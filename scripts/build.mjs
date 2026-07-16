// マニアウ — 静的サイトビルダー(依存パッケージゼロ)
// 使い方: node scripts/build.mjs
// 出力: site/ 配下に全ページを生成する

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data", "exams");
const OUT_DIR = path.join(ROOT, "site");

const SITE_NAME = "マニアウ";
const TAGLINE = "まだ間に合う資格が、見つかる。";
const BASE_URL = (process.env.BASE_URL || "https://jyobannit-create.github.io/maniau").replace(/\/$/, "");
const URGENT_DAYS = 14; // 締切間近と判定する残日数

// ---------- 日付ユーティリティ(すべてJST基準・日単位) ----------

const DAY = 86400000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function jstTodayUTC() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fmtDate(utc, { year = true } = {}) {
  const d = new Date(utc);
  const wd = WEEKDAYS[d.getUTCDay()];
  const body = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${wd})`;
  return year ? `${d.getUTCFullYear()}年${body}` : body;
}

function fmtIso(utc) {
  return new Date(utc).toISOString().slice(0, 10);
}

const TODAY = process.env.BUILD_DATE ? parseDate(process.env.BUILD_DATE) : jstTodayUTC();
const daysUntil = (utc) => Math.round((utc - TODAY) / DAY);

// ---------- HTMLユーティリティ ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- データ読み込みと状態判定 ----------

async function loadExams() {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
  const exams = [];
  for (const f of files) {
    exams.push(JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8")));
  }
  return exams;
}

// 各試験の「次に取るべきアクション」を判定する
// 戻り値 state: open(受付中) / upcoming(受付開始待ち) / note(受付情報は個別確認) /
//               closed(受付終了・試験待ち) / anytime(随時) / varies(地域による) / tbd(日程未定) / done(今年度終了)
function classify(exam) {
  if (exam.examType === "cbt") return { state: "anytime" };
  if (exam.examType === "varies") return { state: "varies" };
  if (exam.examType === "tbd") return { state: "tbd" };

  const future = (exam.sessions || []).filter((s) => !s.examDate || parseDate(s.examDate) >= TODAY);
  if (future.length === 0) return { state: "done" };

  let best = null;
  const consider = (cand) => {
    const rank = { open: 0, upcoming: 1, note: 2, closed: 3 };
    if (!best) { best = cand; return; }
    if (rank[cand.state] < rank[best.state]) { best = cand; return; }
    if (rank[cand.state] > rank[best.state]) return;
    if (cand.state === "open" && cand.deadline < best.deadline) best = cand;
    if (cand.state === "upcoming" && cand.opensOn < best.opensOn) best = cand;
  };

  for (const session of future) {
    const windows = (session.applications || []).map((a) => ({
      ...a, s: parseDate(a.start), e: parseDate(a.end),
    }));
    const open = windows.filter((w) => w.s <= TODAY && TODAY <= w.e);
    const upcoming = windows.filter((w) => w.s > TODAY);

    if (open.length) {
      const w = open.reduce((a, b) => (a.e <= b.e ? a : b));
      consider({ state: "open", session, window: w, deadline: w.e });
    } else if (upcoming.length) {
      const w = upcoming.reduce((a, b) => (a.s <= b.s ? a : b));
      consider({ state: "upcoming", session, window: w, opensOn: w.s });
    } else if (windows.length === 0 && session.applicationNote) {
      consider({ state: "note", session, note: session.applicationNote });
    } else if (windows.length) {
      consider({ state: "closed", session });
    }
  }
  return best || { state: "done" };
}

// ---------- 共通レイアウト ----------

const CSS = `
:root{
  --ink:#17233b; --ink-soft:#4a5568; --paper:#f7f5f0; --card:#ffffff;
  --line:#e4dfd4; --red:#d8442b; --red-bg:#fdf0ed; --green:#1e6e5c; --green-bg:#ecf5f0;
  --blue:#2c5aa0; --blue-bg:#eef2f9; --gray-bg:#f0ede6;
}
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","BIZ UDPGothic","Yu Gothic Medium","Yu Gothic",sans-serif;
  background:var(--paper); color:var(--ink); line-height:1.75;
  -webkit-font-smoothing:antialiased; font-feature-settings:"palt";
}
a{color:inherit}
.wrap{max-width:720px;margin:0 auto;padding:0 20px}
header.site{background:var(--ink);color:#fff;padding:14px 0}
header.site .wrap{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.logo{font-size:22px;font-weight:800;letter-spacing:.06em;text-decoration:none}
.logo .dot{color:var(--red)}
.tagline{font-size:12px;opacity:.75}
.hero{padding:40px 0 28px}
.hero h1{font-size:26px;font-weight:800;line-height:1.4;letter-spacing:.02em}
.hero p.lead{margin-top:10px;font-size:14px;color:var(--ink-soft)}
.hero .stats{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap}
.stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 14px;font-size:13px}
.stat b{font-size:18px;margin-right:2px;font-variant-numeric:tabular-nums}
.stat.hot b{color:var(--red)}
section.group{padding:8px 0 4px}
.group h2{font-size:18px;font-weight:800;margin:20px 0 4px;display:flex;align-items:center;gap:8px}
.group p.sub{font-size:13px;color:var(--ink-soft);margin-bottom:12px}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 10px;border-radius:3px;letter-spacing:.05em}
.badge.red{background:var(--red);color:#fff}
.badge.green{background:var(--green);color:#fff}
.badge.blue{background:var(--blue);color:#fff}
.badge.gray{background:var(--ink-soft);color:#fff}
.cards{display:grid;gap:12px;grid-template-columns:1fr;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;display:block;text-decoration:none;transition:border-color .15s}
.card:hover{border-color:var(--ink)}
.card .cat{font-size:11px;color:var(--ink-soft);letter-spacing:.08em}
.card h3{font-size:16px;font-weight:700;margin:2px 0 8px;line-height:1.45}
.card .deadline{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.card .count{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.card.urgent .count{color:var(--red)}
.card.open .count{color:var(--green)}
.card .when{font-size:12.5px;color:var(--ink-soft)}
.card .meta{margin-top:8px;font-size:12.5px;color:var(--ink-soft);border-top:1px dashed var(--line);padding-top:8px}
footer.site{margin-top:48px;background:var(--ink);color:#fff;padding:28px 0 36px;font-size:12.5px}
footer.site a{color:#cdd6e4}
footer.site .note{opacity:.8;margin-top:8px}
.crumb{font-size:12px;color:var(--ink-soft);padding-top:20px}
.crumb a{color:var(--ink-soft)}
article.exam{padding:8px 0 20px}
article.exam h1{font-size:24px;font-weight:800;line-height:1.4;margin:6px 0 14px}
.status-banner{border-radius:8px;padding:14px 16px;margin-bottom:20px;font-size:14px;font-weight:700}
.status-banner .big{font-size:20px;font-variant-numeric:tabular-nums}
.status-banner.red{background:var(--red-bg);color:var(--red);border:1px solid var(--red)}
.status-banner.green{background:var(--green-bg);color:var(--green);border:1px solid var(--green)}
.status-banner.blue{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue)}
.status-banner.gray{background:var(--gray-bg);color:var(--ink-soft);border:1px solid var(--line)}
article.exam h2{font-size:17px;font-weight:800;margin:28px 0 10px;padding-left:10px;border-left:4px solid var(--red)}
.tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:480px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--gray-bg);font-size:12.5px;white-space:nowrap}
tr:last-child td{border-bottom:none}
td .state{font-weight:700}
td .state.open{color:var(--green)}
td .state.closed{color:var(--ink-soft)}
td .state.upcoming{color:var(--blue)}
.desc{font-size:14.5px}
.info-table th{width:110px}
.cta{display:flex;justify-content:center;margin:32px 0 8px}
.cta a{display:flex;align-items:center;justify-content:center;min-height:52px;width:100%;max-width:420px;
  background:var(--red);color:#fff;font-weight:800;font-size:16px;text-decoration:none;border-radius:8px;
  padding:12px 24px;letter-spacing:.04em}
.cta a:hover{opacity:.9}
.cta-note{text-align:center;font-size:12px;color:var(--ink-soft);margin-bottom:8px}
.sources{font-size:12px;color:var(--ink-soft);margin-top:24px;border-top:1px solid var(--line);padding-top:12px}
.sources ul{list-style:none}
.sources li{margin:2px 0;overflow-wrap:anywhere}
.verified{font-size:12px;color:var(--ink-soft);margin-top:6px}
.disclaimer{background:var(--gray-bg);border-radius:6px;padding:10px 14px;font-size:12px;color:var(--ink-soft);margin-top:16px}
@media(min-width:768px){
  .hero h1{font-size:32px}
  .cards{grid-template-columns:1fr 1fr}
  .cards.single{grid-template-columns:1fr}
}
@media(min-width:1280px){
  .wrap{max-width:860px}
}
`;

// 残り日数をアクセス時点で再計算する(週次ビルドの間のズレを防ぐ)
const COUNTDOWN_JS = `
document.querySelectorAll("[data-count]").forEach(function(el){
  var p = el.getAttribute("data-count").split("-");
  var target = Date.UTC(+p[0], +p[1]-1, +p[2]);
  var jstNow = new Date(Date.now() + 9*3600000);
  var today = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
  var days = Math.round((target - today)/86400000);
  var mode = el.getAttribute("data-mode") || "end";
  if(mode === "end"){
    el.textContent = days > 0 ? "あと" + days + "日" : (days === 0 ? "本日締切" : "受付終了");
  } else {
    el.textContent = days > 0 ? "あと" + days + "日で開始" : "受付開始";
  }
});
`;

function page({ title, description, canonicalPath, body, jsonLd, depth = 0 }) {
  const rel = depth === 0 ? "." : Array(depth).fill("..").join("/");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${BASE_URL}${canonicalPath}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE_URL}${canonicalPath}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<link rel="stylesheet" href="${rel}/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
</head>
<body>
<header class="site"><div class="wrap">
  <a class="logo" href="${rel}/">マニアウ<span class="dot">.</span></a>
  <span class="tagline">${esc(TAGLINE)}</span>
</div></header>
${body}
<footer class="site"><div class="wrap">
  <div><a href="${rel}/">${esc(SITE_NAME)}</a> — 資格試験の申込締切トラッカー</div>
  <p class="note">掲載情報は各実施団体の公表内容をもとに自動巡回で更新していますが、申込前に必ず公式サイトで最新情報をご確認ください。</p>
  <p class="note">最終更新: ${fmtDate(TODAY)}</p>
</div></footer>
<script>${COUNTDOWN_JS}</script>
</body>
</html>`;
}

// ---------- トップページ ----------

function examCard(exam, cls, depth = 0) {
  const rel = depth === 0 ? "." : Array(depth).fill("..").join("/");
  const href = `${rel}/exams/${exam.slug}/`;
  const c = exam._c;
  let deadlineHtml = "";
  let metaHtml = "";

  if (c.state === "open") {
    const label = (exam.sessions || []).length > 1 ? `${c.session.label}` : "申込締切";
    const extra = (exam.sessions || []).filter((s) => s !== c.session && (!s.examDate || parseDate(s.examDate) >= TODAY)).length;
    deadlineHtml = `<div class="deadline">
      <span class="count" data-count="${fmtIso(c.deadline)}" data-mode="end">あと${daysUntil(c.deadline)}日</span>
      <span class="when">${fmtDate(c.deadline, { year: false })}締切 / ${esc(c.window.method)}</span>
    </div>`;
    metaHtml = `試験日: ${c.session.examDate ? fmtDate(parseDate(c.session.examDate)) : "—"}${extra ? ` ほか今後${extra}回の日程あり` : ""}`;
  } else if (c.state === "upcoming") {
    deadlineHtml = `<div class="deadline">
      <span class="count" data-count="${fmtIso(c.opensOn)}" data-mode="start">あと${daysUntil(c.opensOn)}日で開始</span>
      <span class="when">${fmtDate(c.opensOn, { year: false })}受付開始</span>
    </div>`;
    metaHtml = `試験日: ${c.session.examDate ? fmtDate(parseDate(c.session.examDate)) : "—"}`;
  } else if (c.state === "note") {
    deadlineHtml = `<div class="deadline"><span class="when">${esc(c.note)}</span></div>`;
    metaHtml = `試験日: ${c.session.examDate ? fmtDate(parseDate(c.session.examDate)) : "—"}`;
  } else if (c.state === "anytime") {
    deadlineHtml = `<div class="deadline"><span class="when">${esc(exam.cbtNote || "全国のテストセンターで随時受験可能")}</span></div>`;
  } else if (c.state === "varies") {
    deadlineHtml = `<div class="deadline"><span class="when">${esc(exam.variesNote || "日程は地域により異なります")}</span></div>`;
  } else if (c.state === "tbd") {
    deadlineHtml = `<div class="deadline"><span class="when">${esc(exam.tbdNote || "日程は未発表です")}</span></div>`;
  }

  return `<a class="card ${cls}" href="${href}">
    <div class="cat">${esc(exam.category)}</div>
    <h3>${esc(exam.name)}</h3>
    ${deadlineHtml}
    ${metaHtml ? `<div class="meta">${metaHtml}</div>` : ""}
  </a>`;
}

function renderIndex(exams) {
  const urgent = [], open = [], upcoming = [], anytime = [], tbd = [];
  for (const exam of exams) {
    const c = exam._c;
    if (c.state === "open") (daysUntil(c.deadline) <= URGENT_DAYS ? urgent : open).push(exam);
    else if (c.state === "upcoming" || c.state === "note") upcoming.push(exam);
    else if (c.state === "anytime" || c.state === "varies") anytime.push(exam);
    else if (c.state === "tbd") tbd.push(exam);
  }
  urgent.sort((a, b) => a._c.deadline - b._c.deadline);
  open.sort((a, b) => a._c.deadline - b._c.deadline);
  upcoming.sort((a, b) => (a._c.opensOn || Infinity) - (b._c.opensOn || Infinity));

  const section = (title, badge, badgeCls, sub, list, cardCls) =>
    list.length
      ? `<section class="group"><h2><span class="badge ${badgeCls}">${badge}</span>${esc(title)}</h2>
         <p class="sub">${esc(sub)}</p>
         <div class="cards">${list.map((e) => examCard(e, cardCls)).join("\n")}</div></section>`
      : "";

  const body = `
<div class="wrap">
  <div class="hero">
    <h1>資格の申込締切、<br>もう見逃さない。</h1>
    <p class="lead">主要資格の申込期間・試験日を毎週自動チェック。「受けようと思ったら締切が過ぎていた」をなくすための締切トラッカーです。</p>
    <div class="stats">
      <div class="stat hot"><b>${urgent.length}</b>件 締切間近</div>
      <div class="stat"><b>${urgent.length + open.length}</b>件 受付中</div>
      <div class="stat"><b>${exams.length}</b>資格 掲載中</div>
    </div>
  </div>
  ${section("締切間近 — 今すぐ申込を", "急いで", "red", `申込締切まで${URGENT_DAYS}日以内の試験です。`, urgent, "urgent")}
  ${section("申込受付中", "受付中", "green", "現在申込できる試験です。締切が近い順に表示しています。", open, "open")}
  ${section("まもなく受付開始", "予告", "blue", "受付開始日が近い順に表示しています。", upcoming, "soon")}
  ${section("いつでも受験できる(CBT・随時実施)", "随時", "gray", "通年またはお住まいの地域ごとに実施されている試験です。", anytime, "anytime")}
  ${section("日程未確定・続報待ち", "未定", "gray", "実施団体からの正式発表を毎週チェックしています。", tbd, "tbd")}
</div>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: BASE_URL + "/",
    description: "資格試験の申込締切・試験日トラッカー",
  };

  return page({
    title: `${SITE_NAME} | 資格試験の申込締切トラッカー — ${TAGLINE}`,
    description: `宅建・行政書士・簿記・TOEICなど主要資格の申込締切と試験日を毎週自動更新でチェック。締切間近の資格が一目でわかります。`,
    canonicalPath: "/",
    body,
    jsonLd,
    depth: 0,
  });
}

// ---------- 資格詳細ページ ----------

function windowState(w) {
  if (w.s <= TODAY && TODAY <= w.e) return `<span class="state open">受付中(あと${daysUntil(w.e)}日)</span>`;
  if (w.s > TODAY) return `<span class="state upcoming">${fmtDate(w.s, { year: false })}から</span>`;
  return `<span class="state closed">受付終了</span>`;
}

function renderExam(exam) {
  const c = exam._c;

  let banner = "";
  if (c.state === "open") {
    const d = daysUntil(c.deadline);
    banner = `<div class="status-banner ${d <= URGENT_DAYS ? "red" : "green"}">申込受付中 — ${esc(c.window.method)}の締切まで <span class="big" data-count="${fmtIso(c.deadline)}" data-mode="end">あと${d}日</span>(${fmtDate(c.deadline)}${c.window.endTime ? " " + c.window.endTime : ""}まで)</div>`;
  } else if (c.state === "upcoming") {
    banner = `<div class="status-banner blue">申込受付は ${fmtDate(c.opensOn)} 開始予定(<span data-count="${fmtIso(c.opensOn)}" data-mode="start">あと${daysUntil(c.opensOn)}日で開始</span>)</div>`;
  } else if (c.state === "note") {
    banner = `<div class="status-banner blue">${esc(c.note)}</div>`;
  } else if (c.state === "anytime") {
    banner = `<div class="status-banner green">${esc(exam.cbtNote || "全国のテストセンターで随時受験できます")}</div>`;
  } else if (c.state === "varies") {
    banner = `<div class="status-banner blue">${esc(exam.variesNote || "試験日程は地域により異なります")}</div>`;
  } else if (c.state === "tbd") {
    banner = `<div class="status-banner gray">${esc(exam.tbdNote || "日程は未発表です。発表され次第更新します。")}</div>`;
  } else {
    banner = `<div class="status-banner gray">今年度の申込受付は終了しています。次回日程が発表され次第更新します。</div>`;
  }

  const sessions = (exam.sessions || []).filter((s) => !s.examDate || parseDate(s.examDate) >= TODAY);
  let scheduleHtml = "";
  if (sessions.length) {
    const rows = sessions.map((s) => {
      const windows = (s.applications || []).map((a) => ({ ...a, s: parseDate(a.start), e: parseDate(a.end) }));
      const appHtml = windows.length
        ? windows.map((w) =>
            `${esc(w.method)}: ${fmtDate(w.s, { year: false })}〜${fmtDate(w.e, { year: false })}${w.endTime ? " " + w.endTime : ""}${w.note ? `(${esc(w.note)})` : ""} ${windowState(w)}`
          ).join("<br>")
        : esc(s.applicationNote || "公式サイトで確認");
      return `<tr>
        <td>${esc(s.label)}</td>
        <td>${s.examDate ? fmtDate(parseDate(s.examDate)) : "—"}${s.examNote ? `<br><small>${esc(s.examNote)}</small>` : ""}</td>
        <td>${appHtml}</td>
        ${s.resultDate ? `<td>${fmtDate(parseDate(s.resultDate))}</td>` : "<td>—</td>"}
      </tr>`;
    }).join("\n");
    scheduleHtml = `<h2>試験日程と申込期間</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>実施回</th><th>試験日</th><th>申込期間</th><th>合格発表</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  const cta = exam.affiliate?.url
    ? `<div class="cta"><a href="${esc(exam.affiliate.url)}" rel="sponsored nofollow">${esc(exam.affiliate.label || "対策講座を見る")}</a></div><p class="cta-note">※ 上記は提携先(広告)リンクです</p>`
    : `<div class="cta"><a href="${esc(exam.officialUrl)}" rel="noopener" target="_blank">公式サイトで申込方法を確認する</a></div>`;

  const jsonLd = sessions.filter((s) => s.examDate).map((s) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${exam.name} ${s.label}`,
    startDate: s.examDate,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: "全国の試験会場", address: { "@type": "PostalAddress", addressCountry: "JP" } },
    organizer: { "@type": "Organization", name: exam.organizer, url: exam.officialUrl },
  }));

  const body = `
<div class="wrap">
  <nav class="crumb"><a href="../../">${esc(SITE_NAME)}</a> › ${esc(exam.category)} › ${esc(exam.shortName)}</nav>
  <article class="exam">
    <div class="cat">${esc(exam.category)}</div>
    <h1>${esc(exam.name)}の申込締切・試験日</h1>
    ${banner}
    ${scheduleHtml}
    <h2>どんな資格?</h2>
    <p class="desc">${esc(exam.description)}</p>
    <h2>試験の基本情報</h2>
    <div class="tablewrap"><table class="info-table">
      <tr><th>実施団体</th><td>${esc(exam.organizer)}</td></tr>
      <tr><th>受験料</th><td>${exam.fee ? esc(exam.fee) : "公式サイトでご確認ください"}</td></tr>
      <tr><th>公式サイト</th><td><a href="${esc(exam.officialUrl)}" rel="noopener" target="_blank">${esc(exam.officialUrl)}</a></td></tr>
    </table></div>
    ${cta}
    <div class="disclaimer">日程・受験料等は変更される場合があります。申込の際は必ず実施団体の公式サイトで最新情報をご確認ください。</div>
    <div class="sources">情報源:
      <ul>${(exam.sources || []).map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.note || s.url)}</a></li>`).join("")}</ul>
      <p class="verified">最終確認日: ${fmtDate(parseDate(exam.lastVerified))}</p>
    </div>
  </article>
</div>`;

  return page({
    title: `${exam.name}の申込締切・試験日【2026年度】| ${SITE_NAME}`,
    description: `${exam.name}の2026年度の申込期間・締切日・試験日を掲載。${exam.description.slice(0, 60)}…`,
    canonicalPath: `/exams/${exam.slug}/`,
    body,
    jsonLd: jsonLd.length === 1 ? jsonLd[0] : jsonLd.length ? jsonLd : null,
    depth: 2,
  });
}

// ---------- サイトマップ等 ----------

function renderSitemap(exams) {
  const urls = ["/", ...exams.map((e) => `/exams/${e.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${BASE_URL}${u}</loc><lastmod>${fmtIso(TODAY)}</lastmod></url>`).join("\n")}
</urlset>`;
}

// ---------- メイン ----------

const exams = await loadExams();
for (const exam of exams) exam._c = classify(exam);

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

await writeFile(path.join(OUT_DIR, "style.css"), CSS);
await writeFile(path.join(OUT_DIR, "index.html"), renderIndex(exams));
for (const exam of exams) {
  const dir = path.join(OUT_DIR, "exams", exam.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), renderExam(exam));
}
await writeFile(path.join(OUT_DIR, "sitemap.xml"), renderSitemap(exams));
await writeFile(path.join(OUT_DIR, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`);
await writeFile(path.join(OUT_DIR, "404.html"), page({
  title: `ページが見つかりません | ${SITE_NAME}`,
  description: "お探しのページは見つかりませんでした。",
  canonicalPath: "/404.html",
  body: `<div class="wrap"><div class="hero"><h1>ページが見つかりません</h1><p class="lead"><a href="./">トップページへ戻る</a></p></div></div>`,
  depth: 0,
}));
await writeFile(path.join(OUT_DIR, ".nojekyll"), "");

const counts = exams.reduce((m, e) => ((m[e._c.state] = (m[e._c.state] || 0) + 1), m), {});
console.log(`✅ build complete: ${exams.length} exams → ${OUT_DIR}`);
console.log("   states:", JSON.stringify(counts));
