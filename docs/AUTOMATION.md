# 自動運用の仕組み

## 全体像

```
[週1回・月曜朝] ローカルMacのcron
   └─ claude -p "/update-exams"
        ├─ 公式サイト巡回 → data/exams/*.json 更新
        ├─ queue.md から新規資格を1〜2件追加
        ├─ check.mjs で検証 → build.mjs でビルド
        ├─ git commit & push
        └─ reports/ に更新レポートを記録
              ↓ push をトリガーに
[GitHub Actions]
   └─ 検証 → ビルド → GitHub Pages へデプロイ
        (毎週日曜21:00 UTCにもスケジュール実行 = 残り日数の再計算保険)
```

人間の作業は「月1回、reports/ を眺めて異常がないか確認する」だけ。

## セットアップ(1回だけ・設定済み 2026-07-16)

### 週次更新のLaunchAgent登録

macOSではcronではなくlaunchdを使う(実行時刻にスリープしていても、復帰時に実行される)。

`~/Library/LaunchAgents/com.maniau.update-exams.plist` に定義済み:
- スケジュール: 毎週月曜 7:00
- 実行内容: `claude -p "/update-exams" --permission-mode acceptEdits`(ログは reports/cron.log)

```bash
# 登録(初回のみ)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.maniau.update-exams.plist
# 登録確認
launchctl list | grep maniau
# 手動で今すぐ実行(動作確認)
launchctl kickstart gui/$(id -u)/com.maniau.update-exams
# 停止したいとき
launchctl bootout gui/$(id -u)/com.maniau.update-exams
```

- `--permission-mode acceptEdits` はこのリポジトリ内の編集を自動承認する。WebFetch/WebSearch/git push は .claude/settings.json の許可リストで無人実行できる
- Macの電源が完全に切れている場合は実行されない(次回起動後の月曜7:00から再開)

## 障害時の初動

| 症状 | 確認する場所 | 対応 |
|------|-------------|------|
| サイトが更新されない | GitHub Actions の実行履歴 | check.mjs のエラーログを見てデータを修正 |
| cronが動いていない | reports/cron.log | PATH・claude CLIの場所を確認 |
| 公式サイトの構造が変わり取得失敗 | reports/ の最新レポート | sources のURLを新しい公式ページに差し替え |
| 誤ったデータが公開された | 該当JSONとreports/ | 公式を再確認して修正→push(数分で反映) |

## 影響範囲

誤情報を公開した場合の影響は「読者が誤った締切を信じる」こと。これを防ぐ多層防御:
1. データの鉄則(公式一次情報のみ・推測禁止) — CLAUDE.md
2. check.mjs の機械検証(日付整合性・鮮度チェック)
3. 全ページに「申込前に必ず公式サイトで確認」の注意書きと公式リンクを常設

---

# SEO改善サイクル(半自動・PRゲート式)

データ更新とは別系統。GSC実測データを起点に、機械スキャン → エージェントによる改修 →
独立検証 → **PR作成** までを無人で行い、**mainへのマージだけ人間**がやる。

```
[週次] launchd(gsc-scan)
  ├─ node scripts/gsc-fetch.mjs   … Search Console API で取得 → reports/gsc/YYYY-MM-DD.json
  └─ node scripts/build.mjs && node scripts/seo-scan.mjs
       └─ reports/seo-scan-YYYY-MM-DD.{md,json} … CTR機会 / 順位回帰 / コンテンツギャップ /
                                                   title核語の欠落 / 伸長クエリ を検出
       └─ 重大な順位下落があれば exit 2(cron.log に 🔴)

[月次] launchd(seo-auto) → claude -p "/seo-review --auto"
  └─ スキャン結果を読む → 着手すべき指摘があれば
       ブランチ seo/auto-YYYY-MM-DD を切る
       → 実装エージェント(dev-frontend)が title/description・構造化データ等を改修
       → 独立検証エージェントが実測クエリとの整合を機械チェック
       → commit(ブランチのみ) → git push → gh pr create
  ★ mainには触らない / 自動マージしない / 構造的変更(ハブ新設・noindex・301)は
    「要人間判断」として列挙するだけ

[人間・月1回・2分] PRをレビューしてマージ → 既存の Build & Deploy が動く
```

フローの詳細は `.claude/skills/seo-review/SKILL.md`。

## セットアップ(1回だけ)

### 1. サービスアカウントを作る(GSC API用)

無人でGSCを読むために、OAuthの対話ログインではなくサービスアカウントを使う。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作る(既存でも可)
2. 「APIとサービス」→ **Search Console API** を有効化
3. 「IAMと管理」→「サービスアカウント」→ 新規作成(名前は `maniau-gsc-reader` 等、ロール不要)
4. 作ったサービスアカウント → 「キー」→「鍵を追加」→ JSON をダウンロード
5. ダウンロードしたJSONを **リポジトリ外** に置く:
   ```bash
   mkdir -p ~/.config/maniau
   mv ~/Downloads/xxxxx.json ~/.config/maniau/gsc-sa.json
   chmod 600 ~/.config/maniau/gsc-sa.json
   ```
   (別の場所に置くなら環境変数 `MANIAU_GSC_SA_KEY` でパスを指定)

### 2. サービスアカウントを Search Console に招待する

1. [Search Console](https://search.google.com/search-console) → プロパティ `https://maniau-shikaku.com/` を開く
2. 「設定」→「ユーザーと権限」→「ユーザーを追加」
3. `gsc-sa.json` の中の `client_email`(`...@....iam.gserviceaccount.com`)を貼り付け、権限は「制限付き」でよい

### 3. 動作確認

```bash
node scripts/gsc-fetch.mjs   # reports/gsc/ に今日のスナップショットができる
node scripts/build.mjs && node scripts/seo-scan.mjs   # reports/seo-scan-*.md ができる
```

### 4. LaunchAgent を登録

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.maniau.gsc-scan.plist   # 週次: 取得+スキャン
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.maniau.seo-auto.plist   # 月次: 改修PR作成
launchctl list | grep maniau
```

- `com.maniau.gsc-scan` — 毎週月曜 7:30(update-exams の30分後)。取得とスキャンのみ。PRは作らない
- `com.maniau.seo-auto` — 毎月1日 8:00。`/seo-auto` コマンド(= seo-review スキルの --auto フロー)を実行し、指摘があればPRを作る。手動で回すなら対話セッションで `/seo-review --auto`

## 障害・注意

| 症状 | 確認する場所 | 対応 |
|------|-------------|------|
| gsc-fetch が鍵エラー | `~/.config/maniau/gsc-sa.json` の有無 | セットアップ1をやり直す |
| gsc-fetch が 403 | GSCのユーザー一覧 | サービスアカウントのメールが追加されているか(セットアップ2) |
| スキャンが「取得待ち」 | `reports/gsc/` | gsc-fetch がまだ一度も成功していない。手動で実行 |
| PRが作られない | `reports/YYYY-MM-DD-seo.md` | 着手すべき指摘なし(actionable=0)なら正常。ログを見る |
| 🔴 重大な順位下落 | `reports/seo-scan-*.md` の①、`reports/gsc/cron.log` | 該当ページを手動確認。公式の日程変更・ペナルティ等を疑う |

- サービスアカウント鍵は `.gitignore` で二重にガードしているが、**絶対にコミットしない**
- `--auto` が触るのは常に `seo/auto-*` ブランチだけ。main への push 権限があっても main は触らない設計
