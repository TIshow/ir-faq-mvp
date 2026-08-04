/**
 * 公開Q&Aページ（#113）のデータ層。層1（`agent/data/facts/<ticker>.json`）を読み、
 * **決定論的に**「質問＋答え＋出典」を組み立てる。
 *
 * 設計の背骨（CLAUDE.md）をここでも守る:
 *  - 数値は層1の検証済み実データをそのまま使う（LLMを一切通さない）
 *  - 計算するのは前年比だけ（同一 metric_key の前年度との単純比較）
 *  - 出典が無いファクト・**未検証のファクトは公開しない**
 *
 * このファイルが作るのは**AIクローラーに読ませるための面**なので、
 * 採用条件はエージェント（`agent/facts_store.py`）と同じかそれ以上に厳しくする。
 * 取り込んだだけで未検証のデータ（EDINET抽出は `verified: false` で出る）が
 * 「公式Q&A」として出ていくと、取り消せない形でAIに配られる（docs/edinet-ingest.md §8）。
 *
 * ビルド時に fs で読む（層1はフロントの Docker イメージに同梱される）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 層1の1レコード（検証済みファクト） */
interface Fact {
  ticker: string;
  metric_key: string;
  metric_label_ja: string;
  period_label: string;
  fiscal_year: number;
  value_numeric: number;
  unit: string;
  consolidated: boolean;
  is_forecast: boolean;
  source_doc_label: string;
  source_page: number | null;
  source_url: string | null;
  verified?: boolean;
}

/** 公開ページに出す1問（答え全文＋出典つき） */
export interface PublicQa {
  /** アンカーID（AIが答えを名指しで引用できるように） */
  id: string;
  question: string;
  /** 答えの本文（決定論で組み立てた文章。LLM不使用） */
  answer: string;
  source: { doc: string; page: number | null };
}

/** 表示順（この順に並べる）。ここに無い metric_key は数値Q&Aにしない。 */
const HEADLINE_METRICS = [
  'revenue',
  'operating_profit',
  'ordinary_profit',
  'net_income',
  'eps',
  'dividend_per_share',
] as const;

/** ティッカー -> そのファクト。プロセス内で1回だけ読む。 */
const cache = new Map<string, Fact[]>();

/** ティッカー -> 実ファイル。層1ディレクトリを1回だけ列挙して作る。 */
let index: Map<string, string> | null = null;

/**
 * `agent/data/facts/*.json` を列挙して「ティッカー -> パス」を作る（1回だけ）。
 *
 * **ティッカーからパスを組み立てない。** ticker は `/c/<ticker>` のURL由来なので、
 * `${ticker}.json` と繋ぐと `../` でディレクトリの外を読める。実在するファイルだけを
 * 引く形にすれば、読める対象が層1ディレクトリの中身に限定される
 * （エージェント側 `agent/facts_store.py` の `_file_index` と同じ考え方）。
 */
function fileIndex(): Map<string, string> {
  if (index) return index;
  const dir = path.join(process.cwd(), 'agent', 'data', 'facts');
  index = new Map();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.json')) index.set(name.slice(0, -'.json'.length), path.join(dir, name));
    }
  }
  return index;
}

/** 指定企業の層1ファイルを読む（`agent/data/facts/<ticker>.json`）。 */
function loadTicker(ticker: string): Fact[] {
  const hit = cache.get(ticker);
  if (hit) return hit;
  const file = fileIndex().get(ticker);
  // 索引に無いティッカーはキャッシュしない（空振りを覚えるとMapが際限なく育つ）。
  if (!file) return [];
  const rows = (JSON.parse(fs.readFileSync(file, 'utf8')) as { facts?: Fact[] }).facts ?? [];
  cache.set(ticker, rows);
  return rows;
}

/** 公開してよいファクトだけを返す。
 *  ticker はファイル名だけでなく中身でも確認する（取り違えたファイルを置いたとき、
 *  別の会社の数字を出すのではなく何も出さないで落ちるようにするため）。 */
function factsFor(ticker: string): Fact[] {
  return loadTicker(ticker).filter(
    (f) => f.ticker === ticker && !!f.source_doc_label && f.verified === true,
  );
}

