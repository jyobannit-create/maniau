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
