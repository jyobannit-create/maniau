// GSC履歴(reports/gsc/)と現在のビルド(site/)を突き合わせ、SEO改善の機会と回帰を
// 機械ルールで検出する。使い方: node scripts/seo-scan.mjs
//
// 前提: 先に node scripts/build.mjs を実行して site/ を最新にしておくこと。
//       GSCスナップショットが無い場合は「取得待ち」とだけ表示して正常終了する。
//
// 出力:
//   reports/seo-scan-YYYY-MM-DD.md   … 人間が読む優先度順レポート
//   reports/seo-scan-YYYY-MM-DD.json … /seo-review --auto が読む機械可読サマリー
//
// 終了コード: 通常 0。重大な順位下落(R2 high)を検出したときのみ 2(cronのアラート用)。

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GSC_DIR = path.join(ROOT, "reports", "gsc");
const SITE_DIR = path.join(ROOT, "site");
const DATA_DIR = path.join(ROOT, "data", "exams");
const BASE_URL = "https://maniau-shikaku.com";
const TODAY = new Date().toISOString().slice(0, 10);

// ── しきい値(運用しながら調整する) ──────────────────────────────
const TH = {
  ctrMinImpr: 80, // R1: この表示回数以上のページだけCTR機会とみなす(90日)
  ctrMaxPos: 10.5, // R1: この掲載順位以内
  ctrRatio: 0.35, // R1: 期待CTRのこの割合を下回ったら機会あり
  regDeltaPos: 4, // R2: 順位がこの数以上悪化したら回帰
  regMinImpr: 30, // R2: この表示回数以上のみ
  gapMinImpr: 25, // R3: コンテンツギャップとみなす最小表示回数
  gapMaxPos: 25, // R3: これより下位 or 該当ページ無しならギャップ
  risingMinImpr: 30, // R5: 伸びているクエリの最小表示回数
  risingRatio: 2.5, // R5: 前期比でこの倍率以上
  lintMinImpr: 40, // R4: 意図語がタイトル/説明に無いと指摘する最小(合算)表示回数
};

const INTENT_TERMS = [
  "試験日程", "試験日", "日程", "申込", "締切",
  "受験料", "検定料", "合格発表", "願書", "受験票", "いつ", "期間", "スケジュール",
];

// 検索で使われる資格の呼び名。data/exams から自動生成したものに手動の別名を足す。
const MANUAL_ALIASES = {
  boki1: ["簿記1級", "簿記一級", "日商簿記1級", "boki1"],
  boki: ["簿記2級", "簿記3級", "日商簿記", "簿記"],
  "e-shiken": ["e資格", "e-shiken"],
  "g-kentei": ["g検定", "ジェネラリスト検定"],
  kikenbutsu: ["危険物乙4", "乙4", "危険物取扱者", "危険物", "乙種第4類"],
  kangyo: ["管理業務主任者", "管業"],
  mankan: ["マンション管理士", "マン管", "マンカン"],
  "oyo-joho": ["応用情報技術者試験", "応用情報", "応用情報技術者"],
  "kihon-joho": ["基本情報技術者試験", "基本情報", "基本情報技術者", "fe"],
  "it-passport": ["itパスポート", "iパス", "アイパス"],
  shikisai: ["色彩検定", "カラーコーディネート"],
  toeic: ["toeic", "トーイック"],
  fp1: ["fp1級", "fp1級実技", "1級fp"],
  fp: ["fp2級", "fp3級", "fp技能検定", "ファイナンシャルプランナー", "fp検定"],
  gyoseishoshi: ["行政書士"],
  hoikushi: ["保育士"],
  "eisei-kanri": ["衛生管理者", "第一種衛生管理者", "第二種衛生管理者", "衛生管理"],
  takken: ["宅建", "宅地建物取引士", "宅建士"],
  denko2: ["電気工事士2種", "第二種電気工事士", "電工二種", "電工2種", "2種電気工事士"],
  chintai: ["賃貸不動産経営管理士", "賃管"],
};

const norm = (s) => (s || "").toLowerCase().replace(/[\s　]+/g, "").replace(/[()（）]/g, "");
// 送り仮名ゆれを吸収してから語の包含を判定する(「申し込み」と「申込」を同一視)
const canon = (s) =>
  norm(s)
    .replace(/申(し)?込(み)?/g, "申込")
    .replace(/締(め)?切(り)?/g, "締切")
    .replace(/問(い)?合(わせ)?/g, "問合");
