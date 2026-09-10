// 無人ジョブの実行結果を macOS の通知センターに表示する。
// 使い方: node scripts/notify.mjs <ジョブ名> [終了コード] [ログファイル]
//   例: node scripts/notify.mjs update-exams "$rc" reports/cron.log
//
// 依存ゼロ(Node標準の child_process のみ)。osascript は macOS 標準。
// 通知が出ない場合は「システム設定 > 通知 > スクリプトエディタ(osascript)」を許可する。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const job = process.argv[2] || "maniau";
const exitCode = process.argv[3] ?? "";
const logFile = process.argv[4];

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

git("fetch", "-q", "origin");
const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "?";
const ahead = Number(git("rev-list", "--count", "@{u}..HEAD") || 0);
const dirty = git("status", "--porcelain").length > 0;
const lastCommit = git("log", "-1", "--format=%s") || "(コミットなし)";

let tail = "";
if (logFile) {
  try {
    tail = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).at(-1) || "";
  } catch {}
}

let headline;
let sound = "";
if (exitCode !== "" && exitCode !== "0" && exitCode !== "2") {
  headline = `❌ 失敗 (code ${exitCode})`;
  sound = "Basso";
} else if (exitCode === "2") {
  headline = "⚠️ 重大な順位下落を検出";
  sound = "Basso";
} else if (ahead > 0) {
  headline = `⚠️ 未pushのコミット ${ahead}件`;
  sound = "Basso";
} else if (dirty && branch === "main") {
  headline = "⚠️ 未コミットの変更あり";
  sound = "Basso";
} else {
  headline = "✅ 完了";
}

const body = [headline, `${branch}: ${lastCommit}`, tail && `— ${tail}`].filter(Boolean).join("\n").slice(0, 240);
const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(`マニアウ ${job}`)}${sound ? ` sound name ${JSON.stringify(sound)}` : ""}`;

try {
  execFileSync("osascript", ["-e", script]);
} catch (e) {
  console.error(`[notify] osascript 失敗: ${e.message}`);
}
console.log(`[notify] ${job}: ${headline} | ${branch}: ${lastCommit}`);
