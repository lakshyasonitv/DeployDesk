import { eq, inArray, sql } from "drizzle-orm";
import { db, log, schema as s } from "./ctx";
import { deriveRateBand } from "../../lib/money/rate-band";
import type { OrgSeed } from "./orgs";

/**
 * Dual-role organisations, groups and block lists.
 *
 * This module exists because of a bug worth remembering: migration 0002 backfilled
 * `org_capabilities` and `memberships` once, and the next `db:seed` silently destroyed
 * them. The seed truncates `organizations CASCADE`, and both tables reference it with
 * ON DELETE CASCADE, so they emptied and nothing rebuilt them. Any table the seed can
 * cascade into has to be owned by the seed.
 *
 * The four shapes the product needs to exercise (per the dual-role brief):
 *
 *   vendor-only     Nimbus Softworks        can_supply
 *   client-only     Acme Finserv            can_hire
 *   DUAL ROLE       Cygnet Infotech Labs    can_supply AND can_hire
 *   GROUP-LINKED    Helix Systems (supply) + Vantage Insurance (hire), same group
 *
 * The last two are the ones that matter for the self-dealing rule:
 *
 *   - Cygnet has engineers on its own bench AND posts its own requirement. Its own people
 *     must never be offered to it.
 *   - Helix and Vantage are different legal entities in one group. Helix's bench must
 *     never be offered to Vantage either, which is why the rule keys on `group_id` and
 *     not on `org_id`.
 *
 * Plus one block pair, which must hide each side from the other in BOTH directions.
 */

/** Ops declares groups from the MSA. Never inferred from PAN or GSTIN. */
const GROUPS = [
  {
    name: "Helix Group",
    notes: "Declared in the Helix MSA, clause 4.2. Helix Systems and Vantage Insurance "
      + "are subsidiaries of the same holding company.",
    members: ["Helix Systems", "Vantage Insurance"],
  },
];

/** can_supply / can_hire. The broker gets neither — the trigger from 0002 enforces it. */
const CAPABILITIES: Record<string, { supply: boolean; hire: boolean }> = {
  // The dual-role case.
  "Cygnet Infotech Labs": { supply: true, hire: true },
};

/** Bidirectional: one row hides each org from the other. */
const BLOCKS = [
  {
    org: "Northwind Retail",
    blocked: "Orbit Talent Services",
    reason: "Two Orbit submissions withdrew after Northwind selected them. Northwind asked "
      + "not to be shown Orbit profiles again; Orbit must equally not see Northwind work.",
  },
];

