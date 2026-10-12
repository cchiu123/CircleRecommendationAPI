import type { DB } from "../db/connection";
import type { Candidate } from "./types";

export type CandidateRow = Omit<
  Candidate,
  "primaryMatch" | "tagMatches" | "profileMatch" | "sharedMembers" | "joinableAnywhere"
>;

/**
 * Circles this member could actually join. Hard filters, not penalties: recommending
 * a Circle that is full, dormant, hidden or already joined is never the right answer.
 */
export function eligibleCircles(db: DB, userId: number): CandidateRow[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.description, c.format, c.join_policy, c.member_count,
              c.feed_posts_30d, s.seats_left, s.days_since_activity, s.activity_score,
              t.slug AS topic_slug, t.label AS topic_label
         FROM circles c
         JOIN circle_stats s ON s.circle_id = c.id
         LEFT JOIN circle_topics ct ON ct.circle_id = c.id AND ct.is_primary = 1
         LEFT JOIN topics t ON t.id = ct.topic_id
        WHERE s.is_full = 0
          AND s.is_inactive = 0
          AND c.access = 'public'
          AND NOT EXISTS (
                SELECT 1 FROM memberships m WHERE m.user_id = ? AND m.circle_id = c.id)`,
    )
    .all(userId) as CandidateRow[];
}
