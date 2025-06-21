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

  const request = {
    servingConfig: servingConfigPath,
    query: query,
    pageSize: pageSize,
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
  };

  try {
    console.log('Discovery Engine request for:', request.query);
    const [response] = await client.search(request);
    
    console.log('Discovery Engine response keys:', Object.keys(response));
    console.log('Response.results length:', (response as any).results?.length || 0);
    
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
      
      if (!result.document) {
        console.log('Skipping result - no document');
        continue;
      }
      
      // Extract structured data from Discovery Engine format
      const extractStructData = (structData: { fields?: Record<string, { stringValue?: string; numberValue?: number; boolValue?: boolean }> }) => {
        if (!structData || !structData.fields) {
          return {};
        }
        
        const extracted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(structData.fields)) {
          const fieldValue = value as { stringValue?: string; numberValue?: number; boolValue?: boolean };
          
          if (fieldValue.stringValue) {
            extracted[key] = fieldValue.stringValue;
          } else if (fieldValue.numberValue !== undefined) {
            extracted[key] = fieldValue.numberValue;
          } else if (fieldValue.boolValue !== undefined) {
            extracted[key] = fieldValue.boolValue;
          }
        }
        return extracted;
      };
      
      const structData = extractStructData(result.document.structData);
      
      const processedResult = {
        id: result.id || '',
        document: {
          id: result.document.id || '',
          structData: structData,
          derivedStructData: result.document.derivedStructData || {}
        },
        relevanceScore: result.relevanceScore || 0
      };
      
      if (structData.question || structData.answer || Object.keys(structData).length > 0) {
        console.log('Extracted data:', Object.keys(structData));
      }
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
    throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}