export async function seedDualRole(org: OrgSeed) {
  const orgId = (name: string) => {
    const o = org.byName.get(name);
    if (!o) throw new Error(`seedDualRole: unknown organisation ${name}`);
    return o.id;
  };

  /* ---------------------------------------------------------------- groups */

  const groupRows = await db.insert(s.groups).values(
    GROUPS.map((g) => ({ name: g.name, notes: g.notes })),
  ).returning();

  for (const [i, g] of GROUPS.entries()) {
    await db.update(s.organizations)
      .set({ parentGroupId: groupRows[i].id })
      .where(inArray(s.organizations.id, g.members.map(orgId)));
  }
  log(`  groups: ${groupRows.length} (${GROUPS.map((g) => `${g.name}: ${g.members.join(" + ")}`).join("; ")})`);

  /* ----------------------------------------------------- org_capabilities */

  // Authoritative. Derived from org_type except where CAPABILITIES overrides it, and the
  // trigger from migration 0002 keeps organizations.org_type in step.
  const allOrgs = await db
    .select({ id: s.organizations.id, name: s.organizations.name, orgType: s.organizations.orgType })
    .from(s.organizations);

  const capRows = allOrgs.map((o) => {
    const override = CAPABILITIES[o.name];
    const isBroker = o.orgType === "talentvibes";
    return {
      orgId: o.id,
      // The broker is not a participant on either side.
      canSupply: isBroker ? false : (override?.supply ?? o.orgType === "vendor"),
      canHire: isBroker ? false : (override?.hire ?? o.orgType === "client"),
      updatedBy: org.opsByShort.get("D. Rao")!.id, // ops_admin; only ops may change these
    };
  });
  await db.insert(s.orgCapabilities).values(capRows);

  const dual = capRows.filter((c) => c.canSupply && c.canHire).length;
  log(`  org_capabilities: ${capRows.length} (${dual} dual-role)`);

  /* ------------------------------------------------------------ fee model */

  /**
   * A dual-role organisation is put on a FLAT DECLARED FEE, not a hidden markup.
   *
   * This is the commercial half of the masking rule and the schema comment on
   * `organizations.fee_model` has always described it, but nothing implemented it — every
   * organisation sat on the column's `hidden_markup` default, the dual-role one included.
   *
   * Why it matters: a company that both supplies and hires can compare what it is PAID as
   * a supplier against what it is CHARGED as a client. With a hidden markup those two
   * numbers reveal the spread. With the fee declared there is no spread left to infer —
   * which is why the brief pairs this with "the two rate views never share a screen"
   * rather than relying on screen separation alone.
   */
  const dualRoleIds = capRows.filter((c) => c.canSupply && c.canHire).map((c) => c.orgId);
  if (dualRoleIds.length) {
    await db.update(s.organizations)
      .set({ feeModel: "flat_declared_fee" })
      .where(inArray(s.organizations.id, dualRoleIds));
    log(`  fee_model: ${dualRoleIds.length} dual-role org(s) -> flat_declared_fee (no margin to infer)`);
  }

  /* ------------------------- promote the dual-role org's admin ----------- */

  /**
   * The dual-role organisation's user must actually HOLD both roles, or acceptance test 2
   * ("a dual-role user can switch workspaces and each side shows only its own rate") has
   * no data to run against.
   *
   * The seed creates non-demo vendor users as `bench_manager`, which maps to `supply`
   * only — correct for a supply-only company, wrong for this one. A dual-role company's
   * admin is the person who sees both sides, so promote them to `vendor_admin`.
   */
  for (const name of Object.keys(CAPABILITIES)) {
    const cap = CAPABILITIES[name];
    if (!cap.supply || !cap.hire) continue;
    await db.update(s.users)
      .set({ role: "vendor_admin" })
      .where(eq(s.users.orgId, orgId(name)));
    log(`  promoted ${name} users to vendor_admin (dual-role: must hold both sides)`);
  }

  /* ---------------------------------------------------------- memberships */

  // ADR-012: a user still belongs to exactly ONE organisation (unique on user_id). What
  // changed is that a membership holds a SET of roles.
  const users = await db
    .select({ id: s.users.id, orgId: s.users.orgId, role: s.users.role, email: s.users.email })
    .from(s.users);

  const capByOrg = new Map(capRows.map((c) => [c.orgId, c]));

  const memberRows = users.map((u) => {
    const cap = capByOrg.get(u.orgId);
    const roles: Array<"supply" | "demand" | "admin"> = [];

    if (["ops_admin", "broker", "finance"].includes(u.role)) {
      roles.push("admin");
    } else {
      // At a dual-role organisation an admin holds BOTH sides; a bench manager or hiring
      // manager holds only their own, even when the org has both capabilities.
      const isOrgAdmin = u.role === "vendor_admin" || u.role === "client_admin";
      if (cap?.canSupply && (isOrgAdmin || u.role === "bench_manager")) roles.push("supply");
      if (cap?.canHire && (isOrgAdmin || ["hiring_manager", "panel_member"].includes(u.role))) {
        roles.push("demand");
      }
      if (isOrgAdmin) roles.push("admin");
    }

    // The CHECK constraint requires at least one role.
    if (!roles.length) roles.push(cap?.canSupply ? "supply" : "demand");
    return { userId: u.id, orgId: u.orgId, roles };
  });
  await db.insert(s.memberships).values(memberRows);

  const bothSides = memberRows.filter((m) => m.roles.includes("supply") && m.roles.includes("demand")).length;
  log(`  memberships: ${memberRows.length} (${bothSides} holding both supply and demand)`);

  /* ---------------------------------------------------------- org_blocks */

  const blockRows = BLOCKS.map((b) => ({
    orgId: orgId(b.org),
    blockedOrgId: orgId(b.blocked),
    reason: b.reason,
    createdBy: org.opsByShort.get("D. Rao")!.id,
  }));
  await db.insert(s.orgBlocks).values(blockRows);
  log(`  org_blocks: ${blockRows.length} (${BLOCKS.map((b) => `${b.org} <-> ${b.blocked}`).join("; ")})`);

  return {
    groupIdByOrg: new Map(
      GROUPS.flatMap((g, i) => g.members.map((m) => [orgId(m), groupRows[i].id] as const)),
    ),
    dualRoleOrgs: Object.keys(CAPABILITIES).filter((n) => CAPABILITIES[n].supply && CAPABILITIES[n].hire),
    blocks: BLOCKS.map((b) => ({ a: orgId(b.org), b: orgId(b.blocked) })),
  };
}