const RECENT_CHANGE_DAYS = 21; // 改修直後のページは効果測定待ちとして指摘を保留する
const round = (n, p = 1) => Math.round(n * 10 ** p) / 10 ** p;
const pct = (n) => `${round(n * 100, 2)}%`;
const slugFromUrl = (u) => (u.match(/\/exams\/([^/]+)\//) || [])[1] || null;

function expectedCtr(pos) {
  const t = [[1, 0.25], [2, 0.13], [3, 0.09], [4, 0.06], [5, 0.045], [6, 0.036], [7, 0.03], [8, 0.026], [9, 0.023], [10, 0.021], [15, 0.01], [20, 0.006]];
  if (pos <= 1) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (pos <= t[i][0]) {
      const [p0, c0] = t[i - 1];
      const [p1, c1] = t[i];
      return c0 + ((c1 - c0) * (pos - p0)) / (p1 - p0);
    }
  }
  return 0.004;
}

// 資格の区別に使えない汎用語。別名から除外しないと「色彩検定 3級」が簿記に化ける等の誤マッピングを起こす
const GENERIC_ALIAS = new Set(["試験", "検定", "公開テスト", "実技", "学科", "エンジニア資格", "fe", "級"]);
const isGenericAlias = (a) => GENERIC_ALIAS.has(a) || /^[0-9０-９一二三四五六]級$/.test(a) || a.length < 2;

async function loadExams() {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
  const exams = {};
  for (const f of files) {
    const e = JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));
    const auto = [e.name, e.shortName, ...(e.name || "").split(/[()（）・\/、,]/)]
      .map((s) => (s || "").trim())
      .filter((s) => s.length >= 2);
    const aliases = [...new Set([...auto, ...(MANUAL_ALIASES[e.slug] || [])].map(norm).filter(Boolean))].filter((a) => !isGenericAlias(a));
    exams[e.slug] = { ...e, aliases };
  }
  return exams;
}

async function loadMeta(slug) {
  const file = slug === "_home" ? path.join(SITE_DIR, "index.html") : path.join(SITE_DIR, "exams", slug, "index.html");
  let html;
  try {
    html = await readFile(file, "utf8");
  } catch {
    return null;
  }
  return {
    title: (html.match(/<title>([^<]*)<\/title>/) || [, ""])[1],
    description: (html.match(/<meta name="description" content="([^"]*)"/) || [, ""])[1],
  };
}

