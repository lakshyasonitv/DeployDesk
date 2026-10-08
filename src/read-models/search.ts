import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import * as s from "../db/schema";
import { formatPaiseShort } from "../lib/money/paise";
import { formatExperience, istFormat } from "../lib/derived";

/**
 * Search — one visible box per portal.
 *
 * Replaces a ⌘K palette that was never built. The product owner's words on the shortcut
 * were "what does that even mean": the audience is senior staff who do not want a keyboard
 * shortcut to learn, so this is an ordinary search field that shows results as you type.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE THREE FUNCTIONS AND NOT ONE WITH A ROLE PARAMETER
 * ---------------------------------------------------------------------------
 *
 * ADR-003 and CLAUDE.md are explicit: no shared DTO across portals, and no
 * `if (role === 'ops')` inside a serializer. Search is the most tempting place in the
 * product to break that rule, because "search everything" sounds like one query — but the
 * three portals are allowed to see completely different things, and a single function with
 * a branch inside it is one edit away from returning a vendor name to a client.
 *
 * So each portal has its own function, its own queries and its own result shape:
 *
 *   CLIENT  its own roles, its own shortlisted candidates as TV-#### with a rate BAND,
 *           its own people working. Never a supplier name, never a vendor rate.
 *   VENDOR  its own bench by name or masked id, its own test scores, its own invoices.
 *           Never a client name, never a client rate, never a margin.
 *   OPS     everything, including real names and both rates.
 *
 * Every query is scoped by the caller's `orgId` in its WHERE clause, so a result for
 * another organisation cannot be constructed even by accident.
 */

export interface SearchHit {
  /** Shown as the group heading. Plain language, not a table name. */
  group: string;
  /** The line a human reads first. */
  title: string;
  /** One line of context under it. */
  sub: string;
  href: string;
  /** A short code rendered in mono, when there is one. */
  code?: string;
}

/** Below this, a query is too broad to be useful and too cheap to be a filter. */
const MIN_QUERY = 2;
const PER_GROUP = 5;

function like(q: string) {
  // Escape the LIKE wildcards so a user typing "%" searches for a percent sign.
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/* ====================================================================== */
/*  CLIENT                                                                 */
/* ====================================================================== */

export async function searchClient(clientOrgId: string, query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];
  const pattern = like(q);

  const [roles, candidates, working] = await Promise.all([
    db
      .select({
        code: s.requirements.code,
        roleTitle: s.requirements.roleTitle,
        quantity: s.requirements.quantity,
        stage: s.requirements.stage,
        city: s.requirements.locationCity,
      })
      .from(s.requirements)
      .where(and(
        eq(s.requirements.clientOrgId, clientOrgId),
        or(ilike(s.requirements.roleTitle, pattern), ilike(s.requirements.code, pattern)),
      ))
      .limit(PER_GROUP),

    /**
     * Candidates come from `shortlist_items`, which is the snapshot the client is allowed
     * to read (ADR-009). It has no vendor column and no vendor rate column, so this query
     * structurally cannot leak one — the rate shown is the BAND, derived from the proposed
     * client rate only (ADR-004).
     */
    db
      .select({
        maskedId: s.shortlistItems.maskedId,
        city: s.shortlistItems.baseCity,
        months: s.shortlistItems.experienceMonths,
        bandMin: s.shortlistItems.rateBandMinPaise,
        bandMax: s.shortlistItems.rateBandMaxPaise,
        skills: s.shortlistItems.skillsSnapshot,
        reqCode: s.requirements.code,
      })
      .from(s.shortlistItems)
      .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
      .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
      .where(and(
        eq(s.requirements.clientOrgId, clientOrgId),
        or(
          ilike(s.shortlistItems.maskedId, pattern),
          ilike(s.shortlistItems.baseCity, pattern),
          sql`exists (select 1 from unnest(${s.shortlistItems.skillsSnapshot}) sk where sk ilike ${pattern})`,
        ),
      ))
      .limit(PER_GROUP),

    db
      .select({
        maskedId: s.benchResources.maskedId,
        roleTitle: s.engagements.roleTitle,
        status: s.engagements.status,
      })
      .from(s.engagements)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId))
      .where(and(
        eq(s.engagements.clientOrgId, clientOrgId),
        or(ilike(s.engagements.roleTitle, pattern), ilike(s.benchResources.maskedId, pattern)),
      ))
      .limit(PER_GROUP),
  ]);

  return [
    ...roles.map((r) => ({
      group: "Your open roles",
      title: r.roleTitle,
      sub: `${r.quantity} ${r.quantity === 1 ? "position" : "positions"} · ${r.city ?? "Remote"} · ${r.stage}`,
      href: "/client/requirements",
      code: r.code,
    })),
    ...candidates.map((c) => ({
      group: "Candidates sent to you",
      title: c.maskedId,
      sub: `${formatExperience(c.months)} · ${c.city} · ${formatPaiseShort(c.bandMin)}–${formatPaiseShort(c.bandMax).replace("₹", "")} · ${(c.skills ?? []).slice(0, 3).join(", ")}`,
      href: `/client/shortlists/${c.reqCode.toLowerCase()}`,
      code: c.maskedId,
    })),
    ...working.map((w) => ({
      group: "People working",
      title: w.maskedId,
      sub: `${w.roleTitle} · ${w.status}`,
      href: "/client/engagements",
      code: w.maskedId,
    })),
  ];
}

