# reports/gsc/ — Search Console スナップショット履歴

`scripts/gsc-fetch.mjs` が週次で `YYYY-MM-DD.json` を書き出す。
GSC は約16か月しかデータを保持しないため、施策の前後比較ができるよう自前で蓄積している。
`scripts/seo-scan.mjs` が最新2ファイルを読んで機械スキャンをかける。

## スキーマ

```jsonc
{
  "fetchedAt": "2026-09-17T07:00:00Z",
  "property": "https://maniau-shikaku.com/",
  "source": "search-console-api",     // 手動シードは "browser-manual-YYYY-MM-DD"
  "windowDays": 90,
  "partial": false,                    // true = 部分データ(初期シード等)
  "current": {
    "range": { "start": "2026-06-19", "end": "2026-09-17" },
    "totals":      { "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 },
    "byQuery":     [ { "query": "...", "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 } ],
    "byPage":      [ { "page": "https://...", "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 } ],
    "byPageQuery": [ { "page": "https://...", "query": "...", "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 } ],
    "byDate":      [ { "date": "2026-06-19", "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 } ]
  },
  "previous": {                        // 前期(比較用・byPageQuery/byDate は省略)
    "range": { "start": "2026-03-20", "end": "2026-06-18" },
    "totals": { ... }, "byQuery": [ ... ], "byPage": [ ... ]
  }
}
```

- `ctr` は 0〜1 の小数、`position` は掲載順位(小さいほど上位)
- `2026-09-10.json` は Claude in Chrome で手動取得した初期スナップショット。`byPageQuery` 未取得のため
  `seo-scan.mjs` は `byQuery` を資格名で推定マッピングして代用する(`partial: true`)
