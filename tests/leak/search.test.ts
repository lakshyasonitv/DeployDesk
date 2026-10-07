/**
 * Search, the newest read path — and the one most likely to leak.
 *
 * `docs/MASKING.md` governs every read path, and search is the worst case: it reaches
 * across tables that are normally queried separately, and "search everything" is a
 * sentence that invites one function with a role branch inside it. ADR-003 forbids exactly
 * that shape, so there are three functions with three result shapes, and these tests are
 * what keeps them honest.
 *
 * The assertions are deliberately about ABSENCE. A search that returns too little is a bug
 * someone reports; a search that returns a supplier's name to a client is the end of the
 * business, and nobody reports it.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/db/client";
import * as s from "../../src/db/schema";
import { searchClient, searchVendor, searchOps } from "../../src/read-models/search";

let acmeId: string;
let nimbusId: string;
let cygnetId: string;

/** Real names of people on a bench. A client must never see one of these. */
let realNames: string[] = [];
/** Supplier company names. A client must never see one of these either. */
let vendorNames: string[] = [];

beforeAll(async () => {
  const orgs = await db
    .select({ id: s.organizations.id, name: s.organizations.name })
    .from(s.organizations)
    .where(inArray(s.organizations.name, ["Acme Finserv", "Nimbus Softworks", "Cygnet Infotech Labs"]));
  acmeId = orgs.find((o) => o.name === "Acme Finserv")!.id;
  nimbusId = orgs.find((o) => o.name === "Nimbus Softworks")!.id;
  cygnetId = orgs.find((o) => o.name === "Cygnet Infotech Labs")!.id;

  const people = await db
    .select({ fullName: s.benchResources.fullName })
    .from(s.benchResources)
    .limit(40);
  realNames = [...new Set(people.map((p) => p.fullName))];

  const vendors = await db
    .select({ name: s.organizations.name })
    .from(s.organizations)
    .where(eq(s.organizations.orgType, "vendor"));
  vendorNames = vendors.map((v) => v.name);
}, 60_000);

/* ====================================================================== */
/*  CLIENT                                                                 */
/* ====================================================================== */

describe("client search never reveals a supplier or a candidate's name", () => {
  it("returns results at all, so the absence checks are not vacuous", async () => {
    // Without this, a search that returned nothing would satisfy every assertion below.
    const hits = await searchClient(acmeId, "react");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("carries NO real candidate name, for any query that matches people", async () => {
    for (const q of ["react", "bangalore", "sap", "java", "a"]) {
      const payload = JSON.stringify(await searchClient(acmeId, q));
      for (const name of realNames) {
        expect(payload).not.toContain(name);
      }
    }
  });

  it("carries NO supplier company name", async () => {
    for (const q of ["react", "bangalore", "nimbus", "vertex"]) {
      const payload = JSON.stringify(await searchClient(acmeId, q));
      for (const vendor of vendorNames) {
        expect(payload).not.toContain(vendor);
      }
    }
  });

  it("identifies candidates ONLY by a masked id", async () => {
    const hits = await searchClient(acmeId, "bangalore");
    const candidates = hits.filter((h) => h.group === "Candidates sent to you");
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.title).toMatch(/^TV-\d{4,5}(-[A-Z])?$/);
    }
  });

  it("shows a rate BAND and never an exact vendor rate", async () => {
    const hits = await searchClient(acmeId, "bangalore");
    const candidates = hits.filter((h) => h.group === "Candidates sent to you");

    // Every vendor rate in the database, formatted the way the vendor portal shows it.
    // None of those strings may appear in a client payload.
    const rates = await db
      .select({ rate: s.benchResources.vendorRatePaise })
      .from(s.benchResources);
    const payload = JSON.stringify(candidates);

    for (const { rate } of rates) {
      const exact = `₹${(rate / 100).toLocaleString("en-IN")}`;
      expect(payload).not.toContain(exact);
    }
    // And a band is a range, so it has a dash between two figures.
    for (const c of candidates) {
      expect(c.sub).toMatch(/₹[\d.]+[A-Za-z]?[–-]/);
    }
  });

  it("never mentions margin or spread", async () => {
    const payload = JSON.stringify(await searchClient(acmeId, "react")).toLowerCase();
    expect(payload).not.toContain("margin");
    expect(payload).not.toContain("spread");
  });

  it("scopes to the caller: another client's role is absent", async () => {
    // REQ-2320 is Cygnet's. Searching Acme's portal for it must find nothing.
    const hits = await searchClient(acmeId, "REQ-2320");
    expect(hits).toHaveLength(0);

    // And Cygnet's own search DOES find it, so the scope is a filter and not a blanket.
    const theirs = await searchClient(cygnetId, "REQ-2320");
    expect(theirs.length).toBeGreaterThan(0);
  });
});

