# マニアウ — 資格試験の申込締切トラッカー

「まだ間に合う資格が、見つかる。」放置運用を前提とした自動更新型メディア。
週次で公式情報を巡回してデータを更新し、静的サイトを再ビルド・デプロイする。

## コマンド

```bash
node scripts/check.mjs   # データ検証(エラーで exit 1)
node scripts/build.mjs   # site/ に静的サイトを生成
```

デプロイは main への push で GitHub Actions が自動実行(検証→ビルド→GitHub Pages)。
週次更新は `/update-exams` コマンド(.claude/commands/update-exams.md)で行う。

## データの鉄則(最重要)

1. **日付は一次情報でのみ更新する。** 実施団体の公式サイトで確認できた日付だけを書く。予備校サイト等は補助情報とし、公式と食い違ったら公式を採用する
2. **確認できないものは書かない。** 受験料・合格発表日などが未確認なら null のまま(サイト側で「公式サイトでご確認ください」と表示される)
3. **推測で日付を埋めない。** 「例年◯月だから」で具体的な日付を書くのは禁止。その場合は applicationNote / tbdNote に「例年◯月頃」と書く
4. 更新したら必ず `lastVerified` を当日に更新し、`sources` を最新の確認先に合わせる
5. 変更は `reports/YYYY-MM-DD.md` に「何をどう変えたか・根拠URL」を記録する

## データ構造(data/exams/*.json)

- `examType`: `fixed`(日程固定) / `cbt`(随時) / `tbd`(日程未発表) / `varies`(地域により異なる)
- `sessions[].applications[]`: `{method, start, end, endTime?, note?}` — 日付は YYYY-MM-DD
- 申込期間が地域・会場ごとに異なる場合は `applications: []` + `applicationNote`
- 新規資格の追加候補は `data/queue.md` から。追加ルールも同ファイル参照

## サイト設計

- 依存パッケージゼロ(Node標準のみ)。npm install は存在しない。ライブラリ追加は原則禁止
- モバイルファースト。ブレークポイント 375/768/1280。タップターゲット44px以上
- 配色はブランドカラー固定: 深紺 #17233b / 生成り #f7f5f0 / 朱 #d8442b / 深緑 #1e6e5c。紫グラデ等のAI汎用配色に変えない
- CTAは1ページに1つ。アフィリエイトURL未設定時は公式サイトリンクがCTAになる
- 残り日数はビルド時に計算し、閲覧時にインラインJSで再計算される(ビルド間隔のズレ対策)

## マネタイズ

- `affiliate.url` を設定するとCTAが広告リンクに切り替わる(rel="sponsored nofollow" 自動付与)
- ASP申請手順・提携先候補は docs/MONETIZE.md
