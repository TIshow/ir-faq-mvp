import { searchDocuments, SearchResult } from './discovery-engine';
import { generateTextWithGemini } from './vertex-ai';
import { DocumentReference } from './firestore';

export interface RAGRequest {
  query: string;
  conversationHistory?: ConversationMessage[];
  maxResults?: number;
  companyId?: string;
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
  const { query, conversationHistory = [], maxResults = 5, companyId } = request;
  
  // Increase maxResults significantly for better snippet variety
  const limitedMaxResults = Math.min(maxResults * 4, 25); // Increased for comprehensive snippet selection

  try {
    // Step 1: Search for relevant documents
    const searchResponse = await searchDocuments(query, limitedMaxResults, companyId);
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
        
        // Check similarity (remove punctuation and check if 60%+ words match - lowered threshold)
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
        
        // Return direct answer for exact match or good similarity (lowered from 0.7 to 0.5)
        if (exactMatch || similarity >= 0.5) {
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
    const context = buildContextFromResults(searchResponse.results, query);
    
    console.log('Generated context for Vertex AI:', context);
    
    // Ensure we have some context to work with
    if (!context || context.trim().length === 0) {
      console.log('No valid context generated, using fallback...');
      return {
        answer: '申し訳ございませんが、お尋ねの内容に関する十分な情報が見つかりませんでした。より具体的な質問をしていただけますでしょうか。',
        sources: [],
        confidence: 0,
        searchResultsCount: searchResponse.results.length
      };
    }
    
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

function buildContextFromResults(results: SearchResult[], query: string): string {
  console.log('buildContextFromResults called with', results.length, 'results for query:', query);
  
  const contextParts: string[] = [];
  
  // PRIORITY 1: Extract and prioritize extractive_answers with numerical data
  const extractiveAnswers = extractExtractiveAnswers(results, query);
  if (extractiveAnswers.length > 0) {
    console.log(`Found ${extractiveAnswers.length} extractive answers`);
    extractiveAnswers.forEach((answer, index) => {
      contextParts.push(`[抽出回答${index + 1}] ${answer}`);
    });
  }
  
  const qaResults: SearchResult[] = [];
  const pdfResults: SearchResult[] = [];
  
  // Separate Q&A and PDF results
  results.forEach((result, index) => {
    const data = result.document.structData;
    const derivedData = result.document.derivedStructData;
    
    console.log(`Result ${index + 1} analysis:`, {
      structDataKeys: Object.keys(data),
      derivedDataKeys: Object.keys(derivedData || {}),
      structData: JSON.stringify(data, null, 2),
      derivedData: JSON.stringify(derivedData, null, 2)
    });
    
    // Check if this is Q&A data (has question/answer fields)
    const hasQA = data.question || data.answer || data.q || data.a;
    
    // Check if this is PDF data - handle nested fields structure
    const hasPDF = derivedData?.title || derivedData?.link || 
                  derivedData?.fields?.title || derivedData?.fields?.link || 
                  derivedData?.snippets || derivedData?.fields?.snippets ||
                  data.text || data.content || 
                  (derivedData && Object.keys(derivedData).length > 0);
    
    // Also check for general text content that could be from PDF
    const hasTextContent = data.text || data.content || data.body;
    
    console.log(`Result ${index + 1} classification:`, { hasQA, hasPDF, hasTextContent });
    
    if (hasQA) {
      qaResults.push(result);
    } else if (hasPDF || hasTextContent) {
      pdfResults.push(result);
    } else {
      // If we can't classify, treat as PDF content to avoid losing data
      console.log(`Result ${index + 1} unclassified - treating as PDF content`);
      pdfResults.push(result);
    }
  });
  
  console.log(`Found ${qaResults.length} Q&A results and ${pdfResults.length} PDF results`);
  
  // Process Q&A results
  qaResults.forEach((result, index) => {
    const data = result.document.structData;
    let context = `[Q&A文書${index + 1}]`;
    
    const questionFields = ['question', 'q', 'query', 'title', '質問', 'Question'];
    const answerFields = ['answer', 'a', 'response', 'content', '回答', 'Answer'];
    const companyFields = ['company', 'enterprise', 'corp', '企業', 'Company'];
    
    let question = '';
    let answer = '';
    let company = '';
    
    // Find question, answer, company
    for (const field of questionFields) {
      if (data[field]) { question = data[field]; break; }
    }
    for (const field of answerFields) {
      if (data[field]) { answer = data[field]; break; }
    }
    for (const field of companyFields) {
      if (data[field]) { company = data[field]; break; }
    }
    
    if (company) context += ` 企業: ${company}`;
    if (question) context += `\n質問: ${question}`;
    if (answer) context += `\n回答: ${answer}`;
    
    contextParts.push(context);
  });
  
  // Process PDF results with simplified extraction (extractive_answers are already prioritized above)
  pdfResults.forEach((result, index) => {
    const data = result.document.structData;
    const derivedData = result.document.derivedStructData;
    let context = `[PDF資料${index + 1}]`;
    
    console.log(`Processing PDF result ${index + 1}:`, { 
      structDataKeys: Object.keys(data),
      derivedDataKeys: Object.keys(derivedData || {}),
      structData: JSON.stringify(data, null, 2),
      derivedData: JSON.stringify(derivedData, null, 2)
    });
    
    // Extract PDF metadata - handle nested fields structure
    const title = derivedData?.title || derivedData?.fields?.title;
    const link = derivedData?.link || derivedData?.fields?.link;
    
    if (title) {
      const titleText = typeof title === 'string' ? title : title?.stringValue || title;
      context += ` タイトル: ${titleText}`;
    }
    if (link) {
      const linkText = typeof link === 'string' ? link : link?.stringValue || link;
      context += `\nソース: ${linkText}`;
    }
    
    // SIMPLIFIED: Extract content from PDF - focus on most reliable sources
    let pdfContent = '';
    let contentSource = '';
    
    // 1. Try structData for text content (prioritize main content fields)
    const structContentFields = ['text', 'content', 'body', 'extractedText'];
    for (const field of structContentFields) {
      if (data[field] && typeof data[field] === 'string') {
        pdfContent = data[field] as string;
        contentSource = `structData.${field}`;
        break;
      }
    }
    
    // 2. Try derivedData for text content
    if (!pdfContent) {
      const derivedContentFields = ['content', 'text', 'body', 'extractedText'];
      for (const field of derivedContentFields) {
        if (derivedData?.[field] && typeof derivedData[field] === 'string') {
          pdfContent = derivedData[field] as string;
          contentSource = `derivedData.${field}`;
          break;
        }
      }
    }
    
    // 3. Extract from snippets (simplified) - only if no other content found
    if (!pdfContent) {
      const snippetsData = derivedData?.snippets || derivedData?.fields?.snippets;
      if (snippetsData) {
        console.log('Processing snippets as fallback');
        const allSnippets = extractSnippetsFromPDF(snippetsData);
        
        // Use simpler filtering for better reliability
        const relevantSnippets = allSnippets.filter(snippet => {
          const hasNumericalData = /\d{1,3}(?:,\d{3})*(?:\.\d+)?[\u767e\u5343\u4e07\u5104\u5186\uff05%]/.test(snippet);
          const hasFinancialTerms = ['\u55b6\u696d\u5229\u76ca', '\u58f2\u4e0a\u9ad8', '\u5f53\u671f\u7d14\u5229\u76ca', '\u5229\u76ca'].some(term => 
            snippet.toLowerCase().includes(term)
          );
          const hasStrongNegative = ['\u7701\u7565', '\u8a18\u8f09\u306a\u3057', '\u8a72\u5f53\u306a\u3057'].some(term => 
            snippet.toLowerCase().includes(term)
          );
          
          return (hasNumericalData || hasFinancialTerms) && !hasStrongNegative;
        });
        
        if (relevantSnippets.length > 0) {
          pdfContent = relevantSnippets.slice(0, 3).join(' ');
          contentSource = `snippets (${relevantSnippets.length} relevant)`;
        }
      }
    }
    
    if (pdfContent) {
      console.log(`Found PDF content from ${contentSource}:`, pdfContent.substring(0, 100) + '...');
      
      // Limit content to reasonable length for context
      const maxLength = 800;
      const truncatedContent = pdfContent.length > maxLength 
        ? pdfContent.substring(0, maxLength) + '...'
        : pdfContent;
      context += `\n内容: ${truncatedContent}`;
    } else {
      console.log(`No PDF content found for result ${index + 1}`);
      // Include minimal context even without content
      context += `\n内容: [内容が取得できませんでした]`;
    }
    
    contextParts.push(context);
  });
  
  return contextParts.join('\n\n');
}

function extractExtractiveAnswers(results: SearchResult[], query: string): string[] {
  console.log('Extracting extractive answers from', results.length, 'results');
  
  const extractiveAnswers: string[] = [];
  
  results.forEach((result, index) => {
    const derivedData = result.document.derivedStructData;
    const extractiveAnswersData = derivedData?.extractive_answers;
    
    if (extractiveAnswersData?.values && Array.isArray(extractiveAnswersData.values)) {
      console.log(`Processing ${extractiveAnswersData.values.length} extractive answers from result ${index + 1}`);
      
      const answersFromThisResult: { content: string, score: number }[] = [];
      
      for (let i = 0; i < extractiveAnswersData.values.length; i++) {
        const value = extractiveAnswersData.values[i];
        let extractedText = '';
        
        // Handle the exact structure from Discovery Engine
        if (value.structValue?.fields?.content?.stringValue) {
          extractedText = value.structValue.fields.content.stringValue;
        } else if (value.structValue?.fields?.answer?.stringValue) {
          extractedText = value.structValue.fields.answer.stringValue;
        } else if (value.stringValue) {
          extractedText = value.stringValue;
        } else if (typeof value === 'string') {
          extractedText = value;
        }
        
        if (extractedText && extractedText.length > 10) {
          // Clean HTML tags and normalize text
          const cleanedText = extractedText
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
            .replace(/&amp;/g, '&')  // Replace &amp; with &
            .replace(/&lt;/g, '<')   // Replace &lt; with <
            .replace(/&gt;/g, '>')   // Replace &gt; with >
            .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
            .trim();
          
          if (cleanedText.length > 10) {
            // Score based on numerical content and financial terms
            const score = scoreExtractiveAnswer(cleanedText, query);
            answersFromThisResult.push({
              content: cleanedText,
              score: score
            });
          }
        }
      }
      
      // Sort by score and add to main list
      answersFromThisResult
        .sort((a, b) => b.score - a.score)
        .forEach(answer => {
          console.log(`Adding extractive answer with score ${answer.score}: ${answer.content.substring(0, 100)}...`);
          extractiveAnswers.push(answer.content);
        });
    }
  });
  
  // Remove duplicates and return top answers
  const uniqueAnswers = Array.from(new Set(extractiveAnswers));
  console.log(`Found ${uniqueAnswers.length} unique extractive answers`);
  
  return uniqueAnswers.slice(0, 3); // Return top 3 extractive answers
}

function scoreExtractiveAnswer(text: string, query: string): number {
  let score = 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // Extract keywords from query
  const queryKeywords = lowerQuery
    .replace(/[？?！!。、]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 1);
  
  // Score for query keyword matches
  queryKeywords.forEach(keyword => {
    const keywordCount = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
    score += keywordCount * 15;
  });
  
  // VERY HIGH priority for numerical data patterns
  const numericalPatterns = [
    // Financial amounts
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?[\u767e\u5343\u4e07\u5104\u5186]/g,
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[\u767e\u5343\u4e07\u5104]\u5186/g,
    // Financial metrics with values
    /\u55b6\u696d\u5229\u76ca\s*[\uff1a:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
    /\u58f2\u4e0a\u9ad8\s*[\uff1a:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
    /\u5f53\u671f\u7d14\u5229\u76ca\s*[\uff1a:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
    // Percentages
    /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[％%]/g,
    /\u524d\u5e74(?:\u540c\u671f)?\u6bd4\s*\d+(?:\.\d+)?\s*[％%]/g,
    // Growth indicators
    /\d+(?:\.\d+)?\s*[％%][\u5897\u6e1b]/g,
    // Fiscal periods
    /\d{4}\u5e74\d{1,2}\u6708\u671f/g
  ];
  
  numericalPatterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    score += matches.length * 50; // Very high score for numerical data
  });
  
  // High priority for primary financial terms
  const primaryFinancialTerms = ['\u55b6\u696d\u5229\u76ca', '\u58f2\u4e0a\u9ad8', '\u5f53\u671f\u7d14\u5229\u76ca', '\u7d4c\u5e38\u5229\u76ca'];
  primaryFinancialTerms.forEach(term => {
    if (lowerText.includes(term)) {
      score += 30;
    }
  });
  
  // Medium priority for secondary financial terms
  const secondaryFinancialTerms = ['\u5229\u76ca', '\u696d\u7e3e', '\u524d\u5e74', '\u5897\u6e1b', '\u6bd4\u8f03', '\u767e\u4e07\u5186'];
  secondaryFinancialTerms.forEach(term => {
    if (lowerText.includes(term)) {
      score += 15;
    }
  });
  
  // Strong penalty for negative/exclusion terms
  const negativeTerms = [
    '\u7701\u7565', '\u8a18\u8f09\u306a\u3057', '\u8a72\u5f53\u306a\u3057', '\u8a72\u5f53\u4e8b\u9805\u306f\u3042\u308a\u307e\u305b\u3093',
    '\u8a18\u8f09\u3059\u3079\u304d\u4e8b\u9805\u306f\u306a\u3044', '\u306a\u3044\u305f\u3081'
  ];
  negativeTerms.forEach(term => {
    if (lowerText.includes(term)) {
      score -= 100; // Very strong penalty
    }
  });
  
  // Bonus for specific financial reporting patterns
  if (text.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*\u767e\u4e07\u5186.*\u524d\u5e74\u540c\u671f\u6bd4.*\d+(?:\.\d+)?\s*[％%]/)) {
    score += 100; // Very high bonus for complete financial comparison
  }
  
  return score;
}

function extractSnippetsFromPDF(snippets: unknown): string[] {
  if (!snippets) return [];
  
  const snippetTexts: string[] = [];
  
  try {
    console.log('Extracting snippets from:', JSON.stringify(snippets, null, 2));
    
    // Handle different snippet formats
    if (Array.isArray(snippets)) {
      // Direct array of snippets
      for (const snippet of snippets) {
        if (typeof snippet === 'string' && snippet.length > 10) {
          snippetTexts.push(snippet);
        } else if (snippet?.snippet && typeof snippet.snippet === 'string') {
          snippetTexts.push(snippet.snippet);
        } else if (snippet?.content && typeof snippet.content === 'string') {
          snippetTexts.push(snippet.content);
        }
      }
    } else if (typeof snippets === 'object') {
      const snippetData = snippets as any;
      
      // Handle the actual structure from logs: { values: [...] }
      if (snippetData.values && Array.isArray(snippetData.values)) {
        console.log(`Processing ${snippetData.values.length} snippet values`);
        
        for (let i = 0; i < snippetData.values.length; i++) {
          const value = snippetData.values[i];
          let snippetText = '';
          
          console.log(`Processing value ${i + 1}:`, JSON.stringify(value, null, 2));
          
          // Handle the exact structure from logs:
          // { structValue: { fields: { snippet: { stringValue: "...", kind: "stringValue" } } } }
          if (value.structValue?.fields?.snippet?.stringValue) {
            snippetText = value.structValue.fields.snippet.stringValue;
            console.log(`Found snippet via structValue.fields.snippet.stringValue: ${snippetText.substring(0, 100)}...`);
          }
          // Try alternative paths
          else if (value.structValue?.fields?.content?.stringValue) {
            snippetText = value.structValue.fields.content.stringValue;
            console.log(`Found snippet via structValue.fields.content.stringValue: ${snippetText.substring(0, 100)}...`);
          }
          else if (value.stringValue) {
            snippetText = value.stringValue;
            console.log(`Found snippet via stringValue: ${snippetText.substring(0, 100)}...`);
          }
          else if (typeof value === 'string') {
            snippetText = value;
            console.log(`Found snippet via direct string: ${snippetText.substring(0, 100)}...`);
          }
          else {
            console.log(`No extractable snippet found in value ${i + 1}`);
          }
          
          // Filter out empty or placeholder snippets, and clean HTML tags
          if (snippetText && 
              snippetText !== 'No snippet is available for this page.' && 
              snippetText.length > 10 &&
              !snippetText.includes('snippet not available')) {
            
            // Clean HTML tags like <b>, &nbsp; etc.
            const cleanedText = snippetText
              .replace(/<[^>]*>/g, '') // Remove HTML tags
              .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
              .replace(/&amp;/g, '&')  // Replace &amp; with &
              .replace(/&lt;/g, '<')   // Replace &lt; with <
              .replace(/&gt;/g, '>')   // Replace &gt; with >
              .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
              .trim();
            
            if (cleanedText.length > 10) {
              snippetTexts.push(cleanedText);
              console.log(`Added cleaned snippet: ${cleanedText.substring(0, 100)}...`);
            }
          }
        }
      }
      
      // Handle Google Cloud format: { listValue: { values: [...] } }
      else if (snippetData.listValue?.values) {
        console.log(`Processing listValue with ${snippetData.listValue.values.length} values`);
        
        for (const value of snippetData.listValue.values) {
          let snippetText = '';
          
          // Try different extraction paths
          if (value.structValue?.fields?.snippet?.stringValue) {
            snippetText = value.structValue.fields.snippet.stringValue;
          } else if (value.structValue?.fields?.content?.stringValue) {
            snippetText = value.structValue.fields.content.stringValue;
          } else if (value.stringValue) {
            snippetText = value.stringValue;
          } else if (typeof value === 'string') {
            snippetText = value;
          }
          
          // Filter out empty or placeholder snippets
          if (snippetText && 
              snippetText !== 'No snippet is available for this page.' && 
              snippetText.length > 10 &&
              !snippetText.includes('snippet not available')) {
            
            const cleanedText = snippetText
              .replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/\s+/g, ' ')
              .trim();
            
            if (cleanedText.length > 10) {
              snippetTexts.push(cleanedText);
            }
          }
        }
      }
      
      // Handle object with snippet property
      else if (snippetData.snippet && typeof snippetData.snippet === 'string') {
        const cleanedText = snippetData.snippet
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanedText.length > 10) {
          snippetTexts.push(cleanedText);
        }
      }
    }
  } catch (error) {
    console.error('Error extracting PDF snippets:', error);
    console.log('Snippets structure that caused error:', JSON.stringify(snippets, null, 2));
  }
  
  console.log(`Extracted ${snippetTexts.length} snippets from PDF:`, snippetTexts.map(s => s.substring(0, 50) + '...'));
  return snippetTexts;
}

function filterAndPrioritizeSnippets(snippets: string[], query: string): string[] {
  if (!snippets || snippets.length === 0) return [];
  
  console.log(`Filtering ${snippets.length} snippets for query: "${query}"`);
  
  // Extract keywords from query for relevance scoring
  const queryKeywords = query
    .toLowerCase()
    .replace(/[？?！!。、]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 1);
  
  console.log('Query keywords:', queryKeywords);
  
  // Score and filter snippets
  const scoredSnippets = snippets.map((snippet, index) => {
    const lowerSnippet = snippet.toLowerCase();
    let score = 0;
    
    // Positive scoring factors
    queryKeywords.forEach(keyword => {
      const keywordCount = (lowerSnippet.match(new RegExp(keyword, 'g')) || []).length;
      score += keywordCount * 10; // Heavy weight for keyword matches
    });
    
    // ENHANCED: More comprehensive numerical data detection with much higher priority
    const numberPatterns = [
      // Currency amounts with various formats
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億円]/g,
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[百千万億]円/g,
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*百万円/g,
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*億円/g,
      // Financial metric patterns
      /営業利益\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
      /売上高\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
      /当期純利益\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
      /経常利益\s*[：:]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?/g,
      // Percentages with various formats
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*％/g,
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*%/g,
      // Year-over-year comparisons
      /前年(?:同期)?比\s*\d+(?:\.\d+)?\s*％/g,
      /前年(?:同期)?比\s*\d+(?:\.\d+)?\s*%/g,
      /\d+(?:\.\d+)?\s*％[増減]/g,
      /\d+(?:\.\d+)?\s*%[増減]/g,
      // Growth/decline with numbers
      /増益\s*\d+(?:\.\d+)?/g,
      /減益\s*\d+(?:\.\d+)?/g,
      /増収\s*\d+(?:\.\d+)?/g,
      /減収\s*\d+(?:\.\d+)?/g,
      // Fiscal periods
      /\d{4}年\d{1,2}月期/g,
      /\d{4}年\d{1,2}月/g,
      /\d+年\d+月期/g,
      // Specific numerical patterns commonly found in financial reports
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*倍/g,
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*円/g
    ];
    
    let numericalScore = 0;
    numberPatterns.forEach(pattern => {
      const matches = snippet.match(pattern) || [];
      numericalScore += matches.length * 35; // SIGNIFICANTLY higher weight for numerical data
    });
    score += numericalScore;
    
    // ENHANCED: More comprehensive financial terms detection
    const primaryFinancialTerms = ['売上高', '営業利益', '当期純利益', '経常利益', '売上', '利益率', '収益', '業績'];
    const secondaryFinancialTerms = ['利益', '業績', '前年', '増減', '比較', '百万円', '予想', '実績', '決算', '四半期'];
    const contextualTerms = ['最高', '更新', '達成', '好調', '堅調', '成長', '拡大', '向上', '改善'];
    
    primaryFinancialTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score += 25; // Higher weight for primary terms
      }
    });
    
    secondaryFinancialTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score += 10;
      }
    });
    
    contextualTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score += 8;
      }
    });
    
    // ENHANCED: Much stronger penalty for negative/exclusion terms
    const negativeTerms = [
      '省略', '記載を省略', '記載なし', '該当なし', '該当事項はありません', 
      '特に記載すべき事項はありません', '記載すべき事項はない', '該当する事項はありません',
      'ないため', '超えるため', '記載を省略しております', '記載を省略します',
      '該当する事項はない', '該当事項なし', '特になし', '記載事項なし'
    ];
    negativeTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score -= 50; // Much stronger penalty for exclusion language
      }
    });
    
    // ENHANCED: Bonus for complete financial statements format
    if (snippet.includes('百万円') && (snippet.includes('前年') || snippet.includes('増') || snippet.includes('減'))) {
      score += 20; // Higher bonus for complete financial data
    }
    
    // ENHANCED: Bonus for specific financial reporting patterns
    if (snippet.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*百万円.*前年同期比.*\d+(?:\.\d+)?\s*％/)) {
      score += 30; // Strong bonus for complete financial comparison format
    }
    
    // ENHANCED: Bonus for financial performance indicators
    const performanceIndicators = ['過去最高', '最高益', '最高売上', '連続増益', '連続増収', '大幅増益', '大幅増収'];
    performanceIndicators.forEach(indicator => {
      if (lowerSnippet.includes(indicator)) {
        score += 15;
      }
    });
    
    // Penalty for very short snippets (likely incomplete)
    if (snippet.length < 30) {
      score -= 10;
    }
    
    // Bonus for medium-length snippets (likely complete sentences)
    if (snippet.length >= 50 && snippet.length <= 300) {
      score += 5;
    }
    
    console.log(`Snippet ${index + 1} score: ${score}, content: "${snippet.substring(0, 100)}..."`);
    
    return {
      snippet,
      score,
      index
    };
  });
  
  // ENHANCED: More lenient filtering - prioritize numerical data even with some negative scoring
  const filteredAndSorted = scoredSnippets
    .filter(item => {
      // Always include snippets with numerical data, even if they have negative scores
      const hasNumericalData = /\d{1,3}(?:,\d{3})*(?:\.\d+)?[\u767e\u5343\u4e07\u5104\u5186\uff05%]/.test(item.snippet);
      const hasFinancialTerms = ['\u55b6\u696d\u5229\u76ca', '\u58f2\u4e0a\u9ad8', '\u5f53\u671f\u7d14\u5229\u76ca', '\u5229\u76ca'].some(term => 
        item.snippet.toLowerCase().includes(term)
      );
      
      // Include if positive score, OR if has numerical data, OR if has financial terms
      return item.score > 0 || hasNumericalData || hasFinancialTerms;
    })
    .sort((a, b) => b.score - a.score);
  
  console.log(`Filtered to ${filteredAndSorted.length} relevant snippets (includes numerical data even with negative scores)`);
  
  // Return top relevant snippets (3-5 for richer context)
  const topSnippets = filteredAndSorted
    .slice(0, 5) // Increased from 3 to 5 for more comprehensive context
    .map(item => item.snippet);
  
  // ENHANCED: More sophisticated fallback strategy
  if (topSnippets.length === 0 && snippets.length > 0) {
    console.log('No positively scored snippets found, analyzing for fallback...');
    
    // Try to find snippets with at least numerical data, even if they have some negative terms
    const numericalSnippets = snippets.filter(snippet => {
      const hasNumbers = /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億円％%]/.test(snippet);
      const hasFinancialTerms = ['売上高', '営業利益', '当期純利益', '経常利益', '利益', '業績'].some(term => snippet.toLowerCase().includes(term));
      const hasStrongNegative = ['省略', '記載なし', '該当なし'].some(term => snippet.toLowerCase().includes(term));
      
      // Include numerical snippets even if they have some negative terms, but exclude strongly negative ones
      return (hasNumbers || hasFinancialTerms) && !hasStrongNegative;
    });
    
    if (numericalSnippets.length > 0) {
      console.log(`Using ${numericalSnippets.length} numerical snippets as fallback`);
      return numericalSnippets.slice(0, 3);
    }
    
    // Try to find snippets with financial context even without explicit numbers
    const financialContextSnippets = snippets.filter(snippet => {
      const hasFinancialContext = ['決算', '業績', '財務', '利益', '売上', '収益'].some(term => snippet.toLowerCase().includes(term));
      const hasStrongNegative = ['省略', '記載なし', '該当なし'].some(term => snippet.toLowerCase().includes(term));
      return hasFinancialContext && !hasStrongNegative;
    });
    
    if (financialContextSnippets.length > 0) {
      console.log(`Using ${financialContextSnippets.length} financial context snippets as fallback`);
      return financialContextSnippets.slice(0, 2);
    }
    
    // Last resort: use first snippet that doesn't have strong negative terms
    const nonNegativeSnippets = snippets.filter(snippet => {
      const hasStrongNegative = ['省略', '記載なし', '該当なし'].some(term => snippet.toLowerCase().includes(term));
      return !hasStrongNegative;
    });
    
    if (nonNegativeSnippets.length > 0) {
      console.log('Using first non-negative snippet as last resort fallback');
      return [nonNegativeSnippets[0]];
    }
    
    // Absolute last resort: use first snippet
    console.log('Using first snippet as absolute last resort fallback');
    return [snippets[0]];
  }
  
  return topSnippets;
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

