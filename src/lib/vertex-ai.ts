import { PredictionServiceClient } from '@google-cloud/aiplatform';
import { config } from '../config/env';
import { getGoogleAuth } from './gcp-auth';

let vertexAiClient: PredictionServiceClient | null = null;

export function getVertexAIClient(): PredictionServiceClient {
  if (!vertexAiClient) {
    const auth = getGoogleAuth();
    vertexAiClient = new PredictionServiceClient({
      projectId: config.googleCloud.projectId,
      apiEndpoint: `${config.googleCloud.vertexAiLocation}-aiplatform.googleapis.com`,
      auth: auth
    });
  }
  return vertexAiClient;
}

export interface GenerateTextRequest {
  prompt: string;
  context?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateTextResponse {
  text: string;
  confidence: number;
  finishReason: string;
}

export async function generateTextWithGemini(request: GenerateTextRequest): Promise<GenerateTextResponse> {
  const client = getVertexAIClient();
  
  const instanceValue = {
    contents: [{
      role: 'user',
      parts: [{
        text: request.context 
          ? `コンテキスト情報:\n${request.context}\n\n質問: ${request.prompt}`
          : request.prompt
      }]
    }],
    generation_config: {
      max_output_tokens: request.maxTokens || 1024,
      temperature: request.temperature || 0.2,
      top_p: 0.8,
      top_k: 40
    },
    safety_settings: [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      }
    ]
  };

  const instance = [instanceValue];
  const parameter = {};

  const projectPath = `projects/${config.googleCloud.projectId}/locations/${config.googleCloud.vertexAiLocation}`;
  
  const modelPath = `${projectPath}/publishers/google/models/gemini-1.5-pro`;

  try {
    const [response] = await client.predict({
      endpoint: modelPath,
      instances: instance,
      parameters: parameter
    });

    if (!response.predictions || response.predictions.length === 0) {
      throw new Error('No predictions returned from Vertex AI');
    }

    const prediction = response.predictions[0] as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string; citationMetadata?: unknown }> };
    
    // Extract response text from Gemini response structure
    const candidates = prediction.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('No candidates in Vertex AI response');
    }

    const candidate = candidates[0];
    const content = candidate.content;
    
    if (!content || !content.parts || content.parts.length === 0) {
      throw new Error('No content parts in Vertex AI response');
    }

    const text = content.parts[0].text;
    const finishReason = candidate.finishReason || 'STOP';
    
    // Calculate confidence score (simplified)
    const confidence = candidate.citationMetadata ? 0.9 : 0.7;

    return {
      text: text,
      confidence: confidence,
      finishReason: finishReason
    };

  } catch (error) {
    console.error('Vertex AI generation error:', error);
    throw new Error(`Failed to generate text: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}