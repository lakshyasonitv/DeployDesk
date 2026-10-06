import { db, log, rng, schema as s } from "./ctx";
import { daysAgo, hoursAgo, slugify } from "./helpers";
import { REQS, SCREENS, ALL_POOL_CANDIDATES } from "./fixtures";

/* Reference content from docs/SEED-DATA.md. */

export const VENDORS = [
  { name: "Nimbus Softworks",      code: "NSW-0142", reliability: 4.6, placements: 34 },
  { name: "Sparkbridge Systems",   code: "SBS-0218", reliability: 4.2, placements: 21 },
  { name: "Cygnet Infotech Labs",  code: "CIL-0307", reliability: 4.1, placements: 19 },
  { name: "Helix Systems",         code: "HLX-0411", reliability: 3.9, placements: 14 },
  { name: "Vertex Digital",        code: "VXD-0522", reliability: 3.6, placements: 11 },
  { name: "Trueline Consulting",   code: "TLC-0634", reliability: 3.4, placements: 12 },
  { name: "Orbit Talent Services", code: "OTS-0749", reliability: 3.1, placements: 9 },
] as const;

/** The UI claims 14 supplier benches; these seven stay thinly populated so counts read right. */
export const THIN_VENDORS = [
  "Alcove Technologies", "Brightpath Systems", "Corvus Digital", "Dunlin Software",
  "Everest Infotech", "Foxglove Labs", "Granite Consulting",
] as const;

export const CLIENTS = [
  { name: "Acme Finserv",      code: "ACF-1001" },
  { name: "Kestrel Logistics", code: "KSL-1002" },
  { name: "Northwind Retail",  code: "NWR-1003" },
  { name: "Meridian Pharma",   code: "MRP-1004" },
  { name: "Vantage Insurance", code: "VTI-1005" },
] as const;

const OPS_USERS = [
  { name: "Priya Nair",   short: "P. Nair",  email: "priya.nair@talentvibes.com",   role: "broker" as const },
  { name: "R. Verma",     short: "R. Verma", email: "r.verma@talentvibes.com",      role: "broker" as const },
  { name: "S. Iyer",      short: "S. Iyer",  email: "s.iyer@talentvibes.com",       role: "broker" as const },
  { name: "Devika Rao",   short: "D. Rao",   email: "devika.rao@talentvibes.com",   role: "ops_admin" as const },
  { name: "Manish Gupta", short: "M. Gupta", email: "manish.gupta@talentvibes.com", role: "finance" as const },
];

export type OrgSeed = Awaited<ReturnType<typeof seedOrgs>>;

export async function seedOrgs() {
  const [tv] = await db.insert(s.organizations).values({
    orgType: "talentvibes", name: "Talentvibes", publicCode: "TV-HQ", status: "active",
  }).returning();

  const vendorRows = await db.insert(s.organizations).values([
    ...VENDORS.map((v) => ({
      orgType: "vendor" as const, name: v.name, publicCode: v.code, status: "active" as const,
    })),
    ...THIN_VENDORS.map((name, i) => ({
      orgType: "vendor" as const, name,
      publicCode: `TVS-${String(801 + i)}`, status: "active" as const,
    })),
  ]).returning();

  const clientRows = await db.insert(s.organizations).values(
    CLIENTS.map((c) => ({
      orgType: "client" as const, name: c.name, publicCode: c.code, status: "active" as const,
    })),
  ).returning();

  const byName = new Map([tv, ...vendorRows, ...clientRows].map((o) => [o.name, o]));

  // Ops users first: client_profiles.account_owner_id points at one.
  const opsUsers = await db.insert(s.users).values(
    OPS_USERS.map((u) => ({
      orgId: tv.id, email: u.email, fullName: u.name, role: u.role,
      status: "active" as const, lastLoginAt: hoursAgo(1 + rng() * 6),
    })),
  ).returning();
  const opsByShort = new Map(OPS_USERS.map((u, i) => [u.short, opsUsers[i]]));

  // Acme Finserv: the client-portal demo tenant, with the interview panel from the design.
  const acme = byName.get("Acme Finserv")!;
  const clientUsers = await db.insert(s.users).values([
    { orgId: acme.id, email: "ananya.krishnan@acmefinserv.com", fullName: "Ananya Krishnan", role: "hiring_manager" as const, status: "active" as const, lastLoginAt: hoursAgo(2) },
    { orgId: acme.id, email: "r.sundaram@acmefinserv.com", fullName: "R. Sundaram",  role: "panel_member" as const, status: "active" as const },
    { orgId: acme.id, email: "d.kulkarni@acmefinserv.com", fullName: "D. Kulkarni",  role: "panel_member" as const, status: "active" as const },
    { orgId: acme.id, email: "s.ahuja@acmefinserv.com",    fullName: "S. Ahuja",     role: "panel_member" as const, status: "active" as const },
    ...CLIENTS.slice(1).map((c) => ({
      orgId: byName.get(c.name)!.id,
      email: `hiring@${slugify(c.name)}.com`,
      fullName: `${c.name} Hiring`,
      role: "client_admin" as const, status: "active" as const,
    })),
  ]).returning();

  // Nimbus Softworks: the vendor-portal demo tenant.
  const nimbus = byName.get("Nimbus Softworks")!;
  const vendorUsers = await db.insert(s.users).values([
    { orgId: nimbus.id, email: "vikram.shetty@nimbussoftworks.com", fullName: "Vikram Shetty", role: "vendor_admin" as const, status: "active" as const, lastLoginAt: hoursAgo(3) },
    ...VENDORS.slice(1).map((v) => ({
      orgId: byName.get(v.name)!.id,
      email: `bench@${slugify(v.name)}.com`,
      fullName: `${v.name} Bench Desk`,
      role: "bench_manager" as const, status: "active" as const,
    })),
  ]).returning();

  await db.insert(s.vendorProfiles).values([
    ...VENDORS.map((v) => ({
      orgId: byName.get(v.name)!.id,
      reliabilityScore: v.reliability.toFixed(1),
      placementsCount: v.placements,
      withdrawalCount: v.name === "Orbit Talent Services" ? 4 : v.reliability < 4 ? 1 : 0,
      onboardedAt: daysAgo(200 + rng() * 400),
      notesInternal: v.name === "Orbit Talent Services"
        ? "Repeat withdrawals after client selection; two duplicate submissions. Watch closely."
        : null,
    })),
    ...THIN_VENDORS.map((name) => ({
      orgId: byName.get(name)!.id,
      reliabilityScore: (3.2 + rng() * 1.4).toFixed(1),
      placementsCount: Math.floor(rng() * 6),
      onboardedAt: daysAgo(60 + rng() * 200),
    })),
  ]);

  await db.insert(s.clientProfiles).values(
    CLIENTS.map((c) => ({
      orgId: byName.get(c.name)!.id,
      accountOwnerId: opsByShort.get("P. Nair")!.id,
      defaultNoticeAccepted: ["immediate", "le_30"],
    })),
  );

  log(`  orgs:  1 talentvibes · ${vendorRows.length} vendors · ${clientRows.length} clients`);
  log(`  users: ${opsUsers.length} ops · ${clientUsers.length} client · ${vendorUsers.length} vendor`);

  return {
    tv, byName, opsByShort, opsUsers, clientUsers, vendorUsers,
    acme, nimbus,
    ananya: clientUsers[0],
    panel: clientUsers.slice(1, 4),
    vikram: vendorUsers[0],
    priya: opsByShort.get("P. Nair")!,
  };
}

