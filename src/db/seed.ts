// Loads the seed JSON into SQLite and computes circle_stats.
//   Run: npm run seed

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACTIVITY_WINDOW_DAYS, DAY_MS, computeCircleStats } from "../recommend/health";
import { DEFAULT_DATA_DIR, DEFAULT_DB_PATH, openDb, type DB } from "./connection";

const SCHEMA_PATH = fileURLToPath(new URL("./schema.sql", import.meta.url));

interface TopicRow { id: number; slug: string; label: string; domain: string }
interface UserRow {
  id: number; first_name: string; last_name: string; has_photo: boolean; bio: string | null;
  job_title: string | null; company: string | null; industry: string | null; location: string | null;
  joined_at: string; topic_interests: string[]; profile_completeness: number;
}
interface CircleRow {
  id: number; name: string; slug: string; description: string | null; topic: string | null;
  tags: string[]; cover_image_url: string | null; format: string; access: string; join_policy: string;
  max_members: number | null; member_count: number; created_at: string; last_activity_at: string;
  feed_posts_30d: number; chat_messages_30d: number;
}
interface MembershipRow { user_id: number; circle_id: number; role: string; joined_at: string }
interface PostRow {
  id: number; circle_id: number; author_user_id: number; body: string; reaction_count: number;
  comment_count: number; save_count: number; created_at: string;
}

export function seed(db: DB, dataDir: string = DEFAULT_DATA_DIR): void {
  const load = <T>(name: string): T[] => JSON.parse(readFileSync(join(dataDir, name), "utf8"));
  const topics = load<TopicRow>("topics.json");
  const users = load<UserRow>("users.json");
  const circles = load<CircleRow>("circles.json");
  const memberships = load<MembershipRow>("memberships.json");
  const posts = load<PostRow>("activity.json");

  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const topicIdBySlug = new Map(topics.map((t) => [t.slug, t.id]));
  const topicId = (slug: string): number => {
    const id = topicIdBySlug.get(slug);
    if (id === undefined) throw new Error(`Unknown topic slug in seed data: ${slug}`);
    return id;
  };

  const insertTopic = db.prepare("INSERT INTO topics VALUES (@id, @slug, @label, @domain)");
  const insertUser = db.prepare(
    `INSERT INTO users VALUES (@id, @first_name, @last_name, @has_photo, @bio, @job_title,
       @company, @industry, @location, @joined_at, @profile_completeness)`,
  );
  const insertUserTopic = db.prepare("INSERT INTO user_topics VALUES (?, ?)");
  const insertCircle = db.prepare(
    `INSERT INTO circles VALUES (@id, @name, @slug, @description, @cover_image_url, @format,
       @access, @join_policy, @max_members, @member_count, @created_at, @last_activity_at,
       @feed_posts_30d, @chat_messages_30d)`,
  );
  // A tag that repeats the primary topic is already covered by the primary row.
  const insertCircleTopic = db.prepare("INSERT OR IGNORE INTO circle_topics VALUES (?, ?, ?)");
  const insertMembership = db.prepare(
    "INSERT INTO memberships VALUES (@user_id, @circle_id, @role, @joined_at)",
  );
  const insertPost = db.prepare(
    `INSERT INTO posts VALUES (@id, @circle_id, @author_user_id, @body, @reaction_count,
       @comment_count, @save_count, @created_at)`,
  );
  const insertStats = db.prepare(
    `INSERT INTO circle_stats VALUES (@circle_id, @seats_left, @days_since_activity,
       @avg_post_engagement, @activity_score, @is_full, @is_inactive, @as_of)`,
  );

  // The dataset is a snapshot, so "now" is the latest activity in it, not the wall
  // clock. Otherwise every Circle would look staler each day the data ages.
  const asOf = Math.max(...circles.map((c) => Date.parse(c.last_activity_at)));
  const windowStart = asOf - ACTIVITY_WINDOW_DAYS * DAY_MS;
  const recentEngagement = new Map<number, number[]>();
  for (const p of posts) {
    if (Date.parse(p.created_at) < windowStart) continue;
    const list = recentEngagement.get(p.circle_id) ?? [];
    list.push(p.reaction_count + p.comment_count + p.save_count);
    recentEngagement.set(p.circle_id, list);
  }

  db.transaction(() => {
    for (const t of topics) insertTopic.run(t);
    for (const u of users) {
      const { topic_interests, ...row } = u;
      insertUser.run({ ...row, has_photo: u.has_photo ? 1 : 0 });
      for (const slug of topic_interests) insertUserTopic.run(u.id, topicId(slug));
    }
    for (const c of circles) {
      const { topic, tags, ...row } = c;
      insertCircle.run(row);
      if (topic) insertCircleTopic.run(c.id, topicId(topic), 1);
      for (const tag of tags) insertCircleTopic.run(c.id, topicId(tag), 0);

      const stats = computeCircleStats(c, recentEngagement.get(c.id) ?? [], asOf);
      insertStats.run({
        circle_id: c.id,
        ...stats,
        is_full: stats.is_full ? 1 : 0,
        is_inactive: stats.is_inactive ? 1 : 0,
        as_of: new Date(asOf).toISOString(),
      });
    }
    for (const m of memberships) insertMembership.run(m);
    for (const p of posts) insertPost.run(p);
  })();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(DEFAULT_DB_PATH)) rmSync(DEFAULT_DB_PATH);
  const db = openDb();
  seed(db);
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  console.log(
    `Seeded ${DEFAULT_DB_PATH}\n` +
      ["users", "circles", "memberships", "posts", "topics"].map((t) => `  ${t}: ${count(t)}`).join("\n"),
  );
  db.close();
}
