export type ReasonCode =
  | "topic_match" // the Circle's primary topic is one of the member's stated interests
  | "tag_match" // one of the Circle's tags is one of the member's stated interests
  | "profile_match" // no stated interests, but the member's bio points to the Circle's topic
  | "shared_members" // people from the member's current Circles are in this one
  | "joinable_anywhere" // virtual or hybrid, for a member with no fixed location on file
  | "active" // the Circle is lively right now
  | "popular_start" // cold start: nothing known about the member, so lead with healthy Circles
  | "limited_seats"; // nearly at capacity

export interface Reason {
  code: ReasonCode;
  text: string;
}

/** An eligible Circle plus everything known about how it relates to one member. */
export interface Candidate {
  id: number;
  name: string;
  description: string | null;
  format: "in_person" | "virtual" | "hybrid";
  join_policy: "open" | "request";
  member_count: number;
  seats_left: number | null;
  feed_posts_30d: number;
  days_since_activity: number;
  activity_score: number;
  topic_slug: string | null;
  topic_label: string | null;
  /** Label of the primary topic, when it is one of the member's interests. */
  primaryMatch: string | null;
  /** Labels of tags (not the primary topic) that are among the member's interests. */
  tagMatches: string[];
  /** Label of the primary topic, when the member has no stated interests and her bio points to it. */
  profileMatch: string | null;
  /** Distinct people who share a Circle with the member and belong to this one. */
  sharedMembers: number;
  /** The Circle can be attended remotely and the member's location is unknown or "Remote". */
  joinableAnywhere: boolean;
}

export interface ScoreParts {
  topic: number;
  tag: number;
  profile: number;
  sharedMembers: number;
  format: number;
  activity: number;
  openJoin: number;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  parts: ScoreParts;
}

export interface Recommendation {
  circle: {
    id: number;
    name: string;
    description: string | null;
    topic: string | null;
    format: Candidate["format"];
    join_policy: Candidate["join_policy"];
    member_count: number;
    seats_left: number | null;
  };
  score: number;
  reasons: Reason[];
  explanation: string;
}
