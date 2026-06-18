-- IR Agent 層1（構造化財務ファクト層）スキーマ
-- PostgreSQL 15
--
-- 設計思想:
--   数値はLLMの生成文を経由させず、この決定論的なファクト層から取得する。
--   YoY・利益率などの派生値は保存せず、アプリ側（get_financial_facts）でコード計算する。
--   各ファクトは必ず出典（source_document_id / source_page / source_quote）を持ち、
--   評価ハーネス(④)の正解データ兼、UI(③)の出典ディープリンク元になる。
--
-- 粒度: PL中心 ＋ セグメント別（metric_key に 'segment.<key>.revenue' 等で表現）。
-- 実績/予想は is_forecast で明確に区別（②ガードレールの「会社予想」線引きと連動）。
--
-- 前提: schema.sql の companies / documents テーブルが先に存在すること。

CREATE TABLE IF NOT EXISTS financial_facts (
    fact_id          SERIAL PRIMARY KEY,
    company_id       INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,

    -- 期間
    period_label     VARCHAR(20)  NOT NULL,   -- '2025FY', '2025Q2' 等（表示・照合キー）
    fiscal_year      INTEGER      NOT NULL,    -- 決算年度
    fiscal_quarter   INTEGER,                  -- 1-4、通期は NULL

    -- 指標
    metric_key       VARCHAR(120) NOT NULL,    -- 正規化キー: 'revenue','operating_profit','net_income',
                                               --   'ordinary_profit','dividend_per_share',
                                               --   'segment.office.revenue','segment.office.operating_profit' 等
    metric_label_ja  VARCHAR(120) NOT NULL,    -- '営業利益','オフィス事業 売上高' 等（表示用）

    -- 値（派生値=YoY/利益率は保存しない。コードで算出）
    value_numeric    NUMERIC(20,4) NOT NULL,   -- 正規化済みの数値
    unit             VARCHAR(20)  NOT NULL,    -- '百万円','円','%' 等

    -- 区分
    consolidated     BOOLEAN      NOT NULL DEFAULT true,   -- true=連結, false=単体
    is_forecast      BOOLEAN      NOT NULL DEFAULT false,  -- true=会社予想, false=実績

    -- 出典（必須。出典の無いファクトは作らない）
    source_document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL,
    source_doc_label   VARCHAR(255),           -- '2025年4Q決算短信' 等（documents未投入時のラベル）
    source_page        INTEGER,                -- 原本PDFのページ番号（#page=N ディープリンク用）
    source_quote       TEXT,                   -- 抽出元の原文（検証用・引用表示用）
    source_url         VARCHAR(1000),          -- GCS等にホストした原本PDFのURL

    -- 検証・由来
    extraction_method  VARCHAR(30) NOT NULL DEFAULT 'manual', -- 'manual','xbrl','document_ai'
    verified           BOOLEAN     NOT NULL DEFAULT false,     -- 人手/正本(XBRL)で確定済みか
    created_at         TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,

    -- 同一企業・同一期間・同一指標・同一区分は一意
    UNIQUE (company_id, period_label, metric_key, consolidated, is_forecast)
);

-- 照会パターン（get_financial_facts）に合わせたインデックス
CREATE INDEX IF NOT EXISTS idx_ff_company_period   ON financial_facts(company_id, period_label);
CREATE INDEX IF NOT EXISTS idx_ff_company_metric   ON financial_facts(company_id, metric_key);
CREATE INDEX IF NOT EXISTS idx_ff_metric_period    ON financial_facts(metric_key, fiscal_year, fiscal_quarter);
CREATE INDEX IF NOT EXISTS idx_ff_verified         ON financial_facts(verified);

-- 更新時刻の自動更新（schema.sql の update_updated_at_column() を再利用）
DROP TRIGGER IF EXISTS update_financial_facts_updated_at ON financial_facts;
CREATE TRIGGER update_financial_facts_updated_at BEFORE UPDATE ON financial_facts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- エスカレーション/質問ログ（②: 拒否・不明をIRインテリジェンス化）
-- プライバシー・バイ・デザイン: 個人識別子は持たない。匿名・集計用途のみ。
CREATE TABLE IF NOT EXISTS escalations (
    escalation_id  SERIAL PRIMARY KEY,
    company_id     INTEGER REFERENCES companies(company_id) ON DELETE CASCADE,
    question       TEXT NOT NULL,
    reason         VARCHAR(50) NOT NULL,   -- 'out_of_corpus','advice','prediction','undisclosed','unknown'
    scope_status   VARCHAR(20) NOT NULL,   -- 'refused' | 'escalated'
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_escalations_company ON escalations(company_id);
CREATE INDEX IF NOT EXISTS idx_escalations_reason  ON escalations(reason);
CREATE INDEX IF NOT EXISTS idx_escalations_created ON escalations(created_at);
