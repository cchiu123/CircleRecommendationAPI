import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DATA_DIR, openDb, type DB } from "../src/db/connection";
import { seed } from "../src/db/seed";

export function seededDb(): DB {
  const db = openDb(":memory:");
  seed(db);
  return db;
}

// The raw seed files, so tests check recommendations against the source data and not
// against the tables and derived stats the recommender itself reads.
const load = (name: string) => JSON.parse(readFileSync(join(DEFAULT_DATA_DIR, name), "utf8"));

export interface RawUser {
  id: number; topic_interests: string[]; bio: string | null; location: string | null;
}
export interface RawCircle {
  id: number; name: string; topic: string | null; tags: string[]; format: string; access: string;
  join_policy: string; max_members: number | null; member_count: number;
  last_activity_at: string; feed_posts_30d: number;
}
export interface RawMembership { user_id: number; circle_id: number }

export const users: RawUser[] = load("users.json");
export const circles: RawCircle[] = load("circles.json");
export const memberships: RawMembership[] = load("memberships.json");
export const topics: { slug: string; label: string }[] = load("topics.json");

export const circleById = new Map(circles.map((c) => [c.id, c]));
export const labelBySlug = new Map(topics.map((t) => [t.slug, t.label]));

export function circlesOf(userId: number): Set<number> {
  return new Set(memberships.filter((m) => m.user_id === userId).map((m) => m.circle_id));
}

export function membersOf(circleId: number): Set<number> {
  return new Set(memberships.filter((m) => m.circle_id === circleId).map((m) => m.user_id));
}

/** Everyone who shares at least one Circle with this user, excluding the user. */
export function circleMatesOf(userId: number): Set<number> {
  const mates = new Set<number>();
  for (const circleId of circlesOf(userId)) for (const id of membersOf(circleId)) mates.add(id);
  mates.delete(userId);
  return mates;
}

export const SNAPSHOT = Math.max(...circles.map((c) => Date.parse(c.last_activity_at)));
export const daysSinceActivity = (c: RawCircle) =>
  (SNAPSHOT - Date.parse(c.last_activity_at)) / 86_400_000;
