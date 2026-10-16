// seo-loop の公開前検証(DESIGN.md §7 の V1〜V4・V6)と公開後の本番確認。V5(意味的整合)は独立エージェントが行う。
//
// 使い方:
//   node loop/scripts/verify.mjs snapshot          … 施策前にビルドし site/ を loop/.work/site-before に退避
//   node loop/scripts/verify.mjs check --slug S    … 施策後の機械検証。1つでも不合格なら exit 1
//   node loop/scripts/verify.mjs live --slug S     … 本番URLに新しい title が出るまで最長10分待つ
//
// check は git HEAD の data/exams/S.json と比べて「変わったフィールド」だけを事実照合する。

import { cp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { ROOT, pageUrl } from "./lib.mjs";
import { MANUAL_ALIASES, norm, canon, isGenericAlias, coreTerms } from "../../scripts/lib/seo-terms.mjs";

const SITE = path.join(ROOT, "site");
const BEFORE = path.join(ROOT, "loop", ".work", "site-before");
const SEO_TITLE_MAX_WIDTH = 36; // 既存 seoTitle の最大幅(35.5)に合わせた上限
const SEO_TITLE_WARN_WIDTH = 32; // build.mjs の TITLE_WIDTH_BUDGET。超えたら警告のみ
const LINT_MIN_IMPR = 40; // seo-scan の lintMinImpr と同じ
const ALLOWED_EXTRA_CHANGES = new Set(["sitemap.xml"]);
const CHECKED_FIELDS = ["seoTitle", "seoDescription", "description", "faq", "relatedSlugs"];

const { positionals, values: args } = parseArgs({ allowPositionals: true, options: { slug: { type: "string" } } });
const cmd = positionals[0];
const node = (...a) => execFileSync(process.execPath, a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const width = (s) => [...s].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? 0.5 : 1), 0);

async function walk(dir, base = dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p));
  }
  return out;
}

async function snapshot() {
  node("scripts/build.mjs");
  await rm(BEFORE, { recursive: true, force: true });
  await mkdir(path.dirname(BEFORE), { recursive: true });
  await cp(SITE, BEFORE, { recursive: true });
  console.log(`✅ site/ を ${path.relative(ROOT, BEFORE)} に退避`);
}

// ── V3: 事実整合 ──
function sessionFacts(exam) {
  const dates = new Set();
  const years = new Set();
  for (const s of exam.sessions || []) {
    for (const d of [s.examDate, s.resultDate, ...(s.applications || []).flatMap((a) => [a.start, a.end])]) {
      if (!d) continue;
      dates.add(d);
      years.add(d.slice(0, 4));
    }
    for (const m of (s.label || "").matchAll(/(\d{4})年/g)) years.add(m[1]);
  }
  const fees = new Set([...(exam.fee || "").matchAll(/([\d,]+)円/g)].map((m) => m[1].replace(/,/g, "")));
  return { dates, years, fees };
}
const md = (d) => d.slice(5); // MM-DD
function factIssues(field, text, exam) {
  const issues = [];
  const { dates, years, fees } = sessionFacts(exam);
  const mmdd = new Set([...dates].map(md));
  const pad = (n) => String(n).padStart(2, "0");
  const isSeoMeta = field === "seoTitle" || field === "seoDescription";
  const found = [];
  for (const m of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) found.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of text.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)) found.push(m[1] ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : `--${pad(m[2])}-${pad(m[3])}`);
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) found.push(`--${pad(m[1])}-${pad(m[2])}`);
  for (const d of found) {
    if (isSeoMeta) issues.push(`${field} に具体的な日付「${d.replace(/^--/, "")}」がある(seoTitle/seoDescription は日付を書かない規約)`);
    else if (d.startsWith("--") ? !mmdd.has(d.slice(2)) : !dates.has(d)) issues.push(`${field} の日付「${d.replace(/^--/, "")}」が sessions に存在しない(推測日付の疑い)`);
  }
  for (const m of text.matchAll(/(\d{4})年度/g)) if (!years.has(m[1])) issues.push(`${field} の「${m[0]}」が sessions の年に存在しない`);
  for (const m of text.matchAll(/([\d,]+)円/g)) if (!fees.has(m[1].replace(/,/g, ""))) issues.push(`${field} の金額「${m[0]}」が fee(${exam.fee ?? "null"})と一致しない`);
  for (const m of text.matchAll(/\d+(?:\.\d+)?\s*[%％]/g)) issues.push(`${field} に割合「${m[0]}」がある(合格率等の数値は禁止)`);
  return issues;
}

const flatten = (v) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.map(flatten).join("\n") : Object.values(v).map(flatten).join("\n"));