/* ====================================================================== */
/*  VENDOR                                                                 */
/* ====================================================================== */

export async function searchVendor(vendorOrgId: string, query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];
  const pattern = like(q);

  const [people, tests, invoices] = await Promise.all([
    /**
     * A vendor may search its OWN bench by real name — that is its own employee. The
     * tenancy predicate is what keeps it to its own: `vendor_org_id = the session's org`.
     */
    db
      .select({
        maskedId: s.benchResources.maskedId,
        fullName: s.benchResources.fullName,
        city: s.benchResources.baseCity,
        months: s.benchResources.experienceMonths,
        rate: s.benchResources.vendorRatePaise,
        status: s.benchResources.status,
      })
      .from(s.benchResources)
      .where(and(
        eq(s.benchResources.vendorOrgId, vendorOrgId),
        or(
          ilike(s.benchResources.fullName, pattern),
          ilike(s.benchResources.maskedId, pattern),
          ilike(s.benchResources.baseCity, pattern),
          ilike(s.benchResources.employeeCode, pattern),
        ),
      ))
      .limit(PER_GROUP),

    /**
     * One row per PERSON, not per attempt.
     *
     * A retake means a second `assessments` row, so the plain join listed the same person
     * twice — "Priyanka Joshi" appeared under Skill tests twice because she has two
     * attempts. `distinct on` keeps the highest attempt, ordered so the latest wins, which
     * is also the score a client would be shown.
     */
    db
      .selectDistinctOn([s.benchResources.id], {
        maskedId: s.benchResources.maskedId,
        fullName: s.benchResources.fullName,
        score: s.assessments.overallScore,
        status: s.assessments.status,
        track: s.assessments.track,
        attemptNo: s.assessments.attemptNo,
      })
      .from(s.assessments)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.assessments.resourceId))
      .where(and(
        eq(s.benchResources.vendorOrgId, vendorOrgId),
        or(
          ilike(s.benchResources.fullName, pattern),
          ilike(s.benchResources.maskedId, pattern),
          ilike(s.assessments.track, pattern),
        ),
      ))
      .orderBy(s.benchResources.id, sql`${s.assessments.attemptNo} desc`)
      .limit(PER_GROUP),

    // PAYABLE invoices only. There is no path from here to a receivable row, so a vendor
    // cannot see what a client was charged.
    db
      .select({
        periodMonth: s.invoices.periodMonth,
        total: s.invoices.totalPaise,
        status: s.invoices.status,
      })
      .from(s.invoices)
      .where(and(
        eq(s.invoices.counterpartyOrgId, vendorOrgId),
        eq(s.invoices.direction, "payable"),
        // `invoices` has no number column; the period is what a vendor would search by
        // ("september", "2026-09"), so the date is cast to text and matched.
        sql`${s.invoices.periodMonth}::text ilike ${pattern}`,
      ))
      .limit(PER_GROUP),
  ]);

  return [
    ...people.map((p) => ({
      group: "Your bench",
      title: p.fullName,
      sub: `${p.maskedId} · ${formatExperience(p.months)} · ${p.city} · ${formatPaiseShort(p.rate)} · ${p.status}`,
      href: "/vendor/roster",
      code: p.maskedId,
    })),
    ...tests.map((t) => ({
      group: "Skill tests",
      title: t.fullName,
      // "scored · scored 87" read badly. The score IS the status when there is one.
      sub: t.score != null
        ? `${t.track ?? "test"} · scored ${t.score}${t.attemptNo > 1 ? ` on attempt ${t.attemptNo}` : ""}`
        : `${t.track ?? "test"} · ${String(t.status).replace(/_/g, " ")}`,
      href: "/vendor/assessments",
      code: t.maskedId,
    })),
    ...invoices.map((i) => ({
      group: "Your earnings",
      title: istFormat(i.periodMonth, { month: "long", year: "numeric" }),
      sub: `${formatPaiseShort(i.total)} · ${i.status}`,
      href: "/vendor/earnings",
    })),
  ];
}

