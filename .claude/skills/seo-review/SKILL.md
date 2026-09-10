---
name: seo-review
description: マニアウのSEO(検索パフォーマンス)を検証・改修する。「SEOを見直して」「Search Consoleを確認して」「検索パフォーマンスを改善して」「CTRを改善して」と言われたとき、または定期的なSEO点検を行うときに使用。分析→実装→検証→人間承認の4段階を必ず経る。/seo-review --auto で半自動モード(PR作成まで無人・マージは人間)。
---
# マニアウ SEOレビュー・改修フロー

Search Consoleの実測データに基づいてtitle/description・内部構造等を改修する際の標準手順。
**分析 → 実装 → 検証 → 人間承認** の4段階を必ず経ること。

2026-08-17、実装エージェント任せの自己検証だけではkangyoページで実測クエリ(「管理業務主任者
申し込み 2026」)と生成titleの不一致(shortName「管業」に一律置換されフルネームが消えていた)
を見逃す不具合があった。この教訓から③検証ステップを必須化している。省略しないこと。

## 前提

- 対象サイト: https://maniau-shikaku.com/ 、リポジトリ: このディレクトリ(`~/dev/businesses/コンテンツマーケ/cases/maniau`)
- **GSCデータ取得は2系統ある:**
  - **API(推奨・無人可)**: `node scripts/gsc-fetch.mjs` がサービスアカウント経由で取得し `reports/gsc/YYYY-MM-DD.json` に蓄積する。鍵の準備は docs/AUTOMATION.md の「SEO改善サイクル」節。鍵が無い環境では最新スナップショットを使って続行する
  - **ブラウザ(手動)**: Claude in Chrome で検索パフォーマンスを開いて取得。APIが未設定のときのフォールバック
- サイトはCloudflareプロキシ経由。Cloudflare Web Analyticsが導入済み(2026-08-17〜)なので、GSCに加えてCTAクリック率等も参照できる場合はあわせて見る
- 機械スキャン: `node scripts/seo-scan.mjs` が GSC履歴 + 現在のビルドから、CTR機会・順位回帰・コンテンツギャップ・title核語の欠落・伸長クエリを検出し `reports/seo-scan-YYYY-MM-DD.{md,json}` を出力する

---

## 手動モード: `/seo-review`

### ① 分析
1. GSCデータを取得する。まず `node scripts/gsc-fetch.mjs` を試し、鍵が無ければ Claude in Chrome で直近3ヶ月の「クエリ別」「ページ別」(クリック・表示・CTR・平均掲載順位)を取得する
2. `node scripts/build.mjs && node scripts/seo-scan.mjs` を実行し、`reports/seo-scan-*.md` を確認する
3. スキャン結果 + 生データを `ai-company-os:webmk-strategist` に渡して分析を委任する。`scripts/build.mjs` など該当コードも読ませ、原因をコードレベルで特定させる
4. 分析結果は必要に応じてArtifact化してユーザーに共有する

### ② 実装
1. 分析結果の改善案を `ai-company-os:dev-frontend`(または該当する実装エージェント)に委任する
2. タスク指示には必ず「①で取得した実測クエリ・実データ(および `reports/seo-scan-*.json`)」を含める(③で使うため、生成結果を後から突き合わせられる形で報告させる)
3. 依存パッケージ追加禁止・データの鉄則(推測日付禁止、CLAUDE.md参照)遵守を明記する
4. この段階では commit / push させない

### ③ 検証(★このステップを省略しない)
1. **②の実装に関与していない、独立した新規エージェント**を立てる(実装エージェントの会話をforkしない。同じ視点の欠如を引き継ぐリスクがあるため、必ず新規エージェントを使う)
2. このエージェントには以下だけを渡す:
   - ①で取得した実測クエリ・ページ別実データ
   - ②の実装後に生成されたHTML(`site/` 配下)の title / description 一覧
3. 依頼内容:「各ページについて、実測データ上で重要度が高い語(実際に流入した検索クエリの核となる語)が生成されたtitle/descriptionに含まれているか機械的に突き合わせ、含まれていないページを理由とともに報告せよ。問題ないページの報告は不要、不一致の指摘のみでよい」
4. 指摘があれば②に差し戻して修正し、再度③を行う。指摘がなければ④の報告に「検証エージェントで実測データとの整合性を確認済み」と明記する

