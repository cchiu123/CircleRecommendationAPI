import type { DB } from "../db/connection";
import { inferTopicsFromBio } from "./bio";
import { diversify } from "./diversify";
import { explain } from "./explain";
import { eligibleCircles } from "./filter";
import { scoreCandidate } from "./score";
import type { Candidate, Recommendation } from "./types";

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

/**
 * Ranked Circles for one member: filter to what they can join, score each against what
 * we know about them, spread the list across topics, then explain each pick.
 * Returns null when the user does not exist.
 */
export function recommend(db: DB, userId: number, limit = DEFAULT_LIMIT): Recommendation[] | null {
  const user = db.prepare("SELECT bio, location FROM users WHERE id = ?").get(userId) as
    | { bio: string | null; location: string | null }
    | undefined;
  if (!user) return null;

  const interestCount = (
    db.prepare("SELECT COUNT(*) AS n FROM user_topics WHERE user_id = ?").get(userId) as { n: number }
  ).n;
  const membershipCount = (
    db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?").get(userId) as { n: number }
  ).n;
  // The bio is only read when the member has stated no interests at all.
  const inferredTopics = new Set(interestCount === 0 ? inferTopicsFromBio(user.bio) : []);
  const isColdStart = interestCount === 0 && membershipCount === 0 && inferredTopics.size === 0;
  // Circles have no location, so in-person can't be matched to a city. What we can tell is
  // when a member has no fixed location on file and so needs a Circle she can attend remotely.
  const needsRemoteOption = user.location === null || user.location === "Remote";

  // Circle topics and tags that are among this member's stated interests.
  const topicMatches = db
    .prepare(
      `SELECT ct.circle_id, ct.is_primary, t.label
         FROM user_topics ut
         JOIN circle_topics ct ON ct.topic_id = ut.topic_id
         JOIN topics t ON t.id = ct.topic_id
        WHERE ut.user_id = ?
        ORDER BY t.id`,
    )
    .all(userId) as { circle_id: number; is_primary: number; label: string }[];
  const primaryMatch = new Map<number, string>();
  const tagMatches = new Map<number, string[]>();
  for (const m of topicMatches) {
    if (m.is_primary) primaryMatch.set(m.circle_id, m.label);
    else tagMatches.set(m.circle_id, [...(tagMatches.get(m.circle_id) ?? []), m.label]);
  }

  // For each Circle, how many distinct people from this member's Circles belong to it.
  const shared = db
    .prepare(
      `SELECT theirs.circle_id, COUNT(DISTINCT theirs.user_id) AS n
         FROM memberships mine
         JOIN memberships mates
           ON mates.circle_id = mine.circle_id AND mates.user_id != mine.user_id
         JOIN memberships theirs ON theirs.user_id = mates.user_id
        WHERE mine.user_id = ?
        GROUP BY theirs.circle_id`,
    )
    .all(userId) as { circle_id: number; n: number }[];
  const sharedMembers = new Map(shared.map((r) => [r.circle_id, r.n]));

  const candidates: Candidate[] = eligibleCircles(db, userId).map((c) => ({
    ...c,
    primaryMatch: primaryMatch.get(c.id) ?? null,
    tagMatches: tagMatches.get(c.id) ?? [],
    profileMatch: c.topic_slug && inferredTopics.has(c.topic_slug) ? c.topic_label : null,
    sharedMembers: sharedMembers.get(c.id) ?? 0,
    joinableAnywhere: needsRemoteOption && c.format !== "in_person",
  }));

  return diversify(candidates.map(scoreCandidate), limit).map((c) => {
    const reasons = explain(c, isColdStart);
    return {
      circle: {
        id: c.id,
        name: c.name,
        description: c.description,
        topic: c.topic_label,
        format: c.format,
        join_policy: c.join_policy,
        member_count: c.member_count,
        seats_left: c.seats_left,
      },
      score: Math.round(c.score * 1000) / 1000,
      reasons,
      explanation: reasons.map((r) => r.text).join(" "),
    };
  });
}
