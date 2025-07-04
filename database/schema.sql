-- IR FAQ System Database Schema (改良版)
-- PostgreSQL 15

-- 企業マスターテーブル
CREATE TABLE companies (
    company_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255), -- 英語名
    ticker VARCHAR(20), -- ティッカーシンボル
    sector VARCHAR(100), -- 業界
    market_cap BIGINT, -- 時価総額
    search_engine_id VARCHAR(100), -- Discovery Engine ID
    description TEXT, -- 企業説明
    website_url VARCHAR(500), -- 公式サイト
    is_active BOOLEAN DEFAULT true, -- アクティブ状態
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 文書管理テーブル
CREATE TABLE documents (
    document_id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(company_id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL, -- 'pdf', 'csv', 'json', 'xlsx'
    content_type VARCHAR(50) NOT NULL, -- 'financial_report', 'qa_data', 'earnings_call', 'presentation'
    original_filename VARCHAR(500),
    file_path VARCHAR(1000), -- Cloud Storage原本パス
    processed_file_path VARCHAR(1000), -- 前処理済みファイルパス
    discovery_engine_doc_id VARCHAR(200), -- Discovery Engine ドキュメントID
    processing_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    file_size BIGINT, -- ファイルサイズ（バイト）
    metadata JSONB, -- ページ数、抽出テキスト長等
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 決算レポートメタデータテーブル
CREATE TABLE financial_reports (
    report_id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(company_id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(document_id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL, -- 決算年度
    fiscal_quarter INTEGER, -- 四半期（1-4、年次は NULL）
    report_type VARCHAR(50) NOT NULL, -- 'annual', 'quarterly', 'interim'
    report_period VARCHAR(20) NOT NULL, -- '2024Q1', '2024FY' など
    title VARCHAR(500), -- レポートタイトル
    published_date DATE, -- 公開日
    revenue BIGINT, -- 売上高（百万円）
    operating_profit BIGINT, -- 営業利益（百万円）
    net_income BIGINT, -- 当期純利益（百万円）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, fiscal_year, fiscal_quarter, report_type)
);

-- Q&Aデータテーブル
CREATE TABLE qa_data (
    qa_id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(company_id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(document_id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category VARCHAR(100), -- 'finance', 'strategy', 'governance', 'esg' 等
    subcategory VARCHAR(100), -- より詳細なカテゴリ
    confidence_score DECIMAL(3,2), -- 0.00-1.00
    source_reference VARCHAR(500), -- PDF参照先、ページ番号等
    keywords TEXT[], -- 検索用キーワード配列
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- チャットセッション拡張（企業情報追加）
CREATE TABLE chat_sessions_extended (
    session_id VARCHAR(100) PRIMARY KEY,
    company_id INTEGER REFERENCES companies(company_id) ON DELETE SET NULL,
    title VARCHAR(500),
    session_type VARCHAR(50) DEFAULT 'general', -- 'general', 'financial_analysis', 'qa_focused'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- メッセージ拡張（企業コンテキスト追加）
CREATE TABLE messages_extended (
    message_id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) REFERENCES chat_sessions_extended(session_id) ON DELETE CASCADE,
    company_id INTEGER REFERENCES companies(company_id) ON DELETE SET NULL,
    message_type VARCHAR(20) NOT NULL, -- 'user', 'assistant'
    content TEXT NOT NULL,
    sources JSONB, -- 参考文献情報 [{"document_id": 1, "title": "...", "relevance": 0.9}]
    metadata JSONB, -- {"confidence": 0.85, "topics": ["revenue", "profit"], "processing_time": 1.2}
    parent_message_id INTEGER REFERENCES messages_extended(message_id), -- 会話の流れ
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 文書処理ログテーブル
CREATE TABLE document_processing_logs (
    log_id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(document_id) ON DELETE CASCADE,
    processing_step VARCHAR(100), -- 'upload', 'text_extraction', 'indexing', 'discovery_engine_upload'
    status VARCHAR(50), -- 'started', 'completed', 'failed'
    details TEXT, -- エラーメッセージやメタデータ
    processing_time_ms INTEGER, -- 処理時間（ミリ秒）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
-- 企業マスター
CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_companies_ticker ON companies(ticker);
CREATE INDEX idx_companies_sector ON companies(sector);
CREATE INDEX idx_companies_active ON companies(is_active);

-- 文書管理
CREATE INDEX idx_documents_company ON documents(company_id);
CREATE INDEX idx_documents_type ON documents(document_type, content_type);
CREATE INDEX idx_documents_status ON documents(processing_status);
CREATE INDEX idx_documents_created ON documents(created_at);

-- 決算レポート
CREATE INDEX idx_financial_reports_company ON financial_reports(company_id);
CREATE INDEX idx_financial_reports_period ON financial_reports(fiscal_year, fiscal_quarter);
CREATE INDEX idx_financial_reports_type ON financial_reports(report_type);
CREATE INDEX idx_financial_reports_published ON financial_reports(published_date);

-- Q&Aデータ
CREATE INDEX idx_qa_data_company ON qa_data(company_id);
CREATE INDEX idx_qa_data_category ON qa_data(category, subcategory);
CREATE INDEX idx_qa_data_keywords ON qa_data USING GIN(keywords);
CREATE INDEX idx_qa_data_active ON qa_data(is_active);
-- pg_trgm拡張を有効化（日本語検索対応）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- トライグラムインデックス作成（日本語部分一致検索）
CREATE INDEX idx_qa_data_question_trgm ON qa_data USING GIN(question gin_trgm_ops);
CREATE INDEX idx_qa_data_answer_trgm ON qa_data USING GIN(answer gin_trgm_ops);

-- チャットセッション
CREATE INDEX idx_chat_sessions_company ON chat_sessions_extended(company_id);
CREATE INDEX idx_chat_sessions_created ON chat_sessions_extended(created_at);
CREATE INDEX idx_chat_sessions_activity ON chat_sessions_extended(last_activity);

-- メッセージ
CREATE INDEX idx_messages_session ON messages_extended(session_id);
CREATE INDEX idx_messages_company ON messages_extended(company_id);
CREATE INDEX idx_messages_timestamp ON messages_extended(timestamp);
CREATE INDEX idx_messages_parent ON messages_extended(parent_message_id);

-- 処理ログ
CREATE INDEX idx_processing_logs_document ON document_processing_logs(document_id);
CREATE INDEX idx_processing_logs_step ON document_processing_logs(processing_step);
CREATE INDEX idx_processing_logs_created ON document_processing_logs(created_at);

-- 更新時刻の自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_financial_reports_updated_at BEFORE UPDATE ON financial_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_qa_data_updated_at BEFORE UPDATE ON qa_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions_extended
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- セッションの最終活動時刻更新トリガー
CREATE OR REPLACE FUNCTION update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_sessions_extended 
    SET last_activity = CURRENT_TIMESTAMP,
        message_count = message_count + 1
    WHERE session_id = NEW.session_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_session_activity_trigger AFTER INSERT ON messages_extended
    FOR EACH ROW EXECUTE FUNCTION update_session_activity();

-- 初期データ投入用のサンプル企業
INSERT INTO companies (name, name_en, ticker, sector, description, is_active) VALUES
('トヨタ自動車株式会社', 'Toyota Motor Corporation', '7203', '自動車', '世界最大級の自動車メーカー', true),
('ソニーグループ株式会社', 'Sony Group Corporation', '6758', 'エレクトロニクス・エンターテインメント', '多角的テクノロジー・エンターテインメント企業', true),
('ソフトバンクグループ株式会社', 'SoftBank Group Corp.', '9984', 'テクノロジー投資', '世界最大級のテクノロジー投資会社', true);

-- 初期Q&Aデータサンプル
INSERT INTO qa_data (company_id, question, answer, category, confidence_score) VALUES
(1, 'トヨタの2024年度の売上高はいくらですか？', 'トヨタ自動車の2024年度の売上高は約45兆円でした。', 'finance', 0.95),
(1, 'トヨタの電動化戦略について教えてください', 'トヨタは2030年までに電動車を年間350万台販売する目標を掲げています。', 'strategy', 0.90),
(2, 'ソニーの主要事業セグメントは何ですか？', 'ソニーの主要事業は、ゲーム&ネットワークサービス、音楽、映画、エレクトロニクス、イメージング&センシングソリューションです。', 'business', 0.92);