/* ====================================================================== */
/*  OPS                                                                    */
/* ====================================================================== */

export async function searchOps(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];
  const pattern = like(q);

  // Ops sees everything, including real names, supplier identity and both rates. No
  // tenancy predicate, because the broker is not a tenant.
  const [roles, people, orgs, dupes] = await Promise.all([
    db
      .select({
        code: s.requirements.code,
        roleTitle: s.requirements.roleTitle,
        stage: s.requirements.stage,
        clientName: s.organizations.name,
      })
      .from(s.requirements)
      .innerJoin(s.organizations, eq(s.organizations.id, s.requirements.clientOrgId))
      .where(or(
        ilike(s.requirements.roleTitle, pattern),
        ilike(s.requirements.code, pattern),
        ilike(s.organizations.name, pattern),
      ))
      .limit(PER_GROUP),

    db
      .select({
        maskedId: s.benchResources.maskedId,
        fullName: s.benchResources.fullName,
        city: s.benchResources.baseCity,
        rate: s.benchResources.vendorRatePaise,
        vendorName: s.organizations.name,
        status: s.benchResources.status,
      })
      .from(s.benchResources)
      .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
      .where(or(
        ilike(s.benchResources.fullName, pattern),
        ilike(s.benchResources.maskedId, pattern),
        ilike(s.benchResources.baseCity, pattern),
        ilike(s.organizations.name, pattern),
      ))
      .limit(PER_GROUP),

    db
      .select({
        name: s.organizations.name,
        code: s.organizations.publicCode,
        orgType: s.organizations.orgType,
        canSupply: s.orgCapabilities.canSupply,
        canHire: s.orgCapabilities.canHire,
      })
      .from(s.organizations)
      .innerJoin(s.orgCapabilities, eq(s.orgCapabilities.orgId, s.organizations.id))
      .where(or(ilike(s.organizations.name, pattern), ilike(s.organizations.publicCode, pattern)))
      .limit(PER_GROUP),

    db
      .select({
        code: s.duplicateFlags.code,
        confidence: s.duplicateFlags.confidence,
        status: s.duplicateFlags.status,
      })
      .from(s.duplicateFlags)
      .where(ilike(s.duplicateFlags.code, pattern))
      .limit(PER_GROUP),
  ]);

  return [
    ...roles.map((r) => ({
      group: "Roles",
      title: r.roleTitle,
      sub: `${r.clientName} · ${r.stage}`,
      href: `/ops/matching/${r.code.toLowerCase()}`,
      code: r.code,
    })),
    ...people.map((p) => ({
      group: "People",
      title: p.fullName,
      sub: `${p.maskedId} · ${p.vendorName} · ${p.city} · ${formatPaiseShort(p.rate)} · ${p.status}`,
      href: "/ops/pool",
      code: p.maskedId,
    })),
    ...orgs.map((o) => ({
      group: "Companies",
      title: o.name,
      sub: o.orgType === "talentvibes" ? "Broker"
        : o.canSupply && o.canHire ? "Both sides"
        : o.canSupply ? "Supplies" : "Hires",
      href: "/ops/organisations",
      code: o.code ?? undefined,
    })),
    ...dupes.map((d) => ({
      group: "Duplicate checks",
      title: d.code,
      sub: `${d.confidence}% confidence · ${d.status}`,
      href: "/ops/duplicates",
      code: d.code,
    })),
  ];
}

/** One entry point for the route handler. The branch is on the PORTAL, not inside a shape. */
export async function searchFor(
  portal: "client" | "vendor" | "ops",
  orgId: string,
  query: string,
): Promise<SearchHit[]> {
  if (portal === "client") return searchClient(orgId, query);
  if (portal === "vendor") return searchVendor(orgId, query);
  return searchOps(query);
}

export { MIN_QUERY };