async function check() {
  const slug = args.slug;
  if (!slug) throw new Error("--slug が必要");
  const results = [];
  const add = (id, ok, detail) => results.push({ id, ok, detail });

  // V1: データ検証 + ビルド
  try {
    node("scripts/check.mjs");
    node("scripts/build.mjs");
    add("V1", true, "check.mjs / build.mjs 成功");
  } catch (e) {
    add("V1", false, (e.stdout || "") + (e.stderr || e.message));
  }

  // V2: 変更範囲(対象ページ + sitemap.xml 以外のHTML等が変わっていない)
  const target = path.join("exams", slug, "index.html");
  const files = new Set([...(await walk(SITE)), ...(await walk(BEFORE).catch(() => []))]);
  const changed = [];
  for (const f of files) {
    const a = await readFile(path.join(BEFORE, f)).catch(() => null);
    const b = await readFile(path.join(SITE, f)).catch(() => null);
    if (!a || !b || !a.equals(b)) changed.push(f);
  }
  const outside = changed.filter((f) => f !== target && !ALLOWED_EXTRA_CHANGES.has(f));
  if (!changed.includes(target)) add("V2", false, `対象ページ ${target} の出力が変わっていない`);
  else add("V2", outside.length === 0, outside.length ? `対象外の出力が変化: ${outside.join(", ")}` : `変化は ${changed.join(", ")} のみ`);

  // V3: 変わったフィールドの事実整合
  const file = path.join("data", "exams", `${slug}.json`);
  const now = JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
  let head = {};
  try {
    head = JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { cwd: ROOT, encoding: "utf8" }));
  } catch {}
  const changedFields = CHECKED_FIELDS.filter((k) => JSON.stringify(now[k]) !== JSON.stringify(head[k]));
  const forbidden = Object.keys({ ...now, ...head }).filter((k) => !CHECKED_FIELDS.includes(k) && JSON.stringify(now[k]) !== JSON.stringify(head[k]));
  const v3 = changedFields.flatMap((k) => factIssues(k, flatten(now[k]), now));
  if (forbidden.length) v3.push(`ループが触ってはいけないフィールドが変更されている: ${forbidden.join(", ")}`);
  for (const r of now.relatedSlugs || []) {
    const ok = await readFile(path.join(ROOT, "data", "exams", `${r}.json`)).then(() => true, () => false);
    if (!ok) v3.push(`relatedSlugs の「${r}」に対応する資格データが無い`);
  }
  add("V3", v3.length === 0, v3.length ? v3 : `変更フィールド: ${changedFields.join(", ") || "(なし)"}`);

  // V4: 実測クエリの核語が title/description にあるか(seo-scan の titleLint と同じ基準)
  const html = await readFile(path.join(SITE, target), "utf8");
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ""])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [, ""])[1];
  const snapName = (await readdir(path.join(ROOT, "reports", "gsc"))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
  const snap = JSON.parse(await readFile(path.join(ROOT, "reports", "gsc", snapName), "utf8"));
  const rows = (snap.current?.byPageQuery || []).filter((r) => r.page === pageUrl(slug) && r.position <= 20);
  const aliases = [now.name, now.shortName, ...(now.name || "").split(/[()（）・\/、,]/), ...(MANUAL_ALIASES[slug] || [])]
    .map(norm).filter((a) => a && a.length >= 2 && !isGenericAlias(a));
  const nT = canon(title), nD = canon(desc);
  const v4 = [];
  if (!aliases.some((a) => nT.includes(a))) v4.push(`title に資格名(別名含む)が無い: "${title}"`);
  const formal = norm((now.name || "").replace(/[(（][^)）]*[)）]/g, "")); // 「基本情報技術者試験(FE)」→ 括弧部分は任意
  if (!nT.includes(formal) && !nD.includes(formal)) v4.push(`正式名称「${now.name}」が title にも description にも無い(R001)`);
  const intent = {};
  for (const r of rows) for (const t of coreTerms(r.query)) intent[t] = (intent[t] || 0) + r.impressions;
  for (const [t, impr] of Object.entries(intent)) {
    if (impr < LINT_MIN_IMPR) continue;
    const n = canon(t);
    // 「試験日」は「試験日程」で、「いつ」は日付系の語でカバーとみなす(seo-scan と同じく緩めに判定)
    const covers = (x) => x.includes(n) || (n === "試験日" && x.includes("試験日程")) || (n === "いつ" && /試験日|日程|スケジュール|締切/.test(x));
    if (![nT, nD].some(covers)) v4.push(`「${t}」系クエリ(計${impr}表示)の語が title/description に無い`);
  }
  add("V4", v4.length === 0, v4.length ? v4 : `title="${title}"`);

  // V6: 表示幅
  if (now.seoTitle) {
    const w = width(now.seoTitle);
    add("V6", w <= SEO_TITLE_MAX_WIDTH, `seoTitle 幅 ${w}(上限 ${SEO_TITLE_MAX_WIDTH}${w > SEO_TITLE_WARN_WIDTH ? `・${SEO_TITLE_WARN_WIDTH}超はスマホで省略されやすい` : ""})`);
  } else add("V6", true, "seoTitle なし(自動生成title)");

  const ok = results.every((r) => r.ok);
  console.log(JSON.stringify({ slug, ok, title, description: desc, results }, null, 2));
  if (!ok) process.exit(1);
}

async function live() {
  const slug = args.slug;
  const html = await readFile(path.join(SITE, "exams", slug, "index.html"), "utf8");
  const expected = (html.match(/<title>([^<]*)<\/title>/) || [, ""])[1];
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${pageUrl(slug)}?v=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
      const got = ((await res.text()).match(/<title>([^<]*)<\/title>/) || [, ""])[1];
      if (res.ok && got === expected) {
        console.log(`✅ 本番反映を確認: ${pageUrl(slug)}`);
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 30000));
  }
  console.error(`❌ 10分以内に本番反映を確認できず: ${pageUrl(slug)}(期待title: ${expected})`);
  process.exit(1);
}

const handlers = { snapshot, check, live };
if (!handlers[cmd]) {
  console.error("使い方: node loop/scripts/verify.mjs <snapshot|check|live> [--slug S]");
  process.exit(1);
}
try {
  await handlers[cmd]();
} catch (e) {
  console.error(`❌ verify ${cmd} 失敗: ${e.message}`);
  process.exit(1);
}
