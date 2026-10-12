import { describe, expect, it } from "vitest";
import { MAX_PER_TOPIC, REPEAT_TOPIC_PENALTY, diversify } from "../src/recommend/diversify";
import { inferTopicsFromBio } from "../src/recommend/bio";
import { explain } from "../src/recommend/explain";
import { DAY_MS, computeCircleStats, type CircleHealthInput } from "../src/recommend/health";
import { WEIGHTS, byRank, scoreCandidate } from "../src/recommend/score";
import type { Candidate, ScoredCandidate } from "../src/recommend/types";
import { seededDb } from "./helpers";

const NOW = Date.parse("2026-09-21T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

const health = (over: Partial<CircleHealthInput> = {}): CircleHealthInput => ({
  max_members: 20,
  member_count: 12,
  last_activity_at: daysAgo(1),
  feed_posts_30d: 10,
  chat_messages_30d: 100,
  ...over,
});

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: 1,
  name: "Test Circle",
  description: null,
  format: "virtual",
  join_policy: "open",
  member_count: 10,
  seats_left: 8,
  feed_posts_30d: 10,
  days_since_activity: 1,
  activity_score: 0.8,
  topic_slug: "negotiation",
  topic_label: "Negotiation",
  primaryMatch: null,
  tagMatches: [],
  profileMatch: null,
  sharedMembers: 0,
  joinableAnywhere: false,
  ...over,
});

describe("circle health", () => {
  it("treats an uncapped Circle as never full", () => {
    const s = computeCircleStats(health({ max_members: null, member_count: 500 }), [], NOW);
    expect(s.is_full).toBe(false);
    expect(s.seats_left).toBeNull();
  });

  it("is full at capacity and not full one seat short", () => {
    expect(computeCircleStats(health({ max_members: 12 }), [], NOW).is_full).toBe(true);
    expect(computeCircleStats(health({ max_members: 13 }), [], NOW).is_full).toBe(false);
    expect(computeCircleStats(health({ max_members: 13 }), [], NOW).seats_left).toBe(1);
  });

  it("is inactive only with no recent posts and a long silence", () => {
    const silent = health({ feed_posts_30d: 0, chat_messages_30d: 0 });
    expect(computeCircleStats({ ...silent, last_activity_at: daysAgo(200) }, [], NOW).is_inactive).toBe(true);
    expect(computeCircleStats({ ...silent, last_activity_at: daysAgo(7) }, [], NOW).is_inactive).toBe(false);
    expect(computeCircleStats(health({ last_activity_at: daysAgo(200) }), [], NOW).is_inactive).toBe(false);
  });

  it("scores active above moderate above dormant, always within 0..1", () => {
    const active = computeCircleStats(health({ feed_posts_30d: 14, chat_messages_30d: 130 }), [16, 20, 12], NOW);
    const moderate = computeCircleStats(
      health({ feed_posts_30d: 4, chat_messages_30d: 20, last_activity_at: daysAgo(12) }), [5, 6], NOW);
    const dormant = computeCircleStats(
      health({ feed_posts_30d: 0, chat_messages_30d: 1, last_activity_at: daysAgo(200) }), [], NOW);
    const maxed = computeCircleStats(
      health({ feed_posts_30d: 999, chat_messages_30d: 99999, last_activity_at: daysAgo(0) }), [500], NOW);

    expect(active.activity_score).toBeGreaterThan(moderate.activity_score);
    expect(moderate.activity_score).toBeGreaterThan(dormant.activity_score);
    expect(dormant.activity_score).toBeGreaterThanOrEqual(0);
    expect(maxed.activity_score).toBeCloseTo(1);
  });

  it("measures recency against the dataset snapshot, not the wall clock", () => {
    const db = seededDb();
    const rows = db
      .prepare("SELECT as_of, MIN(days_since_activity) AS freshest FROM circle_stats")
      .get() as { as_of: string; freshest: number };
    expect(rows.as_of.startsWith("2026-09-2")).toBe(true);
    expect(rows.freshest).toBe(0);
  });
});

