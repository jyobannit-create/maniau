# マニアウ — 資格試験の申込締切トラッカー

「まだ間に合う資格が、見つかる。」

主要資格の申込期間・試験日を週次で自動巡回・更新する静的サイト。
依存パッケージゼロ(Node標準のみ)で、GitHub Pages にデプロイされる。

## 構成

```
data/exams/*.json   資格データ(1資格1ファイル・一次情報ソースURL付き)
data/queue.md       追加予定の資格キュー
scripts/check.mjs   データ検証
scripts/build.mjs   静的サイト生成 → site/
.claude/commands/update-exams.md  週次自動更新コマンド
.github/workflows/deploy.yml      検証→ビルド→Pages デプロイ
docs/AUTOMATION.md  自動運用のセットアップと障害対応
docs/MONETIZE.md    ASP申請・アフィリエイト設置手順
reports/            週次更新レポート(自動生成)
```

## 開発

```bash
node scripts/check.mjs && node scripts/build.mjs
open site/index.html
```

運用の詳細は CLAUDE.md と docs/ を参照。
