import { searchDocuments, SearchResult } from './discovery-engine';
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
  const { query, conversationHistory = [], maxResults = 10, companyId } = request;
  
  console.log('=== RAG Query Analysis ===');
  console.log('Query:', query);
  console.log('Company ID:', companyId);

  try {
    // Step 1: Search for relevant documents using Discovery Engine
    const searchResponse = await searchDocuments(query, maxResults, companyId);
    console.log('Search response received:', {
      resultsCount: searchResponse.results.length,
      totalSize: searchResponse.totalSize,
      hasSummary: !!searchResponse.summary
    });
    
    // Step 2: Use Discovery Engine summary if available (Preview版と同等)
    if (searchResponse.summary && searchResponse.summary.trim().length > 0) {
      console.log('Using Discovery Engine summary (Preview equivalent):', searchResponse.summary);
      
      // Build sources from search results
      const sources = searchResponse.results.map((result: any) => {
        const data = result.document.structData;
        const derivedData = result.document.derivedStructData;
        
        return {
          id: result.document.id,
          title: data.question || derivedData?.title || 'タイトルなし',
          source: data.company || derivedData?.link || '情報源不明',
          relevanceScore: result.relevanceScore || 0
        };
      });
      
      return {
        answer: searchResponse.summary,
        sources: sources,
        confidence: 0.9, // High confidence for Discovery Engine summary
        searchResultsCount: searchResponse.results.length
      };
    }
    
    // Step 3: Fallback if no summary available
    if (searchResponse.results.length === 0) {
      return {
        answer: '申し訳ございませんが、お尋ねの内容に関する情報が見つかりませんでした。別の質問や、より具体的な企業名・トピックを含めて再度お試しください。',
        sources: [],
        confidence: 0,
        searchResultsCount: 0
      };
    }

    // Step 4: Check for exact Q&A match as fallback
    for (const result of searchResponse.results) {
      const data = result.document.structData;
      
      if (data.question && data.answer) {
        const originalQuestion = data.question.toLowerCase().trim();
        const userQuery = query.toLowerCase().trim();
        
        // Check exact match
        const exactMatch = originalQuestion === userQuery;
        
        // Check similarity
        const originalWords = originalQuestion.replace(/[？。、！]/g, '').split(/\s+/);
        const queryWords = userQuery.replace(/[？。、！]/g, '').split(/\s+/);
        
        const matchingWords = originalWords.filter(word => 
          queryWords.some(qWord => word.includes(qWord) || qWord.includes(word))
        );
        const similarity = matchingWords.length / Math.max(originalWords.length, queryWords.length);
        
        // Return direct answer for exact match or good similarity
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

    // Step 5: Extract PDF snippet data when no summary available
    const pdfSnippets = extractPDFSnippets(searchResponse.results, query);
    
    if (pdfSnippets.length > 0) {
      console.log('Found PDF snippets, generating financial answer:', pdfSnippets);
      
      const sources = searchResponse.results.map((result: any) => {
        const data = result.document.structData;
        const derivedData = result.document.derivedStructData;
        return {
          id: result.document.id,
          title: derivedData?.title || data.question || 'タイトルなし',
          source: derivedData?.link || data.company || '情報源不明',
          relevanceScore: result.relevanceScore || 0
        };
      });

      return {
        answer: generateFinancialAnswer(pdfSnippets, query),
        sources: sources,
        confidence: 0.8,
        searchResultsCount: searchResponse.results.length
      };
    }

    // Step 6: Fallback to Q&A answers if available
    const fallbackAnswer = searchResponse.results
      .filter(result => result.document.structData.answer)
      .slice(0, 2)
      .map(result => result.document.structData.answer)
      .join('\n\n');

    if (fallbackAnswer) {
      const sources = searchResponse.results.map((result: any) => {
        const data = result.document.structData;
        return {
          id: result.document.id,
          title: data.question || 'タイトルなし',
          source: data.company || '情報源不明',
          relevanceScore: result.relevanceScore || 0
        };
      });

      return {
        answer: `関連情報をお答えします：\n\n${fallbackAnswer}`,
        sources: sources,
        confidence: 0.6,
        searchResultsCount: searchResponse.results.length
      };
    }

    // No useful results found
    return {
      answer: '申し訳ございませんが、お尋ねの内容に関する十分な情報が見つかりませんでした。より具体的な質問をしていただけますでしょうか。',
      sources: [],
      confidence: 0,
      searchResultsCount: searchResponse.results.length
    };

  } catch (error) {
    console.error('RAG generation error:', error);
    throw new Error(`RAG response generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract PDF snippets from search results
 */
function extractPDFSnippets(results: SearchResult[], query: string): string[] {
  const snippets: string[] = [];
  
  results.forEach((result, index) => {
    const derivedData = result.document.derivedStructData;
    console.log(`Processing result ${index + 1} for PDF snippets:`, derivedData);
    
    // Extract snippets from the structure we see in the logs
    const snippetsData = derivedData?.snippets;
    console.log(`Snippets data structure:`, JSON.stringify(snippetsData, null, 2));
    
    // The discovery-engine.ts processes listValue and stores it as the snippets value
    // So we need to check if snippetsData itself has a values array
    if (snippetsData?.values && Array.isArray(snippetsData.values)) {
      console.log(`Found ${snippetsData.values.length} snippet values in processed format`);
      
      snippetsData.values.forEach((value: any, i: number) => {
        console.log(`Processing snippet value ${i + 1}:`, JSON.stringify(value, null, 2));
        
        let snippetText = '';
        
        // Handle the structValue format from the logs
        if (value?.structValue?.fields?.snippet?.stringValue) {
          snippetText = value.structValue.fields.snippet.stringValue;
          console.log(`Found snippet text from structValue: "${snippetText}"`);
        } else if (typeof value === 'string') {
          snippetText = value;
          console.log(`Found snippet text from direct string: "${snippetText}"`);
        } else if (value?.snippet) {
          snippetText = value.snippet;
          console.log(`Found snippet text from snippet field: "${snippetText}"`);
        }
        
        if (snippetText && snippetText.length > 10) {
          console.log(`Snippet ${i + 1}: "${snippetText}"`);
          
          // Clean HTML tags and decode HTML entities
          const cleanedSnippet = snippetText
            .replace(/<[^>]*>/g, '') // Remove HTML tags like <b>
            .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
            .replace(/&amp;/g, '&')  // Replace &amp; with &
            .replace(/&lt;/g, '<')   // Replace &lt; with <
            .replace(/&gt;/g, '>')   // Replace &gt; with >
            .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
            .trim();
          
          if (cleanedSnippet.length > 10) {
            snippets.push(cleanedSnippet);
            console.log(`✓ Added snippet: "${cleanedSnippet}"`);
          }
        }
      });
    } else {
      console.log('No snippets.values found, checking alternative formats...');
      console.log('Available snippetsData keys:', Object.keys(snippetsData || {}));
      
      // If snippetsData is the listValue object directly
      if (snippetsData && typeof snippetsData === 'object') {
        // Check if it's the raw listValue structure 
        if (snippetsData.values && Array.isArray(snippetsData.values)) {
          console.log(`Found direct values array with ${snippetsData.values.length} items`);
          
          snippetsData.values.forEach((value: any, i: number) => {
            console.log(`Processing direct value ${i + 1}:`, JSON.stringify(value, null, 2));
            
            let snippetText = '';
            
            if (value?.structValue?.fields?.snippet?.stringValue) {
              snippetText = value.structValue.fields.snippet.stringValue;
            } else if (typeof value === 'string') {
              snippetText = value;
            } else if (value?.snippet) {
              snippetText = value.snippet;
            }
            
            if (snippetText && snippetText.length > 10) {
              console.log(`Direct snippet ${i + 1}: "${snippetText}"`);
              
              const cleanedSnippet = snippetText
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/\s+/g, ' ')
                .trim();
              
              if (cleanedSnippet.length > 10) {
                snippets.push(cleanedSnippet);
                console.log(`✓ Added direct snippet: "${cleanedSnippet}"`);
              }
            }
          });
        }
      }
    }
  });
  
  console.log(`Extracted ${snippets.length} PDF snippets total`);
  return snippets;
}

/**
 * Generate financial answer from PDF snippets
 */
function generateFinancialAnswer(snippets: string[], query: string): string {
  console.log('Generating financial answer from snippets:', snippets);
  
  const queryLower = query.toLowerCase();
  
  // For 営業利益 queries, use the exact log data we see
  if (queryLower.includes('営業利益')) {
    for (const snippet of snippets) {
      console.log(`Analyzing snippet for 営業利益: "${snippet}"`);
      
      // Look for the table format we see in the logs:
      // "... 利益 900,878 935,873 販売費及び一般管理費 549,952 621,065 営業利益 350,925 314,807 営業外収益 ..."
      const tablePattern = /営業利益\s+(\d{1,3}(?:,\d{3})*)\s+(\d{1,3}(?:,\d{3})*)/;
      const tableMatch = snippet.match(tablePattern);
      
      if (tableMatch) {
        const previousYear = tableMatch[1];
        const currentYear = tableMatch[2];
        
        console.log(`Found table format: previous=${previousYear}, current=${currentYear}`);
        
        // Calculate percentage change
        const prevValue = parseInt(previousYear.replace(/,/g, ''));
        const currValue = parseInt(currentYear.replace(/,/g, ''));
        const changePercent = ((currValue - prevValue) / prevValue * 100).toFixed(1);
        
        // Determine if it's thousands or millions based on context
        const unit = snippet.includes('百万円') ? '百万円' : '千円';
        
        let answer = '';
        
        if (unit === '千円') {
          // Convert to 百万円 for better readability
          const currentMillions = Math.round(currValue / 1000);
          answer = `当中間連結会計期間の営業利益は${currentMillions}百万円でした。`;
        } else {
          answer = `当期の営業利益は${currentYear}${unit}でした。`;
        }
        
        // Add year-over-year comparison
        const changeType = currValue > prevValue ? '増加' : '減少';
        answer += ` これは前年同期比で${Math.abs(parseFloat(changePercent))}%の${changeType}です。`;
        
        // Add context about previous year
        if (unit === '千円') {
          const prevMillions = Math.round(prevValue / 1000);
          answer += ` 前中間連結会計期間の営業利益は${prevMillions}百万円でした。`;
        }
        
        return answer;
      }
      
      // Alternative pattern for single value
      const singlePattern = /営業利益\s*[：:]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/;
      const singleMatch = snippet.match(singlePattern);
      
      if (singleMatch) {
        const value = singleMatch[1];
        const unit = snippet.includes('百万円') ? '百万円' : snippet.includes('千円') ? '千円' : '';
        
        let answer = `営業利益は${value}${unit}です。`;
        
        // Look for year-over-year comparison in the same snippet
        const yoyPattern = /前年同期比.*?(\d+(?:\.\d+)?%)/;
        const yoyMatch = snippet.match(yoyPattern);
        
        if (yoyMatch) {
          answer += ` これは前年同期比${yoyMatch[1]}です。`;
        }
        
        return answer;
      }
    }
  }
  
  // For other financial queries, use general patterns
  const financialPatterns = {
    営業利益: /営業利益\s*[：:]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g,
    売上高: /売上高\s*[：:]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g,
    当期純利益: /当期純利益\s*[：:]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g,
    経常利益: /経常利益\s*[：:]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g
  };
  
  const extractedData: { [key: string]: string[] } = {};
  
  // Extract specific financial data based on query
  for (const snippet of snippets) {
    for (const [term, pattern] of Object.entries(financialPatterns)) {
      if (queryLower.includes(term.toLowerCase())) {
        const matches = snippet.match(pattern);
        if (matches) {
          if (!extractedData[term]) extractedData[term] = [];
          matches.forEach(match => {
            if (!extractedData[term].includes(match)) {
              extractedData[term].push(match);
            }
          });
        }
      }
    }
  }
  
  console.log('Extracted financial data:', extractedData);
  
  // Generate answer based on extracted data
  if (Object.keys(extractedData).length > 0) {
    let answer = '';
    
    for (const [term, values] of Object.entries(extractedData)) {
      if (values.length > 0) {
        const contextSnippets = snippets.filter(snippet => 
          values.some(value => snippet.includes(value))
        );
        
        if (contextSnippets.length > 0) {
          const contextSnippet = contextSnippets[0];
          const unit = contextSnippet.includes('百万円') ? '百万円' : contextSnippet.includes('千円') ? '千円' : '';
          
          answer += `${term}は${values[0]}${unit}です。`;
          
          // Look for year-over-year comparison
          const yoyPattern = /前年同期比.*?(\d+(?:\.\d+)?%)/;
          const yoyMatch = contextSnippet.match(yoyPattern);
          
          if (yoyMatch) {
            answer += ` これは前年同期比${yoyMatch[1]}です。`;
          }
        }
      }
    }
    
    if (answer) {
      return answer;
    }
  }
  
  // Fallback: return the most relevant snippet with context
  const relevantSnippet = snippets.find(snippet => 
    Object.keys(financialPatterns).some(term => 
      queryLower.includes(term.toLowerCase()) && snippet.includes(term)
    )
  ) || snippets[0];
  
  if (relevantSnippet) {
    return `決算資料によると、${relevantSnippet}`;
  }
  
  return '申し訳ございませんが、お尋ねの内容に関する十分な情報が見つかりませんでした。';
}