// seo-loop の計測・答え合わせ・施策記録。loop/state.json を正とし、loop/metrics.md を毎回再生成する。
//
// 使い方:
//   node loop/scripts/measure.mjs kpi                 … 直近7日(確定分)のサイト合計を週次KPIに追記
//   node loop/scripts/measure.mjs judge               … 判定日を迎えた施策を判定(結果JSONを標準出力)
//   node loop/scripts/measure.mjs record --slug S --method M1 --prev '{"seoTitle":"旧値"}' --note "..." [--commit abc123]
//                                                     … 公開した施策を観察中に登録し、seo-annotations にも追記
//   node loop/scripts/measure.mjs mark-reverted --id ID [--commit abc123]
//   node loop/scripts/measure.mjs render              … metrics.md の再生成のみ
//
// 計測できなかった値は推測で埋めない(失敗時は exit 1 で止まる)。

import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  ROOT, LOOP_DIR, TODAY, OBSERVE_DAYS, EXTEND_DAYS, MIN_AFTER_IMPRESSIONS, TOP_QUERIES, GSC_LAG_DAYS,
  addDays, round, loadState, saveState, pageQueries, measureWindow, siteTotals, beforeWindow, afterWindow,
} from "./lib.mjs";

const METHODS = {
  M1: "title改修",
  M2: "description改修",
  M3: "導入文の補強",
  M4: "FAQ節の追加",
  M5: "関連資格への内部リンク",
};
const STATUS_LABEL = {
  observing: "観察中",
  achieved: "達成",
  other: "別手へ",
  worse: "悪化(要revert)",
  reverted: "悪化→revert済",
  mixed: "混在(別手へ)",
  undetermined: "判定不能(別手へ)",
};

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    slug: { type: "string" },
    method: { type: "string" },
    prev: { type: "string" },
    note: { type: "string" },
    commit: { type: "string" },
    id: { type: "string" },
  },
});
const cmd = positionals[0];
const state = await loadState();

// ── 判定ロジック(DESIGN.md §5) ──────────────────────────
function verdict(before, after) {
  if (after.impressions < MIN_AFTER_IMPRESSIONS) return "continue";
  const posDelta = before.position != null && after.position != null ? before.position - after.position : 0; // +なら改善
  const good =
    (after.ctr >= before.ctr * 1.3 && after.clicksPerDay > before.clicksPerDay) || posDelta >= 2;
  const bad =
    (before.ctr > 0 && after.ctr <= before.ctr * 0.7 && after.clicksPerDay < before.clicksPerDay) || posDelta <= -3;
  if (good && bad) return "mixed";
  if (good) return "achieved";
  if (bad) return "worse";
  return "other";
}

async function judge() {
  const results = [];
  for (const a of state.actions) {
    if (a.status !== "observing" || a.judgeDate > TODAY) continue;
    const w = afterWindow(a.date, a.judgeDate);
    const after = await measureWindow(a.slug, a.queries, w.start, w.end);
    let v = verdict(a.before, after);
    if (v === "continue") {
      if (!a.extended) {
        a.extended = true;
        a.judgeDate = addDays(a.judgeDate, EXTEND_DAYS);
        results.push({ id: a.id, slug: a.slug, method: a.method, verdict: "continue", newJudgeDate: a.judgeDate, after });
        continue;
      }
      v = "undetermined";
    }
    a.status = v;
    a.after = after;
    a.judgedOn = TODAY;
    results.push({ id: a.id, slug: a.slug, method: a.method, verdict: v, before: a.before, after, prev: a.prev });
  }
  await saveState(state);
  await render();
  console.log(JSON.stringify({ today: TODAY, judged: results }, null, 2));
}

async function kpi() {
  const end = addDays(TODAY, -GSC_LAG_DAYS);
  const start = addDays(end, -6);
  if (state.kpi.some((k) => k.end === end)) {
    console.log(`KPI ${start}〜${end} は記録済み`);
    return;
  }
  const t = await siteTotals(start, end);
  state.kpi.push({ start, end, ...t });
  await saveState(state);
  await render();
  console.log(`✅ KPI ${start}〜${end}: クリック${t.clicks} / 表示${t.impressions} / CTR ${(t.ctr * 100).toFixed(2)}% / ${t.position}位`);
}

async function record() {
  const { slug, method, note } = args;
  if (!slug || !METHODS[method]) throw new Error("--slug と --method(M1〜M5)は必須");
  const prev = args.prev ? JSON.parse(args.prev) : {};
  const b = beforeWindow(TODAY);
  const queries = (await pageQueries(slug, b.start, b.end)).slice(0, TOP_QUERIES).map((r) => r.query);
  const before = await measureWindow(slug, queries, b.start, b.end);
  const id = `${TODAY}-${slug}`;
  state.actions.push({
    id, slug, method, note: note || "", date: TODAY, judgeDate: addDays(TODAY, OBSERVE_DAYS),
    extended: false, status: "observing", queries, before, prev, commit: args.commit || null,
  });
  await saveState(state);
  await appendFile(
    path.join(ROOT, "reports", "seo-annotations.ndjson"),
    JSON.stringify({ date: TODAY, commit: args.commit || "", pages: [slug], note: `seo-loop ${method}(${METHODS[method]}): ${note || ""}` }) + "\n"
  );
  await render();
  console.log(`✅ 観察登録 ${id}(判定日 ${addDays(TODAY, OBSERVE_DAYS)} / 対象クエリ${queries.length}件 / 施策前 表示${before.impressions}・クリック${before.clicks})`);
}

