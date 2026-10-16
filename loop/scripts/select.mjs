// seo-loop の対象候補を DESIGN.md §6 の優先順位で並べる(決定的処理)。
// 使い方: node loop/scripts/select.mjs   … 候補JSONを標準出力し、state.queue と metrics.md を更新
// 前提: 同じ日に scripts/gsc-fetch.mjs → build.mjs → seo-scan.mjs を実行済みであること。
// 最終的に1件選ぶのは ROUTINE.md ③(LLM)。候補ゼロなら「何もしない」。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, TODAY, addDays, loadState, saveState } from "./lib.mjs";

const DEADLINE_GUARD_DAYS = 7; // 申込締切までこの日数以内のページは揺らさない
const ANNOTATION_HOLD_DAYS = 21;
const MID_RANK = { min: 10.5, max: 20, minImpr: 100 }; // 優先4: 11〜20位で表示が多い

const reportsDir = path.join(ROOT, "reports");
const latestOf = async (dir, re) => (await readdir(dir)).filter((f) => re.test(f)).sort().at(-1);

const scanName = await latestOf(reportsDir, /^seo-scan-\d{4}-\d{2}-\d{2}\.json$/);
if (!scanName) throw new Error("seo-scan の結果がありません");
const scan = JSON.parse(await readFile(path.join(reportsDir, scanName), "utf8"));
const snapName = await latestOf(path.join(reportsDir, "gsc"), /^\d{4}-\d{2}-\d{2}\.json$/);
const snap = snapName ? JSON.parse(await readFile(path.join(reportsDir, "gsc", snapName), "utf8")) : null;
const state = await loadState();

// ── 除外条件 ──
const excluded = new Map(); // slug -> 理由
for (const a of state.actions) if (a.status === "observing") excluded.set(a.slug, `観察中(判定日 ${a.judgeDate})`);
try {
  const raw = await readFile(path.join(reportsDir, "seo-annotations.ndjson"), "utf8");
  for (const l of raw.trim().split("\n").filter(Boolean)) {
    const a = JSON.parse(l);
    if (a.date < addDays(TODAY, -ANNOTATION_HOLD_DAYS)) continue;
    for (const s of a.pages || []) if (!excluded.has(s)) excluded.set(s, `${a.date} に改修済み(21日以内)`);
  }
} catch {}
const examFiles = (await readdir(path.join(ROOT, "data", "exams"))).filter((f) => f.endsWith(".json"));
const exams = {};
for (const f of examFiles) {
  const e = JSON.parse(await readFile(path.join(ROOT, "data", "exams", f), "utf8"));
  exams[e.slug] = e;
  const guardEnd = addDays(TODAY, DEADLINE_GUARD_DAYS);
  for (const s of e.sessions || [])
    for (const ap of s.applications || [])
      if (ap.end && ap.end >= TODAY && ap.end <= guardEnd && !excluded.has(e.slug))
        excluded.set(e.slug, `申込締切 ${ap.end} が${DEADLINE_GUARD_DAYS}日以内`);
}

// 「別手へ」判定のページで、既に試した手法(次は別の手法を使う)
const triedMethods = (slug) => [...new Set(state.actions.filter((a) => a.slug === slug).map((a) => a.method))];

// ── 優先順位どおりに候補を積む ──
const f = scan.findings || {};
const raw = [];
const push = (rank, slug, reason, evidence) => slug && exams[slug] && raw.push({ rank, slug, reason, evidence });
for (const r of f.regressions || []) push(1, r.slug, `回帰アラート(${r.before}→${r.after}位)`, r);
for (const r of f.titleLint || []) push(2, r.slug, `titleLint: ${r.detail}`, r);
for (const r of f.ctrOpportunities || []) push(3, r.slug, `CTR機会(${r.position.toFixed(1)}位・表示${r.impressions}・逃し${r.lostClicksPer90d}click/90d)`, r);
for (const p of snap?.current?.byPage || []) {
  const slug = (p.page.match(/\/exams\/([^/]+)\//) || [])[1];
  if (p.position > MID_RANK.min && p.position <= MID_RANK.max && p.impressions >= MID_RANK.minImpr)
    push(4, slug, `11〜20位で表示多(${p.position.toFixed(1)}位・表示${p.impressions})`, p);
}
for (const r of f.contentGaps || []) push(5, r.matchedExam, `コンテンツギャップ「${r.query}」(${r.position.toFixed(1)}位・表示${r.impressions})`, r);
for (const a of state.actions) if (["other", "mixed", "undetermined"].includes(a.status)) push(6, a.slug, `前回「別手へ」(${a.id} ${a.method})`, { id: a.id });

const seen = new Set();
const candidates = [];
const skipped = [];
for (const c of raw.sort((a, b) => a.rank - b.rank)) {
  if (seen.has(c.slug)) continue;
  seen.add(c.slug);
  if (excluded.has(c.slug)) {
    skipped.push({ ...c, excludedBecause: excluded.get(c.slug) });
    continue;
  }
  candidates.push({ ...c, triedMethods: triedMethods(c.slug) });
}

state.queue = candidates.map(({ rank, slug, reason }) => ({ rank, slug, reason }));
await saveState(state);
execFileSync(process.execPath, [path.join(ROOT, "loop", "scripts", "measure.mjs"), "render"], { stdio: "ignore" });

console.log(JSON.stringify({ today: TODAY, scan: scanName, snapshot: snapName, candidates, skipped }, null, 2));
