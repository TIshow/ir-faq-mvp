import { VertexAI } from '@google-cloud/vertexai';
import { config } from '../config/env';
import { getGoogleAuth } from './gcp-auth';

let vertexAI: VertexAI | null = null;

export function getVertexAI(): VertexAI {
  if (!vertexAI) {
    const auth = getGoogleAuth();
    const projectIdentifier = config.googleCloud.projectNumber || config.googleCloud.projectId;
    
    vertexAI = new VertexAI({
      project: projectIdentifier,
      location: config.googleCloud.vertexAiLocation,
      googleAuth: auth
    });
  }
  return vertexAI;
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
  const vertexAI = getVertexAI();
  
  // Get the generative model
  const model = vertexAI.getGenerativeModel({
    model: config.googleCloud.modelName,
    generationConfig: {
      maxOutputTokens: request.maxTokens || 1024,
      temperature: request.temperature || 0.2,
      topP: 0.8,
      topK: 40
    },
    safetySettings: [
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
  });

  const prompt = request.context 
    ? `コンテキスト情報:\n${request.context}\n\n質問: ${request.prompt}`
    : request.prompt;

  try {
    const response = await model.generateContent(prompt);
    
    if (!response.response) {
      throw new Error('No response returned from Vertex AI');
    }

    const candidates = response.response.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('No candidates returned from Vertex AI');
    }

    const candidate = candidates[0];
    const content = candidate.content;
    
    if (!content || !content.parts || content.parts.length === 0) {
      throw new Error('No content parts in Vertex AI response');
    }

    const text = content.parts[0].text || '';
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