import type { Reason, ScoredCandidate } from "./types";

// Thresholds for when a signal is strong enough to say out loud.
const ACTIVE_ENOUGH = 0.5; // activity score needed to call a Circle "active"
const SHARED_MEMBERS_MIN = 2; // one familiar face is too thin to lead with
const FEW_SEATS = 2;
const MAX_REASONS = 2;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function formatReason(c: ScoredCandidate): Reason {
  return {
    code: "joinable_anywhere",
    text:
      c.format === "virtual"
        ? "Meets virtually, so you can join from anywhere."
        : "Has a virtual option, so you can join from anywhere.",
  };
}

function activitySentence(c: ScoredCandidate): string {
  const posts = plural(c.feed_posts_30d, "post", "posts");
  if (c.feed_posts_30d === 0) {
    return `Last active ${plural(Math.round(c.days_since_activity), "day", "days")} ago.`;
  }
  if (c.activity_score < ACTIVE_ENOUGH) return `Members shared ${posts} in the last month.`;
  return c.days_since_activity <= 7
    ? `Active this week, with ${posts} in the last month.`
    : `Active this month, with ${posts}.`;
}

/**
 * Turns the signals that actually drove a Circle's score into member-facing sentences.
 * Every sentence is backed by a fact about this member and this Circle; when nothing is
 * known about the member (cold start), the explanation says so instead of implying a match.
 */
export function explain(c: ScoredCandidate, isColdStart: boolean): Reason[] {
  const reasons: Reason[] = [];

  if (isColdStart) {
    reasons.push({
      code: "popular_start",
      text:
        `One of the most active Circles right now, with ` +
        `${plural(c.feed_posts_30d, "post", "posts")} in the last month. A good place to start.`,
    });
    if (c.joinableAnywhere) reasons.push(formatReason(c));
  } else {
    const ranked: { weight: number; reason: Reason }[] = [];
    if (c.primaryMatch) {
      ranked.push({
        weight: c.parts.topic,
        reason: {
          code: "topic_match",
          text: `Focused on ${c.primaryMatch.toLowerCase()}, which you said you're interested in.`,
        },
      });
    } else if (c.tagMatches.length > 0) {
      ranked.push({
        weight: c.parts.tag,
        reason: {
          code: "tag_match",
          text: `Also covers ${c.tagMatches[0].toLowerCase()}, one of your interests.`,
        },
      });
    }
    if (c.profileMatch) {
      ranked.push({
        weight: c.parts.profile,
        reason: {
          code: "profile_match",
          text: `Focused on ${c.profileMatch.toLowerCase()}, which may fit what you wrote in your profile.`,
        },
      });
    }
    if (c.joinableAnywhere) ranked.push({ weight: c.parts.format, reason: formatReason(c) });
    if (c.sharedMembers >= SHARED_MEMBERS_MIN) {
      ranked.push({
        weight: c.parts.sharedMembers,
        reason: {
          code: "shared_members",
          text: `${plural(c.sharedMembers, "member", "members")} of your Circles are also here.`,
        },
      });
    }
    if (c.activity_score >= ACTIVE_ENOUGH) {
      ranked.push({ weight: c.parts.activity, reason: { code: "active", text: activitySentence(c) } });
    }

    ranked.sort((a, b) => b.weight - a.weight);
    reasons.push(...ranked.slice(0, MAX_REASONS).map((r) => r.reason));
    // Nothing stood out: still say something true about the Circle.
    if (reasons.length === 0) reasons.push({ code: "active", text: activitySentence(c) });
  }

  if (c.seats_left !== null && c.seats_left <= FEW_SEATS) {
    reasons.push({
      code: "limited_seats",
      text: `Only ${plural(c.seats_left, "spot", "spots")} left.`,
    });
  }
  return reasons;
}
