// 無人ジョブの実行結果を macOS の通知センターと(設定時は)Gmail に知らせる。
// 使い方: node scripts/notify.mjs <ジョブ名> [終了コード] [ログファイル]
//   例: node scripts/notify.mjs update-exams "$rc" reports/cron.log
//
// 依存ゼロ(Node標準 + macOS標準の osascript / curl)。
//
// macOS通知が出ない場合は「システム設定 > 通知 > スクリプトエディタ」を許可する。
// メール通知(任意): ~/.config/maniau/gmail-notify に2行
//     1行目: 通知を受け取る Gmail アドレス
//     2行目: 16桁のアプリパスワード(スペースは無視される)
//   を書くと、通知に加えて自分宛にメールを送る(Gmailの2段階認証+アプリパスワードが必要)。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
let ok = true;
if (exitCode !== "" && exitCode !== "0" && exitCode !== "2") {
  headline = `❌ 失敗 (code ${exitCode})`;
  sound = "Basso";
  ok = false;
} else if (exitCode === "2") {
  headline = "⚠️ 重大な順位下落を検出";
  sound = "Basso";
  ok = false;
} else if (ahead > 0) {
  headline = `⚠️ 未pushのコミット ${ahead}件`;
  sound = "Basso";
  ok = false;
} else if (dirty && branch === "main") {
  headline = "⚠️ 未コミットの変更あり";
  sound = "Basso";
  ok = false;
} else {
  headline = "✅ 完了";
}

const body = [headline, `${branch}: ${lastCommit}`, tail && `— ${tail}`].filter(Boolean).join("\n");

// ── macOS 通知 ──
const script = `display notification ${JSON.stringify(body.slice(0, 240))} with title ${JSON.stringify(`マニアウ ${job}`)}${sound ? ` sound name ${JSON.stringify(sound)}` : ""}`;
try {
  execFileSync("osascript", ["-e", script]);
} catch (e) {
  console.error(`[notify] osascript 失敗: ${e.message}`);
}

// ── メール通知(任意) ──
try {
  const conf = readFileSync(path.join(homedir(), ".config", "maniau", "gmail-notify"), "utf8");
  const lines = conf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const addr = (lines[0] || "").match(/[^\s@]+@[^\s@]+/)?.[0] || "";
  const appPw = lines.slice(1).join("").replace(/\s+/g, "");
  if (addr && appPw) {
    const mail =
      [
        `From: マニアウ自動運用 <${addr}>`,
        `To: ${addr}`,
        `Subject: [マニアウ ${job}] ${ok ? "OK" : "要確認"} — ${headline}`,
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
        "",
        body,
        "",
        `(このメールは launchd ジョブ com.maniau.${job} が自動送信しています)`,
      ].join("\r\n") + "\r\n";
    execFileSync(
      "curl",
      [
        "--silent", "--show-error", "--ssl-reqd",
        "--url", "smtps://smtp.gmail.com:465",
        "--user", `${addr}:${appPw}`,
        "--mail-from", addr,
        "--mail-rcpt", addr,
        "--upload-file", "-",
      ],
      { input: mail }
    );
    console.log(`[notify] メール送信: ${addr}`);
  }
} catch (e) {
  if (e.code !== "ENOENT") console.error(`[notify] メール送信失敗: ${e.message}`);
}

console.log(`[notify] ${job}: ${headline} | ${branch}: ${lastCommit}`);
