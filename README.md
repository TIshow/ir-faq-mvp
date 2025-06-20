# IR FAQ RAG System

GCPを使用したRAG（Retrieval-Augmented Generation）システムによるIR情報チャットボット

## アーキテクチャ

- **フロントエンド**: Next.js 15 + TypeScript + Tailwind CSS
- **検索エンジン**: Google Cloud Discovery Engine
- **生成AI**: Vertex AI (Gemini Pro)
- **データベース**: Cloud Firestore
- **デプロイ**: Cloud Run

## セットアップ

### 1. GCPプロジェクトの準備

以下のAPIを有効化してください：

```bash
gcloud services enable discoveryengine.googleapis.com
gcloud services enable aiplatform.googleapis.com
gcloud services enable firestore.googleapis.com
```

### 2. Discovery Engine の設定

1. GCPコンソールでDiscovery Engineに移動
2. 新しい検索アプリを作成
3. データストアを作成してQ&Aデータをアップロード
4. エンジンIDを`.env.local`に設定

### 3. Firestore の設定

1. GCPコンソールでFirestoreに移動
2. ネイティブモードでデータベースを作成
3. 必要に応じてセキュリティルールを設定

### 4. サービスアカウントの作成

```bash
gcloud iam service-accounts create ir-faq-service \
    --display-name="IR FAQ Service Account"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:ir-faq-service@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/discoveryengine.editor"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:ir-faq-service@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:ir-faq-service@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/datastore.user"
```

### 5. 環境変数の設定

`.env.local`ファイルは既に設定済みです。

必要に応じて値を調整してください。

## ローカル開発

```bash
npm install
npm run dev
```

http://localhost:3000 にアクセス

## Cloud Run デプロイ

### 1. Docker イメージをビルド

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/ir-faq-rag
```

### 2. Cloud Run にデプロイ

```bash
gcloud run deploy ir-faq-rag \
    --image gcr.io/YOUR_PROJECT_ID/ir-faq-rag \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --set-env-vars="GCP_PROJECT_ID=YOUR_PROJECT_ID,GCP_SEARCH_ENGINE_ID=YOUR_ENGINE_ID"
```

## データ投入

Q&Aデータは以下の形式でDiscovery Engineにアップロードしてください：

```json
{
  "question": "質問内容",
  "answer": "回答内容", 
  "company": "企業名",
  "category": "カテゴリ"
}
```

## 機能

- 自然言語による質問・回答
- 検索結果に基づくRAG生成
- チャット履歴の保存
- ソース情報の表示
- 信頼度スコア表示

## トラブルシューティング

### 認証エラー
- サービスアカウントキーが正しく設定されているか確認
- IAMロールが適切に設定されているか確認

### 検索結果が返らない
- Discovery Engineのデータストアにデータが投入されているか確認
- 検索エンジンIDが正しいか確認

### Vertex AI エラー  
- Vertex AI APIが有効化されているか確認
- リージョン設定が正しいか確認
