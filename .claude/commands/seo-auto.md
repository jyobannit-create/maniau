---
description: SEO改善サイクルの半自動実行 — GSC取得→スキャン→改修→独立検証→PR作成(mainには触れない)
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Task
---

`.claude/skills/seo-review/SKILL.md` の **「半自動モード: `/seo-review --auto`」** の手順を実行する。

要点(詳細はSKILL.mdが一次情報):

1. `node scripts/gsc-fetch.mjs`(失敗しても最新スナップショットで続行)→ `node scripts/check.mjs && node scripts/build.mjs && node scripts/seo-scan.mjs`
2. `reports/seo-scan-YYYY-MM-DD.json` の `actionable` が 0 なら `reports/YYYY-MM-DD-seo.md` に1行記録して終了(PRなし)
3. 着手すべき指摘があれば `git switch -c seo/auto-YYYY-MM-DD`
4. 実装(dev-frontend)→ 独立新規エージェントで検証 → 指摘が残る限り差し戻し
   - 自動で実装してよいのは titleLint / 原因が明らかな CTR機会 / 構造化データの不備のみ
   - contentGaps・regressions原因調査・ハブ新設・noindex・301・レイアウト変更は「要人間判断」として列挙するだけ
5. `reports/seo-annotations.ndjson` と `reports/YYYY-MM-DD-seo.md` に記録 → ブランチにcommit
6. `git push -u origin seo/auto-YYYY-MM-DD` → `gh pr create`(要約・diff要点・検証結果・目視確認チェックリスト・要人間判断リストを本文に)

## 無人実行の前提

このコマンドは launchd から `claude -p` で無人実行される。`seo/auto-*` ブランチへの commit / push / `gh pr create` は
人間に可否を質問せずそのまま実行すること(質問で止まると月次レビューが機能しない)。main には触れないので影響は限定的。

## 絶対にやらないこと

- main への commit / push / マージ
- `gh pr merge`
- 検証ステップの省略
- 構造的変更(ハブ新設・noindex・301・レイアウト・queue.md追加)の自動実装
- サービスアカウント鍵のリポジトリ内配置
