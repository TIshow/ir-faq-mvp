/**
 * IR Agent 回答オブジェクトの契約（型）
 *
 * 設計の背骨:
 *  - 数値は LLM の生成文(answer_prose)を経由させず、層1由来の fact_cards に集約する。
 *  - すべての主張・数値は出典を持つ（citations / FactCard.source）。
 *  - scope_status でガードレールの結果（回答/拒否/エスカレーション）を表現する。
 *
 * この型は API(/api/chat) の戻り値、UI(ChatInterface) の描画、
 * 評価ハーネス(④) の検証対象が共有する単一の契約。
 */

/** ガードレール(②)の判定結果 */
export type ScopeStatus = 'answered' | 'refused' | 'escalated';

/** 出典（原本PDFの該当ページへのディープリンク元） */
export interface Citation {
  /** 資料名（例: '2025年4Q決算短信'） */
  doc: string;
  /** 原本PDFのページ番号（#page=N に使用） */
  page?: number;
  /** GCS等にホストした原本PDFのURL（#page=N を付与してディープリンク） */
  url?: string;
  /** 抽出元の原文（検証・ホバー表示用） */
  quote?: string;
}

/** 実績/予想の区分（②「会社予想」の線引きと連動） */
export type FactBasis = 'actual' | 'forecast';

/**
 * 数値カード（層1=構造化財務ファクト由来、逐語）
 * UI では散文と視覚的に分離して表示し、出典の無いカードは描画しない。
 */
export interface FactCard {
  /** 指標名（例: '営業利益', 'オフィス事業 売上高'） */
  metric: string;
  /** 正規化キー（例: 'operating_profit', 'segment.office.revenue'） */
  metricKey: string;
  /** 期間（例: '2025FY', '2025Q2'） */
  period: string;
  /** 表示値（単位付きの整形済み文字列。例: '314百万円'） */
  value: string;
  /** 生の数値（評価ハーネスの決定論的比較に使用） */
  valueNumeric: number;
  /** 単位（例: '百万円', '%'） */
  unit: string;
  /** 前年同期比などの整形済み表示（例: '+10.3%'）。コードで算出 */
  yoy?: string;
  /** 連結/単体 */
  consolidated: boolean;
  /** 実績/予想（'forecast' は UI で「会社予想」バッジ＋点線枠） */
  basis: FactBasis;
  /** 出典（必須） */
  source: Citation;
}

/**
 * IR Agent の回答（単一契約）
 *  - answer_prose: LLM が書く語り（接続詞）。数値は基本含めず、薄めにする。
 *  - fact_cards:   層1由来の数値（逐語）。
 *  - citations:    層2（定性RAG）の出典。
 *  - scope_status: ガードレール結果。
 */
export interface AgentResponse {
  answer_prose: string;
  fact_cards: FactCard[];
  citations: Citation[];
  scope_status: ScopeStatus;
  /** エスカレーション/拒否の理由（②の分類）。answered では undefined */
  scope_reason?: 'out_of_corpus' | 'advice' | 'prediction' | 'undisclosed' | 'unknown';
}