export type DualRoleSeed = Awaited<ReturnType<typeof seedDualRole>>;

/**
 * A requirement posted BY the dual-role organisation, so the self-dealing rule has
 * something to refuse. Cygnet Infotech Labs has engineers on its own bench; this is
 * Cygnet hiring, and its own people must not be offered back to it.
 */
export async function seedDualRoleRequirement(org: OrgSeed) {
  const cygnet = org.byName.get("Cygnet Infotech Labs")!;
  const admin = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.orgId, cygnet.id))
    .limit(1);

  const [req] = await db.insert(s.requirements).values({
    code: "REQ-2320",
    clientOrgId: cygnet.id,
    createdBy: admin[0].id,
    ownerUserId: org.opsByShort.get("R. Verma")!.id,
    roleTitle: "Java Spring Boot Engineers",
    quantity: 2,
    experienceBand: "5-8",
    budgetMinPaise: 15_500_000,
    budgetMaxPaise: 19_000_000,
    engagementType: "contract",
    durationText: "6 months, extendable",
    locationCity: "Bangalore",
    workMode: "hybrid",
    hybridDays: 3,
    startDate: null,
    noticeAccepted: ["immediate", "le_30"],
    clientNote: "Overflow for the Q4 platform programme. We are a supplier on this "
      + "exchange too — do not show us our own people.",
    stage: "matching",
    slaDueAt: new Date(Date.now() + 20 * 3_600_000),
    slaWindowHours: 36,
    postedAt: new Date(Date.now() - 5 * 3_600_000),
  }).returning();

  /**
   * Source a pool for it, which is the whole point of the scenario.
   *
   * Without this the requirement sits with zero candidates and the dual-role story cannot
   * be demonstrated — and worse, a test asserting "its own people are absent" would pass
   * trivially against an empty pool. The pool is built from resources that pass the
   * self-dealing and block rules, so Cygnet's own engineers are excluded while everyone
   * else's are not.
   *
   * The exclusions are expressed in SQL using the same functions the trigger uses, so the
   * seed cannot disagree with the enforcement.
   */
  const eligible = await db.execute<{ id: string; vendor_rate_paise: number }>(sql`
    select b.id, b.vendor_rate_paise
      from bench_resources b
      join resource_skills rs on rs.resource_id = b.id
      join skills sk on sk.id = rs.skill_id
     where b.status in ('listed', 'in_process')
       and sk.label in ('Java Spring Boot', 'Kafka', 'PostgreSQL')
       and not is_self_dealing(b.id, ${req.id})
       and not match_is_blocked(b.id, ${req.id})
     group by b.id, b.vendor_rate_paise
     order by b.vendor_rate_paise
     limit 5
  `) as unknown as Array<{ id: string; vendor_rate_paise: number }>;

  if (eligible.length) {
    await db.insert(s.matches).values(
      eligible.map((r, i) => ({
        requirementId: req.id,
        resourceId: r.id,
        // Plausible component spread; algo_score is the weighted sum (ADR-011).
        scoreSkill: 92 - i * 4, scoreTest: 84 - i * 3, scoreExpFit: 88 - i * 2,
        scoreRate: 90 - i * 5, scoreFreshness: 95 - i * 6, scoreVendor: 86 - i * 3,
        algoScore: Math.round(
          (92 - i * 4) * 0.30 + (84 - i * 3) * 0.22 + (88 - i * 2) * 0.16 +
          (90 - i * 5) * 0.14 + (95 - i * 6) * 0.10 + (86 - i * 3) * 0.08,
        ),
        reasonLine: i === 0
          ? "Strongest Spring Boot depth in the eligible pool"
          : "Solid platform background, available this quarter",
        algoRank: i + 1,
        proposedClientRatePaise: Math.round(Number(r.vendor_rate_paise) / (1 - 0.24)),
        eligibility: "eligible" as const,
        computedAt: new Date(),
      })),
    );
  }

  /**
   * Send a shortlist for it, so the dual-role organisation's HIRING side has something to
   * show.
   *
   * This is not decoration. Acceptance test 2 is "a dual-role user can switch workspaces
   * and each side shows only its own rate" — and with no shortlist, Cygnet's hiring side
   * renders no rate at all, so the test passes by showing NOTHING rather than by showing
   * the right thing. That is the same vacuous-pass trap as the empty candidate pool this
   * function already guards against above: an assertion that nothing forbidden is present
   * is worthless when nothing at all is present.
   *
   * Bands come from `deriveRateBand(proposed_client_rate)` — ADR-004, the client rate
   * only, never the vendor rate. The snapshot is immutable by design (ADR-009), so these
   * values are copied in rather than joined at read time.
   */
  if (eligible.length) {
    const matched = await db
      .select({
        resourceId: s.matches.resourceId,
        proposed: s.matches.proposedClientRatePaise,
        rank: s.matches.algoRank,
        maskedId: s.benchResources.maskedId,
        experienceMonths: s.benchResources.experienceMonths,
        baseCity: s.benchResources.baseCity,
        availableFrom: s.benchResources.availableFrom,
      })
      .from(s.matches)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
      .where(eq(s.matches.requirementId, req.id))
      .orderBy(s.matches.algoRank);

    const [shortlist] = await db.insert(s.shortlists).values({
      requirementId: req.id,
      sequenceNo: 1,
      sentBy: org.opsByShort.get("R. Verma")!.id,
      brokerNote: "Four profiles that fit the Spring Boot brief. Rate bands reflect the "
        + "declared fee already applied, so there is no markup to negotiate separately.",
      sentAt: new Date(Date.now() - 2 * 3_600_000),
      openedAt: new Date(Date.now() - 1 * 3_600_000),
    }).returning();

    // Skills per resource, for the snapshot. One query, not one per candidate.
    const skillRows = await db
      .select({ resourceId: s.resourceSkills.resourceId, label: s.skills.label })
      .from(s.resourceSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
      .where(inArray(s.resourceSkills.resourceId, matched.map((m) => m.resourceId)));
    const skillsBy = new Map<string, string[]>();
    for (const r of skillRows) {
      skillsBy.set(r.resourceId, [...(skillsBy.get(r.resourceId) ?? []), r.label]);
    }

    const picked = matched.slice(0, 4);
    await db.insert(s.shortlistItems).values(picked.map((m, i) => {
      const band = deriveRateBand(Number(m.proposed));
      return {
        shortlistId: shortlist.id,
        resourceId: m.resourceId,
        maskedId: m.maskedId,
        position: i + 1,
        experienceMonths: m.experienceMonths,
        baseCity: m.baseCity,
        skillsSnapshot: skillsBy.get(m.resourceId) ?? [],
        scoreOverall: 88 - i * 3,
        scoreCoding: 90 - i * 3,
        scoreDsa: 86 - i * 2,
        scoreSystemDesign: 84 - i * 4,
        scoreCommunication: 89 - i * 2,
        assessmentAttemptNo: 1,
        assessmentTestedOn: new Date(Date.now() - (9 + i) * 86_400_000)
          .toISOString().slice(0, 10),
        availabilityLabel: m.availableFrom ? "30 days notice" : "Immediate",
        availabilityKind: (m.availableFrom ? "notice" : "immediate") as "notice" | "immediate",
        rateBandMinPaise: band.minPaise,
        rateBandMaxPaise: band.maxPaise,
        clientDecision: (i === 0 ? "selected" : "pending") as "selected" | "pending",
        decidedAt: i === 0 ? new Date(Date.now() - 30 * 60_000) : null,
      };
    }));

    await db.update(s.requirements)
      .set({ stage: "shortlisted" })
      .where(eq(s.requirements.id, req.id));

    log(`    shortlist sent: ${picked.length} masked profiles, bands from the client rate (ADR-004)`);
  }

  const [ownCount] = await db.execute<{ n: number }>(sql`
    select own_bench_matches as n from ops_v_own_bench_matches where requirement_id = ${req.id}
  `) as unknown as Array<{ n: number }>;

  log(`  dual-role requirement: ${req.code} posted BY Cygnet Infotech Labs (also a supplier)`);
  log(`    sourced ${eligible.length} eligible candidates; ${Number(ownCount?.n) || 0} on its OWN bench excluded (ops-only note)`);
  return req;
}
