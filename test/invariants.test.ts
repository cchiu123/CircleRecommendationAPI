// Rules that must hold for every member in the dataset, whatever the weights are.

import { describe, expect, it } from "vitest";
import { recommend } from "../src/recommend";
import { MAX_PER_TOPIC } from "../src/recommend/diversify";
import { circleById, circlesOf, daysSinceActivity, seededDb, users } from "./helpers";

const db = seededDb();
const LIMIT = 5;
const all = users.map((u) => ({ user: u, recs: recommend(db, u.id, LIMIT)! }));

describe("every member's recommendations", () => {
  it("are a full list", () => {
    for (const { recs } of all) expect(recs).toHaveLength(LIMIT);
  });

  it("never include a Circle the member already belongs to", () => {
    for (const { user, recs } of all) {
      const joined = circlesOf(user.id);
      for (const r of recs) expect(joined.has(r.circle.id), `user ${user.id}`).toBe(false);
    }
  });

  it("never include a full, inactive or unlisted Circle", () => {
    for (const { user, recs } of all) {
      for (const r of recs) {
        const c = circleById.get(r.circle.id)!;
        const where = `user ${user.id}, circle ${c.id}`;
        expect(c.max_members !== null && c.member_count >= c.max_members, where).toBe(false);
        expect(c.feed_posts_30d === 0 && daysSinceActivity(c) > 60, where).toBe(false);
        expect(c.access, where).toBe("public");
      }
    }
  });

  it("never include the planted full (#20) or inactive (#21, #32) Circles", () => {
    const recommended = new Set(all.flatMap(({ recs }) => recs.map((r) => r.circle.id)));
    for (const id of [20, 21, 32]) expect(recommended.has(id)).toBe(false);
  });

  it("have no repeats and are ordered best first", () => {
    for (const { recs } of all) {
      const ids = recs.map((r) => r.circle.id);
      expect(new Set(ids).size).toBe(ids.length);
      const scores = recs.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it(`have at most ${MAX_PER_TOPIC} Circles on any one topic`, () => {
    for (const { user, recs } of all) {
      const perTopic = new Map<string, number>();
      for (const r of recs) {
        if (r.circle.topic) perTopic.set(r.circle.topic, (perTopic.get(r.circle.topic) ?? 0) + 1);
      }
      for (const n of perTopic.values()) expect(n, `user ${user.id}`).toBeLessThanOrEqual(MAX_PER_TOPIC);
    }
  });

  it("each come with at least one reason and a readable explanation", () => {
    for (const { recs } of all) {
      for (const r of recs) {
        expect(r.reasons.length).toBeGreaterThan(0);
        expect(r.explanation.trim()).not.toBe("");
      }
    }
  });

  it("are the same on a second run", () => {
    for (const { user, recs } of all) expect(recommend(db, user.id, LIMIT)).toEqual(recs);
  });

  it("keep the same order when the list is shorter or longer", () => {
    for (const { user, recs } of all) {
      const ids = recs.map((r) => r.circle.id);
      expect(recommend(db, user.id, 1)!.map((r) => r.circle.id)).toEqual(ids.slice(0, 1));
      expect(recommend(db, user.id, 10)!.map((r) => r.circle.id).slice(0, LIMIT)).toEqual(ids);
    }
  });
});
