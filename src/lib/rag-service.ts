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
  
  // Increase maxResults significantly for better snippet variety
  const limitedMaxResults = Math.min(maxResults * 4, 25); // Increased for comprehensive snippet selection

  try {
    // Step 1: Search for relevant documents
    console.log('Searching for relevant documents with limited results:', limitedMaxResults);
    const searchResponse = await searchDocuments(query, limitedMaxResults);
    
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
  
  const qaResults: SearchResult[] = [];
  const pdfResults: SearchResult[] = [];
  
  // Separate Q&A and PDF results
  results.forEach((result, index) => {
    const data = result.document.structData;
    const derivedData = result.document.derivedStructData;
    
    console.log(`Result ${index + 1} analysis:`, {
      structDataKeys: Object.keys(data),
      derivedDataKeys: Object.keys(derivedData || {}),
      structData: data,
      derivedData: derivedData
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
  
  const contextParts: string[] = [];
  
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
  
  // Process PDF results with enhanced extraction
  pdfResults.forEach((result, index) => {
    const data = result.document.structData;
    const derivedData = result.document.derivedStructData;
    let context = `[PDF資料${index + 1}]`;
    
    console.log(`Processing PDF result ${index + 1}:`, { data, derivedData });
    
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
    
    // Extract content from PDF - comprehensive approach
    let pdfContent = '';
    let contentSource = '';
    
    // 1. Try structData for text content (all possible fields)
    const structContentFields = ['text', 'content', 'body', 'extractedText', 'snippet', 'textRepresentation', 'pageContent'];
    for (const field of structContentFields) {
      if (data[field]) {
        if (typeof data[field] === 'string') {
          pdfContent = data[field] as string;
          contentSource = `structData.${field}`;
          break;
        } else if (Array.isArray(data[field])) {
          // Handle array of text content
          pdfContent = (data[field] as string[]).join(' ');
          contentSource = `structData.${field} (array)`;
          break;
        }
      }
    }
    
    // 2. Try derivedData for text content - handle nested fields
    if (!pdfContent) {
      const derivedContentFields = ['content', 'text', 'body', 'extractedText', 'textRepresentation', 'pageContent'];
      for (const field of derivedContentFields) {
        // Try direct access first
        if (derivedData?.[field]) {
          if (typeof derivedData[field] === 'string') {
            pdfContent = derivedData[field] as string;
            contentSource = `derivedData.${field}`;
            break;
          } else if (Array.isArray(derivedData[field])) {
            pdfContent = (derivedData[field] as string[]).join(' ');
            contentSource = `derivedData.${field} (array)`;
            break;
          }
        }
        // Try nested fields access
        else if (derivedData?.fields?.[field]) {
          const fieldData = derivedData.fields[field];
          if (typeof fieldData === 'string') {
            pdfContent = fieldData;
            contentSource = `derivedData.fields.${field}`;
            break;
          } else if (fieldData?.stringValue) {
            pdfContent = fieldData.stringValue;
            contentSource = `derivedData.fields.${field}.stringValue`;
            break;
          } else if (Array.isArray(fieldData)) {
            pdfContent = fieldData.join(' ');
            contentSource = `derivedData.fields.${field} (array)`;
            break;
          }
        }
      }
    }
    
    // 3. Extract from extractive_answers (common in Discovery Engine PDF results)
    if (!pdfContent) {
      const extractiveAnswersData = derivedData?.extractive_answers || derivedData?.fields?.extractive_answers;
      if (extractiveAnswersData) {
        console.log('Processing extractive_answers:', JSON.stringify(extractiveAnswersData, null, 2));
        
        const extractiveTexts: string[] = [];
        
        // Handle nested structure: extractive_answers.values[].structValue.fields.content.stringValue
        if (extractiveAnswersData.values && Array.isArray(extractiveAnswersData.values)) {
          console.log(`Processing ${extractiveAnswersData.values.length} extractive answer values`);
          
          for (let i = 0; i < extractiveAnswersData.values.length; i++) {
            const value = extractiveAnswersData.values[i];
            let extractedText = '';
            
            console.log(`Processing extractive answer ${i + 1}:`, JSON.stringify(value, null, 2));
            
            // Handle the exact structure from logs: { structValue: { fields: { content: { stringValue: "...", kind: "stringValue" } } } }
            if (value.structValue?.fields?.content?.stringValue) {
              extractedText = value.structValue.fields.content.stringValue;
              console.log(`Found extractive content via structValue.fields.content.stringValue: ${extractedText.substring(0, 100)}...`);
            }
            // Try alternative paths
            else if (value.structValue?.fields?.answer?.stringValue) {
              extractedText = value.structValue.fields.answer.stringValue;
              console.log(`Found extractive content via structValue.fields.answer.stringValue: ${extractedText.substring(0, 100)}...`);
            }
            else if (value.stringValue) {
              extractedText = value.stringValue;
              console.log(`Found extractive content via stringValue: ${extractedText.substring(0, 100)}...`);
            }
            else if (typeof value === 'string') {
              extractedText = value;
              console.log(`Found extractive content via direct string: ${extractedText.substring(0, 100)}...`);
            }
            else {
              console.log(`No extractable content found in extractive answer ${i + 1}`);
            }
            
            // Filter out empty or placeholder content
            if (extractedText && 
                extractedText.length > 10 &&
                !extractedText.includes('No content available') &&
                !extractedText.includes('内容が取得できません')) {
              
              // Clean HTML tags if present
              const cleanedText = extractedText
                .replace(/<[^>]*>/g, '') // Remove HTML tags
                .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
                .replace(/&amp;/g, '&')  // Replace &amp; with &
                .replace(/&lt;/g, '<')   // Replace &lt; with <
                .replace(/&gt;/g, '>')   // Replace &gt; with >
                .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
                .trim();
              
              if (cleanedText.length > 10) {
                extractiveTexts.push(cleanedText);
                console.log(`Added cleaned extractive text: ${cleanedText.substring(0, 100)}...`);
              }
            }
          }
        }
        // Handle direct array format
        else if (Array.isArray(extractiveAnswersData)) {
          for (const answer of extractiveAnswersData) {
            if (answer?.content) {
              extractiveTexts.push(answer.content);
            } else if (typeof answer === 'string') {
              extractiveTexts.push(answer);
            } else if (answer?.stringValue) {
              extractiveTexts.push(answer.stringValue);
            }
          }
        }
        // Handle single object
        else if (extractiveAnswersData.content) {
          extractiveTexts.push(extractiveAnswersData.content);
        }
        
        if (extractiveTexts.length > 0) {
          pdfContent = extractiveTexts.join(' ');
          contentSource = `extractive_answers (${extractiveTexts.length} items)`;
          console.log(`Successfully extracted ${extractiveTexts.length} extractive answers`);
        } else {
          console.log('No extractive texts found after processing');
        }
      }
    }
    
    // 4. Extract from snippets (enhanced extraction) - handle nested fields with quality filtering
    if (!pdfContent) {
      const snippetsData = derivedData?.snippets || derivedData?.fields?.snippets;
      if (snippetsData) {
        const allSnippets = extractSnippetsFromPDF(snippetsData);
        
        // Filter and prioritize snippets for better content quality
        const filteredSnippets = filterAndPrioritizeSnippets(allSnippets, query);
        
        if (filteredSnippets.length > 0) {
          // Use multiple relevant snippets for richer context
          pdfContent = filteredSnippets.join(' ');
          contentSource = `${derivedData?.snippets ? 'derivedData.snippets' : 'derivedData.fields.snippets'} (${filteredSnippets.length} filtered)`;
          
          console.log(`Using ${filteredSnippets.length} filtered snippets out of ${allSnippets.length} total`);
          console.log('Filtered snippets:', filteredSnippets.map(s => s.substring(0, 80) + '...'));
        }
      }
    }
    
    // 5. Try any other field that might contain text (fallback)
    if (!pdfContent) {
      const allFields = { ...data, ...derivedData };
      for (const [key, value] of Object.entries(allFields)) {
        if (typeof value === 'string' && value.length > 50 && 
            !key.includes('id') && !key.includes('url') && !key.includes('link')) {
          pdfContent = value;
          contentSource = `fallback.${key}`;
          break;
        }
      }
    }
    
    if (pdfContent) {
      console.log(`Found PDF content from ${contentSource}:`, pdfContent.substring(0, 100) + '...');
    } else {
      console.log(`No PDF content found for result ${index + 1}`, { 
        structDataKeys: Object.keys(data),
        derivedDataKeys: Object.keys(derivedData || {}),
        hasExtractiveAnswers: !!(derivedData?.extractive_answers || derivedData?.fields?.extractive_answers),
        hasSnippets: !!(derivedData?.snippets || derivedData?.fields?.snippets),
        fieldsKeys: derivedData?.fields ? Object.keys(derivedData.fields) : [],
        derivedDataSample: derivedData ? JSON.stringify(derivedData, null, 2).substring(0, 500) : 'null'
      });
    }
    
    // Lower threshold for content inclusion
    if (pdfContent && pdfContent.length > 10) {
      // Limit content to reasonable length for context
      const maxLength = 800;
      const truncatedContent = pdfContent.length > maxLength 
        ? pdfContent.substring(0, maxLength) + '...'
        : pdfContent;
      context += `\n内容: ${truncatedContent}`;
    } else {
      console.log(`No usable content found for PDF result ${index + 1}`);
      // Include minimal context even without content
      context += `\n内容: [内容が取得できませんでした]`;
    }
    
    contextParts.push(context);
  });
  
  return contextParts.join('\n\n');
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
    
    // Enhanced numerical data detection with higher priority
    const numberPatterns = [
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億円]/g,  // Currency amounts
      /\d{1,3}(?:,\d{3})*(?:\.\d+)?％/g,           // Percentages
      /前年(?:同期)?比\s*\d+(?:\.\d+)?％/g,        // Year-over-year comparisons
      /\d+(?:\.\d+)?％[増減]/g,                    // Growth/decline percentages
      /\d{4}年\d{1,2}月期/g                       // Fiscal periods
    ];
    
    let numericalScore = 0;
    numberPatterns.forEach(pattern => {
      const matches = snippet.match(pattern) || [];
      numericalScore += matches.length * 20; // Higher weight for numerical data
    });
    score += numericalScore;
    
    // Enhanced financial terms detection
    const primaryFinancialTerms = ['売上高', '営業利益', '当期純利益', '経常利益'];
    const secondaryFinancialTerms = ['利益', '業績', '前年', '増減', '比較', '百万円', '予想', '実績'];
    
    primaryFinancialTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score += 15; // Higher weight for primary terms
      }
    });
    
    secondaryFinancialTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score += 5;
      }
    });
    
    // Strong penalty for negative/exclusion terms
    const negativeTerms = [
      '省略', '記載を省略', '記載なし', '該当なし', '該当事項はありません', 
      '特に記載すべき事項はありません', '記載すべき事項はない', '該当する事項はありません',
      'ないため', '超えるため'
    ];
    negativeTerms.forEach(term => {
      if (lowerSnippet.includes(term)) {
        score -= 30; // Stronger penalty for exclusion language
      }
    });
    
    // Bonus for complete financial statements format
    if (snippet.includes('百万円') && (snippet.includes('前年') || snippet.includes('増') || snippet.includes('減'))) {
      score += 10; // Bonus for complete financial data
    }
    
    // Penalty for very short snippets (likely incomplete)
    if (snippet.length < 30) {
      score -= 5;
    }
    
    // Bonus for medium-length snippets (likely complete sentences)
    if (snippet.length >= 50 && snippet.length <= 300) {
      score += 3;
    }
    
    console.log(`Snippet ${index + 1} score: ${score}, content: "${snippet.substring(0, 100)}..."`);
    
    return {
      snippet,
      score,
      index
    };
  });
  
  // Sort by score (highest first) and filter out negative scores
  const filteredAndSorted = scoredSnippets
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  
  console.log(`Filtered to ${filteredAndSorted.length} relevant snippets`);
  
  // Return top relevant snippets (3-5 for richer context)
  const topSnippets = filteredAndSorted
    .slice(0, 5) // Increased from 3 to 5 for more comprehensive context
    .map(item => item.snippet);
  
  // Enhanced fallback strategy
  if (topSnippets.length === 0 && snippets.length > 0) {
    console.log('No positively scored snippets found, analyzing for fallback...');
    
    // Try to find snippets with at least numerical data, even if they have negative terms
    const numericalSnippets = snippets.filter(snippet => {
      const hasNumbers = /\d{1,3}(?:,\d{3})*(?:\.\d+)?[百千万億円％%]/.test(snippet);
      const hasFinancialTerms = ['売上高', '利益', '業績'].some(term => snippet.toLowerCase().includes(term));
      return hasNumbers || hasFinancialTerms;
    });
    
    if (numericalSnippets.length > 0) {
      console.log(`Using ${numericalSnippets.length} numerical snippets as fallback`);
      return numericalSnippets.slice(0, 3);
    }
    
    // Last resort: use first snippet
    console.log('Using first snippet as last resort fallback');
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

回答の要件:
- Q&A文書と PDF資料の両方の情報を活用してください
- Q&A文書に直接的な回答がある場合は、それを優先してください
- PDF資料からは具体的な数値や事実データを重視してください
- 「省略」「記載なし」等の否定的情報は回答に含めず、肯定的な具体的情報を探してください
- 企業名や数値は正確に記載してください（百万円、％、前年比等も含む）
- 複数の関連情報がある場合は、それらを統合して包括的な回答を作成してください
- 情報源（Q&A文書またはPDF資料）を明記してください
- 不確実な情報については推測しないでください
- 決算資料からの情報の場合は「決算資料によると」等の前置きを付けてください
- 丁寧で専門的な日本語で回答してください

特に重要: PDF資料には表や図表の数値データが含まれています。「記載を省略」等の記述ではなく、具体的な数値や業績データを優先して回答に含めてください。

回答形式の例:
1. Q&Aデータから直接回答できる場合:
   「[回答内容]（Q&Aデータより）」

2. PDF資料から補完する場合:
   「[Q&A回答] 
   
   また、決算資料によると[PDF内容による補完情報]があります。」

3. PDF資料のみから回答する場合:
   「決算資料によると、[具体的な数値や実績データ]です。」

質問: ${query}${conversationContext}

上記のコンテキスト情報に基づいて、質問に対する適切な回答を生成してください。肯定的で具体的な情報を中心に回答を構成してください。`;
}