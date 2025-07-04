# IR FAQ RAG System - 複数企業対応設計

## プロジェクト概要

複数企業に対応したIR（Investor Relations）情報のRAG（Retrieval-Augmented Generation）システム。投資家が複数企業の財務情報や決算データについて自然言語で質問し、AIが適切な回答を生成する。

## 技術構想

### データストレージ設計

#### メインデータベース: Cloud SQL (PostgreSQL)
```sql
-- 企業マスター
CREATE TABLE companies (
    company_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ticker VARCHAR(10) UNIQUE,
    sector VARCHAR(100),
    market_cap BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 決算メタデータ
CREATE TABLE financial_reports (
    report_id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(company_id),
    period DATE,
    report_type VARCHAR(50),
    file_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- チャット履歴
CREATE TABLE chat_sessions (
    session_id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(company_id),
    user_id VARCHAR(255),
    query TEXT,
    response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 分析データベース: BigQuery
- 決算詳細データ（パーティション: company_id, fiscal_year）
- 集計済みメトリクス（事前計算済み指標）
- 大量データの高速分析用

### RAG実装アーキテクチャ

#### 文書ストレージ: Cloud Storage
```
/raw-documents/{company_id}/{period}/
├── annual_report.pdf
├── quarterly_report.pdf
└── presentation.pdf

/processed-documents/{company_id}/{period}/
├── extracted_text.json
├── financial_data.json
└── metadata.json
```

#### 検索エンジン: Discovery Engine（現状維持）
- 企業別データストア分離
- ベクトル検索機能
- 企業コンテキスト保持

### アプリケーション設計

```
User → Next.js Frontend → Cloud Run API
                           ├── 企業選択サービス → Cloud SQL
                           ├── RAG検索サービス → Discovery Engine
                           └── LLM応答生成 → Vertex AI
```

## 現在システムとの主な差異

| 項目 | 現在 | 構想 |
|------|------|------|
| データベース | Firestore | Cloud SQL + BigQuery |
| 検索エンジン | Discovery Engine | Discovery Engine（継続） |
| 企業対応 | 単一企業 | 複数企業 |
| 企業選択 | なし | 企業検索・選択機能 |
| データパイプライン | 手動 | 自動化 |

## 改善された設計

### 1. セキュリティ強化
- Row Level Security (RLS) 実装
- 企業別IAMロール設定
- データアクセス監査ログ

### 2. パフォーマンス最適化
- Redis/Memorystore でクエリ結果キャッシュ
- CDN で静的コンテンツ配信
- Connection Pooling 実装

### 3. 監視・運用
- Cloud Monitoring でメトリクス監視
- Error Reporting で例外追跡
- SLO/SLI 定義

### 4. データ品質保証
- Data Quality Engine 導入
- 自動データ検証パイプライン
- 異常検知アラート設定

## 実装フェーズ計画

### Phase 1: 基盤構築
- [ ] Cloud SQL (PostgreSQL) セットアップ
- [ ] 企業マスターDB構築
- [ ] 基本的なスキーマ設計

### Phase 2: データ移行
- [ ] 既存Firestoreデータの移行
- [ ] Discovery Engineデータストア再構築
- [ ] データ整合性チェック

### Phase 3: 企業選択機能
- [ ] 企業検索API実装
- [ ] 企業選択UI開発
- [ ] 企業別コンテキスト管理

### Phase 4: RAG機能拡張
- [ ] 企業別RAG検索ロジック
- [ ] BigQueryとの連携
- [ ] 回答生成の最適化

### Phase 5: 運用機能
- [ ] 監視・ログ機能
- [ ] 自動データパイプライン
- [ ] 複数企業データ追加

## 重要な技術的決定

### Discovery Engine継続利用
- 理由: 現在のシステムが安定稼働中
- 移行コスト・リスクを考慮し段階的アプローチ

### Cloud SQL選択
- 理由: リレーショナルデータの管理が容易
- 企業間の関係性データを効率的に管理

### BigQuery併用
- 理由: 大量の財務データ分析に最適
- 集計済みメトリクスで高速応答

## 開発・運用注意事項

### コスト管理
- BigQueryクエリ量の監視とキャッシュ戦略
- Cloud SQL インスタンスサイズの最適化
- Discovery Engine使用量の監視

### セキュリティ
- 企業データの完全分離
- 個人情報保護の徹底
- APIアクセス制御の実装

### パフォーマンス
- データベースインデックス最適化
- キャッシュ戦略の実装
- 検索レスポンス時間の監視

### データ品質
- 定期的なデータ検証
- 異常データの自動検出
- データ更新の自動化

## テスト戦略

### 単体テスト
- API エンドポイントテスト
- データベース操作テスト
- RAG検索ロジックテスト

### 統合テスト
- エンドツーエンドテスト
- 企業選択からRAG応答まで
- データパイプラインテスト

### 負荷テスト
- 同時接続数テスト
- 大量データ処理テスト
- レスポンス時間測定

## 監視項目

### システムメトリクス
- API レスポンス時間
- データベース接続数
- エラー発生率

### ビジネスメトリクス
- 企業別利用状況
- 質問カテゴリ分析
- 回答精度指標

### 運用メトリクス
- データ更新頻度
- システム可用性
- コスト効率性

## 災害対策

### バックアップ戦略
- Cloud SQL自動バックアップ
- BigQueryデータセット複製
- Cloud Storage多重化

### リカバリ手順
- データベース復旧手順
- 検索インデックス再構築
- システム全体の復旧テスト

## 次のアクション

1. 現在のシステムの詳細調査
2. 企業マスターデータの準備
3. データ移行計画の策定
4. 開発チームでの技術レビュー
5. プロトタイプの開発開始