// The planted records named in the dataset README.

import { describe, expect, it } from "vitest";
import { recommend } from "../src/recommend";
import { circlesOf, seededDb, users } from "./helpers";

const db = seededDb();
const ids = (userId: number, limit = 5) => recommend(db, userId, limit)!.map((r) => r.circle.id);

describe("cold start: user 42 has no interests, memberships or profile", () => {
  const recs = recommend(db, 42)!;

  it("still gets a full list", () => {
    expect(recs).toHaveLength(5);
  });

  it("is never told a Circle matches her interests or network", () => {
    for (const r of recs) {
      expect(r.reasons[0].code).toBe("popular_start");
      const codes = r.reasons.map((x) => x.code);
      expect(codes).not.toContain("topic_match");
      expect(codes).not.toContain("tag_match");
      expect(codes).not.toContain("shared_members");
      expect(r.explanation).not.toMatch(/you said|your interests|your Circles/i);
    }
  });

  it("gets a spread of topics to choose from", () => {
    expect(new Set(recs.map((r) => r.circle.topic)).size).toBeGreaterThanOrEqual(3);
  });

  it("is not sent to in-person Circles, since we do not know where she is", () => {
    for (const r of recs) expect(r.circle.format).not.toBe("in_person");
  });
});

describe("obvious matches: user 7 is interested in leadership skills and public speaking", () => {
  const recs = recommend(db, 7)!;

  it("ranks #5 Women Who Lead and #6 Speak Up Circle first and second", () => {
    expect(recs.slice(0, 2).map((r) => r.circle.id).sort()).toEqual([5, 6]);
  });

  it("explains each by the interest it matches", () => {
    const byId = new Map(recs.map((r) => [r.circle.id, r]));
    expect(byId.get(5)!.explanation).toContain("leadership skills");
    expect(byId.get(6)!.explanation).toContain("public speaking");
    expect(byId.get(5)!.reasons[0].code).toBe("topic_match");
    expect(byId.get(6)!.reasons[0].code).toBe("topic_match");
  });

  it("leaves out #4, which she already joined", () => {
    expect(ids(7, 20)).not.toContain(4);
  });
});

describe("duplicates: user 15 is interested in negotiation; #10, #11, #12 are near-identical", () => {
  it("does not return all three, even in a long list", () => {
    for (const limit of [5, 10, 20]) {
      const negotiation = ids(15, limit).filter((id) => [10, 11, 12].includes(id));
      expect(negotiation.length).toBeGreaterThanOrEqual(1);
      expect(negotiation.length).toBeLessThanOrEqual(2);
    }
  });

  it("puts a negotiation Circle first and her other interest, confidence, right behind it", () => {
    const recs = recommend(db, 15)!;
    expect([10, 11, 12]).toContain(recs[0].circle.id);
    expect(recs[1].circle.topic).toBe("Confidence");
  });

  it("leaves out #9 and #35, which she already joined", () => {
    const list = ids(15, 20);
    expect(list).not.toContain(9);
    expect(list).not.toContain(35);
  });
});

describe("full / inactive: user 23 is interested in getting promoted", () => {
  it("ranks #22 Level Up Collective first", () => {
    expect(ids(23)[0]).toBe(22);
  });

  it("never shows #20 (full) or #21 (inactive), even in a long list", () => {
    const list = ids(23, 20);
    expect(list).not.toContain(20);
    expect(list).not.toContain(21);
  });

  it("fills the rest of the list instead of coming up short", () => {
    expect(ids(23)).toHaveLength(5);
  });
});

describe("a member with a bio but no stated interests: user 4 is returning from a career break", () => {
  const recs = recommend(db, 4)!;

  it("is offered a career-breaks Circle first, worded as a guess", () => {
    expect(recs[0].circle.topic).toBe("Career breaks");
    expect(recs[0].reasons[0].code).toBe("profile_match");
    expect(recs[0].explanation).toContain("may fit what you wrote in your profile");
  });
});

describe("members with Circles but no stated interests", () => {
  const quiet = users.filter((u) => u.topic_interests.length === 0 && circlesOf(u.id).size > 0);

  it("covers the 29 such members in the dataset", () => {
    expect(quiet).toHaveLength(29);
  });

  it("are recommended Circles through their network and Circle health, never through interests", () => {
    for (const u of quiet) {
      const recs = recommend(db, u.id)!;
      const codes = recs.flatMap((r) => r.reasons.map((x) => x.code));
      expect(codes, `user ${u.id}`).not.toContain("topic_match");
      expect(codes, `user ${u.id}`).not.toContain("tag_match");
      expect(codes, `user ${u.id}`).not.toContain("popular_start");
      expect(codes, `user ${u.id}`).toContain("shared_members");
    }
  });
});
