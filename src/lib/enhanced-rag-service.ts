import { searchDocuments, SearchResult } from './discovery-engine';
import { DocumentReference } from './firestore';
import { generateTextWithGemini } from './vertex-ai';

export interface EnhancedRAGRequest {
  query: string;
  conversationHistory?: ConversationMessage[];
  maxResults?: number;
  companyId?: string;
  generateFollowUp?: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EnhancedRAGResponse {
  answer: string;
  sources: DocumentReference[];
  confidence: number;
  searchResultsCount: number;
  followUpQuestions?: string[];
  processingSteps: {
    extractiveAnswersFound: number;
    snippetsFound: number;
    contextLength: number;
    modelUsed: string;
  };
}

export async function generateEnhancedRAGResponse(request: EnhancedRAGRequest): Promise<EnhancedRAGResponse> {
  const { query, conversationHistory = [], maxResults = 10, companyId, generateFollowUp = false } = request;
  
  console.log('=== Enhanced RAG Query Analysis ===');
  console.log('Query:', query);
  console.log('Company ID:', companyId);
  console.log('Generate Follow-up:', generateFollowUp);

  try {
    // ② 検索処理：Discovery Engine APIでextractive answersとsnippetsを取得
    const searchResponse = await searchDocuments(query, maxResults, companyId);
    console.log('Search response received:', {
      resultsCount: searchResponse.results.length,
      totalSize: searchResponse.totalSize,
      hasSummary: !!searchResponse.summary
    });

    // Discovery Engine summaryをチェックするが、財務データが不十分な場合はenhanced processingを実行
    if (searchResponse.summary && searchResponse.summary.trim().length > 0) {
      console.log('Discovery Engine summary available:', searchResponse.summary);
      
      // 財務データの具体性をチェック
      const hasSpecificFinancialData = checkFinancialDataSpecificity(searchResponse.summary, query);
      
      if (hasSpecificFinancialData) {
        console.log('Using Discovery Engine summary - contains specific financial data');
        
        const sources = buildSourcesFromResults(searchResponse.results);
        
        return {
          answer: searchResponse.summary,
          sources: sources,
          confidence: 0.95,
          searchResultsCount: searchResponse.results.length,
          followUpQuestions: generateFollowUp ? await generateFollowUpQuestions(query, searchResponse.summary) : undefined,
          processingSteps: {
            extractiveAnswersFound: 0,
            snippetsFound: 0,
            contextLength: searchResponse.summary.length,
            modelUsed: 'Discovery Engine Summary'
          }
        };
      } else {
        console.log('Discovery Engine summary lacks specific financial data - proceeding with enhanced processing');
      }
    }

    // ③ 文脈構築：extractiveAnswersと高スコアなsnippetsを収集
    const context = await buildEnhancedContext(searchResponse.results, query);
    
    if (!context.extractiveAnswers.length && !context.snippets.length) {
      return {
        answer: '申し訳ございませんが、お尋ねの内容に関する情報が見つかりませんでした。別の質問や、より具体的な企業名・トピックを含めて再度お試しください。',
        sources: [],
        confidence: 0,
        searchResultsCount: searchResponse.results.length,
        processingSteps: {
          extractiveAnswersFound: 0,
          snippetsFound: 0,
          contextLength: 0,
          modelUsed: 'None'
        }
      };
    }

    // ④ 回答生成：Gemini 1.5 Proで自然文の回答を生成
    const geminiResponse = await generateAnswerWithGemini(query, context, conversationHistory);
    
    // ⑤ 出力：Follow-up質問の生成
    const followUpQuestions = generateFollowUp ? await generateFollowUpQuestions(query, geminiResponse.answer) : undefined;

    const sources = buildSourcesFromResults(searchResponse.results);

    return {
      answer: geminiResponse.answer,
      sources: sources,
      confidence: geminiResponse.confidence,
      searchResultsCount: searchResponse.results.length,
      followUpQuestions: followUpQuestions,
      processingSteps: {
        extractiveAnswersFound: context.extractiveAnswers.length,
        snippetsFound: context.snippets.length,
        contextLength: context.totalLength,
        modelUsed: 'Gemini 1.5 Pro'
      }
    };

  } catch (error) {
    console.error('Enhanced RAG generation error:', error);
    throw new Error(`Enhanced RAG response generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

interface EnhancedContext {
  extractiveAnswers: Array<{
    content: string;
    score: number;
    source: string;
  }>;
  snippets: Array<{
    content: string;
    score: number;
    source: string;
  }>;
  totalLength: number;
}

/**
 * ③ 文脈構築：extractiveAnswersと高スコアなsnippetsを収集
 */
async function buildEnhancedContext(results: SearchResult[], query: string): Promise<EnhancedContext> {
  console.log('=== Building Enhanced Context ===');
  console.log('Results count:', results.length);
  
  const context: EnhancedContext = {
    extractiveAnswers: [],
    snippets: [],
    totalLength: 0
  };

  // 1. Extractive Answersの収集
  results.forEach((result, index) => {
    const derivedData = result.document.derivedStructData;
    const extractiveAnswersData = derivedData?.extractive_answers;
    
    if (extractiveAnswersData?.values && Array.isArray(extractiveAnswersData.values)) {
      console.log(`Processing ${extractiveAnswersData.values.length} extractive answers from result ${index + 1}`);
      
      extractiveAnswersData.values.forEach((value: any, i: number) => {
        let content = '';
        let score = 0;
        
        if (value.structValue?.fields?.content?.stringValue) {
          content = value.structValue.fields.content.stringValue;
          score = value.structValue?.fields?.score?.numberValue || 0;
        } else if (value.stringValue) {
          content = value.stringValue;
          score = 0.5; // Default score for string values
        }
        
        if (content && content.length > 10) {
          // Clean HTML and normalize
          const cleanedContent = content
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (cleanedContent.length > 10) {
            context.extractiveAnswers.push({
              content: cleanedContent,
              score: score,
              source: derivedData?.title || derivedData?.link || `Result ${index + 1}`
            });
            console.log(`Added extractive answer: "${cleanedContent.substring(0, 100)}..." (score: ${score})`);
          }
        }
      });
    }
  });

  // 2. Snippetsの収集
  results.forEach((result, index) => {
    const derivedData = result.document.derivedStructData;
    const snippetsData = derivedData?.snippets;
    
    if (snippetsData?.values && Array.isArray(snippetsData.values)) {
      console.log(`Processing ${snippetsData.values.length} snippets from result ${index + 1}`);
      
      snippetsData.values.forEach((value: any, i: number) => {
        let content = '';
        let score = 0;
        
        if (value.structValue?.fields?.snippet?.stringValue) {
          content = value.structValue.fields.snippet.stringValue;
          score = value.structValue?.fields?.snippet_score?.numberValue || 0;
        } else if (typeof value === 'string') {
          content = value;
          score = 0.5; // Default score
        }
        
        if (content && content.length > 10) {
          // Clean HTML and normalize
          const cleanedContent = content
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (cleanedContent.length > 10) {
            // Score snippets based on financial content relevance
            const financialScore = scoreSnippetForFinancialContent(cleanedContent, query);
            const finalScore = Math.max(score, financialScore);
            
            context.snippets.push({
              content: cleanedContent,
              score: finalScore,
              source: derivedData?.title || derivedData?.link || `Result ${index + 1}`
            });
            console.log(`Added snippet: "${cleanedContent.substring(0, 100)}..." (score: ${finalScore})`);
          }
        }
      });
    }
  });

  // 3. スコアでソートして上位を選択
  context.extractiveAnswers.sort((a, b) => b.score - a.score);
  context.snippets.sort((a, b) => b.score - a.score);
  
  // 上位5つずつに制限
  context.extractiveAnswers = context.extractiveAnswers.slice(0, 5);
  context.snippets = context.snippets.slice(0, 5);
  
  // 総文字数を計算
  context.totalLength = context.extractiveAnswers.reduce((sum, item) => sum + item.content.length, 0) +
                       context.snippets.reduce((sum, item) => sum + item.content.length, 0);

  console.log('Enhanced context built:', {
    extractiveAnswers: context.extractiveAnswers.length,
    snippets: context.snippets.length,
    totalLength: context.totalLength
  });

  return context;
}

/**
 * スニペットの財務コンテンツ関連度をスコアリング
 */
function scoreSnippetForFinancialContent(content: string, query: string): number {
  let score = 0;
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // 1. クエリキーワードマッチング
  const queryKeywords = lowerQuery.split(/\s+/).filter(word => word.length > 1);
  queryKeywords.forEach(keyword => {
    if (lowerContent.includes(keyword)) {
      score += 0.2;
    }
  });
  
  // 2. 数値データの存在
  const numericalPatterns = [
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億円]/g,
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[百千万億]円/g,
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*％/g,
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%/g
  ];
  
  numericalPatterns.forEach(pattern => {
    const matches = content.match(pattern) || [];
    score += matches.length * 0.3;
  });
  
  // 3. 主要財務用語
  const primaryTerms = ['営業利益', '売上高', '当期純利益', '経常利益'];
  primaryTerms.forEach(term => {
    if (lowerContent.includes(term)) {
      score += 0.4;
    }
  });
  
  // 4. 比較データ
  const comparisonTerms = ['前年同期比', '増減', '増益', '減益', '成長率'];
  comparisonTerms.forEach(term => {
    if (lowerContent.includes(term)) {
      score += 0.3;
    }
  });
  
  return Math.min(score, 1.0); // 最大1.0にキャップ
}

/**
 * ④ 回答生成：Gemini 1.5 Proで自然文の回答を生成
 */
async function generateAnswerWithGemini(query: string, context: EnhancedContext, conversationHistory: ConversationMessage[]): Promise<{ answer: string; confidence: number }> {
  console.log('=== Generating Answer with Gemini ===');
  
  // プロンプトとコンテキストを構築
  const prompt = buildGeminiPrompt(query, context, conversationHistory);
  
  console.log('Prompt length:', prompt.length);
  console.log('Context items:', context.extractiveAnswers.length + context.snippets.length);
  
  try {
    const response = await generateTextWithGemini({
      prompt: prompt,
      maxTokens: 2048,
      temperature: 0.3
    });
    
    // 信頼度を計算（コンテキストの質と量に基づく）
    const confidence = calculateResponseConfidence(context, response.text);
    
    return {
      answer: response.text,
      confidence: confidence
    };
  } catch (error) {
    console.error('Gemini generation error:', error);
    throw new Error(`Gemini response generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gemini用のプロンプト構築
 */
function buildGeminiPrompt(query: string, context: EnhancedContext, conversationHistory: ConversationMessage[]): string {
  // クエリの抽象度を判定
  const queryLower = query.toLowerCase();
  const isGeneralQuery = [
    '決算について', '決算情報', '業績について', '業績情報', 
    '最新の', '概要', '状況', 'について教えて'
  ].some(term => queryLower.includes(term));
  
  let prompt = `あなたは投資家向け広報（IR）の専門アシスタントです。提供されたコンテキスト情報に基づいて、正確で有用な回答を生成してください。

【最重要】数値データの必須要件:
- 営業利益、売上高、当期純利益、経常利益などの財務数値は必ず具体的な金額（百万円、億円など）を明記してください
- 前年同期比、成長率、増減率などの比較データは必ず％や倍数を含めて明記してください
- 例：「営業利益は314百万円（前年同期比10.3%減）」のような具体的な数値表記を必須とします
- 「過去最高」「4期連続増益」などの表現がある場合は、その具体的な数値も併記してください

【計算要件】
- 必要に応じて、提供されたデータから営業利益率、売上総利益率、成長率などを計算してください
- 計算式と計算過程も説明してください

【回答形式】
- 企業名や数値は正確に記載してください
- 丁寧で専門的な日本語で回答してください
- 不確実な情報については推測しないでください
- 情報源（決算資料、IR資料等）を明記してください

${isGeneralQuery ? `
【一般的な質問への対応】
この質問は決算全般についての質問です。以下の順序で回答してください：
1. 売上高の具体的な数値と前年比較
2. 営業利益の具体的な数値と前年比較
3. 当期純利益の具体的な数値と前年比較
4. 主要な業績ポイントの要約
5. 特記事項があれば言及

「具体的な数値を把握することができません」「資料をご確認ください」のような回答は避けてください。
提供されたコンテキスト情報から必ず具体的な数値を抽出して回答してください。
` : ''}

質問: ${query}

`;

  // 過去の会話履歴を追加
  if (conversationHistory.length > 0) {
    prompt += `\n【過去の会話履歴】\n`;
    conversationHistory.slice(-4).forEach(msg => {
      prompt += `${msg.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${msg.content}\n`;
    });
    prompt += `\n`;
  }

  // Extractive Answersを追加
  if (context.extractiveAnswers.length > 0) {
    prompt += `【抽出された回答】\n`;
    context.extractiveAnswers.forEach((answer, index) => {
      prompt += `${index + 1}. ${answer.content}\n   （出典: ${answer.source}、スコア: ${answer.score.toFixed(2)}）\n\n`;
    });
  }

  // Snippetsを追加
  if (context.snippets.length > 0) {
    prompt += `【関連情報】\n`;
    context.snippets.forEach((snippet, index) => {
      prompt += `${index + 1}. ${snippet.content}\n   （出典: ${snippet.source}、スコア: ${snippet.score.toFixed(2)}）\n\n`;
    });
  }

  prompt += `\n上記のコンテキスト情報に基づいて、質問に対する適切な回答を生成してください。必ず具体的な数値を含めて回答してください。`;

  return prompt;
}

/**
 * 応答の信頼度を計算
 */
function calculateResponseConfidence(context: EnhancedContext, response: string): number {
  let confidence = 0.5; // ベース信頼度
  
  // コンテキストの質に基づく調整
  if (context.extractiveAnswers.length > 0) {
    confidence += 0.2;
    const avgScore = context.extractiveAnswers.reduce((sum, item) => sum + item.score, 0) / context.extractiveAnswers.length;
    confidence += avgScore * 0.2;
  }
  
  if (context.snippets.length > 0) {
    confidence += 0.1;
    const avgScore = context.snippets.reduce((sum, item) => sum + item.score, 0) / context.snippets.length;
    confidence += avgScore * 0.1;
  }
  
  // 回答の質に基づく調整
  const hasNumbers = /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億円％%]/.test(response);
  if (hasNumbers) confidence += 0.1;
  
  const hasComparison = /前年同期比|増減|成長率/.test(response);
  if (hasComparison) confidence += 0.1;
  
  return Math.min(confidence, 1.0);
}

/**
 * ⑤ Follow-up質問の生成
 */
async function generateFollowUpQuestions(originalQuery: string, answer: string): Promise<string[]> {
  console.log('=== Generating Follow-up Questions ===');
  
  const prompt = `以下の質問と回答に基づいて、ユーザーが次に聞きたいと思われる関連質問を3つ生成してください。

元の質問: ${originalQuery}

回答: ${answer}

【要件】
- 財務データや企業業績に関連する質問を優先してください
- 具体的で実用的な質問にしてください
- 「〜はどうですか？」「〜について教えてください」などの自然な形式で
- 各質問は1行で、番号は付けないでください

関連質問:`;

  try {
    const response = await generateTextWithGemini({
      prompt: prompt,
      maxTokens: 512,
      temperature: 0.4
    });
    
    // 回答を行で分割し、空行を除去
    const questions = response.text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.match(/^\d+\.?\s*/))
      .slice(0, 3);
    
    console.log('Generated follow-up questions:', questions);
    return questions;
  } catch (error) {
    console.error('Follow-up question generation error:', error);
    return [];
  }
}

/**
 * 財務データの具体性をチェック
 */
function checkFinancialDataSpecificity(summary: string, query: string): boolean {
  console.log('=== Checking Financial Data Specificity ===');
  console.log('Summary:', summary);
  console.log('Query:', query);
  
  // 1. 具体的な数値データの存在チェック
  const hasSpecificNumbers = [
    // 財務数値パターン
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億]円/g,
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*百万円/g,
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*億円/g,
    // パーセント
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[％%]/g,
    // 財務指標と数値の組み合わせ
    /営業利益\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
    /売上高\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
    /当期純利益\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g
  ].some(pattern => pattern.test(summary));
  
  console.log('Has specific numbers:', hasSpecificNumbers);
  
  // 2. 抽象的な表現のチェック（これらがあると具体性が低い）
  const hasAbstractExpressions = [
    /把握することができません/g,
    /確認できません/g,
    /提供することができません/g,
    /具体的な.*を.*できません/g,
    /資料.*をご確認ください/g,
    /IRサイト.*をご参照ください/g,
    /添付資料.*をご確認/g
  ].some(pattern => pattern.test(summary));
  
  console.log('Has abstract expressions:', hasAbstractExpressions);
  
  // 3. クエリタイプ別の判定
  const queryLower = query.toLowerCase();
  const isGeneralQuery = [
    '決算について', '決算情報', '業績について', '業績情報', 
    '最新の', '概要', '状況', 'について教えて'
  ].some(term => queryLower.includes(term));
  
  const isSpecificQuery = [
    '営業利益', '売上高', '当期純利益', '経常利益', 
    '金額', '数値', 'いくら', '何円'
  ].some(term => queryLower.includes(term));
  
  console.log('Is general query:', isGeneralQuery);
  console.log('Is specific query:', isSpecificQuery);
  
  // 4. 総合判定
  let isSpecific = false;
  
  if (isSpecificQuery) {
    // 具体的な質問の場合：数値データが必須
    isSpecific = hasSpecificNumbers && !hasAbstractExpressions;
  } else if (isGeneralQuery) {
    // 一般的な質問の場合：より厳格な判定
    isSpecific = hasSpecificNumbers && !hasAbstractExpressions;
  } else {
    // その他の場合：基本的な数値データがあれば OK
    isSpecific = hasSpecificNumbers;
  }
  
  console.log('Final specificity decision:', isSpecific);
  return isSpecific;
}

/**
 * 検索結果からソース情報を構築
 */
function buildSourcesFromResults(results: SearchResult[]): DocumentReference[] {
  return results.map(result => {
    const data = result.document.structData;
    const derivedData = result.document.derivedStructData;
    
    return {
      id: result.document.id,
      title: data.question || derivedData?.title || 'タイトルなし',
      source: data.company || derivedData?.link || '情報源不明',
      relevanceScore: result.relevanceScore || 0
    };
  });
}