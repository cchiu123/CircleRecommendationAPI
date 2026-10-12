PRAGMA foreign_keys = ON;

CREATE TABLE topics (
  id     INTEGER PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  label  TEXT NOT NULL,
  domain TEXT NOT NULL
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  has_photo            INTEGER NOT NULL CHECK (has_photo IN (0, 1)),
  bio                  TEXT,
  job_title            TEXT,
  company              TEXT,
  industry             TEXT,
  location             TEXT,
  joined_at            TEXT NOT NULL,
  profile_completeness REAL NOT NULL
);

CREATE TABLE circles (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  description       TEXT,
  cover_image_url   TEXT,
  format            TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'hybrid')),
  access            TEXT NOT NULL CHECK (access IN ('public', 'unlisted')),
  join_policy       TEXT NOT NULL CHECK (join_policy IN ('open', 'request')),
  max_members       INTEGER,           -- NULL means uncapped
  member_count      INTEGER NOT NULL,
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  feed_posts_30d    INTEGER NOT NULL,
  chat_messages_30d INTEGER NOT NULL
);

-- A member's stated interests (users.json `topic_interests`).
CREATE TABLE user_topics (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (user_id, topic_id)
) WITHOUT ROWID;

-- A Circle's primary topic and its free-form tags in one table.
-- is_primary = 1 for circles.json `topic`, 0 for entries that only appear in `tags`.
CREATE TABLE circle_topics (
  circle_id  INTEGER NOT NULL REFERENCES circles(id),
  topic_id   INTEGER NOT NULL REFERENCES topics(id),
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (circle_id, topic_id)
) WITHOUT ROWID;
-- "Which Circles cover this member's interests?"
CREATE INDEX idx_circle_topics_topic ON circle_topics (topic_id, circle_id);

CREATE TABLE memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  role      TEXT NOT NULL CHECK (role IN ('member', 'leader')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (user_id, circle_id)
) WITHOUT ROWID;
-- The primary key covers "this member's Circles"; this covers "this Circle's members",
-- which the co-membership signal needs.
CREATE INDEX idx_memberships_circle ON memberships (circle_id, user_id);

CREATE TABLE posts (
  id             INTEGER PRIMARY KEY,
  circle_id      INTEGER NOT NULL REFERENCES circles(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  reaction_count INTEGER NOT NULL,
  comment_count  INTEGER NOT NULL,
  save_count     INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
-- Per-Circle engagement over a time window.
CREATE INDEX idx_posts_circle_created ON posts (circle_id, created_at);

-- Derived Circle health. It is the same for every member, so it is computed once
-- (at seed time here; by a scheduled job or on write in production), not per request.
CREATE TABLE circle_stats (
  circle_id           INTEGER PRIMARY KEY REFERENCES circles(id),
  seats_left          INTEGER,          -- NULL means uncapped
  days_since_activity REAL NOT NULL,
  avg_post_engagement REAL NOT NULL,    -- reactions + comments + saves per post, last 30 days
  activity_score      REAL NOT NULL,    -- 0..1
  is_full             INTEGER NOT NULL CHECK (is_full IN (0, 1)),
  is_inactive         INTEGER NOT NULL CHECK (is_inactive IN (0, 1)),
  as_of               TEXT NOT NULL     -- the "now" the stats were computed against
);
