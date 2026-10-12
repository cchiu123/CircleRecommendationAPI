# Code Walkthrough: `CircleRecommendationAPI/src`

A guide to the 12 source files, about 750 lines in total. It is ordered the way a request flows, so reading the files in this order explains the whole system.

## Layout

```
src/
  server.ts              HTTP layer: one route plus a health check
  db/
    schema.sql           Tables and indexes
    connection.ts        Opens the SQLite database
    seed.ts              Loads the JSON files and computes Circle health
  recommend/
    index.ts             The pipeline: gathers facts, then calls the steps below
    filter.ts            Step 1: which Circles are eligible
    score.ts             Step 2: weighted score per Circle
    diversify.ts         Step 3: limit repeats of one topic
    explain.ts           Step 4: member-facing sentences
    health.ts            Circle capacity and activity score
    bio.ts               Topic hints from a member's bio
    types.ts             Shared data shapes
```

## What happens on a request

`GET /users/7/recommendations?limit=5`

1. `server.ts` validates `id` and `limit`, then calls `recommend(db, 7, 5)`.
2. `index.ts` looks up the user, her interests, her memberships, her bio and her location.
3. `filter.ts` returns every Circle she could join.
4. `index.ts` attaches to each Circle the facts that link it to her: topic match, tag matches, bio match, shared members, and whether it is remotely joinable.
5. `score.ts` turns those facts into a score, keeping each signal's contribution separately.
6. `diversify.ts` picks the top Circles, discounting a second Circle on the same topic.
7. `explain.ts` turns the largest contributions into sentences.
8. `index.ts` shapes the response and `server.ts` returns it as JSON.

Circle health (step 3 and 5 rely on it) is not computed during a request. It is computed once, when the database is seeded.

## The database layer: `src/db/`

### `schema.sql` (94 lines)

Defines eight tables.

| Table | Holds |
|---|---|
| `users`, `circles`, `topics` | One row per record from the seed files |
| `user_topics` | Each member's stated interests |
| `circle_topics` | Each Circle's primary topic and tags, with `is_primary` set to 1 or 0 |
| `memberships` | Who is in which Circle, with role |
| `posts` | Feed posts with reaction, comment and save counts |
| `circle_stats` | Derived health: seats left, days since activity, activity score, full and inactive flags |

Points worth knowing:

- **Interests and tags are join tables**, not arrays. Matching a member's interests to Circles is then an indexed join.
- **`memberships` is indexed in both directions**: the primary key `(user_id, circle_id)` finds a member's Circles, and `idx_memberships_circle` finds a Circle's members. The shared-members query needs both.
- **`CHECK` constraints** restrict `format`, `access`, `join_policy` and `role` to their allowed values.
- **`max_members` is nullable**: null means uncapped.

### `connection.ts` (13 lines)

`openDb(path)` opens a SQLite file and turns on foreign keys. It also exports the default paths for the database file and the data folder. Tests pass `":memory:"` to get a throwaway database.

### `seed.ts` (122 lines)

`seed(db, dataDir)` reads the five JSON files and fills every table in one transaction.

- **Topic slugs become ids.** An unknown slug throws, so bad data fails loudly.
- **Tags that repeat the primary topic are skipped** (`INSERT OR IGNORE`), since the primary row already covers them.
- **The snapshot date is derived**: `asOf` is the latest `last_activity_at` across all Circles. Recency is measured against that, not today's date.
- **Engagement is gathered per Circle** from posts in the 30 days before `asOf`.
- **`computeCircleStats`** from `health.ts` is called for each Circle and the result is stored in `circle_stats`.

When run directly with `npm run seed`, it deletes any existing database file, reseeds, and prints row counts.

## The recommender: `src/recommend/`

### `types.ts` (71 lines)

The shapes passed between steps.

| Type | Meaning |
|---|---|
| `Candidate` | An eligible Circle plus the facts linking it to one member |
| `ScoreParts` | The seven contributions that add up to a score |
| `ScoredCandidate` | A `Candidate` with its `score` and `parts` |
| `Reason` | A `code` and the sentence shown to the member |
| `ReasonCode` | The eight possible reason codes |
| `Recommendation` | One item in the API response |

### `index.ts` (95 lines)

`recommend(db, userId, limit)` is the entry point. It returns `null` for an unknown user.

It works out three things about the member:

- **`inferredTopics`**: topics from her bio, read only if she has stated no interests.
- **`isColdStart`**: true when she has no interests, no memberships and no usable bio.
- **`needsRemoteOption`**: true when her location is missing or "Remote".

It runs two SQL queries for the per-member facts:

- **Topic matches**: joins `user_topics` to `circle_topics`, and sorts the results into primary matches and tag matches.
- **Shared members**: a three-way self-join on `memberships`. It goes from her Circles, to the other people in them, to every Circle those people belong to, and counts distinct people per Circle.

Then it builds the `Candidate` list, runs score, diversify and explain, and rounds the score to three decimals for the response.

### `filter.ts` (30 lines)

`eligibleCircles(db, userId)` is one SQL query. It keeps a Circle only when all of these are true:

