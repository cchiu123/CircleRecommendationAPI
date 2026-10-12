import type { Candidate, ScoredCandidate } from "./types";

// Starting weights, tuned by hand against the planted scenarios. Stated interests are
// the strongest signal because they are the only thing the member told us directly.
export const WEIGHTS = {
  topic: 1.0, // primary topic is a stated interest
  tag: 0.4, // only a tag matches; tags are noisier than the primary topic
  profile: 0.3, // topic inferred from the bio; a guess, so it ranks below anything stated
  sharedMembers: 0.5, // scaled by the share of the Circle the member already knows
  activity: 0.4, // scaled by the 0..1 activity score
  // Circles have no location, so an in-person Circle can't be confirmed as reachable.
  // For a member with no fixed location on file, favor ones she can attend from anywhere.
  format: 0.15,
  openJoin: 0.1, // no approval step between the member and the Circle
};

export function scoreCandidate(c: Candidate): ScoredCandidate {
  // Share of this Circle's members the member already shares a Circle with. Dividing by
  // Circle size keeps large Circles from winning just because they contain more people.
  const knownShare = c.member_count > 0 ? Math.min(c.sharedMembers / c.member_count, 1) : 0;

  const parts = {
    topic: c.primaryMatch ? WEIGHTS.topic : 0,
    // A Circle matching on both topic and tag is not counted twice.
    tag: !c.primaryMatch && c.tagMatches.length > 0 ? WEIGHTS.tag : 0,
    profile: c.profileMatch ? WEIGHTS.profile : 0,
    sharedMembers: WEIGHTS.sharedMembers * knownShare,
    format: c.joinableAnywhere ? WEIGHTS.format : 0,
    activity: WEIGHTS.activity * c.activity_score,
    openJoin: c.join_policy === "open" ? WEIGHTS.openJoin : 0,
  };
  const score = Object.values(parts).reduce((sum, part) => sum + part, 0);
  return { ...c, parts, score };
}

/** Best first. Ties resolve the same way every time: livelier Circle, then lower id. */
export function byRank(a: ScoredCandidate, b: ScoredCandidate): number {
  return b.score - a.score || b.activity_score - a.activity_score || a.id - b.id;
}
