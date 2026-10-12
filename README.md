# Circle Recommendation API

Returns a ranked list of Lean In Circles a member should join, with a short member-facing explanation for each one.

## Setup

Requires Node 20 or newer.

```sh
npm install
npm run seed     # loads data/*.json into data/circles.db
npm start        # http://127.0.0.1:3000 (set PORT to change)
```

```sh
curl "http://127.0.0.1:3000/users/7/recommendations"
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the test suite against an in-memory database |
| `npm run review` | Prints recommendations for the four planted scenario users |
| `npm run review -- 3 58` | Prints recommendations for specific user ids |
| `npm run sensitivity` | Moves each weight ±20% (or `-- 50` for ±50%) and reports whether the scenarios still hold |
| `npm run typecheck` | Type-checks the project |

## API

### `GET /users/:id/recommendations`

| Parameter | In | Notes |
|---|---|---|
| `id` | path | User id, a positive integer |
| `limit` | query | 1–20, default 5 |

Responses:

- `200` with the ranked list
- `400` when `id` or `limit` is malformed or out of range
- `404` when the user does not exist

```json
{
  "user_id": 23,
  "recommendations": [
    {
      "circle": {
        "id": 22,
        "name": "Level Up Collective",
        "description": "A supportive circle for women focused on getting promoted.",
        "topic": "Getting promoted",
        "format": "hybrid",
        "join_policy": "request",
        "member_count": 14,
        "seats_left": 6
      },
      "score": 1.352,
      "reasons": [
        { "code": "topic_match", "text": "Focused on getting promoted, which you said you're interested in." },
        { "code": "active", "text": "Active this week, with 8 posts in the last month." }
      ],
      "explanation": "Focused on getting promoted, which you said you're interested in. Active this week, with 8 posts in the last month."
    }
  ]
}
```

`explanation` is the text to show a member. `reasons` carries the same sentences with a code each, for clients that want to style or log them. `seats_left` is `null` for an uncapped Circle.

### `GET /health`

Returns `{ "status": "ok" }`.

## How recommendations are made

A transparent scoring pipeline, with no trained model. Each step is one file in [src/recommend/](src/recommend/).

1. **Filter** ([filter.ts](src/recommend/filter.ts)): drop Circles the member cannot or should not join.
   - Already a member
   - Full: `member_count >= max_members` (uncapped Circles are never full)
   - Inactive: no posts in 30 days and no activity at all for more than 60 days
   - Unlisted
2. **Score** ([score.ts](src/recommend/score.ts)): add up weighted signals.

   | Signal | Weight |
   |---|---|
   | The Circle's primary topic is one of the member's stated interests | 1.0 |
   | Only a tag matches a stated interest | 0.4 |
   | No stated interests, but the member's bio points to the Circle's topic | 0.3 |
   | Share of the Circle's members who are already in a Circle with this member | up to 0.5 |
   | Circle activity score, 0–1 | up to 0.4 |
   | Virtual or hybrid Circle, for a member with no location or "Remote" | 0.15 |
   | Open to join without a request | 0.1 |

3. **Diversify** ([diversify.ts](src/recommend/diversify.ts)): at most two Circles per topic, and the second is discounted to 70% of its score so the member's other interests come first.
4. **Explain** ([explain.ts](src/recommend/explain.ts)): the one or two signals that contributed most become sentences. A member we know nothing about is told the Circle is popular and active, never that it matches her.

The activity score ([health.ts](src/recommend/health.ts)) combines posts in the last 30 days, recency of last activity, group-chat volume, and average engagement per recent post. It is computed once at seed time into `circle_stats`, measured against the latest activity in the dataset, not the wall clock, because the data is a fixed snapshot.

## Planted scenarios

| Scenario | User | Result |
|---|---|---|
| Cold start | 42 | Five active, open Circles across five topics, all virtual or hybrid since her location is unknown, each explained as popular and active |
| Obvious matches | 7 | #5 Women Who Lead, then #6 Speak Up Circle |
| Duplicates | 15 | #11 and #10 appear, #12 does not; confidence Circles fill the slots between |
| Full / inactive | 23 | #22 Level Up Collective first; #20 and #21 never appear |

Run `npm run review` to see the full lists.

## Database schema

Defined in [src/db/schema.sql](src/db/schema.sql).

| Table | Purpose |
|---|---|
| `users`, `circles`, `topics` | One row per record in the seed files |
| `user_topics` | A member's stated interests |
| `circle_topics` | A Circle's primary topic and tags, with an `is_primary` flag |
| `memberships` | Who belongs to which Circle, and their role |
| `posts` | Circle feed posts with engagement counts |
| `circle_stats` | Derived health per Circle: seats left, days since activity, activity score, full and inactive flags |

Indexing decisions:

- `memberships` has primary key `(user_id, circle_id)` for "this member's Circles", plus an index on `(circle_id, user_id)` for "this Circle's members". The co-membership query walks both directions.
- `circle_topics (topic_id, circle_id)` answers "which Circles cover this member's interests".
- `posts (circle_id, created_at)` supports per-Circle engagement over a time window.
- Topics and tags are normalized into join tables so interest matching is an indexed join, not string matching on arrays.
- `circle_stats` is precomputed because Circle health is the same for every member.
- `CHECK` constraints restrict `format`, `access`, `join_policy` and `role` to their allowed values.
- `max_members` is nullable: null means uncapped.

## Code walkthrough

The source is 12 files in [src/](src/). This section follows the order a request flows through them.

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

### What happens on a request

`GET /users/7/recommendations?limit=5`

1. `server.ts` validates `id` and `limit`, then calls `recommend(db, 7, 5)`.
2. `index.ts` looks up the user, her interests, her memberships, her bio and her location.
3. `filter.ts` returns every Circle she could join.
4. `index.ts` attaches to each Circle the facts that link it to her: topic match, tag matches, bio match, shared members, and whether it is remotely joinable.
5. `score.ts` turns those facts into a score, keeping each signal's contribution separately.
6. `diversify.ts` picks the top Circles, discounting a second Circle on the same topic.
7. `explain.ts` turns the largest contributions into sentences.
8. `index.ts` shapes the response and `server.ts` returns it as JSON.

Circle health, which steps 3 and 5 rely on, is not computed during a request. It is computed once, when the database is seeded.

### Database layer: [src/db/](src/db/)

**[connection.ts](src/db/connection.ts)**: `openDb(path)` opens a SQLite file and turns on foreign keys. Tests pass `":memory:"` to get a throwaway database.

**[seed.ts](src/db/seed.ts)**: `seed(db, dataDir)` reads the five JSON files and fills every table in one transaction.

- **Topic names are converted to topic ids.** The JSON files refer to topics by a text name such as `getting-promoted` (called a slug in the data). The seed looks up each name and stores its numeric id. A name that is not in the topics table stops the seed with an error, so a typo in the data is caught immediately.
- **Tags that repeat the primary topic are skipped**, since the primary row already covers them.
- **The snapshot date is derived**: `asOf` is the latest `last_activity_at` across all Circles. Recency is measured against that, not today's date.
- **Engagement is gathered per Circle** from posts in the 30 days before `asOf`.
- **`computeCircleStats`** from `health.ts` is called for each Circle and the result is stored in `circle_stats`.

Run with `npm run seed`, it deletes any existing database file, reseeds, and prints row counts.

### Recommender: [src/recommend/](src/recommend/)

**[types.ts](src/recommend/types.ts)**: the shapes passed between steps.

| Type | Meaning |
|---|---|
| `Candidate` | An eligible Circle plus the facts linking it to one member |
| `ScoreParts` | The seven contributions that add up to a score |
| `ScoredCandidate` | A `Candidate` with its `score` and `parts` |
| `Reason` | A `code` and the sentence shown to the member |
| `ReasonCode` | The eight possible reason codes |
| `Recommendation` | One item in the API response |

**[index.ts](src/recommend/index.ts)**: `recommend(db, userId, limit)` is the entry point. It returns `null` for an unknown user.

It works out three things about the member:

- **`inferredTopics`**: topics from her bio, read only if she has stated no interests.
- **`isColdStart`**: true when she has no interests, no memberships and no usable bio.
- **`needsRemoteOption`**: true when her location is missing or "Remote".

It runs two SQL queries for the per-member facts:

- **Topic matches**: joins `user_topics` to `circle_topics`, and sorts the results into primary matches and tag matches.
- **Shared members**: a three-way self-join on `memberships`. It goes from her Circles, to the other people in them, to every Circle those people belong to, and counts distinct people per Circle.

Then it builds the `Candidate` list, runs score, diversify and explain, and rounds the score to three decimals.

**[filter.ts](src/recommend/filter.ts)**: `eligibleCircles(db, userId)` is one SQL query. It keeps a Circle only when it is not full, not inactive, public, and she has no membership row for it. These are filters, not penalties: a removed Circle is never scored.

**[health.ts](src/recommend/health.ts)**: `computeCircleStats(circle, recentPostEngagement, asOf)` is a pure function used by the seed step.

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

The caps sit near the level of a typical active Circle in the seed data, so the score separates quiet from lively and stops rewarding volume beyond that.

**[bio.ts](src/recommend/bio.ts)**: `inferTopicsFromBio(bio)` checks a bio against 11 patterns, each mapped to a topic, and returns the topics that match. For example, "career break" or "returning to work" maps to career breaks. It matches "leadership" but not "leaders", so a bio about mentoring women leaders is not read as an interest in leadership skills.

**[score.ts](src/recommend/score.ts)**: `scoreCandidate(c)` computes each contribution from the weights table above and their sum.

- The shared-members part is 0.5 × (shared members ÷ Circle size). Dividing by size keeps large Circles from winning only because they contain more people.
- A Circle matching on both topic and tag is counted once.
- `byRank` is the sort order: higher score first, then higher activity score, then lower Circle id. Ties come out the same on every run.

**[diversify.ts](src/recommend/diversify.ts)**: `diversify(scored, limit)` builds the final list one pick at a time.

- Each round, it takes the best remaining Circle.
- A Circle whose topic has already been picked once has its score multiplied by `REPEAT_TOPIC_PENALTY` (0.7).
- A Circle whose topic has been picked `MAX_PER_TOPIC` (2) times is skipped.
- Circles with no topic are never treated as repeats of each other.

The score in the API response is the adjusted one, which is why the list is always in descending order.

**[explain.ts](src/recommend/explain.ts)**: `explain(c, isColdStart)` returns the list of reasons for one Circle. For a cold start, it returns the "most active Circles right now" sentence, plus the format sentence when it applies. Otherwise:

1. Each signal that is present becomes a candidate reason, tagged with its contribution to the score.
2. The candidates are sorted by contribution and the top two are kept.
3. If nothing qualified, it falls back to a plain activity fact.
4. "Only N spots left." is appended when a capped Circle has two or fewer seats.

Shared members is mentioned only at 2 or more people, and a Circle is called "active" only with an activity score of 0.5 or more.

### HTTP layer: [server.ts](src/server.ts)

`buildApp(db)` creates the Fastify app with the two routes. A JSON schema validates `id` and `limit`, so Fastify returns 400 for anything malformed; a `null` from `recommend` becomes a 404.

Run with `npm start`, it checks that the database file exists, opens it read-only, and listens on `127.0.0.1`. Keeping `buildApp` separate from the startup code lets the tests call routes without opening a port.

### Where to change things

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

## Tests

`npm test` runs 73 tests in [test/](test/):

| File | Covers |
|---|---|
| [invariants.test.ts](test/invariants.test.ts) | Rules that hold for all 100 users: nothing joined, full, inactive or unlisted; no repeats; stable order |
| [scenarios.test.ts](test/scenarios.test.ts) | The four planted users, a member matched through her bio, and the 29 members with Circles but no stated interests |
| [explanations.test.ts](test/explanations.test.ts) | Every sentence shown to every user is checked against the raw seed data |
| [components.test.ts](test/components.test.ts) | Health, scoring, bio inference, diversification and explanation units |
| [api.test.ts](test/api.test.ts) | Response shape, `limit`, 400 and 404 handling |

## Notes

- `better-sqlite3` is pinned to v11 and `light-my-request` to 6.6.0 so the project runs on any Node 20 release. Their newest versions need Node 22 or a late Node 20.
- Circles have a format but no location, so in-person Circles are not matched to a member's city. The format signal only helps members with no fixed location on file.
- The bio is read only when a member has stated no interests, using a short keyword list in [bio.ts](src/recommend/bio.ts).
- Job title, company and industry are not used: they are assigned at random in the seed data.
