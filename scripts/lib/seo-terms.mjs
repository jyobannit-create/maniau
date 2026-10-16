// SEOの語彙(検索意図語・資格の別名)と正規化。seo-scan.mjs と loop/scripts/verify.mjs が共有する。

export const INTENT_TERMS = [
  "試験日程", "試験日", "日程", "申込", "締切",
  "受験料", "検定料", "合格発表", "願書", "受験票", "いつ", "期間", "スケジュール",
];

// 検索で使われる資格の呼び名。data/exams から自動生成したものに手動の別名を足す。
export const MANUAL_ALIASES = {
  boki1: ["簿記1級", "簿記一級", "日商簿記1級", "boki1"],
  boki: ["簿記2級", "簿記3級", "日商簿記", "簿記"],
  "e-shiken": ["e資格", "e-shiken"],
  "g-kentei": ["g検定", "ジェネラリスト検定"],
  kikenbutsu: ["危険物乙4", "乙4", "危険物取扱者", "危険物", "乙種第4類"],
  kangyo: ["管理業務主任者", "管業"],
  mankan: ["マンション管理士", "マン管", "マンカン"],
  "oyo-joho": ["応用情報技術者試験", "応用情報", "応用情報技術者"],
  "kihon-joho": ["基本情報技術者試験", "基本情報", "基本情報技術者", "fe"],
  "it-passport": ["itパスポート", "iパス", "アイパス"],
  shikisai: ["色彩検定", "カラーコーディネート"],
  toeic: ["toeic", "トーイック"],
  fp1: ["fp1級", "fp1級実技", "1級fp"],
  fp: ["fp2級", "fp3級", "fp技能検定", "ファイナンシャルプランナー", "fp検定"],
  gyoseishoshi: ["行政書士"],
  hoikushi: ["保育士"],
  "eisei-kanri": ["衛生管理者", "第一種衛生管理者", "第二種衛生管理者", "衛生管理"],
  takken: ["宅建", "宅地建物取引士", "宅建士"],
  denko2: ["電気工事士2種", "第二種電気工事士", "電工二種", "電工2種", "2種電気工事士"],
  chintai: ["賃貸不動産経営管理士", "賃管"],
};

export const norm = (s) => (s || "").toLowerCase().replace(/[\s　]+/g, "").replace(/[()（）]/g, "");
// 送り仮名ゆれを吸収してから語の包含を判定する(「申し込み」と「申込」を同一視)
export const canon = (s) =>
  norm(s)
    .replace(/申(し)?込(み)?/g, "申込")
    .replace(/締(め)?切(り)?/g, "締切")
    .replace(/問(い)?合(わせ)?/g, "問合");

// 資格の区別に使えない汎用語。別名から除外しないと「色彩検定 3級」が簿記に化ける等の誤マッピングを起こす
export const GENERIC_ALIAS = new Set(["試験", "検定", "公開テスト", "実技", "学科", "エンジニア資格", "fe", "級"]);
export const isGenericAlias = (a) => GENERIC_ALIAS.has(a) || /^[0-9０-９一二三四五六]級$/.test(a) || a.length < 2;

export function coreTerms(query) {
  const n = canon(query);
  return INTENT_TERMS.filter((t) => n.includes(canon(t)));
}