### ④ 人間承認
1. 実装内容(diff・生成結果の実例)と③の検証結果をあわせてユーザーに提示する
2. 明示的な承認を得てから commit・push する(このリポジトリはpublicかつ本番反映されるため、承認なしの自動pushは行わない)
3. commit時に `reports/seo-annotations.ndjson` へ1行追記する: `{"date":"YYYY-MM-DD","commit":"<短縮ハッシュ>","pages":["slug",...],"note":"..."}`(seo-scan が改修直後ページを測定待ちとして扱い、2週間後から前後比較する)
4. push後はGitHub Actionsのデプロイ完了を確認し、本番URLで反映を確認する

---

## 半自動モード: `/seo-review --auto`

無人実行(月次 launchd)またはユーザーが `/seo-review --auto` と打ったときのフロー。
**PR作成までを無人で行い、mainへのマージは人間がやる。** mainには一切触れない。

1. **取得とスキャン**
   - `node scripts/gsc-fetch.mjs`(失敗しても最新スナップショットで続行)
   - `node scripts/check.mjs && node scripts/build.mjs && node scripts/seo-scan.mjs`
   - `reports/seo-scan-YYYY-MM-DD.json` を読む
2. **着手判断**
   - `actionable` が 0 → `reports/YYYY-MM-DD-seo.md` に「スキャン実施・着手すべき指摘なし」と1行記録して**終了(PRなし)**
   - `hasHighRegression` が true → PRのタイトルを「【回帰】…」にして最優先で扱う
3. **ブランチを切る**: `git switch -c seo/auto-YYYY-MM-DD`
4. **②実装** を手動モードと同じルールで実行(dev-frontend に委任、`reports/seo-scan-*.json` の findings をスコープとして渡す、commitさせない)
   - **自動で実装してよい指摘**: `titleLint`(核語の欠落) / `ctrOpportunities` のうち改修履歴が無く原因が明らかに title/description にあるもの / 構造化データの欠落・不備。変更対象は data/exams の `seoTitle`/`seoDescription`、`scripts/build.mjs` のメタ生成ロジック、構造化データに限る
   - **自動では実装しない(= `reports/YYYY-MM-DD-seo.md` に「要人間判断」として列挙するだけ)**: `contentGaps`(下位順位・受け皿なし → コンテンツ深掘り/ハブ/新規資格が必要) / `regressions` の原因調査 / ハブページ新設 / noindex / 301 / レイアウト・CSS変更 / queue.md への資格追加
   - 判断に迷ったら実装しない。PRの本文で人間に委ねる
5. **③検証** を手動モードと同じく独立新規エージェントで実行。指摘が残る限り②へ差し戻す
6. **記録とコミット**
   - `reports/seo-annotations.ndjson` に追記
   - `reports/YYYY-MM-DD-seo.md` に「スキャン要約 / 実装した変更 / 検証結果 / 要人間判断」を記録
   - `git add` → `git commit`(このブランチのみ)
7. **PR作成**: `git push -u origin seo/auto-YYYY-MM-DD` → `gh pr create`
   - 本文に必ず入れる: スキャン要約 / 変更ファイルとdiffの要点 / ③検証の結果 / 「マージ前に生成されたtitle・descriptionを目視確認してください」のチェックリスト / 要人間判断リスト
   - **`gh pr merge` は絶対に実行しない**
8. 人間がPRをレビューしてマージ → 既存の GitHub Actions が検証→ビルド→デプロイ

---

## 効果測定
- push直後(〜数日)はCTR等の数値では判断しない。GSCの再クロール(3〜14日)+データ反映(2〜3日)のラグがあるため
- 1週間後は「再クロールが発生したか」をURL検査で確認するのみに留める。CTRの一次判定は2週間後を目安にする
- `reports/seo-annotations.ndjson` に改修を記録しておくと、seo-scan が該当ページを21日間「測定待ち」として指摘から除外し、以後の前後比較の基準にする
- 季節性(申込締切の集中時期等)がある場合、施策がそのピーク前に反映されているか逆算して確認する

## 禁止事項
- ③の検証ステップを省略してそのままpush / PR作成すること
- 検証エージェントに実装エージェントの会話をfork(コンテキスト継承)して使うこと
- ユーザーの明示的な承認なしの **mainへの** push
- `--auto` モードで main を直接触ること、PRを自動マージ(`gh pr merge`)すること
- `--auto` モードで構造的変更(ハブ新設・noindex・301・レイアウト)を自動実装すること — 検出はしてよいが実装は人間判断
- サービスアカウント鍵ファイルをリポジトリ内に置くこと
