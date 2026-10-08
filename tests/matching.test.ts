/**
 * The ranking scorer.
 *
 * `docs/MATCHING.md` specifies six components and six weights; before this suite existed,
 * the weights were displayed and the components were seeded, and **nothing computed
 * anything**. Only the seed ever wrote a `matches` row, so a requirement a client posted got
 * a real "N profiles match" preview and then an empty matching desk.
 *
 * No database here: the scorer is arithmetic over plain numbers, and every interesting case
 * is a boundary — a candidate just below the experience band, a rate exactly at the budget
 * midpoint, a profile fresh but three months from starting. Those are trivial to state and
 * awkward to seed.
 */
import { describe, expect, it } from "vitest";
import {
  MATCHING_COMPONENTS, WEIGHTS, algoScore, proposedClientRate, scoreExpFit,
  scoreFreshness, scoreRate, scoreSkill, scoreTest, scoreVendor,
  MARGIN_FLOOR, TARGET_MARGIN,
} from "../src/lib/matching/score";

describe("the weights", () => {
  it("sum to exactly 100%", () => {
    // The total is presented out of 100, which is only true if these do.
    expect(MATCHING_COMPONENTS.reduce((a, c) => a + c.weightPct, 0)).toBe(100);
    expect(WEIGHTS.reduce((a, w) => a + w, 0)).toBeCloseTo(1, 10);
  });

  it("are declared in the order the component arrays use", () => {
    expect(MATCHING_COMPONENTS.map((c) => c.key)).toEqual([
      "scoreSkill", "scoreTest", "scoreExpFit", "scoreRate", "scoreFreshness", "scoreVendor",
    ]);
  });
});

describe("algoScore", () => {
  it("is the weighted blend, and nothing else", () => {
    // TV-4821 from the prototype fixture: 96/88/92/90/100/95.
    // 28.8 + 19.36 + 14.72 + 12.6 + 10 + 7.6 = 93.08
    expect(algoScore({
      scoreSkill: 96, scoreTest: 88, scoreExpFit: 92,
      scoreRate: 90, scoreFreshness: 100, scoreVendor: 95,
    })).toBe(93);
  });

  it("is 100 when every component is, and 0 when none is", () => {
    const all = (n: number) => ({
      scoreSkill: n, scoreTest: n, scoreExpFit: n, scoreRate: n, scoreFreshness: n, scoreVendor: n,
    });
    expect(algoScore(all(100))).toBe(100);
    expect(algoScore(all(0))).toBe(0);
  });
});

describe("skill match", () => {
  const req = [
    { label: "Java Spring Boot", isPrimary: true },
    { label: "Kafka", isPrimary: false },
  ];

  it("counts a primary skill double", () => {
    // Primary only: 2 of 3 weight.
    expect(scoreSkill(req, ["Java Spring Boot"])).toBe(67);
    // Secondary only: 1 of 3.
    expect(scoreSkill(req, ["Kafka"])).toBe(33);
    expect(scoreSkill(req, ["Java Spring Boot", "Kafka"])).toBe(100);
  });

  it("gives no credit for extra skills", () => {
    // Rewarding breadth would push generalists over specialists.
    expect(scoreSkill(req, ["Java Spring Boot", "Kafka", "Go", "Rust", "Terraform"])).toBe(100);
    expect(scoreSkill(req, ["Go", "Rust", "Terraform"])).toBe(0);
  });

  it("has no adjacency credit yet, which is a known gap", () => {
    // The spec gives 0.4 of a skill's weight to a same-category near miss (React <->
    // React Native) from an explicit adjacency table. That table does not exist, so a near
    // miss scores zero today. Asserted so the gap is visible rather than assumed.
    expect(scoreSkill([{ label: "React", isPrimary: true }], ["React Native"])).toBe(0);
  });

  it("scores 100 when a requirement names no skills", () => {
    expect(scoreSkill([], [])).toBe(100);
  });
});

describe("proctored score", () => {
  it("uses the real score when one is valid", () => {
    expect(scoreTest("scored", 87)).toBe(87);
  });

  it("keeps an untested profile visible rather than sinking it", () => {
    // Deliberately non-zero: a broker needs to see a strong unscored profile to chase the
    // test. Assessment is not an eligibility gate.
    expect(scoreTest("not_started", null)).toBe(40);
    expect(scoreTest("in_progress", null)).toBe(40);
    expect(scoreTest(null, null)).toBe(40);
  });

  it("puts an expired score BELOW an untested one", () => {
    // A lapsed score signals inattention, which is worse than never having been tested.
    expect(scoreTest("expired", 90)).toBe(30);
    expect(scoreTest("scored", 90, true)).toBe(30);
    expect(scoreTest("expired", 90)).toBeLessThan(scoreTest("not_started", null));
  });
});

