export const config = {
  googleCloud: {
    projectId: process.env.GCP_PROJECT_ID || 'ir-bot-mvp',
    searchEngineId: process.env.GCP_SEARCH_ENGINE_ID || 'ir-faq-mvp_1749712204113',
    location: process.env.GCP_LOCATION || 'global',
    configId: process.env.GCP_CONFIG_ID || '28e5ce10-d7d8-43ff-81f9-9316d32ac163',
    serviceAccountEmail: process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    workloadIdentityPoolId: process.env.GCP_WORKLOAD_IDENTITY_POOL_ID,
    workloadIdentityPoolProviderId: process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
    projectNumber: process.env.GCP_PROJECT_NUMBER
  }
};