/* -------------------------------------------------------------------- skills */

export async function seedSkills() {
  const labels = new Set<string>();
  for (const r of REQS) for (const sk of r.skills) labels.add(sk);
  for (const c of ALL_POOL_CANDIDATES) {
    // Pool rows carry no skills array; the talent-pool screen rows do.
    void c;
  }
  for (const row of SCREENS.pool ?? []) {
    for (const sk of ((row.skills as string[]) ?? [])) labels.add(sk);
  }
  for (const row of SCREENS.vendorPipeline ?? []) {
    for (const sk of ((row.skills as string[]) ?? [])) labels.add(sk);
  }
  for (const extra of [
    "React", "TypeScript", "Node.js", "Java Spring Boot", "Kafka", "AWS", "SAP ABAP",
    "Fiori", "HANA", "Salesforce", "Apex", "LWC", ".NET Core", "Azure", "SQL Server",
    "QA Automation", "Playwright", "Selenium", "CI/CD", "React Native", "Next.js",
    "Spark", "Airflow", "QA Strategy", "Flows", "API", "GraphQL", "PostgreSQL",
  ]) labels.add(extra);

  const CATEGORY: Record<string, string> = {
    React: "frontend", TypeScript: "frontend", "Next.js": "frontend", "React Native": "mobile",
    "Node.js": "backend", "Java Spring Boot": "backend", Kafka: "backend", ".NET Core": "backend",
    "SQL Server": "backend", PostgreSQL: "backend", GraphQL: "backend",
    AWS: "cloud", Azure: "cloud",
    "SAP ABAP": "enterprise", Fiori: "enterprise", HANA: "enterprise",
    Salesforce: "enterprise", Apex: "enterprise", LWC: "enterprise", Flows: "enterprise",
    "QA Automation": "qa", Playwright: "qa", Selenium: "qa", "QA Strategy": "qa",
    API: "qa", "CI/CD": "qa",
    Spark: "data", Airflow: "data",
  };
  const ALIASES: Record<string, string[]> = {
    React: ["ReactJS", "React.js"],
    "Node.js": ["Node", "NodeJS"],
    "SAP ABAP": ["ABAP"],
    ".NET Core": ["dotnet core", ".NET", "DotNet"],
    "Java Spring Boot": ["Spring Boot", "SpringBoot"],
    TypeScript: ["TS"],
  };

  const inserted = await db.insert(s.skills).values(
    [...labels].map((label) => ({
      slug: slugify(label),
      label,
      category: CATEGORY[label] ?? "general",
      aliases: ALIASES[label] ?? [],
      isActive: true,
    })),
  ).onConflictDoNothing().returning();

  log(`  skills: ${inserted.length}`);
  return new Map(inserted.map((r) => [r.label, r]));
}

export type SkillMap = Awaited<ReturnType<typeof seedSkills>>;
