// seo-loop の共通処理: 状態ファイル(loop/state.json)の読み書き、日付計算、GSCの期間集計。
// 決定的な処理だけをここに置く(LLMの判断は ROUTINE.md 側)。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAccessToken } from "../../scripts/lib/google-auth.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LOOP_DIR = path.join(ROOT, "loop");
export const STATE_FILE = path.join(LOOP_DIR, "state.json");
export const BASE_URL = "https://maniau-shikaku.com";
const PROPERTY = process.env.MANIAU_GSC_PROPERTY || `${BASE_URL}/`;

// ── 判定パラメータ(DESIGN.md §5。変えるときは DESIGN.md も更新する) ──
export const OBSERVE_DAYS = 21; // 実施日 → 判定日
export const EXTEND_DAYS = 14; // データ不足時の延長(1回まで)
export const SKIP_AFTER_DAYS = 7; // 実施後この日数は再クロール待ちとして集計しない
export const GSC_LAG_DAYS = 3; // GSCの確定データの遅れ
export const BEFORE_DAYS = 28; // 施策前の比較期間
export const MIN_AFTER_IMPRESSIONS = 50; // 後期間の表示がこれ未満なら判定保留
export const TOP_QUERIES = 10; // 施策時に記録する対象クエリ数

export const TODAY = process.env.LOOP_TODAY || new Date().toISOString().slice(0, 10);
export const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1; // 両端含む
export const pageUrl = (slug) => `${BASE_URL}/exams/${slug}/`;
export const round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;

export async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { kpi: [], actions: [] };
  }
}
export async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// ── GSC ──────────────────────────────────────────────
let tokenCache = null;
async function token() {
  if (!tokenCache) tokenCache = (await getAccessToken()).accessToken;
  return tokenCache;
}

export async function gscQuery(body) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "web", dataState: "final", ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GSC query 失敗 (HTTP ${res.status}): ${JSON.stringify(json)}`);
  return json.rows || [];
}

/** ページのクエリ別実績(期間内)。表示回数の降順 */
export async function pageQueries(slug, start, end, rowLimit = 1000) {
  const rows = await gscQuery({
    startDate: start,
    endDate: end,
    dimensions: ["query"],
    dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: pageUrl(slug) }] }],
    rowLimit,
  });
  return rows
    .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }))
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * ページの期間集計。判定に使う主指標はページ全体(匿名化クエリを含む)。
 * GSCはクエリの多くを匿名化するため、クエリ別の合計だけではサンプルが小さすぎる(実測で約1/10)。
 * 施策時に記録した対象クエリ群の集計は queriesSubset として参考に残す。1日あたりに正規化した値も返す。
 */
export async function measureWindow(slug, queries, start, end) {
  const filter = [{ filters: [{ dimension: "page", operator: "equals", expression: pageUrl(slug) }] }];
  const [t] = await gscQuery({ startDate: start, endDate: end, dimensions: ["page"], dimensionFilterGroups: filter, rowLimit: 1 });
  const days = daysBetween(start, end);
  const summarize = (clicks, impressions, position) => ({
    clicks,
    impressions,
    ctr: impressions ? round(clicks / impressions) : 0,
    position: impressions ? round(position, 2) : null,
    clicksPerDay: round(clicks / days),
    impressionsPerDay: round(impressions / days, 2),
  });
  let queriesSubset = null;
  if (queries?.length) {
    const set = new Set(queries);
    const hit = (await pageQueries(slug, start, end, 5000)).filter((r) => set.has(r.query));
    const imp = hit.reduce((n, r) => n + r.impressions, 0);
    queriesSubset = summarize(
      hit.reduce((n, r) => n + r.clicks, 0),
      imp,
      imp ? hit.reduce((n, r) => n + r.position * r.impressions, 0) / imp : 0
    );
  }
  return {
    range: { start, end, days },
    ...summarize(t?.clicks || 0, t?.impressions || 0, t?.position || 0),
    queriesSubset,
  };
}

/** サイト全体の期間合計(週次KPI用) */
export async function siteTotals(start, end) {
  const [t] = await gscQuery({ startDate: start, endDate: end, dimensions: [], rowLimit: 1 });
  const r = t || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return { clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr), position: round(r.position, 2) };
}

export const beforeWindow = (date) => ({
  start: addDays(date, -(GSC_LAG_DAYS + BEFORE_DAYS)),
  end: addDays(date, -(GSC_LAG_DAYS + 1)),
});
export const afterWindow = (date, judgeDate) => ({
  start: addDays(date, SKIP_AFTER_DAYS),
  end: addDays(judgeDate, -GSC_LAG_DAYS),
});
