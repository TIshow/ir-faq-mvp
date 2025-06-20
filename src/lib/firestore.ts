import { Firestore } from '@google-cloud/firestore';
import { config } from '../config/env';

let firestoreInstance: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = new Firestore({
      projectId: config.googleCloud.projectId,
      databaseId: config.googleCloud.firestoreDatabase
      // Uses GOOGLE_APPLICATION_CREDENTIALS environment variable automatically
    });
  }
  return firestoreInstance;
}

// Collection references
export const collections = {
  chatSessions: 'chat_sessions',
  messages: 'messages',
  companies: 'companies',
  documents: 'documents'
} as const;

// Types
export interface ChatSession {
  id: string;
  userId?: string;
  title: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  messageCount: number;
}

export interface Message {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: FirebaseFirestore.Timestamp;
  sources?: DocumentReference[];
  metadata?: {
    company?: string;
    topics?: string[];
    confidence?: number;
  };
}

export interface DocumentReference {
  id: string;
  title: string;
  source: string;
  relevanceScore: number;
}