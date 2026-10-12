# Technical Design: Circle Recommendation API

## What I built

`GET /users/:id/recommendations` returns a ranked list of Circles for a member, each with a short explanation written for her to read. It is a TypeScript service on Fastify and SQLite, with a four-step pipeline:

1. **Filter** out Circles she cannot or should not join: already joined, full, inactive, or unlisted.
2. **Score** each remaining Circle as a weighted sum of signals.
3. **Diversify** so that at most two Circles share a topic, with the second discounted.
4. **Explain** each pick from the one or two signals that contributed most to its score.

| Signal | Weight | Why |
|---|---|---|
| Stated interest matches the Circle's topic | 1.0 | The only thing she told us directly |
| Shares members with her current Circles | up to 0.5 | The main signal for the 29 members with Circles but no stated interests |
| Stated interest matches a tag | 0.4 | Widens the pool, but tags are noisy |
| Circle activity (posts, recency, chat, engagement) | up to 0.4 | A Circle only helps if people show up |
| Bio points to the topic, when no interests are stated | 0.3 | A guess, so it ranks below anything stated and is worded as one |
| Virtual or hybrid, for a member with no fixed location | 0.15 | Circles have no location, so in-person cannot be confirmed as reachable |
| Open to join | 0.1 | Tiebreaker |

Job title, company and industry are not used: in the seed data, members of the same Circle share an industry no more often than chance.

All four planted scenarios return the expected result, and the README lists them. The schema and indexing rationale are also in the README.

## Tradeoffs

- **Rules over a model.** With 100 users and no record of which recommendations led to a join, there is nothing to train on. A weighted sum is easy to reason about, and each explanation is generated from the same values that produced the rank, so it cannot claim something the ranking did not use.
- **Hand-set weights.** The ordering of the signals is reasoned; the exact values are starting points. Moving any single weight by ±20% leaves every scenario intact and changes at most 7% of members' first result (`npm run sensitivity`).
- **Hard filters for full and inactive Circles.** Recommending a Circle she cannot join, or one that has gone silent, costs trust, so no score can bring one back. A waitlist would turn "full" into a penalty.
- **Unlisted Circles are excluded.** I read "unlisted" as not meant for discovery. This removes one large, active Circle; if unlisted Circles should be recommendable, the filter is one line.
- **Honest cold start.** A member we know nothing about is told the Circles are active and a good place to start, never that they match her.
- **Health is precomputed.** Activity and capacity are the same for every member, so they are computed once into `circle_stats`. Topic match and shared members are computed per request in SQL, which is fine at this size.
- **Bio matching is a keyword list.** It is adequate for a weak, labeled fallback on this dataset and would not hold up on real bios.

## For production scale

- Move to Postgres with the same schema and versioned migrations. SQLite allows one writer at a time.
- Replace the one-time seed with incremental loading. Today the seed wipes the database and reloads a fixed snapshot. In production the platform owns this data, so I would backfill once in bulk, then consume its change events (member joined, post created) and apply them as upserts.
- Keep derived data current as events arrive: update only the affected Circle's row in `circle_stats`, measure recency against the real clock, and maintain the rolling 30-day counts, which the snapshot supplies precomputed.
- Split candidate generation from ranking: fetch a few hundred Circles by topic, location and network, then score them.
- Precompute co-membership counts, the most expensive query, and cache each member's list until she joins a Circle or edits her interests.
- Log impressions, joins and what happens after joining, then learn the weights. The target should be members who stay and participate, not joins alone.
- Add embeddings over Circle descriptions and posts for softer topic matching and true near-duplicate detection.
- Watch exposure so new and small Circles are not starved by a bias toward already-active ones.

## With more time

- Circle location, so in-person and hybrid Circles can be matched to her city.
- Recent-join growth, leader engagement and industry overlap as signals, tested on real data.
- Dataset-wide metrics: catalog coverage, popularity concentration, and held-out membership recall against a popularity baseline.
- Review of tag matches on identity-specific Circles, such as recommending a working-mothers Circle because of a shared tag.
- Pagination, authentication and rate limiting on the API.

## How I used AI

I had not built a recommendation system before, so I used Claude Code throughout: first to analyze the dataset and outline an approach, then to write a plan and test plan before any code, then to implement. My role was deciding what to ask and checking the answers. Questioning the initial design led to two added signals and a sensitivity check on the hand-set weights.