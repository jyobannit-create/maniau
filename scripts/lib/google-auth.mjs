// サービスアカウント(JSON鍵)から Google API のアクセストークンを取得する。
// 依存パッケージゼロ — Node標準の crypto / fetch のみで JWT(RS256) を組み立てて署名する。
//
// 鍵ファイルはリポジトリに絶対に置かないこと。既定の探索場所:
//   1. 環境変数 MANIAU_GSC_SA_KEY が指すパス
//   2. ~/.config/maniau/gsc-sa.json
//
// サービスアカウントの作り方は docs/AUTOMATION.md の「SEO改善サイクル」節を参照。

import { readFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** サービスアカウント鍵ファイルのパスを解決する(存在確認まではしない) */
export function resolveKeyPath(explicit) {
  if (explicit) return explicit;
  if (process.env.MANIAU_GSC_SA_KEY) return process.env.MANIAU_GSC_SA_KEY;
  return path.join(homedir(), ".config", "maniau", "gsc-sa.json");
}

/**
 * サービスアカウント鍵からアクセストークンを取得する。
 * @param {object} opts
 * @param {string} [opts.keyPath] 鍵ファイルのパス(省略時は resolveKeyPath)
 * @param {string} [opts.scope]   OAuth スコープ
 * @returns {Promise<{accessToken:string, expiresAt:number, clientEmail:string}>}
 */
export async function getAccessToken({ keyPath, scope = "https://www.googleapis.com/auth/webmasters.readonly" } = {}) {
  const resolved = resolveKeyPath(keyPath);
  let key;
  try {
    key = JSON.parse(await readFile(resolved, "utf8"));
  } catch (e) {
    throw new Error(
      `サービスアカウント鍵を読めません: ${resolved}\n` +
        `  MANIAU_GSC_SA_KEY を設定するか ~/.config/maniau/gsc-sa.json に配置してください。\n` +
        `  (${e.message})`
    );
  }
  if (!key.client_email || !key.private_key) {
    throw new Error(`鍵ファイルに client_email / private_key がありません: ${resolved}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claim}`).sign(key.private_key);
  const jwt = `${header}.${claim}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`トークン取得に失敗 (HTTP ${res.status}): ${JSON.stringify(json)}`);
  }
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    clientEmail: key.client_email,
  };
}
