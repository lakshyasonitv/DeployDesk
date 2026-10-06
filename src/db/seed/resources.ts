import { db, log, rng, schema as s } from "./ctx";
import { ALL_POOL_CANDIDATES, type PoolCandidate } from "./fixtures";
import {
  daysAgo, fixtureDateToOffset, freshnessLabelToLastConfirmed, hoursAgo,
  parseAssessment, parseExperienceToMonths, parseNotice, slugify,
} from "./helpers";
import { parseMoneyToPaise } from "../../lib/money/paise";
import { identityHash } from "../../lib/masked-id";
import type { OrgSeed, SkillMap } from "./orgs";

/**
 * Bench resources: the 21 candidates across the four ops pools, plus six that the
 * fixtures reference only from other screens, plus generated filler so the dashboards'
 * counts (42 on the Nimbus bench, 27 listed, 64% utilisation) read correctly.
 *
 * Vendor attribution follows the OPS POOLS wherever the Nimbus roster table disagrees —
 * docs/SEED-DATA.md calls the pools authoritative, because ops sees unmasked truth.
 */

/** Skills per candidate. The pools carry no skills array, so this comes from the design. */
const SKILLS_BY_ID: Record<string, string[]> = {
  "TV-4821": ["React", "TypeScript", "Node.js"],
  "TV-6620": ["QA Automation", "Playwright", "Selenium", "CI/CD"],
  "TV-7715": ["React Native", "React", "TypeScript"],
  "TV-7024": ["React", "TypeScript"],
  "TV-6612": ["Next.js", "React"],
  "TV-5107": ["Java Spring Boot", "Kafka", "AWS"],
  "TV-5533": ["Java Spring Boot", "Kafka", "PostgreSQL"],
  "TV-7702": ["Java Spring Boot", "PostgreSQL", "Node.js"],
  "TV-6119": ["AWS", "Node.js", "Java Spring Boot"],
  "TV-6845": ["Node.js", "AWS"],
  "TV-5981": ["Node.js", "Kafka"],
  "TV-7188": ["Playwright", "API", "QA Automation"],
  "TV-4102": ["QA Automation", "Selenium", "CI/CD"],
  "TV-6907": ["Playwright", "Selenium"],
  "TV-7341": ["QA Strategy", "API", "Selenium"],
  "TV-6488": ["Playwright", "QA Automation"],
  "TV-4488": ["SAP ABAP", "Fiori", "HANA"],
  "TV-5990": ["SAP ABAP", "HANA"],
  "TV-6833": ["Salesforce", "Apex", "LWC"],
  "TV-6104": [".NET Core", "Azure", "SQL Server"],
  "TV-3964": [".NET Core", "Azure", "SQL Server"],
  "TV-5302": ["Salesforce", "Apex", "LWC"],
  "TV-3310": ["Java Spring Boot", "Kafka"],
  "TV-2984": [".NET Core", "Azure"],
  "TV-3877": ["Salesforce", "Apex"],
  "TV-4455": ["SAP ABAP", "Fiori"],
  "TV-7188-B": ["React", "TypeScript"],
};

const ASSESSMENT_TRACK: Record<string, string> = {
  React: "Frontend / React", TypeScript: "Frontend / React", "Next.js": "Frontend / React",
  "React Native": "Mobile / React Native",
  "Java Spring Boot": "Backend / Java", "Node.js": "Backend / Node", ".NET Core": "Backend / .NET",
  "QA Automation": "QA Automation", Playwright: "QA Automation", Selenium: "QA Automation",
  "QA Strategy": "QA Automation",
  "SAP ABAP": "Enterprise / SAP", Salesforce: "Enterprise / Salesforce", Apex: "Enterprise / Salesforce",
};

/** The four section scores. The pools carry only a composite, so split it deterministically. */
function sectionScores(overall: number, idSeed: number) {
  const jitter = (n: number) => Math.max(40, Math.min(100, overall + n));
  return {
    coding: jitter(3 + (idSeed % 5)),
    dsa: jitter(-4 - (idSeed % 3)),
    systemDesign: jitter(-6 + (idSeed % 7)),
    communication: jitter(2 + (idSeed % 4)),
  };
}