- `circle_stats.is_full = 0`
- `circle_stats.is_inactive = 0`
- `access = 'public'`
- she has no membership row for it

It also joins in the Circle's primary topic slug and label. These are filters, not penalties: a removed Circle is never scored.

### `health.ts` (66 lines)

`computeCircleStats(circle, recentPostEngagement, asOf)` is a pure function used by the seed step.

| Output | Rule |
|---|---|
| `seats_left` | `max_members - member_count`, or null when uncapped |
| `is_full` | `seats_left` is exactly 0 |
| `is_inactive` | No posts in 30 days and more than 60 days since any activity |
| `activity_score` | A 0–1 blend of the four parts below |

| Part | Share | Scaling |
|---|---|---|
| Posts in 30 days | 35% | Linear, capped at 12 |
| Recency | 30% | 1 today, falling to 0 at 30 days |
| Chat messages in 30 days | 20% | Logarithmic, capped at 150 |
| Average engagement per recent post | 15% | Linear, capped at 15 |

The shares are in `ACTIVITY_WEIGHTS`; the inactivity cutoff is `INACTIVE_AFTER_DAYS`.

### `bio.ts` (23 lines)

`inferTopicsFromBio(bio)` checks a bio against a list of 11 patterns, each mapped to a topic slug, and returns the slugs that match. For example, "career break" or "returning to work" maps to `career-breaks`. A null or unrecognized bio returns an empty list.

It matches "leadership" but not "leaders", so a bio about mentoring women leaders is not read as an interest in leadership skills.

### `score.ts` (39 lines)

`WEIGHTS` holds the seven weights. `scoreCandidate(c)` computes each contribution and their sum.

| Part | Value |
|---|---|
| `topic` | 1.0 if the primary topic is a stated interest |
| `tag` | 0.4 if a tag matches and the primary topic did not |
| `profile` | 0.3 if the bio points to the primary topic |
| `sharedMembers` | 0.5 × (shared members ÷ Circle size), capped at 0.5 |
| `format` | 0.15 if the Circle is remotely joinable and she needs that |
| `activity` | 0.4 × activity score |
| `openJoin` | 0.1 if the join policy is open |

`byRank` is the sort order: higher score first, then higher activity score, then lower Circle id. That makes ties come out the same on every run.

### `diversify.ts` (35 lines)

`diversify(scored, limit)` builds the final list one pick at a time.

- Each round, it takes the best remaining Circle.
- A Circle whose topic has already been picked once has its score multiplied by `REPEAT_TOPIC_PENALTY` (0.7).
- A Circle whose topic has been picked `MAX_PER_TOPIC` (2) times is skipped.
- Circles with no topic are never treated as repeats of each other.

The score in the API response is the adjusted one, which is why the list is always in descending order.

### `explain.ts` (103 lines)

`explain(c, isColdStart)` returns the list of reasons for one Circle.

For a cold start, it returns the "most active Circles right now" sentence, plus the format sentence when it applies.

Otherwise:

1. Each signal that is present becomes a candidate reason, tagged with its contribution from `parts`.
2. The candidates are sorted by contribution and the top two are kept (`MAX_REASONS`).
3. If nothing qualified, it falls back to a plain activity fact.
4. "Only N spots left." is appended when a capped Circle has two or fewer seats.

Thresholds: shared members is mentioned only at 2 or more (`SHARED_MEMBERS_MIN`), and a Circle is called "active" only with an activity score of 0.5 or more (`ACTIVE_ENOUGH`).

Two helpers produce wording: `activitySentence` chooses between "Active this week", "Active this month", "Members shared N posts" and "Last active N days ago"; `formatReason` chooses between the virtual and hybrid sentences.

## The HTTP layer: `server.ts` (56 lines)

`buildApp(db)` creates the Fastify app with two routes.

- **`GET /users/:id/recommendations`**: a JSON schema requires `id` to be an integer of at least 1 and `limit` to be an integer from 1 to 20, defaulting to 5. Fastify returns 400 for anything else. A `null` from `recommend` becomes a 404.
- **`GET /health`**: returns `{ "status": "ok" }`.

When run with `npm start`, it checks that the database file exists, opens it read-only, and listens on `127.0.0.1` at `PORT` or 3000. Keeping `buildApp` separate from the startup code lets the tests call routes without opening a port.

## Where to change things

| To change | Edit |
|---|---|
| A scoring weight | `WEIGHTS` in `score.ts` |
| The activity blend or inactivity cutoff | `ACTIVITY_WEIGHTS`, `INACTIVE_AFTER_DAYS` in `health.ts`, then reseed |
| Which Circles are excluded | The `WHERE` clause in `filter.ts` |
| How many Circles per topic, or the discount | `MAX_PER_TOPIC`, `REPEAT_TOPIC_PENALTY` in `diversify.ts` |
| Explanation wording or thresholds | `explain.ts` |
| Bio keywords | `BIO_TOPIC_HINTS` in `bio.ts` |
| Default or maximum list length | `DEFAULT_LIMIT`, `MAX_LIMIT` in `index.ts` |

After any change, run `npm test` and `npm run sensitivity`.
