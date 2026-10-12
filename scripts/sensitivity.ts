// Weight sensitivity check: do the results depend on the exact hand-set weights?
//
// Moves one weight at a time up and down by a fixed percentage, leaves the rest alone,
// and reports (a) whether each planted scenario still gives the expected result and
// (b) how much every member's top five shifts compared with the unmodified weights.
//
//   Run: npm run sensitivity          (±20%)
//        npm run sensitivity -- 50    (±50%)

import { openDb } from "../src/db/connection";
import { seed } from "../src/db/seed";
import { recommend } from "../src/recommend";
import { ACTIVITY_WEIGHTS } from "../src/recommend/health";
import { WEIGHTS } from "../src/recommend/score";
import type { Recommendation } from "../src/recommend/types";

const percent = Number(process.argv[2] ?? 20);
const TOP = 5;

type Lists = Map<number, Recommendation[]>;

// The activity blend is baked into circle_stats at seed time, so each run reseeds.
function runAll(): Lists {
  const db = openDb(":memory:");
  seed(db);
  const ids = (db.prepare("SELECT id FROM users ORDER BY id").all() as { id: number }[]).map((u) => u.id);
  const lists: Lists = new Map(ids.map((id) => [id, recommend(db, id, TOP)!]));
  db.close();
  return lists;
}

const circleIds = (recs: Recommendation[]) => recs.map((r) => r.circle.id);

// The expected outcome for each scenario, as in test/scenarios.test.ts.
const SCENARIOS: { name: string; holds: (lists: Lists) => boolean }[] = [
  {
    name: "42 cold start",
    holds: (l) => {
      const recs = l.get(42)!;
      return (
        recs.length === TOP &&
        new Set(recs.map((r) => r.circle.topic)).size >= 3 &&
        recs.every((r) => r.circle.format !== "in_person")
      );
    },
  },
  {
    name: "7 obvious",
    holds: (l) => circleIds(l.get(7)!).slice(0, 2).sort().join() === "5,6",
  },
  {
    name: "15 duplicates",
    holds: (l) => {
      const recs = l.get(15)!;
      const negotiation = circleIds(recs).filter((id) => [10, 11, 12].includes(id)).length;
      return (
        negotiation >= 1 &&
        negotiation <= 2 &&
        [10, 11, 12].includes(recs[0].circle.id) &&
        recs[1].circle.topic === "Confidence"
      );
    },
  },
  {
    name: "23 full/inactive",
    holds: (l) => {
      const ids = circleIds(l.get(23)!);
      return ids[0] === 22 && !ids.includes(20) && !ids.includes(21);
    },
  },
  {
    name: "4 bio",
    holds: (l) => l.get(4)![0].circle.topic === "Career breaks",
  },
];

const baseline = runAll();
const baselineFailures = SCENARIOS.filter((s) => !s.holds(baseline)).map((s) => s.name);
if (baselineFailures.length) {
  console.error(`Scenarios fail before any weight is changed: ${baselineFailures.join(", ")}`);
  process.exit(1);
}

/** How far a run's lists moved from the baseline, across all members. */
function drift(lists: Lists) {
  let kept = 0;
  let total = 0;
  let sameFirst = 0;
  for (const [userId, base] of baseline) {
    const now = circleIds(lists.get(userId)!);
    kept += circleIds(base).filter((id) => now.includes(id)).length;
    total += base.length;
    if (now[0] === base[0].circle.id) sameFirst++;
  }
  return { kept: kept / total, sameFirst: sameFirst / baseline.size };
}

const groups: [label: string, weights: Record<string, number>][] = [
  ["score", WEIGHTS],
  ["activity", ACTIVITY_WEIGHTS],
];

const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(4);
const rows: string[] = [];
const broken: string[] = [];

for (const [label, weights] of groups) {
  for (const key of Object.keys(weights)) {
    const original = weights[key];
    for (const sign of [-1, 1]) {
      weights[key] = original * (1 + (sign * percent) / 100);
      const lists = runAll();
      weights[key] = original;

      const failed = SCENARIOS.filter((s) => !s.holds(lists)).map((s) => s.name);
      const d = drift(lists);
      const change = `${label}.${key} ${sign < 0 ? "-" : "+"}${percent}%`;
      rows.push(
        `${change.padEnd(30)} top-5 kept ${pct(d.kept)}   same #1 ${pct(d.sameFirst)}   ` +
          (failed.length ? `BROKE: ${failed.join(", ")}` : "all scenarios hold"),
      );
      if (failed.length) broken.push(`${change}: ${failed.join(", ")}`);
    }
  }
}

console.log(`One weight at a time, moved by ±${percent}%, across ${baseline.size} members.\n`);
console.log(rows.join("\n"));
console.log(
  broken.length
    ? `\n${broken.length} of ${rows.length} changes broke a scenario:\n  ${broken.join("\n  ")}`
    : `\nAll scenarios hold under all ${rows.length} changes.`,
);
