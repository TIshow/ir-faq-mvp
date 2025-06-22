import { SearchServiceClient } from '@google-cloud/discoveryengine';
import { config } from '../config/env';
import { getGoogleAuth } from './gcp-auth';

let searchClient: SearchServiceClient | null = null;

export function getDiscoveryEngineClient(): SearchServiceClient {
  if (!searchClient) {
    const auth = getGoogleAuth();
    searchClient = new SearchServiceClient({
      projectId: config.googleCloud.projectId,
      auth: auth
    });
  }
  return searchClient;
}

export interface SearchResult {
  id: string;
  document: {
    id: string;
    structData: {
      question?: string;
      answer?: string;
      title?: string;
      content?: string;
      company?: string;
      category?: string;
      // CSV fields might be different
      [key: string]: unknown;
    };
    derivedStructData?: {
      title?: string;
      extractive_answers?: Array<{
        content?: string;
      }>;
      [key: string]: unknown;
    };
  };
  relevanceScore?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  totalSize: number;
  summary?: string;
}

export async function searchDocuments(query: string, pageSize: number = 10): Promise<SearchResponse> {
  const client = getDiscoveryEngineClient();
  
  const projectPath = client.projectPath(config.googleCloud.projectId);
  const servingConfigPath = `${projectPath}/locations/${config.googleCloud.location}/collections/default_collection/engines/${config.googleCloud.searchEngineId}/servingConfigs/default_search`;

  // Increased pageSize for better snippet variety while preventing timeout
  const limitedPageSize = Math.min(pageSize, 30); // Increased from 20 to 30 for more snippet options

  const request = {
    servingConfig: servingConfigPath,
    query: query,
    pageSize: limitedPageSize,
    // queryExpansionSpec disabled for multi-datastore search to avoid INVALID_ARGUMENT
    // 
    // NOTE: To enable queryExpansionSpec for better search quality, consider:
    // 1. Single-datastore approach: Combine Q&A and PDF data into one datastore
    // 2. Sequential search: Search Q&A first, then PDF if no good results
    // 3. Separate endpoints: Create different search functions for Q&A vs PDF
    //
    // queryExpansionSpec: {
    //   condition: 'AUTO' as const
    // },
    spellCorrectionSpec: {
      mode: 'AUTO' as const
    },
    userInfo: {
      timeZone: 'Asia/Tokyo'
    },
    languageCode: 'ja'
    // No filter to search across all datastores
  };

  try {
    console.log('Discovery Engine request for:', request.query, 'with pageSize:', limitedPageSize);
    
    // Wrap the search call with a timeout promise
    const searchPromise = client.search(request, { autoPaginate: false });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout after 30 seconds')), 30000);
    });
    
    const [response] = await Promise.race([searchPromise, timeoutPromise]) as any;
    
    console.log('Discovery Engine response keys:', Object.keys(response));
    console.log('Response.results length:', (response as any).results?.length || 0);
    console.log('Response.totalSize:', (response as any).totalSize || 0);
    
    // Debug: log response structure (limited to avoid huge logs)
    console.log('Discovery Engine response structure logged (depth limited for performance)');
    
    // Discovery Engine sometimes returns results as indexed properties instead of .results array
    let resultsArray = (response as any).results;
    
    if (!resultsArray || resultsArray.length === 0) {
      // Try to extract results from indexed properties
      const keys = Object.keys(response).filter(key => !isNaN(parseInt(key)));
      console.log('Found numeric keys:', keys);
      
      if (keys.length > 0) {
        resultsArray = keys.map(key => (response as any)[key]);
        console.log('Extracted results from numeric keys:', resultsArray.length);
      }
    }
    
    if (!resultsArray || resultsArray.length === 0) {
      console.log('No results returned from Discovery Engine');
      return { results: [], totalSize: 0, summary: undefined };
    }
    
    console.log('Processing', resultsArray.length, 'results...');
    
    const results: SearchResult[] = [];
    
    for (let i = 0; i < resultsArray.length; i++) {
      const result = resultsArray[i];
      console.log(`Processing result ${i + 1}:`, result.id);
      // Reduced logging to prevent timeout from large log outputs
      console.log(`Result ${i + 1} has document:`, !!result.document);
      
      if (!result.document) {
        console.log('Skipping result - no document');
        continue;
      }
      
      // Extract structured data from Discovery Engine format
      const extractStructData = (structData: { fields?: Record<string, any> }) => {
        if (!structData || !structData.fields) {
          return {};
        }
        
        const extracted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(structData.fields)) {
          // Handle different value types more comprehensively
          if (value && typeof value === 'object') {
            if (value.stringValue) {
              extracted[key] = value.stringValue;
            } else if (value.numberValue !== undefined) {
              extracted[key] = value.numberValue;
            } else if (value.boolValue !== undefined) {
              extracted[key] = value.boolValue;
            } else if (value.listValue) {
              // Handle list values (array of items)
              const listItems = value.listValue.values || [];
              extracted[key] = listItems.map((item: any) => {
                if (item.stringValue) return item.stringValue;
                if (item.numberValue !== undefined) return item.numberValue;
                if (item.boolValue !== undefined) return item.boolValue;
                return item;
              });
            } else if (value.structValue) {
              // Handle nested struct values
              extracted[key] = value.structValue;
            }
          }
        }
        return extracted;
      };
      
      // Enhanced derivedStructData extraction - handle nested fields structure
      const extractDerivedData = (derivedData: any) => {
        if (!derivedData) return {};
        
        const extracted: Record<string, unknown> = {};
        
        // Check if data is nested under 'fields' (common in Discovery Engine responses)
        const dataToProcess = derivedData.fields || derivedData;
        
        // Apply the same extraction logic as structData for nested fields
        if (dataToProcess.fields) {
          // Double-nested structure: derivedData.fields.fields
          for (const [key, value] of Object.entries(dataToProcess.fields)) {
            if (value && typeof value === 'object') {
              if ((value as any).stringValue) {
                extracted[key] = (value as any).stringValue;
              } else if ((value as any).listValue) {
                extracted[key] = (value as any).listValue;
              } else if ((value as any).structValue) {
                extracted[key] = (value as any).structValue;
              } else {
                extracted[key] = value;
              }
            }
          }
        } else {
          // Single-nested or direct structure
          for (const [key, value] of Object.entries(dataToProcess)) {
            if (value && typeof value === 'object') {
              if ((value as any).stringValue) {
                extracted[key] = (value as any).stringValue;
              } else if ((value as any).listValue) {
                extracted[key] = (value as any).listValue;
              } else if ((value as any).structValue) {
                extracted[key] = (value as any).structValue;
              } else {
                extracted[key] = value;
              }
            } else {
              extracted[key] = value;
            }
          }
        }
        
        // Legacy fallback for direct access
        if (derivedData.title) extracted.title = derivedData.title;
        if (derivedData.link) extracted.link = derivedData.link;
        if (derivedData.extractive_answers) extracted.extractive_answers = derivedData.extractive_answers;
        if (derivedData.snippets) extracted.snippets = derivedData.snippets;
        
        return extracted;
      };
      
      const structData = extractStructData(result.document.structData);
      const enhancedDerivedData = extractDerivedData(result.document.derivedStructData);
      
      const processedResult = {
        id: result.id || '',
        document: {
          id: result.document.id || '',
          structData: structData,
          derivedStructData: enhancedDerivedData
        },
        relevanceScore: result.relevanceScore || 0
      };
      
      // Always push results, regardless of content type
      console.log('Extracted structData keys:', Object.keys(structData));
      console.log('derivedStructData keys:', Object.keys(processedResult.document.derivedStructData || {}));
      results.push(processedResult);
    }

    console.log('Total processed results:', results.length);

    return {
      results: results,
      totalSize: (response as any).totalSize || 0,
      summary: (response as any).summary?.summaryText || undefined
    };

  } catch (error) {
    console.error('Discovery Engine search error:', error);
    
    // If timeout or other error, try a simplified search
    if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('DEADLINE_EXCEEDED'))) {
      console.log('Attempting simplified search due to timeout...');
      
      try {
        // Try a much simpler request with smaller pageSize
        const simpleRequest = {
          servingConfig: servingConfigPath,
          query: query,
          pageSize: 5 // Much smaller page size
        };
        
        const simpleSearchPromise = client.search(simpleRequest, { autoPaginate: false });
        const simpleTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Simple search timeout after 15 seconds')), 15000);
        });
        
        const [simpleResponse] = await Promise.race([simpleSearchPromise, simpleTimeoutPromise]) as any;
        
        console.log('Simple search succeeded with', (simpleResponse as any).results?.length || 0, 'results');
        
        // Process simple response with same logic
        let resultsArray = (simpleResponse as any).results;
        if (!resultsArray || resultsArray.length === 0) {
          const keys = Object.keys(simpleResponse).filter(key => !isNaN(parseInt(key)));
          if (keys.length > 0) {
            resultsArray = keys.map(key => (simpleResponse as any)[key]);
          }
        }
        
        if (!resultsArray || resultsArray.length === 0) {
          return { results: [], totalSize: 0, summary: undefined };
        }
        
        const results: SearchResult[] = [];
        for (let i = 0; i < Math.min(resultsArray.length, 5); i++) {
          const result = resultsArray[i];
          if (!result.document) continue;
          
          const extractStructData = (structData: { fields?: Record<string, { stringValue?: string; numberValue?: number; boolValue?: boolean }> }) => {
            if (!structData || !structData.fields) return {};
            const extracted: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(structData.fields)) {
              const fieldValue = value as { stringValue?: string; numberValue?: number; boolValue?: boolean };
              if (fieldValue.stringValue) extracted[key] = fieldValue.stringValue;
              else if (fieldValue.numberValue !== undefined) extracted[key] = fieldValue.numberValue;
              else if (fieldValue.boolValue !== undefined) extracted[key] = fieldValue.boolValue;
            }
            return extracted;
          };
          
          const structData = extractStructData(result.document.structData);
          results.push({
            id: result.id || '',
            document: {
              id: result.document.id || '',
              structData: structData,
              derivedStructData: result.document.derivedStructData || {}
            },
            relevanceScore: result.relevanceScore || 0
          });
        }
        
        return {
          results: results,
          totalSize: (simpleResponse as any).totalSize || 0,
          summary: (simpleResponse as any).summary?.summaryText || undefined
        };
        
      } catch (simpleError) {
        console.error('Simple search also failed:', simpleError);
        return { results: [], totalSize: 0, summary: undefined };
      }
    }
    
    throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}