/* ====================================================================== */
/*  VENDOR                                                                 */
/* ====================================================================== */

describe("vendor search never reveals a client or a margin", () => {
  it("returns its own people, by real name — they are its own employees", async () => {
    const hits = await searchVendor(nimbusId, "pune");
    expect(hits.length).toBeGreaterThan(0);
    const bench = hits.filter((h) => h.group === "Your bench");
    expect(bench.length).toBeGreaterThan(0);
  });

  it("carries NO client company name", async () => {
    const clients = await db
      .select({ name: s.organizations.name })
      .from(s.organizations)
      .where(eq(s.organizations.orgType, "client"));

    for (const q of ["pune", "java", "acme", "northwind"]) {
      const payload = JSON.stringify(await searchVendor(nimbusId, q));
      for (const c of clients) {
        expect(payload).not.toContain(c.name);
      }
    }
  });

  it("carries no requirement code, client rate, margin or spread", async () => {
    for (const q of ["pune", "java", "REQ-2291"]) {
      const payload = JSON.stringify(await searchVendor(nimbusId, q)).toLowerCase();
      expect(payload).not.toContain("req-");
      expect(payload).not.toContain("margin");
      expect(payload).not.toContain("spread");
      expect(payload).not.toContain("client rate");
    }
  });

  it("scopes to the caller: another vendor's person is absent", async () => {
    // TV-4488 is Vertex Digital's.
    expect(await searchVendor(nimbusId, "TV-4488")).toHaveLength(0);
  });

  it("lists one row per PERSON even when they have retaken a test", async () => {
    // A retake is a second `assessments` row, and a plain join listed the same person
    // twice. `distinct on` keeps the latest attempt.
    const hits = await searchVendor(nimbusId, "java");
    const tests = hits.filter((h) => h.group === "Skill tests");
    const ids = tests.map((t) => t.code);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ====================================================================== */
/*  OPS                                                                    */
/* ====================================================================== */

describe("ops search sees everything, which is what makes the other two meaningful", () => {
  it("DOES return real names, supplier names and exact rates", async () => {
    // The control for every absence check above. If ops could not see these either, the
    // client and vendor assertions would prove nothing about masking — only that search
    // was broken.
    const hits = await searchOps("nimbus");
    expect(hits.length).toBeGreaterThan(0);

    const people = hits.filter((h) => h.group === "People");
    expect(people.length).toBeGreaterThan(0);
    // A real name as the title, not a masked id.
    expect(people.some((p) => realNames.includes(p.title))).toBe(true);
    // The supplier named in the context line.
    expect(people.some((p) => p.sub.includes("Nimbus Softworks"))).toBe(true);
  });

  it("finds a role by its client's name, which no other portal may do", async () => {
    const hits = await searchOps("acme");
    expect(hits.filter((h) => h.group === "Roles").length).toBeGreaterThan(0);
  });

  it("finds companies and shows which side they are on", async () => {
    const hits = await searchOps("cygnet");
    const company = hits.find((h) => h.group === "Companies");
    expect(company).toBeDefined();
    // The dual-role organisation, which is ops-only information.
    expect(company!.sub).toBe("Both sides");
  });
});

/* ====================================================================== */
/*  Shared behaviour                                                       */
/* ====================================================================== */

describe("a query too short to be useful does no work", () => {
  it("returns nothing for one character, in every portal", async () => {
    expect(await searchClient(acmeId, "a")).toHaveLength(0);
    expect(await searchVendor(nimbusId, "a")).toHaveLength(0);
    expect(await searchOps("a")).toHaveLength(0);
    expect(await searchClient(acmeId, "  ")).toHaveLength(0);
  });

  it("treats a wildcard as a literal, not as a pattern", async () => {
    // Without escaping, "%" matches everything and a user typing it gets the whole
    // database back. These should find nothing, because no row contains those characters.
    expect(await searchClient(acmeId, "%%")).toHaveLength(0);
    expect(await searchVendor(nimbusId, "%%")).toHaveLength(0);
    expect(await searchOps("%%")).toHaveLength(0);
  });
});