/** 数値の整形（サーバ側の _fmt_value と同じ規則: %は小数1桁、それ以外は3桁区切り）。 */
function formatValue(value: number, unit: string): string {
  if (unit === '%') return `${value.toFixed(1)}%`;
  return `${Math.round(value).toLocaleString('ja-JP')}${unit}`;
}

/** 前年比（同一 metric_key の fiscal_year-1）。前年が無い/ゼロなら null。 */
function yoyPercent(facts: Fact[], target: Fact): number | null {
  const prev = facts.find(
    (f) =>
      f.metric_key === target.metric_key &&
      f.fiscal_year === target.fiscal_year - 1 &&
      f.is_forecast === target.is_forecast,
  );
  if (!prev || prev.value_numeric === 0) return null;
  return ((target.value_numeric - prev.value_numeric) / Math.abs(prev.value_numeric)) * 100;
}

/** 前年比の表示（+58.3% / △6.0%）。 */
function formatYoy(pct: number): string {
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `△${Math.abs(pct).toFixed(1)}%`;
}

/** アンカーID（安定・URLに使える）。metric_key と期間から決定論的に作る。 */
function anchorId(metricKey: string, period: string): string {
  return `q-${metricKey.replace(/[^a-zA-Z0-9]+/g, '-')}-${period}`.toLowerCase();
}

/**
 * 期間の表示名。決算期末月が**確認できている企業だけ**「2026年3月期」と表記し、
 * 不明な企業は層1のラベル（2026FY）のまま出す（勝手に決算月を推測しない）。
 * 投資家もAIも「2026年3月期の営業利益は？」と尋ねるため、分かる場合は日本語表記が望ましい。
 */
function periodLabel(raw: string, fiscalYearEndMonth?: number): string {
  const m = /^(\d{4})FY$/.exec(raw);
  if (!m || !fiscalYearEndMonth) return raw;
  return `${m[1]}年${fiscalYearEndMonth}月期`;
}

/** セグメントの表示名（"中食事業（売上高）" → "中食事業"）。 */
function segmentName(label: string): string {
  return label.replace(/（売上高）$|\s*売上高$/, '');
}

/**
 * 層1から決定論的にQ&Aを組み立てる（#113 段階B）。
 * 実績の最新期を主役にし、前年比と会社予想があれば同じ答えの中で言及する。
 * **文章はテンプレート＝毎回同じ**（静的ページとして安定させるため）。
 */
export function buildNumericQa(ticker: string, fiscalYearEndMonth?: number): PublicQa[] {
  const facts = factsFor(ticker);
  if (facts.length === 0) return [];

  const qa: PublicQa[] = [];
  for (const key of HEADLINE_METRICS) {
    const ofKey = facts.filter((f) => f.metric_key === key);
    const actuals = ofKey.filter((f) => !f.is_forecast).sort((a, b) => a.fiscal_year - b.fiscal_year);
    const latest = actuals[actuals.length - 1];
    if (!latest) continue;

    const label = latest.metric_label_ja;
    const kind = latest.consolidated ? '連結' : '単体';
    const per = periodLabel(latest.period_label, fiscalYearEndMonth);
    let answer = `${per}（${kind}）の${label}は ${formatValue(latest.value_numeric, latest.unit)} です。`;

    const pct = yoyPercent(facts, latest);
    const prev = actuals[actuals.length - 2];
    if (pct !== null && prev) {
      answer += ` 前年（${periodLabel(prev.period_label, fiscalYearEndMonth)}）の ${formatValue(prev.value_numeric, prev.unit)} から ${formatYoy(pct)} です。`;
    }
    const forecast = ofKey
      .filter((f) => f.is_forecast)
      .sort((a, b) => a.fiscal_year - b.fiscal_year)
      .pop();
    if (forecast) {
      answer += ` なお会社は ${periodLabel(forecast.period_label, fiscalYearEndMonth)} について ${formatValue(forecast.value_numeric, forecast.unit)} の会社予想を公表しています。`;
    }

    qa.push({
      id: anchorId(key, latest.period_label),
      question: `${per}の${label}はいくらですか？`,
      answer,
      source: { doc: latest.source_doc_label, page: latest.source_page },
    });
  }

  // セグメント（売上・営業利益）は1問にまとめる（羅列を避け、読み物として成立させる）
  const segRevenue = facts.filter(
    (f) => f.metric_key.startsWith('segment.') && f.metric_key.endsWith('.revenue') && !f.is_forecast,
  );
  if (segRevenue.length > 0) {
    const latestYear = Math.max(...segRevenue.map((f) => f.fiscal_year));
    const rows = segRevenue.filter((f) => f.fiscal_year === latestYear);
    const period = periodLabel(rows[0]?.period_label ?? '', fiscalYearEndMonth);
    const parts = rows.map((r) => {
      const profit = facts.find(
        (f) =>
          f.metric_key === r.metric_key.replace('.revenue', '.operating_profit') &&
          f.fiscal_year === latestYear &&
          !f.is_forecast,
      );
      const name = segmentName(r.metric_label_ja);
      const p = profit ? `・営業利益 ${formatValue(profit.value_numeric, profit.unit)}` : '';
      return `${name}は売上高 ${formatValue(r.value_numeric, r.unit)}${p}`;
    });
    qa.push({
      id: anchorId('segment', rows[0].period_label),
      question: `${period}のセグメント別の業績はどうなっていますか？`,
      answer: `${period}のセグメント別では、${parts.join('、')} です。`,
      source: { doc: rows[0].source_doc_label, page: rows[0].source_page },
    });
  }

  return qa;
}

