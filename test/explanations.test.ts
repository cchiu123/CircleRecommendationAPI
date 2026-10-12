// Every explanation shown to a member must be true for that member and that Circle.
// Checked for all 100 users against the raw seed files.

import { describe, expect, it } from "vitest";
import { recommend } from "../src/recommend";
import { inferTopicsFromBio } from "../src/recommend/bio";
import type { Reason, Recommendation } from "../src/recommend/types";
import {
  circleById, circleMatesOf, circlesOf, labelBySlug, membersOf, seededDb, topics, users,
  type RawUser,
} from "./helpers";

const db = seededDb();

interface Shown { user: RawUser; rec: Recommendation; reason: Reason }
const shown: Shown[] = users.flatMap((user) =>
  recommend(db, user.id, 10)!.flatMap((rec) => rec.reasons.map((reason) => ({ user, rec, reason }))),
);
const withCode = (code: Reason["code"]) => shown.filter((s) => s.reason.code === code);
const firstNumber = (text: string) => Number(text.match(/\d+/)![0]);
const interestLabels = (u: RawUser) => u.topic_interests.map((s) => labelBySlug.get(s)!.toLowerCase());

describe("explanations are truthful", () => {
  it("every reason type is exercised by the dataset", () => {
    const codes = [
      "topic_match", "tag_match", "profile_match", "shared_members", "joinable_anywhere",
      "active", "popular_start", "limited_seats",
    ] as const;
    for (const code of codes) {
      expect(withCode(code).length, code).toBeGreaterThan(0);
    }
  });

  it("topic_match: the Circle's primary topic is a stated interest, and is the topic named", () => {
    for (const { user, rec, reason } of withCode("topic_match")) {
      const topic = circleById.get(rec.circle.id)!.topic!;
      expect(user.topic_interests).toContain(topic);
      expect(reason.text).toContain(labelBySlug.get(topic)!.toLowerCase());
    }
  });

  it("tag_match: the topic named is both a tag on the Circle and a stated interest", () => {
    for (const { user, rec, reason } of withCode("tag_match")) {
      const circle = circleById.get(rec.circle.id)!;
      const shared = circle.tags.filter((t) => user.topic_interests.includes(t));
      const named = shared.filter((t) => reason.text.includes(labelBySlug.get(t)!.toLowerCase()));
      expect(named.length, `user ${user.id}, circle ${circle.id}`).toBeGreaterThan(0);
    }
  });

  it("profile_match: only for a member with no stated interests whose bio points to the topic named", () => {
    for (const { user, rec, reason } of withCode("profile_match")) {
      const topic = circleById.get(rec.circle.id)!.topic!;
      expect(user.topic_interests).toHaveLength(0);
      expect(user.bio).not.toBeNull();
      expect(inferTopicsFromBio(user.bio)).toContain(topic);
      expect(reason.text).toContain(labelBySlug.get(topic)!.toLowerCase());
    }
  });

  it("joinable_anywhere: the Circle has a virtual option and the member has no fixed location", () => {
    for (const { user, rec, reason } of withCode("joinable_anywhere")) {
      const circle = circleById.get(rec.circle.id)!;
      expect(["virtual", "hybrid"]).toContain(circle.format);
      expect([null, "Remote"]).toContain(user.location);
      expect(reason.text.startsWith("Meets virtually")).toBe(circle.format === "virtual");
    }
  });

  it("shared_members: the number quoted is the real count of the member's Circle-mates there", () => {
    for (const { user, rec, reason } of withCode("shared_members")) {
      const mates = circleMatesOf(user.id);
      const actual = [...membersOf(rec.circle.id)].filter((id) => mates.has(id)).length;
      expect(firstNumber(reason.text), `user ${user.id}, circle ${rec.circle.id}`).toBe(actual);
      expect(actual).toBeGreaterThanOrEqual(2);
    }
  });

  it("active and popular_start: any post count quoted is the Circle's real 30-day count", () => {
    for (const { rec, reason } of [...withCode("active"), ...withCode("popular_start")]) {
      const circle = circleById.get(rec.circle.id)!;
      if (/\d+ posts?\b/.test(reason.text)) {
        expect(firstNumber(reason.text), `circle ${circle.id}`).toBe(circle.feed_posts_30d);
      }
    }
  });

  it("limited_seats: the number quoted is the real number of open seats", () => {
    for (const { rec, reason } of withCode("limited_seats")) {
      const circle = circleById.get(rec.circle.id)!;
      expect(circle.max_members).not.toBeNull();
      expect(firstNumber(reason.text)).toBe(circle.max_members! - circle.member_count);
    }
  });

  it("popular_start is only used when nothing is known about the member", () => {
    for (const { user } of withCode("popular_start")) {
      expect(user.topic_interests).toHaveLength(0);
      expect(circlesOf(user.id).size).toBe(0);
    }
  });

  it("an interest is only mentioned to a member who stated it", () => {
    for (const { user, reason } of shown) {
      if (!/you said|your interests/.test(reason.text)) continue;
      expect(interestLabels(user).some((label) => reason.text.includes(label))).toBe(true);
    }
  });
});

describe("explanations read well", () => {
  it("never leak slugs, placeholders or internal values", () => {
    const multiWordSlugs = topics.map((t) => t.slug).filter((s) => s.includes("-"));
    for (const { reason } of shown) {
      expect(reason.text).not.toMatch(/null|undefined|NaN|_/);
      for (const slug of multiWordSlugs) expect(reason.text).not.toContain(slug);
    }
  });

  it("use singular and plural correctly", () => {
    for (const { reason } of shown) {
      expect(reason.text).not.toMatch(/\b1 (posts|members|spots|days)\b/);
      expect(reason.text).not.toMatch(/\b([2-9]|\d{2,}) (post|member|spot|day)\b/);
    }
  });

  it("are complete sentences", () => {
    for (const { reason } of shown) {
      expect(reason.text).toMatch(/^[A-Z0-9].*\.$/);
    }
  });

  it("work for Circles with no topic or description (#27, #28)", () => {
    const untitled = shown.filter((s) => [27, 28].includes(s.rec.circle.id));
    expect(untitled.length).toBeGreaterThan(0);
    for (const { rec } of untitled) expect(rec.circle.topic).toBeNull();
  });
});