describe("scoring", () => {
  it("ranks a primary topic match above a tag-only match above no match", () => {
    const primary = scoreCandidate(candidate({ primaryMatch: "Negotiation" }));
    const tag = scoreCandidate(candidate({ tagMatches: ["Negotiation"] }));
    const none = scoreCandidate(candidate());
    expect(primary.score).toBeGreaterThan(tag.score);
    expect(tag.score).toBeGreaterThan(none.score);
  });

  it("does not double count a Circle matching on both topic and tag", () => {
    const both = scoreCandidate(candidate({ primaryMatch: "Negotiation", tagMatches: ["Confidence"] }));
    expect(both.score).toBeCloseTo(scoreCandidate(candidate({ primaryMatch: "Negotiation" })).score);
  });

  it("gives no network credit to a member with no Circle-mates", () => {
    expect(scoreCandidate(candidate()).parts.sharedMembers).toBe(0);
  });

  it("scales network credit by the share of the Circle, not the head count", () => {
    const small = scoreCandidate(candidate({ member_count: 6, sharedMembers: 3 }));
    const large = scoreCandidate(candidate({ member_count: 24, sharedMembers: 3 }));
    expect(small.parts.sharedMembers).toBeCloseTo(WEIGHTS.sharedMembers * 0.5);
    expect(small.parts.sharedMembers).toBeGreaterThan(large.parts.sharedMembers);
  });

  it("prefers a livelier Circle and an open one, all else equal", () => {
    expect(scoreCandidate(candidate({ activity_score: 0.9 })).score).toBeGreaterThan(
      scoreCandidate(candidate({ activity_score: 0.4 })).score);
    expect(scoreCandidate(candidate({ join_policy: "open" })).score).toBeGreaterThan(
      scoreCandidate(candidate({ join_policy: "request" })).score);
  });

  it("ranks a topic guessed from the bio below anything the member stated", () => {
    const guessed = scoreCandidate(candidate({ profileMatch: "Negotiation" }));
    expect(guessed.score).toBeGreaterThan(scoreCandidate(candidate()).score);
    expect(guessed.score).toBeLessThan(scoreCandidate(candidate({ tagMatches: ["Negotiation"] })).score);
  });

  it("favors a remotely joinable Circle, but never over a stated interest", () => {
    const remote = scoreCandidate(candidate({ joinableAnywhere: true }));
    expect(remote.parts.format).toBe(WEIGHTS.format);
    expect(remote.score).toBeGreaterThan(scoreCandidate(candidate()).score);
    expect(remote.score).toBeLessThan(scoreCandidate(candidate({ tagMatches: ["Negotiation"] })).score);
  });

  it("breaks ties the same way every time: livelier first, then lower id", () => {
    const a = { ...scoreCandidate(candidate({ id: 9 })), score: 1 };
    const b = { ...scoreCandidate(candidate({ id: 3 })), score: 1 };
    const c = { ...scoreCandidate(candidate({ id: 7, activity_score: 0.9 })), score: 1 };
    expect([a, b, c].sort(byRank).map((x) => x.id)).toEqual([7, 3, 9]);
    expect([c, b, a].sort(byRank).map((x) => x.id)).toEqual([7, 3, 9]);
  });
});

describe("inferring topics from a bio", () => {
  it("returns nothing for a missing or unrelated bio", () => {
    expect(inferTopicsFromBio(null)).toEqual([]);
    expect(inferTopicsFromBio("")).toEqual([]);
    expect(inferTopicsFromBio("Career changer, ex-consultant, now in tech.")).toEqual([]);
  });

  it("picks up the topics a bio points to", () => {
    expect(inferTopicsFromBio("Returning to work after a career break and finding my footing."))
      .toEqual(["career-breaks"]);
    expect(inferTopicsFromBio("First-time manager figuring it out alongside a great team."))
      .toEqual(["managing-a-team"]);
    expect(inferTopicsFromBio("Advocate for pay equity and transparent promotion paths."))
      .toEqual(["negotiation", "getting-promoted"]);
  });

  it("does not read 'leaders' as an interest in leadership skills", () => {
    expect(inferTopicsFromBio("Passionate about mentoring the next generation of women leaders."))
      .toEqual(["sponsorship-mentorship"]);
  });
});