/** 企業を指す最小の形（Company 全体を要求しない＝呼び出しが軽い）。 */
type CompanyRef = { ticker?: string; fiscalYearEndMonth?: number };

/** 「おもな数字」1項目。 */
export interface HeadlineNumber {
  label: string;
  value: string;
  yoy: string | null;
}

/** ある企業の「おもな数字」ひとまとまり。UI側もこの型を使う（手書きの複製を作らない）。 */
export interface CompanyHeadline {
  period: string;
  qaCount: number;
  numbers: HeadlineNumber[];
}

/** 「おもな数字」（層1の検証済み実績・最新期の上位3項目）をティッカー別に返す。 */
export function headlineNumbersByTicker(companies: CompanyRef[]): Record<string, CompanyHeadline> {
  const out: Record<string, CompanyHeadline> = {};
  for (const { ticker, fiscalYearEndMonth } of companies) {
    if (!ticker) continue;
    const facts = factsFor(ticker);
    const latest = latestHeadlineFacts(ticker).slice(0, 3); // 売上・営業利益・経常利益あたり
    if (latest.length === 0) continue;
    out[ticker] = {
      // 期間の表記は公式Q&A側と揃える（決算月が確認できている企業だけ「2026年3月期」）
      period: periodLabel(latest[0].period_label, fiscalYearEndMonth),
      qaCount: buildNumericQa(ticker, fiscalYearEndMonth).length,
      numbers: latest.map((f) => {
        const pct = yoyPercent(facts, f);
        return {
          label: f.metric_label_ja,
          value: formatValue(f.value_numeric, f.unit),
          yoy: pct === null ? null : formatYoy(pct),
        };
      }),
    };
  }
  return out;
}

/** その企業の「おもな数字」。層1が無ければ undefined。 */
export function companyHeadline(company: CompanyRef): CompanyHeadline | undefined {
  return company.ticker ? headlineNumbersByTicker([company])[company.ticker] : undefined;
}

/**
 * その企業の公式Q&A。層1が無ければ空配列。
 * サーバー側で解決してチャットに渡すことで、パネルが閉じていてもそのURLのHTMLに
 * 質問＋答え全文が載る＝JSを実行しないAIクローラーが読める。
 */
export function companyQa(company: CompanyRef): PublicQa[] {
  return company.ticker ? buildNumericQa(company.ticker, company.fiscalYearEndMonth) : [];
}

/** 「参考：直近期の主要数値」に出す実績（最新期のみ・脇役として少数） */
function latestHeadlineFacts(ticker: string): Fact[] {
  const facts = factsFor(ticker);
  const out: Fact[] = [];
  for (const key of HEADLINE_METRICS) {
    const actuals = facts
      .filter((f) => f.metric_key === key && !f.is_forecast)
      .sort((a, b) => a.fiscal_year - b.fiscal_year);
    const latest = actuals[actuals.length - 1];
    if (latest) out.push(latest);
  }
  return out;
}
