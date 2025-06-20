export const config = {
  googleCloud: {
    projectId: process.env.GCP_PROJECT_ID || 'hallowed-trail-462613-v1',
    location: process.env.GCP_LOCATION || 'global',
    
    // Discovery Engine
    searchEngineId: process.env.GCP_SEARCH_ENGINE_ID || 'ir-bot-mvp-app_1750418304373',
    
    // Vertex AI
    vertexAiLocation: process.env.GCP_VERTEX_AI_LOCATION || 'us-central1',
    
    // Firestore
    firestoreDatabase: process.env.GCP_FIRESTORE_DATABASE || '(default)'
  },
  
  app: {
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000
  }
};

export const isProduction = config.app.environment === 'production';
export const isDevelopment = config.app.environment === 'development';