async function markReverted() {
  const a = state.actions.find((x) => x.id === args.id);
  if (!a) throw new Error(`施策 ${args.id} が見つかりません`);
  a.status = "reverted";
  a.revertCommit = args.commit || null;
  a.revertedOn = TODAY;
  await saveState(state);
  await appendFile(
    path.join(ROOT, "reports", "seo-annotations.ndjson"),
    JSON.stringify({ date: TODAY, commit: args.commit || "", pages: [a.slug], note: `seo-loop revert: ${a.id}(悪化判定)` }) + "\n"
  );
  await render();
  console.log(`✅ ${a.id} を revert済みに更新`);
}

// ── metrics.md 生成 ──────────────────────────────────
const pct = (n) => (n == null ? "-" : `${round(n * 100, 2)}%`);
const fmt = (m) => (m ? `表示${m.impressions} / クリック${m.clicks} / CTR ${pct(m.ctr)} / ${m.position ?? "-"}位` : "-");

async function render() {
  const md = [];
  md.push("# 計測表 — maniau seo-loop", "");
  md.push("> **自動生成**(`node loop/scripts/measure.mjs render`)。手で編集しない。正データは `loop/state.json`。");
  md.push("> 観察中の対象には判定日まで手を触れない(ロック)。", "");

  md.push("## 週次KPI(サイト全体・直近7日の確定値)", "");
  md.push("| 期間 | クリック | 表示 | CTR | 平均順位 |", "|---|---|---|---|---|");
  for (const k of state.kpi.slice(-12)) md.push(`| ${k.start}〜${k.end} | ${k.clicks} | ${k.impressions} | ${pct(k.ctr)} | ${k.position} |`);
  if (!state.kpi.length) md.push("| (未計測) | | | | |");

  md.push("", "## 観察中(ロック中)", "");
  md.push("| 施策ID | 対象 | 手法 | 実施日 | 判定日 | 施策前(ページ全体・28日) |", "|---|---|---|---|---|---|");
  const obs = state.actions.filter((a) => a.status === "observing");
  for (const a of obs) md.push(`| ${a.id} | ${a.slug} | ${a.method} ${METHODS[a.method]} | ${a.date} | ${a.judgeDate}${a.extended ? "(延長)" : ""} | ${fmt(a.before)} |`);
  if (!obs.length) md.push("| (なし) | | | | | |");

  md.push("", "## 判定済み", "");
  md.push("| 施策ID | 対象 | 手法 | 判定 | 施策前(28日) | 判定時(後期間) |", "|---|---|---|---|---|---|");
  const done = state.actions.filter((a) => a.status !== "observing");
  for (const a of done.slice(-30)) md.push(`| ${a.id} | ${a.slug} | ${a.method} | ${STATUS_LABEL[a.status] || a.status} | ${fmt(a.before)} | ${fmt(a.after)} |`);
  if (!done.length) md.push("| (なし) | | | | | |");

  md.push("", "## 手法別成績", "");
  md.push("| 手法 | 試行 | 達成 | 別手/混在/判定不能 | 悪化 | 観察中 |", "|---|---|---|---|---|---|");
  for (const [m, label] of Object.entries(METHODS)) {
    const xs = state.actions.filter((a) => a.method === m);
    const c = (f) => xs.filter(f).length;
    md.push(`| ${m} ${label} | ${xs.length} | ${c((a) => a.status === "achieved")} | ${c((a) => ["other", "mixed", "undetermined"].includes(a.status))} | ${c((a) => ["worse", "reverted"].includes(a.status))} | ${c((a) => a.status === "observing")} |`);
  }

  md.push("", "## 待ち行列(直近の select 結果・上位5件)", "");
  md.push("| 優先 | 対象 | 理由 |", "|---|---|---|");
  for (const q of (state.queue || []).slice(0, 5)) md.push(`| ${q.rank} | ${q.slug} | ${q.reason} |`);
  if (!state.queue?.length) md.push("| - | (未計算) | |");

  await writeFile(path.join(LOOP_DIR, "metrics.md"), md.join("\n") + "\n");
}

const handlers = { kpi, judge, record, "mark-reverted": markReverted, render };
if (!handlers[cmd]) {
  console.error("使い方: node loop/scripts/measure.mjs <kpi|judge|record|mark-reverted|render> [...]");
  process.exit(1);
}
try {
  await handlers[cmd]();
} catch (e) {
  console.error(`❌ measure ${cmd} 失敗: ${e.message}`);
  process.exit(1);
}