describe("diversify", () => {
  const scored = (id: number, topic: string | null, score: number): ScoredCandidate => ({
    ...scoreCandidate(candidate({ id, topic_slug: topic, topic_label: topic })),
    score,
  });

  it("lets through at most two Circles on a topic and discounts the second", () => {
    const out = diversify(
      [scored(1, "negotiation", 1.5), scored(2, "negotiation", 1.4), scored(3, "negotiation", 1.3),
       scored(4, "confidence", 0.6), scored(5, "networking", 0.5)],
      5,
    );
    expect(out.map((c) => c.id)).toEqual([1, 2, 4, 5]);
    expect(out.filter((c) => c.topic_slug === "negotiation")).toHaveLength(MAX_PER_TOPIC);
    expect(out[1].score).toBeCloseTo(1.4 * REPEAT_TOPIC_PENALTY);
  });

  it("moves a different topic ahead of a discounted repeat", () => {
    const out = diversify(
      [scored(1, "negotiation", 1.5), scored(2, "negotiation", 1.4), scored(3, "confidence", 1.2)], 3);
    expect(out.map((c) => c.id)).toEqual([1, 3, 2]);
  });

  it("does not treat Circles without a topic as duplicates of each other", () => {
    const out = diversify([scored(1, null, 1), scored(2, null, 0.9), scored(3, null, 0.8)], 3);
    expect(out.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(out.map((c) => c.score)).toEqual([1, 0.9, 0.8]);
  });

  it("returns fewer than the limit when there are not enough candidates", () => {
    expect(diversify([scored(1, "negotiation", 1)], 5)).toHaveLength(1);
    expect(diversify([], 5)).toEqual([]);
  });
});

describe("explain", () => {
  const explained = (over: Partial<Candidate>, coldStart = false) =>
    explain(scoreCandidate(candidate(over)), coldStart);

  it("leads with the stated interest when there is one", () => {
    const reasons = explained({ primaryMatch: "Negotiation", sharedMembers: 4 });
    expect(reasons[0]).toEqual({
      code: "topic_match",
      text: "Focused on negotiation, which you said you're interested in.",
    });
    expect(reasons).toHaveLength(2);
  });

  it("does not mention a single shared member", () => {
    const codes = explained({ sharedMembers: 1 }).map((r) => r.code);
    expect(codes).not.toContain("shared_members");
  });

  it("still says something true about a quiet Circle with no other signal", () => {
    const reasons = explained({ activity_score: 0.35, feed_posts_30d: 1, days_since_activity: 15 });
    expect(reasons).toEqual([{ code: "active", text: "Members shared 1 post in the last month." }]);
  });

  it("flags a Circle that is nearly full", () => {
    const reasons = explained({ primaryMatch: "Negotiation", seats_left: 1 });
    expect(reasons.at(-1)).toEqual({ code: "limited_seats", text: "Only 1 spot left." });
    expect(explained({ seats_left: null }).map((r) => r.code)).not.toContain("limited_seats");
  });

  it("makes no personal claim on a cold start", () => {
    const reasons = explained({ primaryMatch: "Negotiation", sharedMembers: 5 }, true);
    expect(reasons.map((r) => r.code)).toEqual(["popular_start"]);
  });

  it("words a bio-based guess as a guess", () => {
    const reasons = explained({ profileMatch: "Career breaks", activity_score: 0.3 });
    expect(reasons[0]).toEqual({
      code: "profile_match",
      text: "Focused on career breaks, which may fit what you wrote in your profile.",
    });
  });

  it("says how a remote member can attend, by format", () => {
    const text = (format: Candidate["format"]) =>
      explained({ joinableAnywhere: true, format, activity_score: 0.3 })
        .find((r) => r.code === "joinable_anywhere")!.text;
    expect(text("virtual")).toBe("Meets virtually, so you can join from anywhere.");
    expect(text("hybrid")).toBe("Has a virtual option, so you can join from anywhere.");
    expect(explained({ joinableAnywhere: true }, true).map((r) => r.code))
      .toEqual(["popular_start", "joinable_anywhere"]);
  });
});
