// Circle health: capacity and activity. These are derived, not stored in the seed
// data, and are the same for every member, so they are computed once into circle_stats.

export const DAY_MS = 86_400_000;
export const ACTIVITY_WINDOW_DAYS = 30;
// A Circle with no posts in the window and nothing at all for this long is treated as dormant.
export const INACTIVE_AFTER_DAYS = 60;

// How the 0..1 activity score is put together. Each part is scaled to 0..1 first.
export const ACTIVITY_WEIGHTS = { posts: 0.35, recency: 0.3, chat: 0.2, engagement: 0.15 };
// Values at which each part saturates, so one very loud Circle doesn't dwarf the rest.
const POSTS_CAP = 12;
const CHAT_CAP = 150;
const ENGAGEMENT_CAP = 15;

export interface CircleHealthInput {
  max_members: number | null;
  member_count: number;
  last_activity_at: string;
  feed_posts_30d: number;
  chat_messages_30d: number;
}

export interface CircleStats {
  seats_left: number | null;
  days_since_activity: number;
  avg_post_engagement: number;
  activity_score: number;
  is_full: boolean;
  is_inactive: boolean;
}

/**
 * @param recentPostEngagement reactions + comments + saves for each post in the last 30 days
 * @param asOf the "now" to measure recency against, in epoch ms
 */
export function computeCircleStats(
  circle: CircleHealthInput,
  recentPostEngagement: number[],
  asOf: number,
): CircleStats {
  const daysSince = Math.max(0, (asOf - Date.parse(circle.last_activity_at)) / DAY_MS);
  const seatsLeft =
    circle.max_members === null ? null : Math.max(0, circle.max_members - circle.member_count);
  const avgEngagement = recentPostEngagement.length
    ? recentPostEngagement.reduce((a, b) => a + b, 0) / recentPostEngagement.length
    : 0;

  const posts = Math.min(circle.feed_posts_30d / POSTS_CAP, 1);
  const recency = Math.max(0, 1 - daysSince / ACTIVITY_WINDOW_DAYS);
  const chat = Math.min(Math.log1p(circle.chat_messages_30d) / Math.log1p(CHAT_CAP), 1);
  const engagement = Math.min(avgEngagement / ENGAGEMENT_CAP, 1);

  return {
    seats_left: seatsLeft,
    days_since_activity: daysSince,
    avg_post_engagement: avgEngagement,
    activity_score:
      ACTIVITY_WEIGHTS.posts * posts +
      ACTIVITY_WEIGHTS.recency * recency +
      ACTIVITY_WEIGHTS.chat * chat +
      ACTIVITY_WEIGHTS.engagement * engagement,
    is_full: seatsLeft === 0,
    is_inactive: circle.feed_posts_30d === 0 && daysSince > INACTIVE_AFTER_DAYS,
  };
}
