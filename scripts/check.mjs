// データ検証スクリプト — ビルド前に必ず実行する
// 使い方: node scripts/check.mjs
// エラーがあれば exit 1(自動更新パイプラインはここで止まる)

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "exams");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STALE_DAYS = 45; // 最終確認からこの日数を超えたら警告

const errors = [];
const warns = [];

const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(s));

const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
if (files.length === 0) errors.push("data/exams/ に資格データがありません");

const slugs = new Set();
for (const f of files) {
  let exam;
  try {
    exam = JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));
  } catch (e) {
    errors.push(`${f}: JSONが不正です (${e.message})`);
    continue;
  }
  const ctx = (msg) => `${f}: ${msg}`;

  for (const key of ["slug", "name", "category", "organizer", "officialUrl", "examType", "description"]) {
    if (!exam[key]) errors.push(ctx(`必須フィールド "${key}" がありません`));
  }
  if (exam.slug && f !== `${exam.slug}.json`) errors.push(ctx(`slug "${exam.slug}" とファイル名が一致しません`));
  if (exam.slug && slugs.has(exam.slug)) errors.push(ctx(`slug "${exam.slug}" が重複しています`));
  slugs.add(exam.slug);

  if (!["fixed", "cbt", "tbd", "varies"].includes(exam.examType)) {
    errors.push(ctx(`examType "${exam.examType}" は不正です`));
  }
  if (exam.examType === "fixed" && (!exam.sessions || exam.sessions.length === 0)) {
    errors.push(ctx("examType=fixed なのに sessions が空です"));
  }
  if (exam.examType === "cbt" && !exam.cbtNote) warns.push(ctx("cbtNote がありません"));
  if (exam.examType === "tbd" && !exam.tbdNote) warns.push(ctx("tbdNote がありません"));
  if (exam.examType === "varies" && !exam.variesNote) warns.push(ctx("variesNote がありません"));

  for (const s of exam.sessions || []) {
    if (!s.label) errors.push(ctx("session に label がありません"));
    if (s.examDate && !isDate(s.examDate)) errors.push(ctx(`examDate "${s.examDate}" が不正です`));
    if ((!s.applications || s.applications.length === 0) && !s.applicationNote && exam.examType === "fixed") {
      warns.push(ctx(`"${s.label}" に applications も applicationNote もありません`));
    }
    for (const a of s.applications || []) {
      if (!a.method) errors.push(ctx("application に method がありません"));
      if (!isDate(a.start)) errors.push(ctx(`application.start "${a.start}" が不正です`));
      if (!isDate(a.end)) errors.push(ctx(`application.end "${a.end}" が不正です`));
      if (isDate(a.start) && isDate(a.end) && Date.parse(a.start) > Date.parse(a.end)) {
        errors.push(ctx(`申込期間の開始が終了より後です (${a.start} > ${a.end})`));
      }
      if (isDate(a.end) && s.examDate && isDate(s.examDate) && Date.parse(a.end) > Date.parse(s.examDate)) {
        warns.push(ctx(`申込締切 ${a.end} が試験日 ${s.examDate} より後です — 確認してください`));
      }
    }
  }

  if (!exam.sources || exam.sources.length === 0) errors.push(ctx("sources がありません(一次情報のURL必須)"));
  if (!isDate(exam.lastVerified)) {
    errors.push(ctx("lastVerified がありません"));
  } else {
    const age = Math.floor((Date.now() - Date.parse(exam.lastVerified)) / 86400000);
    if (age > STALE_DAYS) warns.push(ctx(`最終確認から${age}日経過 — 再確認してください`));
  }
}

for (const w of warns) console.warn("⚠️ ", w);
for (const e of errors) console.error("❌ ", e);
console.log(`\n${files.length}ファイル検証: エラー${errors.length}件 / 警告${warns.length}件`);
process.exit(errors.length ? 1 : 0);
