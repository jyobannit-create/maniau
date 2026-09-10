// Google Search Console の検索パフォーマンスを API で取得し、reports/gsc/ に蓄積する。
// 使い方: node scripts/gsc-fetch.mjs
//
// GSC は約16か月しかデータを保持しないため、施策の前後比較ができるよう
// 取得のたびに reports/gsc/YYYY-MM-DD.json として履歴を残す。
// このスクリプトは読み取り専用(GSCへの書き込みは一切しない)。
//
// 必要な準備(1回だけ): docs/AUTOMATION.md の「SEO改善サイクル」節を参照。
//   - GCPでサービスアカウントを作成し Search Console API を有効化
//   - そのサービスアカウントのメールアドレスを GSC のプロパティに「ユーザー」として追加
//   - JSON鍵を ~/.config/maniau/gsc-sa.json に配置(または MANIAU_GSC_SA_KEY で指定)

import { writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAccessToken } from "./lib/google-auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "reports", "gsc");

// URLプレフィックス型プロパティ。ドメイン型なら sc-domain:maniau-shikaku.com を指定。
const PROPERTY = process.env.MANIAU_GSC_PROPERTY || "https://maniau-shikaku.com/";
const WINDOW_DAYS = 90;
const LAG_DAYS = 3; // GSCの反映ラグ。この日数だけ手前を終端にする

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

async function query(token, body) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`searchAnalytics.query 失敗 (HTTP ${res.status}): ${JSON.stringify(json)}`);
  return json.rows || [];
}

const round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
const mapRows = (rows, ...keyNames) =>
  rows.map((r) => {
    const o = { clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr), position: round(r.position, 2) };
    keyNames.forEach((k, i) => (o[k] = r.keys[i]));
    return o;
  });

async function fetchRange(token, startDate, endDate) {
  const base = { startDate, endDate, type: "web", dataState: "final" };
  const [byQuery, byPage, byPageQuery, byDate] = await Promise.all([
    query(token, { ...base, dimensions: ["query"], rowLimit: 1000 }),
    query(token, { ...base, dimensions: ["page"], rowLimit: 1000 }),
    query(token, { ...base, dimensions: ["page", "query"], rowLimit: 5000 }),
    query(token, { ...base, dimensions: ["date"], rowLimit: 1000 }),
  ]);
  const totalsRows = await query(token, { ...base, dimensions: [], rowLimit: 1 });
  const t = totalsRows[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    range: { start: startDate, end: endDate },
    totals: { clicks: t.clicks, impressions: t.impressions, ctr: round(t.ctr), position: round(t.position, 2) },
    byQuery: mapRows(byQuery, "query"),
    byPage: mapRows(byPage, "page"),
    byPageQuery: mapRows(byPageQuery, "page", "query"),
    byDate: mapRows(byDate, "date"),
  };
}

async function main() {
  const endDate = ymd(daysAgo(LAG_DAYS));
  const startDate = ymd(daysAgo(LAG_DAYS + WINDOW_DAYS));
  const prevEnd = ymd(daysAgo(LAG_DAYS + WINDOW_DAYS + 1));
  const prevStart = ymd(daysAgo(LAG_DAYS + WINDOW_DAYS * 2 + 1));

  const { accessToken, clientEmail } = await getAccessToken();
  console.log(`GSC取得: ${PROPERTY}  as ${clientEmail}`);
  console.log(`  今期: ${startDate} 〜 ${endDate} / 前期: ${prevStart} 〜 ${prevEnd}`);

  const current = await fetchRange(accessToken, startDate, endDate);
  const previous = await fetchRange(accessToken, prevStart, prevEnd);

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    property: PROPERTY,
    source: "search-console-api",
    windowDays: WINDOW_DAYS,
    current,
    previous: {
      range: previous.range,
      totals: previous.totals,
      byQuery: previous.byQuery,
      byPage: previous.byPage,
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${ymd(new Date())}.json`);
  await writeFile(outFile, JSON.stringify(snapshot, null, 2) + "\n");

  const existing = (await readdir(OUT_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length;
  console.log(
    `✅ ${path.relative(ROOT, outFile)} に保存` +
      ` (クエリ${current.byQuery.length} / ページ${current.byPage.length} / 合計クリック${current.totals.clicks}・表示${current.totals.impressions})`
  );
  console.log(`   履歴: ${existing}スナップショット`);
}

main().catch((e) => {
  console.error("❌ gsc-fetch 失敗:", e.message);
  process.exit(1);
});