describe("experience fit", () => {
  it("scores 100 anywhere inside the band", () => {
    expect(scoreExpFit(60, "5-8")).toBe(100);   // bottom edge
    expect(scoreExpFit(78, "5-8")).toBe(100);   // midpoint
    expect(scoreExpFit(95, "5-8")).toBe(100);   // top edge
  });

  it("punishes undershooting half again as hard as overshooting", () => {
    // 9 years for a 5-8 role is expensive but capable; 3 years is not.
    const over = scoreExpFit(108, "5-8");   // 2.5y past the midpoint
    const under = scoreExpFit(48, "5-8");   // 2.5y short of it
    expect(over).toBe(70);
    expect(under).toBe(55);
    expect(under).toBeLessThan(over);
  });

  it("never goes below zero however far off the candidate is", () => {
    expect(scoreExpFit(0, "8+")).toBe(0);
  });
});

describe("rate vs budget", () => {
  const MIN = 10_000_000;   // ₹1.00L
  const MAX = 20_000_000;   // ₹2.00L
  const MID = 15_000_000;

  it("gives full marks at or under the floor, but never above 100", () => {
    // A suspiciously cheap profile is usually a mismatch, not a bargain.
    expect(scoreRate(MIN, MIN, MAX)).toBe(100);
    expect(scoreRate(1_000_000, MIN, MAX)).toBe(100);
  });

  it("walks down gently to the midpoint and faster to the ceiling", () => {
    expect(scoreRate(MID, MIN, MAX)).toBe(90);
    expect(scoreRate(MAX, MIN, MAX)).toBe(60);
  });

  it("falls away fast above the ceiling", () => {
    expect(scoreRate(MAX * 1.1, MIN, MAX)).toBe(50);
    expect(scoreRate(MAX * 2, MIN, MAX)).toBe(0);
  });
});

describe("availability freshness", () => {
  it("is full marks for the first three days, then decays", () => {
    expect(scoreFreshness(0, 0)).toBe(100);
    expect(scoreFreshness(3, 0)).toBe(100);
    expect(scoreFreshness(4, 0)).toBe(96);
    expect(scoreFreshness(9, 0)).toBe(76);
    expect(scoreFreshness(10, 0)).toBe(60);
    expect(scoreFreshness(13, 0)).toBe(36);
  });

  it("discounts a long notice period, because fresh is not the same as available", () => {
    // A profile confirmed today but three months from starting is not actually available.
    expect(scoreFreshness(0, 0)).toBe(100);    // immediate
    expect(scoreFreshness(0, 15)).toBe(95);
    expect(scoreFreshness(0, 30)).toBe(85);
    expect(scoreFreshness(0, 90)).toBe(70);
    expect(scoreFreshness(0, null)).toBe(70);  // unknown is treated as long
  });

  it("is zero at the 14-day gate, where a caller should not be scoring at all", () => {
    expect(scoreFreshness(14, 0)).toBe(0);
    expect(scoreFreshness(null, 0)).toBe(0);
  });
});

describe("vendor reliability", () => {
  it("is the reliability score out of five, as a percentage", () => {
    expect(scoreVendor(5, 50)).toBe(100);
    expect(scoreVendor(4.6, 50)).toBe(92);
  });

  it("caps an unproven supplier so it cannot outrank a proven one on this alone", () => {
    expect(scoreVendor(5, 0)).toBe(75);
    expect(scoreVendor(5, 9)).toBe(75);
    expect(scoreVendor(5, 10)).toBe(100);
  });
});

describe("the proposed client rate", () => {
  it("marks up to the target margin and rounds up to the nearest thousand", () => {
    // ₹1.00L / 0.78 = ₹1,28,205 -> ₹1,29,000
    const out = proposedClientRate(10_000_000, 10_000_000, 20_000_000);
    expect(out.ratePaise).toBe(12_900_000);
    expect(out.aboveBudget).toBe(false);
    const margin = (out.ratePaise - 10_000_000) / out.ratePaise;
    expect(margin).toBeGreaterThanOrEqual(TARGET_MARGIN - 0.01);
  });

  it("clamps to the client ceiling when that still clears the floor", () => {
    // Vendor ₹1.50L, ceiling ₹1.90L. Markup wants ₹1,93,000, over the ceiling — but
    // ₹1.90L still leaves 21% margin, above the 18% floor, so it clamps.
    const out = proposedClientRate(15_000_000, 10_000_000, 19_000_000);
    expect(out.ratePaise).toBe(19_000_000);
    expect(out.aboveBudget).toBe(false);
    expect((19_000_000 - 15_000_000) / 19_000_000).toBeGreaterThanOrEqual(MARGIN_FLOOR);
  });

  it("refuses to clamp below the margin floor, and says so", () => {
    /**
     * The clause that matters. Vendor ₹1.70L against a ₹2.00L ceiling is 15% margin —
     * under the floor. docs/MATCHING.md records that silently accepting a sub-floor margin
     * to fit a budget is how the two below-floor placements in the design fixtures
     * happened, so it stays above budget and a human decides.
     */
    const out = proposedClientRate(17_000_000, 10_000_000, 20_000_000);
    expect(out.aboveBudget).toBe(true);
    expect(out.marginConstrained).toBe(true);
    expect(out.ratePaise).toBeGreaterThan(20_000_000);
    expect((20_000_000 - 17_000_000) / 20_000_000).toBeLessThan(MARGIN_FLOOR);
  });
});