/** Resources the fixtures reference only from the placement / duplicate screens. */
interface ExtraResource {
  maskedId: string;
  name: string;
  vendor: string;
  city: string;
  exp: string;
  vendorRate: string;
  status: "listed" | "deployed" | "in_process";
  fresh: string;
  score: string;
  notice: string;
  note: string;
  /** Share identity hashes with another resource, to make a duplicate pair real. */
  sameIdentityAs?: string;
}

const EXTRAS: ExtraResource[] = [
  { maskedId: "TV-5302", name: "Kavya Menon", vendor: "Trueline Consulting", city: "Pune",
    exp: "3.8y", vendorRate: "₹96,000", status: "in_process", fresh: "Expiring 11d",
    score: "85 · 15 Aug", notice: "1 Oct",
    note: "Two Service Cloud implementations; on the REQ-2291 shortlist at attempt 2." },

  { maskedId: "TV-3310", name: "Priyanka Joshi", vendor: "Nimbus Softworks", city: "Pune",
    exp: "7.4y", vendorRate: "₹1,62,000", status: "deployed", fresh: "Confirmed 1d",
    score: "87 · 11 Aug", notice: "Immediate",
    note: "Placed at Acme Finserv since March; best-performing placement of the quarter." },

  { maskedId: "TV-2984", name: "Nikhil Sharma", vendor: "Orbit Talent Services", city: "Hyderabad",
    exp: "4.9y", vendorRate: "₹1,18,000", status: "deployed", fresh: "Confirmed 4d",
    score: "76 · 02 Aug", notice: "Immediate",
    note: "Placed at Northwind Retail since April. Distinct record from TV-3964." },

  { maskedId: "TV-3877", name: "Rahul Krishnan", vendor: "Trueline Consulting", city: "Bangalore",
    exp: "5.2y", vendorRate: "₹96,000", status: "deployed", fresh: "Confirmed 6d",
    score: "82 · 29 Jul", notice: "Immediate",
    note: "Salesforce developer at Northwind Retail since May; extension likely." },

  // docs/SEED-DATA.md flags that Farhan Qureshi appears as both TV-5990 and TV-4455 and
  // asks for a decision. Taken as a DISTINCT placement record, which is one of the two
  // options it offers: TV-5990 stays the bench profile, TV-4455 is the placed engagement.
  { maskedId: "TV-4455", name: "Farhan Qureshi", vendor: "Nimbus Softworks", city: "Bangalore",
    exp: "9.4y", vendorRate: "₹2,15,000", status: "deployed", fresh: "Confirmed 2d",
    score: "79 · 28 Jul", notice: "Immediate",
    note: "Mid-month start on 1 Aug, billed pro-rata. Separate record from the TV-5990 bench profile." },

  // Submission B of the DUP-0148 pair: the same human, submitted by a second vendor.
  // The design labels it TV-7188-B; that is an ops-only display form (docs/MASKING.md)
  // and clients never see a suffixed id. Note the fixture oddity that TV-7188 itself
  // belongs to a different person — the suffix is the design's, not a real relation.
  { maskedId: "TV-7188-B", name: "A. Rathore", vendor: "Orbit Talent Services", city: "Bangalore",
    exp: "6.5y", vendorRate: "₹1,52,000", status: "listed", fresh: "Unconfirmed 6d",
    score: "Not started", notice: "Immediate",
    note: "Duplicate of an earlier Nimbus submission — see DUP-0148.",
    sameIdentityAs: "TV-4821" },
];

