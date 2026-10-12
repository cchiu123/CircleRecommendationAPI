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
