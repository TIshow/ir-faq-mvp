/**
 * 公開Q&Aページ（#113）のデータ層。層1（`agent/data/facts.json`）を読み、
 * **決定論的に**「質問＋答え＋出典」を組み立てる。
 *
 * 設計の背骨（CLAUDE.md）をここでも守る:
 *  - 数値は facts.json の検証済み実データをそのまま使う（LLMを一切通さない）
 *  - 計算するのは前年比だけ（同一 metric_key の前年度との単純比較）
 *  - 出典が無いファクトは公開しない
 *
 * ビルド時に fs で読む（facts.json はフロントの Docker イメージに同梱される）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** facts.json の1レコード（層1の検証済みファクト） */
export interface Fact {
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

let cache: Fact[] | null = null;

/** facts.json を読む（プロセス内で1回だけ）。 */
function allFacts(): Fact[] {
  if (cache) return cache;
  const file = path.join(process.cwd(), 'agent', 'data', 'facts.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { facts?: Fact[] };
  cache = parsed.facts ?? [];
  return cache;
}

/** 指定企業の、出典を持つファクトだけを返す（出典なしは公開しない）。 */
export function factsFor(ticker: string): Fact[] {
  return allFacts().filter((f) => f.ticker === ticker && !!f.source_doc_label);
}

/** 数値の整形（サーバ側の _fmt_value と同じ規則: %は小数1桁、それ以外は3桁区切り）。 */
export function formatValue(value: number, unit: string): string {
  if (unit === '%') return `${value.toFixed(1)}%`;
  return `${Math.round(value).toLocaleString('ja-JP')}${unit}`;
}

/** 前年比（同一 metric_key の fiscal_year-1）。前年が無い/ゼロなら null。 */
export function yoyPercent(facts: Fact[], target: Fact): number | null {
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
export function formatYoy(pct: number): string {
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
export function periodLabel(raw: string, fiscalYearEndMonth?: number): string {
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

/** トップ画面のティッカー表示用（クライアントに渡す最小の形）。 */
export interface HeadlineNumber {
  label: string;
  value: string;
  yoy: string | null;
}

/**
 * 全企業ぶんの「おもな数字」をクライアントへ渡せる形で返す。
 * トップ画面(/)では企業の選択がクライアント側で決まるため、サーバは全社ぶんを
 * 用意しておく（1社あたり数項目なのでペイロードは小さい）。
 */
export function headlineNumbersByTicker(tickers: string[]): Record<
  string,
  { period: string; qaCount: number; numbers: HeadlineNumber[] }
> {
  const out: Record<string, { period: string; qaCount: number; numbers: HeadlineNumber[] }> = {};
  for (const ticker of tickers) {
    const facts = factsFor(ticker);
    const latest = latestHeadlineFacts(ticker).slice(0, 3); // 売上・営業利益・経常利益あたり
    if (latest.length === 0) continue;
    out[ticker] = {
      period: latest[0].period_label,
      qaCount: buildNumericQa(ticker).length,
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

/**
 * 全企業ぶんのQ&A（トップ画面 `/` 用）。
 * `/` は企業の選択がクライアント側で決まるため、サーバは全社ぶんを渡しておく
 * （実測4.4KB＝無視できる大きさ）。SSR時点では企業未選択なのでHTMLには出ず、
 * `/` が特定銘柄のページだとクローラーに誤解させることもない。
 */
export function qaByTicker(
  companies: { ticker?: string; fiscalYearEndMonth?: number }[],
): Record<string, PublicQa[]> {
  const out: Record<string, PublicQa[]> = {};
  for (const c of companies) {
    if (!c.ticker) continue;
    const qa = buildNumericQa(c.ticker, c.fiscalYearEndMonth);
    if (qa.length > 0) out[c.ticker] = qa;
  }
  return out;
}

/** 「参考：直近期の主要数値」に出す実績（最新期のみ・脇役として少数） */
export function latestHeadlineFacts(ticker: string): Fact[] {
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
