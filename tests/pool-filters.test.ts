/**
 * The talent pool's filters.
 *
 * These exist because the filters were presentational for the whole life of the screen —
 * seven chips rendered with `active: false` and nothing behind them — and because the one
 * filter that DID work, `search`, ran in memory AFTER `.limit(60)`. So a search looked at
 * the first 60 rows of 1,284 and the count beside it described the page rather than the
 * result.
 *
 * The assertions are mostly *relational* rather than absolute: a filter must narrow, a
 * count must not depend on the page size, and the filter must agree with the thing it
 * filters. Those hold whatever the seed happens to contain, which matters because this seed
 * ages — profiles cross freshness thresholds as real days pass.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { getOpsTalentPool, getOpsPoolFacets } from "../src/read-models/ops";

let facets: Awaited<ReturnType<typeof getOpsPoolFacets>>;
let unfiltered = 0;

beforeAll(async () => {
  facets = await getOpsPoolFacets();
  unfiltered = (await getOpsTalentPool({ limit: 1 })).matchCount;
  // Everything below compares against this, so a pool of nothing would make the file
  // vacuous rather than failing.
  expect(unfiltered, "the pool is empty — run `npm run db:seed`").toBeGreaterThan(0);
}, 60_000);

describe("the facets offer only values that exist", () => {
  it("reads cities, employers and skills from the data", () => {
    // A chip offering a city nobody is in is the same defect as the hardcoded
    // "Microservices" skill the create endpoint used to drop silently.
    expect(facets.cities.length).toBeGreaterThan(0);
    expect(facets.suppliers.length).toBeGreaterThan(0);
    expect(facets.skills.length).toBeGreaterThan(0);
    for (const list of [facets.cities, facets.suppliers, facets.skills]) {
      expect(list.every((v) => typeof v === "string" && v.length > 0)).toBe(true);
    }
  });

  it("every offered value actually matches somebody", async () => {
    // One of each is enough to prove the facet query and the filter query agree about
    // which column they are talking about.
    const [city, supplier, skill] = await Promise.all([
      getOpsTalentPool({ city: facets.cities[0], limit: 1 }),
      getOpsTalentPool({ supplier: facets.suppliers[0], limit: 1 }),
      getOpsTalentPool({ skills: [facets.skills[0]], limit: 1 }),
    ]);
    expect(city.matchCount, `city ${facets.cities[0]}`).toBeGreaterThan(0);
    expect(supplier.matchCount, `employer ${facets.suppliers[0]}`).toBeGreaterThan(0);
    expect(skill.matchCount, `skill ${facets.skills[0]}`).toBeGreaterThan(0);
  });
});

describe("a filter narrows, and the count is not the page", () => {
  it("matchCount does not change with the limit", async () => {
    // The whole point of counting in the database. If these differ, the number on screen
    // is describing the page again.
    const [a, b] = await Promise.all([
      getOpsTalentPool({ limit: 1 }),
      getOpsTalentPool({ limit: 300 }),
    ]);
    expect(a.matchCount).toBe(b.matchCount);
    expect(a.resultCount).toBe(1);
    expect(b.resultCount).toBeLessThanOrEqual(b.matchCount);
  });

  it("every filter returns no more than the unfiltered pool", async () => {
    const cases: Array<[string, Parameters<typeof getOpsTalentPool>[0]]> = [
      ["city", { city: facets.cities[0] }],
      ["employer", { supplier: facets.suppliers[0] }],
      ["skill", { skills: [facets.skills[0]] }],
      ["experience", { experienceBand: "5-8" }],
      ["score", { minScore: 85 }],
      ["rate", { maxRatePaise: 12_000_000 }],
      ["search", { search: "a" }],
    ];
    for (const [label, opts] of cases) {
      const r = await getOpsTalentPool({ ...opts, limit: 1 });
      expect(r.matchCount, `${label} widened the pool`).toBeLessThanOrEqual(unfiltered);
    }
  });

  it("adding a second skill never widens the result", async () => {
    // One EXISTS per skill, ANDed. "Java and Kafka" has to mean both on one person.
    const [a, b] = facets.skills;
    const one = await getOpsTalentPool({ skills: [a], limit: 1 });
    const two = await getOpsTalentPool({ skills: [a, b], limit: 1 });
    expect(two.matchCount).toBeLessThanOrEqual(one.matchCount);
  });

  it("an impossible combination returns nothing rather than everything", async () => {
    // A filter that silently matches all rows is the failure mode worth guarding: it looks
    // like it worked.
    const r = await getOpsTalentPool({ city: "Atlantis", limit: 10 });
    expect(r.matchCount).toBe(0);
    expect(r.results).toEqual([]);
  });
});

describe("the score filter agrees with the score the table shows", () => {
  it("never returns a row displaying less than the minimum", async () => {
    // Pinned to the highest attempt in SQL. Without that, someone whose first attempt
    // scored 90 and whose retake scored 60 would pass an "80+" filter and then render 60.
    const r = await getOpsTalentPool({ minScore: 80, limit: 300 });
    expect(r.results.length, "nobody scores 80+ — assertion is vacuous").toBeGreaterThan(0);
    const wrong = r.results.filter((x) => x.score == null || x.score < 80);
    expect(wrong.map((w) => `${w.maskedId}:${w.score}`)).toEqual([]);
  });
});

describe("the freshness filter agrees with the pill it filters on", () => {
  /**
   * The strongest check available here, and the one that caught a real bug.
   *
   * The three states are mutually exclusive and cover every row, so their counts must sum
   * to the unfiltered total. They summed to one MORE, because the `unconfirmed` condition
   * was an un-parenthesised OR: `and(...)` produced
   *   status in (...) and last_confirmed_at is null or days >= 14
   * which SQL reads as
   *   (status in (...) and last_confirmed_at is null) or (days >= 14)
   * so the second branch escaped the status filter and pulled in withdrawn profiles.
   */
  it("partitions the pool exactly", async () => {
    const parts = await Promise.all(
      (["confirmed", "expiring", "unconfirmed"] as const)
        .map((freshness) => getOpsTalentPool({ freshness, limit: 1 })),
    );
    const sum = parts.reduce((a, r) => a + r.matchCount, 0);
    expect(sum, "freshness buckets do not partition the pool").toBe(unfiltered);
  });

  it("returns only rows whose own pill says the same thing", async () => {
    // The filter is IST calendar-day arithmetic in SQL; the pill is
    // `istCalendarDaysBetween` in TypeScript. If they ever diverge, a row appears under
    // "Needs confirming" while its own pill reads "Confirmed".
    for (const [freshness, state] of [
      ["confirmed", "confirmed"], ["expiring", "expiring_soon"], ["unconfirmed", "unconfirmed"],
    ] as const) {
      const r = await getOpsTalentPool({ freshness, limit: 300 });
      const disagree = r.results.filter((x) => x.freshnessState !== state);
      expect(
        disagree.map((d) => `${d.maskedId} filtered as ${freshness} but renders ${d.freshnessState}`),
      ).toEqual([]);
    }
  });
});
