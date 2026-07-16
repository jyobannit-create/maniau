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

## セットアップ(1回だけ)

### 週次更新のcron登録

```bash
crontab -e
```

以下を追加(毎週月曜 7:00):

```cron
0 7 * * 1 export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; cd $HOME/dev/personal/maniau && claude -p "/update-exams" --permission-mode acceptEdits >> reports/cron.log 2>&1
```

- Macがスリープしていると実行されない。確実性を上げるなら `pmset repeat wakeorpoweron M 06:55:00` で自動起床を設定するか、Claude Code の /schedule(クラウド実行)への移行を検討
- `--permission-mode acceptEdits` はこのリポジトリ内の編集を自動承認する。push は .claude/settings.json の許可リストに依存

### 動作確認(手動実行)

```bash
cd ~/dev/personal/maniau && claude -p "/update-exams" --permission-mode acceptEdits
```

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