/** Shared employment history makes the duplicate employer-overlap signal real. */
const EMPLOYERS: Record<string, Array<[string, string, string, string]>> = {
  "TV-4821": [
    ["Zeta Commerce", "Senior Frontend Engineer", "2021-07-01", "2024-09-30"],
    ["Pallava Digital", "Frontend Engineer", "2019-04-01", "2021-06-30"],
    ["Inflexion Labs", "Software Engineer", "2018-01-01", "2019-03-31"],
  ],
  "TV-7188-B": [
    ["Zeta Commerce", "Frontend Engineer", "2021-06-01", "2024-10-31"],
    ["Pallava Digital", "Frontend Engineer", "2019-03-01", "2021-05-31"],
    ["Inflexion Labs", "Engineer", "2017-11-01", "2019-02-28"],
  ],
  "TV-3964": [
    ["Mahanadi Systems", ".NET Engineer", "2021-01-01", "2024-08-31"],
    ["Claimspoint", "Developer", "2019-06-01", "2020-12-31"],
  ],
  "TV-6104": [
    ["Mahanadi Systems", ".NET Engineer", "2021-02-01", "2024-07-31"],
    ["Claimspoint", "Developer", "2019-05-01", "2020-11-30"],
  ],
};

const FILLER_FIRST = ["Aditya","Kavita","Rohan","Sneha","Vikas","Pooja","Harsh","Lata","Nitin","Anjali","Sameer","Ritu","Girish","Swati","Mohit","Jaya","Rakesh","Nandini","Varun","Preeti","Suraj","Bhavna","Yash","Komal","Deepak","Shalini","Ajay","Rupa","Kunal","Megha","Tarun","Ira","Zoya","Omkar","Ashwin"];
const FILLER_LAST  = ["Sharma","Patel","Reddy","Nair","Das","Gupta","Joshi","Menon","Singh","Rao","Bhat","Kaul","Shetty","Pillai","Kulkarni","Bose","Mehta","Chopra","Saxena","Verma"];
const CITIES = ["Bangalore","Pune","Hyderabad","Jaipur","Chennai","Noida","Mumbai"];
const FILLER_SKILLS = [
  ["React","TypeScript"], ["Node.js","AWS"], ["Java Spring Boot","Kafka"],
  ["Playwright","QA Automation"], [".NET Core","Azure"], ["Salesforce","Apex"],
  ["SAP ABAP","Fiori"], ["Spark","Airflow"],
];