【最重要】数値データの必須要件:
- 営業利益、売上高、当期純利益、経常利益などの財務数値は必ず具体的な金額（百万円、億円など）を明記してください
- 前年同期比、成長率、増減率などの比較データは必ず％や倍数を含めて明記してください
- 例：「営業利益は1,915百万円（前年同期比125.7%増）」のような具体的な数値表記を必須とします
- 「過去最高」「4期連続増益」などの表現がある場合は、その具体的な数値も併記してください

回答の要件:
- Q&A文書と PDF資料の両方の情報を活用してください
- Q&A文書に直接的な回答がある場合は、それを優先してください
- PDF資料からは具体的な数値や事実データを最優先してください
- 「省略」「記載なし」「該当なし」等の否定的情報は完全に無視して、肯定的な具体的情報のみを使用してください
- 企業名や数値は正確に記載してください（百万円、％、前年比等も含む）
- 複数の関連情報がある場合は、それらを統合して包括的な回答を作成してください
- 情報源（Q&A文書またはPDF資料）を明記してください
- 不確実な情報については推測しないでください
- 決算資料からの情報の場合は「決算資料によると」等の前置きを付けてください
- 丁寧で専門的な日本語で回答してください

【絶対に避けること】:
- 抽象的な表現のみで数値を省略すること
- 「過去最高」「好調」等の表現だけで具体的数値を記載しないこと
- 否定的情報（「省略」「記載なし」等）を回答に含めること

【必須】回答形式の例:
1. Q&Aデータから直接回答できる場合:
   「[回答内容]（Q&Aデータより）」

2. PDF資料から補完する場合:
   「[Q&A回答] 
   
   また、決算資料によると[PDF内容による補完情報]があります。」

3. PDF資料のみから回答する場合（推奨形式）:
   「決算資料によると、[具体的な数値や実績データ]です。これは[前年同期比や過去との比較データ]を表しています。」

質問: ${query}${conversationContext}

上記のコンテキスト情報に基づいて、質問に対する適切な回答を生成してください。必ず具体的な数値を含めて回答してください。`;
}