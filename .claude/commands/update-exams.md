---
description: 週次の資格データ更新 — 公式サイト巡回→差分反映→検証→ビルド→デプロイ→レポート
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

マニアウの週次更新を実行する。CLAUDE.md の「データの鉄則」を厳守すること。

## 手順

### 1. 掲載中データの巡回確認
`data/exams/*.json` の各資格について:
- `sources` の先頭(公式サイト)を WebFetch し、掲載中の試験日・申込期間・受験料に変更や新情報がないか確認する
- 公式ページが取得できない場合は WebSearch で「(資格名) (年度) 申込期間」を検索し、公式ドメインの結果を優先して確認する
- 変更があれば JSON を修正し、`lastVerified` を今日の日付にする
- 変更がなくても、確認できた資格は `lastVerified` を今日の日付にする
- `examType: "tbd"` の資格(応用情報など)は最優先で確認。日程が発表されていたら sessions に反映し examType を fixed に変更する

### 2. 終了した回の整理
- `examDate` が過去になったセッションは sessions から削除する(全セッション終了で次回日程未発表の場合は examType を "tbd" にし、tbdNote に「次回日程は未発表」と書く)
- TOEIC のような多数回開催は、公式の年間日程から新しい回を追加する

### 3. 新規資格の追加(毎回1〜2件まで)
- `data/queue.md` の優先度: 高 から順に、公式サイトで日程を確認できたものを `data/exams/` に追加する
- 追加できたら queue.md のチェックを外して行を削除する。確認できなければ理由をqueue.mdに追記して次へ

### 4. 検証・ビルド・デプロイ
```bash
node scripts/check.mjs && node scripts/build.mjs
```
- check.mjs がエラーを出したら修正してから進む。警告(lastVerified の経過日数など)は対象を優先確認する
- 問題なければ git add → commit(変更内容を要約したメッセージ)→ push。GitHub Actions が自動でデプロイする

### 5. レポート
`reports/YYYY-MM-DD.md` に以下を記録する:
- 変更した資格と内容(変更なしなら「全件確認・変更なし」)
- 根拠にしたURL
- 追加した資格 / 追加できなかった理由
- 気づいたリスク(公式サイトの構造変更、リンク切れなど)

## 禁止事項
- 公式で確認できない日付の記入・推測での補完
- デザイン・レイアウトの変更(このコマンドの責務はデータ更新のみ)
- check.mjs のエラーを残したままの push
