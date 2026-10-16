// 悪化判定(worse)の施策を、記録しておいた施策前の値に戻す(DESIGN.md §5)。
// 使い方: node loop/scripts/revert.mjs --id 2026-10-20-kangyo
// data/exams/<slug>.json の該当フィールドだけを書き戻す。prev の値が null のフィールドは削除する。
// build.mjs に追加した opt-in 描画は残す(フィールドが無ければ出力に影響しないため)。
// 書き戻し後は ROUTINE.md の手順どおり verify → commit → push → measure.mjs mark-reverted を行う。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { ROOT, loadState } from "./lib.mjs";

const { values: args } = parseArgs({ options: { id: { type: "string" } } });
const state = await loadState();
const a = state.actions.find((x) => x.id === args.id);
if (!a) {
  console.error(`❌ 施策 ${args.id} が見つかりません`);
  process.exit(1);
}
if (a.status !== "worse") {
  console.error(`❌ ${a.id} は悪化判定ではありません(status=${a.status})`);
  process.exit(1);
}
const file = path.join(ROOT, "data", "exams", `${a.slug}.json`);
const exam = JSON.parse(await readFile(file, "utf8"));
for (const [k, v] of Object.entries(a.prev || {})) {
  if (v === null) delete exam[k];
  else exam[k] = v;
}
await writeFile(file, JSON.stringify(exam, null, 2) + "\n");
console.log(`✅ ${a.slug} の ${Object.keys(a.prev || {}).join(", ") || "(記録なし)"} を施策前に戻しました`);