async function loadLatestSnapshots() {
  let files;
  try {
    files = (await readdir(GSC_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch {
    return { latest: null };
  }
  if (!files.length) return { latest: null };
  const latest = JSON.parse(await readFile(path.join(GSC_DIR, files.at(-1)), "utf8"));
  return { latest, latestName: files.at(-1), prevName: files.length >= 2 ? files.at(-2) : null };
}

// byPageQuery が無いスナップショット(初期シード等)では byQuery を別名でスラッグに割り当てて代用する
function derivePageQueries(snap, exams) {
  if (snap.current?.byPageQuery?.length) {
    return { rows: snap.current.byPageQuery, approx: false };
  }
  const rows = [];
  for (const q of snap.current?.byQuery || []) {
    const n = norm(q.query);
    let best = null;
    for (const [slug, e] of Object.entries(exams)) {
      if (e.aliases.some((a) => n.includes(a))) {
        best = slug;
        break;
      }
    }
    if (best) rows.push({ page: `${BASE_URL}/exams/${best}/`, query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position, approx: true });
  }
  return { rows, approx: true };
}

function coreTerms(query) {
  const n = canon(query);
  return INTENT_TERMS.filter((t) => n.includes(canon(t)));
}

// ── メイン ────────────────────────────────────────────────────
const { latest, latestName, prevName } = await loadLatestSnapshots();
const exams = await loadExams();

// 変更アノテーション: 改修直後のページを効果測定待ちとして扱うために先に読む
let annotations = [];
try {
  const raw = await readFile(path.join(ROOT, "reports", "seo-annotations.ndjson"), "utf8");
  annotations = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
} catch {}
const recentChange = new Map(); // slug -> 直近の変更日
for (const a of annotations) {
  const age = Math.floor((Date.parse(TODAY) - Date.parse(a.date)) / 86400000);
  if (age > RECENT_CHANGE_DAYS) continue;
  for (const slug of a.pages || []) if (!recentChange.has(slug) || a.date > recentChange.get(slug)) recentChange.set(slug, a.date);
}
const isRecent = (slug) => slug && recentChange.has(slug);

const findings = { regressions: [], ctrOpportunities: [], contentGaps: [], titleLint: [], risingQueries: [] };
let hadSnapshot = !!latest;

if (latest) {
  const cur = latest.current;
  const prevWithin = latest.previous;
  const prevPagePos = new Map((prevWithin?.byPage || []).map((r) => [r.page, r.position]));
  const prevQueryImpr = new Map((prevWithin?.byQuery || []).map((r) => [r.query, r.impressions]));

  // R1: 順位は良いのにCTRが低いページ(title/meta改修候補)
  for (const p of cur.byPage) {
    if (p.impressions < TH.ctrMinImpr || p.position > TH.ctrMaxPos) continue;
    const exp = expectedCtr(p.position);
    if (p.ctr >= exp * TH.ctrRatio) continue;
    const lost = Math.round((exp - p.ctr) * p.impressions);
    findings.ctrOpportunities.push({
      page: p.page, slug: slugFromUrl(p.page), impressions: p.impressions,
      position: p.position, ctr: p.ctr, expectedCtr: round(exp, 3), lostClicksPer90d: lost,
    });
  }
  findings.ctrOpportunities.sort((a, b) => b.lostClicksPer90d - a.lostClicksPer90d);

  // R2: 前期比で順位が大きく下落したページ(回帰アラート)
  for (const p of cur.byPage) {
    const before = prevPagePos.get(p.page);
    if (before == null || p.impressions < TH.regMinImpr) continue;
    const delta = p.position - before;
    if (delta < TH.regDeltaPos) continue;
    const severity = before <= 10 && p.position > 15 ? "high" : "medium";
    findings.regressions.push({ page: p.page, slug: slugFromUrl(p.page), before: round(before, 1), after: round(p.position, 1), delta: round(delta, 1), impressions: p.impressions, severity });
  }
  findings.regressions.sort((a, b) => (a.severity === b.severity ? b.delta - a.delta : a.severity === "high" ? -1 : 1));

  // R5: 前期比で表示回数が伸びているクエリ(今のうちに取りにいく)。前期データが無いスナップショットでは出さない
  const hasPrevQueries = (prevWithin?.byQuery?.length || 0) > 0;
  if (hasPrevQueries) {
    for (const q of cur.byQuery) {
      if (q.impressions < TH.risingMinImpr) continue;
      const before = prevQueryImpr.get(q.query) || 0;
      if (before > 0 && q.impressions < before * TH.risingRatio) continue;
      if (before === 0 && q.impressions < 50) continue;
      findings.risingQueries.push({ query: q.query, impressions: q.impressions, was: before, clicks: q.clicks, position: q.position });
    }
    findings.risingQueries.sort((a, b) => b.impressions - a.impressions);
  }

  // ページ×クエリ(無ければ推定)
  const { rows: pageQueries, approx } = derivePageQueries(latest, exams);
  const byPage = new Map();
  for (const r of pageQueries) {
    const slug = slugFromUrl(r.page);
    if (!slug) continue;
    if (!byPage.has(slug)) byPage.set(slug, []);
    byPage.get(slug).push(r);
  }

  // R4: そのページが実際に流入しているクエリの核語が、現行 title/description に入っているか
  for (const [slug, rows] of byPage) {
    const e = exams[slug];
    if (!e) continue;
    const meta = await loadMeta(slug);
    if (!meta) continue;
    const nTitle = canon(meta.title);
    const nDesc = canon(meta.description);
    const ranked = rows.filter((r) => r.position <= 20).sort((a, b) => b.impressions - a.impressions);
    if (!ranked.length) continue;

    // 4a: 資格名(の別名のいずれか)が title に入っているか — 略称置換バグの検出
    const identityInTitle = e.aliases.some((a) => nTitle.includes(a));
    if (!identityInTitle) {
      findings.titleLint.push({ slug, kind: "identity-missing", severity: "high", detail: `資格名がtitleに含まれていません(略称置換の疑い)。title="${meta.title}"`, topQuery: ranked[0].query, impressions: ranked[0].impressions, approx });
    }

    // 4b: 意図語(試験日/申込/締切…)の合算表示回数が大きいのに title にも description にも無い
    const intentImpr = {};
    for (const r of ranked) for (const term of coreTerms(r.query)) intentImpr[term] = (intentImpr[term] || 0) + r.impressions;
    for (const [term, impr] of Object.entries(intentImpr).sort((a, b) => b[1] - a[1])) {
      if (impr < TH.lintMinImpr) continue;
      const nTerm = canon(term);
      // 「試験日」は「試験日程」でも実質カバーとみなす等、緩めに判定
      const covered = [nTitle, nDesc].some((t) => t.includes(nTerm) || (nTerm === "試験日" && t.includes("試験日程")));
      if (!covered) {
        findings.titleLint.push({ slug, kind: "intent-missing", severity: "medium", detail: `「${term}」系クエリが計${impr}表示あるが title/description に無い`, topQuery: ranked.find((r) => coreTerms(r.query).includes(term))?.query, impressions: impr, approx });
        break; // 1ページにつき最も表示の多い1件だけ挙げる
      }
    }
  }
  findings.titleLint.sort((a, b) => (a.severity === b.severity ? b.impressions - a.impressions : a.severity === "high" ? -1 : 1));

  // R3: 検索需要はあるが受け皿ページが弱い/無いクエリ
  const pageForQuery = new Map();
  for (const r of pageQueries) {
    const curBest = pageForQuery.get(r.query);
    if (!curBest || r.position < curBest.position) pageForQuery.set(r.query, { page: r.page, position: r.position });
  }
  const seenStem = new Set();
  for (const q of cur.byQuery) {
    if (q.impressions < TH.gapMinImpr || q.clicks > 0) continue;
    if (q.position < 6 || q.position > TH.gapMaxPos + 15) continue;
    const owner = pageForQuery.get(q.query);
    const covered = owner && owner.position <= TH.gapMaxPos;
    if (covered) continue;
    const n = norm(q.query);
    let stem = null;
    for (const [slug, e] of Object.entries(exams)) if (e.aliases.some((a) => n.includes(a))) { stem = slug; break; }
    const dedupKey = stem || q.query.slice(0, 4);
    if (seenStem.has(dedupKey)) continue;
    seenStem.add(dedupKey);
    findings.contentGaps.push({ query: q.query, impressions: q.impressions, position: q.position, matchedExam: stem, note: stem ? "既存ページはあるが下位/未対応" : "対応する資格ページが無い(queue.md候補)" });
  }
  findings.contentGaps.sort((a, b) => b.impressions - a.impressions);
}

// ── 改修直後のページの指摘は「測定待ち」に格下げ ──────────────────
for (const key of ["ctrOpportunities", "titleLint"]) {
  for (const f of findings[key]) if (isRecent(f.slug)) { f.recentlyChanged = recentChange.get(f.slug); f.severity = "hold"; }
  findings[key].sort((a, b) => (a.recentlyChanged ? 1 : 0) - (b.recentlyChanged ? 1 : 0));
}

// ── レポート出力 ──────────────────────────────────────────────
const totalFindings = Object.values(findings).reduce((n, a) => n + a.length, 0);
// 「今すぐ着手すべき」= 測定待ちでない指摘。/seo-review --auto はこの数でPRを出すか判断する
const actionable =
  findings.regressions.length +
  findings.ctrOpportunities.filter((f) => !f.recentlyChanged).length +
  findings.contentGaps.length +
  findings.titleLint.filter((f) => !f.recentlyChanged).length;
const hasHighRegression = findings.regressions.some((r) => r.severity === "high");

const md = [];
md.push(`# SEOスキャン ${TODAY}`);
md.push("");
if (!hadSnapshot) {
  md.push("> GSCスナップショットがありません(`reports/gsc/`)。`node scripts/gsc-fetch.mjs` を実行するとスキャンが有効になります。");
} else {
  const t = latest.current.totals;
  md.push(`データ: \`reports/gsc/${latestName}\`（${latest.current.range.start} 〜 ${latest.current.range.end}）` + (prevName ? ` / 前回スキャン: \`${prevName}\`` : ""));
  md.push("");
  md.push(`- 合計: 表示 ${t.impressions} / クリック ${t.clicks} / CTR ${pct(t.ctr)} / 平均順位 ${t.position}`);
  md.push(`- 検出: 回帰 ${findings.regressions.length} / CTR機会 ${findings.ctrOpportunities.length} / コンテンツギャップ ${findings.contentGaps.length} / titleクエリlint ${findings.titleLint.length} / 伸長クエリ ${findings.risingQueries.length}`);
  md.push(`- **今すぐ着手すべき指摘: ${actionable}件**` + (recentChange.size ? `（改修直後で測定待ちのページ ${recentChange.size} を除く）` : ""));
  md.push("");

  const section = (title, rows, header, fmt) => {
    md.push(`## ${title}`);
    if (!rows.length) { md.push("", "該当なし", ""); return; }
    md.push("", `| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`);
    for (const r of rows) md.push(`| ${fmt(r).join(" | ")} |`);
    md.push("");
  };

  section("① 順位下落(回帰アラート)", findings.regressions, ["深刻度", "ページ", "前", "後", "悪化", "表示"], (r) => [r.severity === "high" ? "🔴 high" : "🟡 med", r.slug || r.page, r.before, r.after, `+${r.delta}`, r.impressions]);
  section("② CTR機会(title/meta改修候補)", findings.ctrOpportunities, ["ページ", "表示", "順位", "現CTR", "期待CTR", "逃しclick/90d"], (r) => [r.recentlyChanged ? `${r.slug} ⏸ ${r.recentlyChanged}改修・測定待ち` : r.slug || r.page, r.impressions, r.position, pct(r.ctr), pct(r.expectedCtr), r.lostClicksPer90d]);
  section("③ titleクエリlint(核語の欠落)", findings.titleLint, ["深刻度", "ページ", "指摘", "根拠クエリ"], (r) => [r.recentlyChanged ? "⏸ hold" : r.severity === "high" ? "🔴 high" : "🟡 med", r.slug, r.detail + (r.approx ? " ※推定マッピング" : ""), `${r.topQuery ?? "-"} (${r.impressions})`]);
  section("④ コンテンツギャップ(受け皿が弱い検索需要)", findings.contentGaps, ["クエリ", "表示", "順位", "メモ"], (r) => [r.query, r.impressions, r.position, r.note]);
  section("⑤ 伸びているクエリ", findings.risingQueries, ["クエリ", "今期表示", "前期", "順位", "clicks"], (r) => [r.query, r.impressions, r.was || "新規", r.position, r.clicks]);
}

md.push("## 効果測定(変更アノテーション)");
md.push("");
if (!annotations.length) {
  md.push("`reports/seo-annotations.ndjson` が空です。改修時に `{ \"date\": \"YYYY-MM-DD\", \"pages\": [\"slug\"], \"note\": \"...\" }` を1行追記すると、2週間後から前後比較を表示します。");
} else {
  for (const a of annotations) {
    const age = Math.floor((Date.parse(TODAY) - Date.parse(a.date)) / 86400000);
    md.push(`- **${a.date}** (${age}日前) ${a.note} — 対象: ${(a.pages || []).join(", ")}` + (age < 14 ? " → 測定はまだ早い(14日待ち)" : ""));
  }
}
md.push("");

const outMd = path.join(ROOT, "reports", `seo-scan-${TODAY}.md`);
const outJson = path.join(ROOT, "reports", `seo-scan-${TODAY}.json`);
await writeFile(outMd, md.join("\n"));
await writeFile(
  outJson,
  JSON.stringify({ date: TODAY, snapshot: latestName || null, partial: !!latest?.partial, totalFindings, actionable, hasHighRegression, recentlyChangedPages: [...recentChange.keys()], findings, annotations }, null, 2) + "\n"
);

console.log(`✅ ${path.relative(ROOT, outMd)}  (検出 ${totalFindings}件 / 今すぐ着手 ${actionable}件)`);
if (!hadSnapshot) console.log("   GSCスナップショット未取得のため検出はスキップ。");
else {
  console.log(`   回帰${findings.regressions.length} / CTR機会${findings.ctrOpportunities.length} / ギャップ${findings.contentGaps.length} / lint${findings.titleLint.length} / 伸長${findings.risingQueries.length}`);
}
if (hasHighRegression) {
  console.error("🔴 重大な順位下落を検出しました。レポートを確認してください。");
  process.exit(2);
}
