import { searchDocuments, SearchResult } from './discovery-engine';
import { generateTextWithGemini } from './vertex-ai';
import { DocumentReference } from './firestore';

export interface RAGRequest {
  query: string;
  conversationHistory?: ConversationMessage[];
  maxResults?: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RAGResponse {
  answer: string;
  sources: DocumentReference[];
  confidence: number;
  searchResultsCount: number;
}

export async function generateRAGResponse(request: RAGRequest): Promise<RAGResponse> {
  const { query, conversationHistory = [], maxResults = 5 } = request;

  try {
    // Step 1: Search for relevant documents
    console.log('Searching for relevant documents...');
    const searchResponse = await searchDocuments(query, maxResults);
    
    console.log('Search response received:', {
      resultsCount: searchResponse.results.length,
      totalSize: searchResponse.totalSize
    });
    
    if (searchResponse.results.length === 0) {
      return {
        answer: '申し訳ございませんが、お尋ねの内容に関する情報が見つかりませんでした。別の質問や、より具体的な企業名・トピックを含めて再度お試しください。',
        sources: [],
        confidence: 0,
        searchResultsCount: 0
      };
    }

    // Step 1.5: Check for exact or similar question match
    for (const result of searchResponse.results) {
      const data = result.document.structData;
      console.log('Checking result for match:', data);
      
      if (data.question && data.answer) {
        const originalQuestion = data.question.toLowerCase().trim();
        const userQuery = query.toLowerCase().trim();
        
        // Check exact match
        const exactMatch = originalQuestion === userQuery;
        
        // Check similarity (remove punctuation and check if 80%+ words match)
        const originalWords = originalQuestion.replace(/[？。、！]/g, '').split(/\s+/);
        const queryWords = userQuery.replace(/[？。、！]/g, '').split(/\s+/);
        
        const matchingWords = originalWords.filter(word => 
          queryWords.some(qWord => word.includes(qWord) || qWord.includes(word))
        );
        const similarity = matchingWords.length / Math.max(originalWords.length, queryWords.length);
        
        console.log('Question match check:', {
          original: data.question,
          query: query,
          exactMatch: exactMatch,
          similarity: similarity,
          matchingWords: matchingWords
        });
        
        // Return direct answer for exact match or high similarity
        if (exactMatch || similarity >= 0.7) {
          console.log(`Found ${exactMatch ? 'exact' : 'similar'} match! Returning direct answer.`);
          return {
            answer: data.answer,
            sources: [{
              id: result.document.id,
              title: data.question,
              source: data.company || '情報源不明',
              relevanceScore: exactMatch ? 1.0 : similarity
            }],
            confidence: exactMatch ? 1.0 : similarity,
            searchResultsCount: 1
          };
        }
      }
    }

    // Step 2: Build context from search results
    const context = buildContextFromResults(searchResponse.results);
    
    // Step 3: Build conversation context
    const conversationContext = buildConversationContext(conversationHistory);
    
    // Step 4: Generate response using Vertex AI (with fallback)
    console.log('Generating response with Vertex AI...');
    const prompt = buildPrompt(query, conversationContext);
    
    let generationResponse;
    try {
      generationResponse = await generateTextWithGemini({
        prompt: prompt,
        context: context,
        maxTokens: 1024,
        temperature: 0.2
      });
    } catch (vertexError) {
      console.error('Vertex AI generation failed, using fallback:', vertexError);
      
      // Fallback: Use the first relevant result directly
      const relevantResult = searchResponse.results.find(result => 
        result.document.structData.answer && result.document.structData.answer.length > 10
      );
      
      if (relevantResult && relevantResult.document.structData.answer) {
        return {
          answer: `以下の関連情報をお答えします：\n\n${relevantResult.document.structData.answer}`,
          sources: [{
            id: relevantResult.document.id,
            title: relevantResult.document.structData.question || 'タイトルなし',
            source: relevantResult.document.structData.company || '情報源不明',
            relevanceScore: 0.8
          }],
          confidence: 0.8,
          searchResultsCount: searchResponse.results.length
        };
      }
      
      // If no fallback possible
      return {
        answer: '申し訳ございませんが、現在システムに一時的な問題が発生しております。しばらくしてから再度お試しください。',
        sources: [],
        confidence: 0,
        searchResultsCount: 0
      };
    }

    // Step 5: Build document references
    const sources: DocumentReference[] = searchResponse.results.map((result: SearchResult) => {
      const data = result.document.structData;
      
      // Try to find title from various fields
      const titleFields = ['question', 'title', 'q', '質問', 'Question'];
      const companyFields = ['company', 'enterprise', 'corp', '企業', 'Company'];
      
      let title = 'タイトルなし';
      let source = '情報源不明';
      
      for (const field of titleFields) {
        if (data[field]) {
          title = data[field];
          break;
        }
      }
      
      for (const field of companyFields) {
        if (data[field]) {
          source = data[field];
          break;
        }
      }
      
      return {
        id: result.document.id,
        title: title,
        source: source,
        relevanceScore: result.relevanceScore || 0
      };
    });

    return {
      answer: generationResponse.text,
      sources: sources,
      confidence: generationResponse.confidence,
      searchResultsCount: searchResponse.results.length
    };

  } catch (error) {
    console.error('RAG generation error:', error);
    throw new Error(`RAG response generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function buildContextFromResults(results: SearchResult[]): string {
  const contextParts = results.map((result, index) => {
    const data = result.document.structData;
    const derivedData = result.document.derivedStructData;
    let context = `[文書${index + 1}]`;
    
    // Check all possible fields in structData (CSV columns)
    const allFields = Object.keys(data);
    console.log(`Document ${index + 1} fields:`, allFields);
    console.log(`Document ${index + 1} data:`, data);
    console.log(`Document ${index + 1} derivedData:`, derivedData);
    
    // Try to identify question and answer from various possible field names
    const questionFields = ['question', 'q', 'query', 'title', '質問', 'Question'];
    const answerFields = ['answer', 'a', 'response', 'content', '回答', 'Answer'];
    const companyFields = ['company', 'enterprise', 'corp', '企業', 'Company'];
    
    let question = '';
    let answer = '';
    let company = '';
    
    // Find question
    for (const field of questionFields) {
      if (data[field]) {
        question = data[field];
        break;
      }
    }
    
    // Find answer
    for (const field of answerFields) {
      if (data[field]) {
        answer = data[field];
        break;
      }
    }
    
    // Find company
    for (const field of companyFields) {
      if (data[field]) {
        company = data[field];
        break;
      }
    }
    
    // Check derived data for extractive answers
    if (!answer && derivedData?.extractive_answers) {
      const extractiveAnswers = derivedData.extractive_answers
        .map((ans: any) => ans.content)
        .filter(Boolean)
        .join(' ');
      if (extractiveAnswers) {
        answer = extractiveAnswers;
      }
    }
    
    // Use first available field if no standard fields found
    if (!question && !answer) {
      const availableFields = Object.entries(data).filter(([key, value]) => 
        value && typeof value === 'string' && value.length > 10
      );
      if (availableFields.length > 0) {
        context += `\n内容: ${availableFields[0][1]}`;
      }
    } else {
      if (company) context += ` 企業: ${company}`;
      if (question) context += `\n質問: ${question}`;
      if (answer) context += `\n回答: ${answer}`;
    }
    
    return context;
  });
  
  return contextParts.join('\n\n');
}

function buildConversationContext(history: ConversationMessage[]): string {
  if (history.length === 0) return '';
  
  const recentHistory = history.slice(-6); // Keep last 3 exchanges
  const contextParts = recentHistory.map(msg => 
    `${msg.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${msg.content}`
  );
  
  return `\n\n過去の会話:\n${contextParts.join('\n')}`;
}

function buildPrompt(query: string, conversationContext: string): string {
  return `あなたは投資家向け広報（IR）の専門アシスタントです。提供されたコンテキスト情報に基づいて、正確で有用な回答を生成してください。

回答の要件:
- 提供された情報のみを使用してください
- 不確実な情報については推測しないでください
- 企業名や数値は正確に記載してください
- 丁寧で専門的な日本語で回答してください
- 情報源が明確でない場合は、その旨を明記してください

質問: ${query}${conversationContext}

上記のコンテキスト情報に基づいて、質問に対する適切な回答を生成してください。`;
}