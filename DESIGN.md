# Technical Design: Circle Recommendation API

## What I built

`GET /users/:id/recommendations` returns a ranked list of Circles for a member, each with a short explanation written for her to read. It is a TypeScript service on Fastify and SQLite. Setup, the API contract, and the schema with indexing rationale are in the [README](README.md).

Each request runs four steps:

1. **Filter** out Circles she cannot or should not join: already joined, full, inactive, or unlisted.
2. **Score** the rest as a weighted sum. In order of weight: a stated interest matches the Circle's topic (1.0), members of her current Circles are in it (up to 0.5), a stated interest matches a tag (0.4), Circle activity (up to 0.4), her bio points to the topic when she has stated no interests (0.3), the Circle is virtual or hybrid and she has no fixed location (0.15), and it is open to join (0.1).
3. **Diversify**: at most two Circles per topic, with the second discounted.
4. **Explain** each pick from the one or two signals that added most to its score.

Circle activity and capacity are the same for every member, so they are computed once at load time into a `circle_stats` table. All four planted scenarios return the expected result.

## Tradeoffs

- **Rules over a model.** With 100 users and no record of which recommendations led to a join, there is nothing to train on. Each explanation is built from the same values that produced the rank, so it cannot claim something the ranking did not use.
- **Hand-set weights.** The order of the signals is reasoned; the values are starting points. Moving any one weight by ±20% leaves every scenario intact (`npm run sensitivity`).
- **Hard filters, not penalties, for full and inactive Circles.** Recommending a Circle she cannot join, or one that has gone silent, costs trust.
- **Unlisted Circles are excluded.** I read "unlisted" as not meant for discovery. This removes one large, active Circle.
- **Honest cold start.** A member we know nothing about is told the Circles are active and a good place to start, never that they match her.
- **Signals left out.** Job title, company and industry are random in the seed data: Circle members share an industry no more often than chance.

## For production scale

- Move to Postgres with migrations. Replace the one-time seed with a bulk backfill, then apply the platform's change events as upserts and update only the affected Circle's stats.
- Split candidate generation from ranking, precompute co-membership counts, and cache each member's list until she joins a Circle or edits her interests.
- Log impressions, joins and later participation, then learn the weights. The target is members who stay and take part, not joins alone.
- Add embeddings for softer topic matching and near-duplicate detection, and watch exposure so new and small Circles are not starved.

## With more time

- Circle location, so in-person Circles can be matched to her city.
- Stricter handling of tag matches on identity-specific Circles, such as a working-mothers Circle recommended through a shared tag.
- Bio matching beyond a keyword list, and dataset-wide metrics such as catalog coverage.

## How I used AI

I had not built a recommendation system before, so I used Claude Code throughout: to analyze the dataset, to write a plan and test plan before any code, then to implement. My role was deciding what to ask and checking the answers. Questioning the first design led to two added signals and the sensitivity check.
