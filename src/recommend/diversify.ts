import { byRank } from "./score";
import type { ScoredCandidate } from "./types";

// Several Circles on one topic are close substitutes. Show the best, let a second through
// at a discount, and leave the remaining slots for something different.
export const MAX_PER_TOPIC = 2;
// 0.7 drops a second Circle on a topic below the member's other interests, but keeps it
// above Circles that only match on a tag. At 0.5 a tag match outranked a true topic match.
export const REPEAT_TOPIC_PENALTY = 0.7;

/**
 * Greedy re-rank: repeatedly take the best remaining Circle, where a Circle's score is
 * discounted once for each already-chosen Circle with the same primary topic.
 * Circles with no topic are never treated as duplicates of each other.
 */
export function diversify(scored: ScoredCandidate[], limit: number): ScoredCandidate[] {
  const remaining = [...scored];
  const chosen: ScoredCandidate[] = [];
  const perTopic = new Map<string, number>();
  const seen = (c: ScoredCandidate) => (c.topic_slug ? perTopic.get(c.topic_slug) ?? 0 : 0);

  while (chosen.length < limit && remaining.length > 0) {
    const adjusted = remaining
      .filter((c) => seen(c) < MAX_PER_TOPIC)
      .map((c) => ({ ...c, score: c.score * REPEAT_TOPIC_PENALTY ** seen(c) }))
      .sort(byRank);
    const next = adjusted[0];
    if (!next) break;

    chosen.push(next);
    remaining.splice(remaining.findIndex((c) => c.id === next.id), 1);
    if (next.topic_slug) perTopic.set(next.topic_slug, seen(next) + 1);
  }
  return chosen;
}
