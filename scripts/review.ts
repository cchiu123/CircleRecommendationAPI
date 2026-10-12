// Prints recommendations for a few members so they can be read the way a member would.
//   Run: npm run review            (the four planted scenario users)
//        npm run review -- 3 58    (specific user ids)

import { openDb } from "../src/db/connection";
import { seed } from "../src/db/seed";
import { recommend } from "../src/recommend";

const db = openDb(":memory:");
seed(db);

const ids = process.argv.slice(2).map(Number);
for (const id of ids.length ? ids : [42, 7, 15, 23]) {
  const interests = db
    .prepare(
      "SELECT t.label FROM user_topics ut JOIN topics t ON t.id = ut.topic_id WHERE ut.user_id = ?",
    )
    .all(id) as { label: string }[];
  const joined = db
    .prepare("SELECT circle_id FROM memberships WHERE user_id = ? ORDER BY circle_id")
    .all(id) as { circle_id: number }[];
  const recs = recommend(db, id);

  console.log(`\nUser ${id}`);
  if (!recs) {
    console.log("  not found");
    continue;
  }
  console.log(`  interests: ${interests.map((t) => t.label).join(", ") || "none"}`);
  console.log(`  member of: ${joined.map((m) => `#${m.circle_id}`).join(", ") || "none"}`);
  recs.forEach((r, i) => {
    const c = r.circle;
    console.log(
      `  ${i + 1}. #${c.id} ${c.name} [${c.topic ?? "no topic"}, ${c.format}, ${c.join_policy}] ` +
        `score ${r.score.toFixed(3)}\n     ${r.explanation}`,
    );
  });
}
