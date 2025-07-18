import { NextRequest, NextResponse } from 'next/server';
import { generateEnhancedRAGResponse, ConversationMessage } from '@/lib/enhanced-rag-service';
import { getFirestore, collections } from '@/lib/firestore';
import { Timestamp, FieldValue } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

interface ChatRequest {
  message: string;
  sessionId?: string;
  conversationHistory?: ConversationMessage[];
  companyId?: string;
  generateFollowUp?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, conversationHistory = [], companyId, generateFollowUp = false }: ChatRequest = await request.json();
    
    if (!message || message.trim() === '') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // 企業IDのバリデーション
    if (!companyId) {
      return NextResponse.json({ error: '企業を選択してください' }, { status: 400 });
    }

    // Generate Enhanced RAG response with company context
    const ragResponse = await generateEnhancedRAGResponse({
      query: message,
      conversationHistory: conversationHistory,
      maxResults: 10,
      companyId: companyId,
      generateFollowUp: generateFollowUp
    });

    // Save to Firestore if sessionId is provided
    let currentSessionId = sessionId;
    if (currentSessionId) {
      const firestore = getFirestore();
      
      try {
        // Create or update session
        if (!sessionId) {
          currentSessionId = uuidv4();
          const sessionData = {
            title: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            messageCount: 2 // user + assistant
          };
          
          await firestore.collection(collections.chatSessions).doc(currentSessionId).set(sessionData);
        } else {
          // Update existing session
          await firestore.collection(collections.chatSessions).doc(currentSessionId).update({
            updatedAt: Timestamp.now(),
            messageCount: FieldValue.increment(2)
          });
        }

        // Save user message
        const userMessage = {
          sessionId: currentSessionId,
          type: 'user',
          content: message,
          timestamp: Timestamp.now()
        };
        
        await firestore.collection(collections.messages).add(userMessage);

        // Save assistant message
        const assistantMessage = {
          sessionId: currentSessionId,
          type: 'assistant',
          content: ragResponse.answer,
          timestamp: Timestamp.now(),
          sources: ragResponse.sources,
          metadata: {
            confidence: ragResponse.confidence,
            topics: extractTopicsFromSources(ragResponse.sources),
            processingSteps: ragResponse.processingSteps,
            followUpQuestions: ragResponse.followUpQuestions
          }
        };
        
        await firestore.collection(collections.messages).add(assistantMessage);
        
        console.log('Messages saved to Firestore');
      } catch (firestoreError) {
        console.error('Firestore save error:', firestoreError);
        // Continue without saving - don't fail the entire request
      }
    }

    return NextResponse.json({
      message: ragResponse.answer,
      sources: ragResponse.sources,
      confidence: ragResponse.confidence,
      searchResultsCount: ragResponse.searchResultsCount,
      followUpQuestions: ragResponse.followUpQuestions,
      processingSteps: ragResponse.processingSteps,
      sessionId: currentSessionId,
      companyId: companyId
    });

  } catch (error: unknown) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function extractTopicsFromSources(sources: { source?: string }[]): string[] {
  const topics = new Set<string>();
  
  sources.forEach(source => {
    if (source.source && source.source !== '情報源不明') {
      topics.add(source.source);
    }
  });
  
  return Array.from(topics);
}