export async function seedResources(org: OrgSeed, skills: SkillMap) {
  const vendorIdOf = (name: string) => {
    const o = org.byName.get(name);
    if (!o) throw new Error(`seedResources: unknown vendor ${name}`);
    return o.id;
  };

  type Row = typeof s.benchResources.$inferInsert;
  const rows: Row[] = [];
  const meta = new Map<string, {
    skills: string[]; score: string; overall?: number; vendor: string; identityKey: string;
  }>();

  /* ---- the 21 pool candidates ---- */
  for (const c of ALL_POOL_CANDIDATES) {
    const notice = parseNotice(c.notice);
    const identityKey = c.id; // pool candidates each have their own identity
    rows.push({
      vendorOrgId: vendorIdOf(c.vendor),
      maskedId: c.id,
      fullName: c.name,
      employeeCode: `${org.byName.get(c.vendor)!.publicCode}-${c.id.slice(3)}`,
      baseCity: c.city,
      experienceMonths: parseExperienceToMonths(c.exp),
      availableFrom: notice.availableFrom ? notice.availableFrom.toISOString().slice(0, 10) : null,
      noticePeriodDays: notice.noticePeriodDays,
      workModes: c.city === "Remote" ? ["remote"] : ["onsite", "hybrid", "remote"],
      vendorRatePaise: parseMoneyToPaise(c.rate),
      status: c.notice === "30 Sep" ? "deployed" : "listed",
      lastConfirmedAt: freshnessLabelToLastConfirmed(c.fresh),
      listedAt: daysAgo(20 + rng() * 40),
      contactEmail: `${slugify(c.name)}@${slugify(c.vendor)}.com`,
      contactPhone: `+9198${String(10_000_000 + Math.floor(rng() * 89_999_999))}`,
      panHash: identityHash(`PAN:${identityKey}`),
      phoneHash: identityHash(`PHONE:${identityKey}`),
      emailHash: identityHash(`EMAIL:${identityKey}`),
      githubHandle: slugify(c.name).replace(/-/g, ""),
      lastProjectNote: c.last,
      cvObjectKey: `cv/${c.id}.pdf`,
    });
    meta.set(c.id, { skills: SKILLS_BY_ID[c.id] ?? ["React"], score: c.score, vendor: c.vendor, identityKey });
  }

  /* ---- the six extras ---- */
  for (const e of EXTRAS) {
    const notice = parseNotice(e.notice);
    const identityKey = e.sameIdentityAs ?? e.maskedId;
    rows.push({
      vendorOrgId: vendorIdOf(e.vendor),
      maskedId: e.maskedId,
      fullName: e.name,
      employeeCode: `${org.byName.get(e.vendor)!.publicCode}-${e.maskedId.slice(3, 7)}`,
      baseCity: e.city,
      experienceMonths: parseExperienceToMonths(e.exp),
      availableFrom: notice.availableFrom ? notice.availableFrom.toISOString().slice(0, 10) : null,
      noticePeriodDays: notice.noticePeriodDays,
      workModes: ["onsite", "hybrid", "remote"],
      vendorRatePaise: parseMoneyToPaise(e.vendorRate),
      status: e.status,
      lastConfirmedAt: freshnessLabelToLastConfirmed(e.fresh),
      listedAt: daysAgo(30 + rng() * 60),
      contactEmail: `${slugify(e.name)}@${slugify(e.vendor)}.com`,
      contactPhone: `+9198${String(10_000_000 + Math.floor(rng() * 89_999_999))}`,
      // The duplicate pair shares identity hashes — that is what the signals detect.
      panHash: identityHash(`PAN:${identityKey}`),
      phoneHash: identityHash(`PHONE:${identityKey}`),
      emailHash: identityHash(`EMAIL:${identityKey}`),
      githubHandle: slugify(e.sameIdentityAs ? "Arjun Rathore" : e.name).replace(/-/g, ""),
      lastProjectNote: e.note,
      cvObjectKey: `cv/${e.maskedId}.pdf`,
    });
    meta.set(e.maskedId, { skills: SKILLS_BY_ID[e.maskedId] ?? ["React"], score: e.score, vendor: e.vendor, identityKey });
  }

  /* ---- filler, so the dashboard counts are honest ----
     Nimbus: 42 on bench total. 6 named pool rows + 2 extras (TV-3310, TV-4455) = 8,
     so 34 generated. Freshness distribution per docs/SEED-DATA.md: 32 confirmed,
     7 expiring, 3 unconfirmed across the listed set.                                  */
  const nimbusNamed = rows.filter((r) => r.vendorOrgId === org.nimbus.id).length;
  const fillerTargets: Array<[string, number]> = [
    ["Nimbus Softworks", 42 - nimbusNamed],
    ["Sparkbridge Systems", 16], ["Cygnet Infotech Labs", 14], ["Helix Systems", 12],
    ["Vertex Digital", 10], ["Trueline Consulting", 11], ["Orbit Talent Services", 8],
  ];
  const takenIds = new Set(rows.map((r) => r.maskedId));
  let fillerCount = 0;
  for (const [vendorName, n] of fillerTargets) {
    for (let i = 0; i < n; i++) {
      let maskedId = "";
      do { maskedId = `TV-${1000 + Math.floor(rng() * 9000)}`; } while (takenIds.has(maskedId));
      takenIds.add(maskedId);

      const sk = FILLER_SKILLS[Math.floor(rng() * FILLER_SKILLS.length)];
      const name = `${FILLER_FIRST[Math.floor(rng() * FILLER_FIRST.length)]} ${FILLER_LAST[Math.floor(rng() * FILLER_LAST.length)]}`;
      const roll = rng();
      const freshDays = roll < 0.76 ? Math.floor(rng() * 9) : roll < 0.93 ? 10 + Math.floor(rng() * 4) : 14 + Math.floor(rng() * 14);
      const statusRoll = rng();
      const status = statusRoll < 0.64 ? "listed" : statusRoll < 0.78 ? "in_process" : statusRoll < 0.9 ? "deployed" : "draft";

      rows.push({
        vendorOrgId: vendorIdOf(vendorName),
        maskedId, fullName: name,
        employeeCode: `${org.byName.get(vendorName)!.publicCode}-${maskedId.slice(3)}`,
        baseCity: CITIES[Math.floor(rng() * CITIES.length)],
        experienceMonths: 24 + Math.floor(rng() * 110),
        availableFrom: null,
        noticePeriodDays: [0, 15, 30, 60][Math.floor(rng() * 4)],
        workModes: ["onsite", "hybrid", "remote"],
        vendorRatePaise: (80 + Math.floor(rng() * 140)) * 1000 * 100,
        status: status as Row["status"],
        lastConfirmedAt: daysAgo(freshDays),
        listedAt: daysAgo(10 + rng() * 90),
        contactEmail: `${slugify(name)}.${maskedId.slice(3)}@${slugify(vendorName)}.com`,
        contactPhone: `+9197${String(10_000_000 + Math.floor(rng() * 89_999_999))}`,
        panHash: identityHash(`PAN:${maskedId}`),
        phoneHash: identityHash(`PHONE:${maskedId}`),
        emailHash: identityHash(`EMAIL:${maskedId}`),
        githubHandle: slugify(name).replace(/-/g, ""),
        lastProjectNote: `${sk.join(" + ")} work at a mid-size product company.`,
        cvObjectKey: `cv/${maskedId}.pdf`,
      });
      meta.set(maskedId, {
        skills: sk, score: rng() < 0.72 ? `${70 + Math.floor(rng() * 25)} · 10 Aug` : "Not started",
        vendor: vendorName, identityKey: maskedId,
      });
      fillerCount++;
    }
  }

  const inserted = await db.insert(s.benchResources).values(rows).returning();
  const byMasked = new Map(inserted.map((r) => [r.maskedId, r]));
  log(`  bench_resources: ${inserted.length} (${rows.length - fillerCount} from fixtures, ${fillerCount} generated)`);

  /* ---- resource_skills ---- */
  const skillRows: Array<typeof s.resourceSkills.$inferInsert> = [];
  for (const [maskedId, m] of meta) {
    const r = byMasked.get(maskedId);
    if (!r) continue;
    m.skills.forEach((label, idx) => {
      const sk = skills.get(label);
      if (!sk) return;
      skillRows.push({
        resourceId: r.id, skillId: sk.id, isPrimary: idx === 0,
        years: ((r.experienceMonths / 12) * (idx === 0 ? 0.8 : 0.5)).toFixed(1),
      });
    });
  }
  await db.insert(s.resourceSkills).values(skillRows).onConflictDoNothing();
  log(`  resource_skills: ${skillRows.length}`);

  /* ---- employment_history ---- */
  const empRows: Array<typeof s.employmentHistory.$inferInsert> = [];
  for (const [maskedId, list] of Object.entries(EMPLOYERS)) {
    const r = byMasked.get(maskedId);
    if (!r) continue;
    for (const [employer, title, start, end] of list) {
      empRows.push({
        resourceId: r.id, employerName: employer, employerSlug: slugify(employer),
        startDate: start, endDate: end, title,
      });
    }
  }
  await db.insert(s.employmentHistory).values(empRows);
  log(`  employment_history: ${empRows.length}`);

  /* ---- assessments ---- */
  const assessRows: Array<typeof s.assessments.$inferInsert> = [];
  for (const [maskedId, m] of meta) {
    const r = byMasked.get(maskedId);
    if (!r) continue;
    const a = parseAssessment(m.score);
    const primary = m.skills[0] ?? "React";
    const seed = Number(maskedId.replace(/\D/g, "")) || 1;
    const sections = a.overall != null ? sectionScores(a.overall, seed) : null;
    // Attempt 2 for the two candidates the design shows on a retake.
    const attemptNo = maskedId === "TV-5302" || maskedId === "TV-3964" ? 2 : 1;
    assessRows.push({
      resourceId: r.id,
      provider: "invigil",
      providerRef: a.status === "not_started" ? null : `inv_${maskedId.toLowerCase().replace("-", "")}`,
      attemptNo,
      status: a.status,
      track: ASSESSMENT_TRACK[primary] ?? "General Engineering",
      invitedAt: a.status === "not_started" ? null : a.completedAt ? new Date(a.completedAt.getTime() - 3 * 86_400_000) : hoursAgo(20),
      startedAt: a.completedAt,
      completedAt: a.completedAt,
      validUntil: a.validUntil,
      overallScore: a.overall,
      scoreCoding: sections?.coding ?? null,
      scoreDsa: sections?.dsa ?? null,
      scoreSystemDesign: sections?.systemDesign ?? null,
      scoreCommunication: sections?.communication ?? null,
      reportObjectKey: a.status === "scored" ? `reports/${maskedId}.pdf` : null,
      // Name-free summary: this is what may reach a client. No full name, no vendor.
      summaryJson: sections
        ? {
            masked_id: maskedId, track: ASSESSMENT_TRACK[primary] ?? "General Engineering",
            overall: a.overall, attempt: attemptNo,
            sections: {
              coding: sections.coding, dsa: sections.dsa,
              system_design: sections.systemDesign, communication: sections.communication,
            },
          }
        : null,
      proctoringFlags: a.status === "scored" ? { identity_verified: true, tab_switches: Math.floor(rng() * 3) } : null,
    });
  }
  await db.insert(s.assessments).values(assessRows);
  log(`  assessments: ${assessRows.length}`);

  /* ---- availability_confirmations: the latest click behind last_confirmed_at ---- */
  const confirmRows: Array<typeof s.availabilityConfirmations.$inferInsert> = [];
  const benchManagerOf = new Map(org.vendorUsers.map((u) => [u.orgId, u]));
  for (const r of inserted) {
    if (!r.lastConfirmedAt) continue;
    const u = benchManagerOf.get(r.vendorOrgId);
    if (!u) continue;
    confirmRows.push({
      resourceId: r.id, confirmedBy: u.id, confirmedAt: r.lastConfirmedAt,
      method: rng() < 0.6 ? "single" : "bulk",
    });
  }
  await db.insert(s.availabilityConfirmations).values(confirmRows);
  log(`  availability_confirmations: ${confirmRows.length}`);

  /* ---- bulk import history: bench_aug26.csv, 38 rows, 34 listed, 4 needing review ---- */
  const [imp] = await db.insert(s.bulkImports).values({
    vendorOrgId: org.nimbus.id,
    uploadedBy: org.vikram.id,
    filename: "bench_aug26.csv",
    objectKey: "imports/nimbus/bench_aug26.csv",
    rowsTotal: 38, rowsListed: 34, rowsNeedsReview: 4,
    status: "review_pending",
    createdAt: daysAgo(3),
  }).returning();

  const reviewRows: Array<typeof s.bulkImportRows.$inferInsert> = [
    { importId: imp.id, rowNumber: 12, raw: { name: "S. Kulkarni", emp_id: "NSW-3412", skills: "React, Redux", exp_years: "4.5", city: "Pune", rate_inr: "" }, errors: ["missing_rate"], resolution: "pending" },
    { importId: imp.id, rowNumber: 19, raw: { name: "P. Mehta", emp_id: "NSW-3419", skills: "Node, Express", exp_years: "6", city: "Bangalore", rate_inr: "" }, errors: ["missing_rate"], resolution: "pending" },
    { importId: imp.id, rowNumber: 27, raw: { name: "A. Rathore", emp_id: "NSW-3427", skills: "React, TypeScript", exp_years: "6.2", city: "Bangalore", rate_inr: "138000" }, errors: ["suspected_duplicate"], duplicateOf: byMasked.get("TV-4821")?.id ?? null, resolution: "pending" },
    { importId: imp.id, rowNumber: 31, raw: { name: "N. Chaudhary", emp_id: "NSW-3431", skills: ".NET Core, Azure", exp_years: "4.8", city: "Hyderabad", rate_inr: "98000" }, errors: ["suspected_duplicate"], duplicateOf: byMasked.get("TV-6104")?.id ?? null, resolution: "pending" },
  ];
  await db.insert(s.bulkImportRows).values(reviewRows);
  log(`  bulk_imports: 1 (${reviewRows.length} rows needing review)`);

  return { byMasked, inserted, meta };
}

export type ResourceSeed = Awaited<ReturnType<typeof seedResources>>;
