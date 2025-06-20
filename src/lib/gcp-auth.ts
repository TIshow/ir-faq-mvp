import { GoogleAuth } from 'google-auth-library';
import { config } from '../config/env';

let authInstance: GoogleAuth | null = null;

export function getGoogleAuth(): GoogleAuth {
  if (!authInstance) {
    authInstance = new GoogleAuth({
      projectId: config.googleCloud.projectId,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/cloud-platform.read-only'
      ]
      // Uses GOOGLE_APPLICATION_CREDENTIALS environment variable automatically
    });
  }
  return authInstance;
}

export async function getAuthClient() {
  const auth = getGoogleAuth();
  return await auth.getClient();
}

export async function getAccessToken() {
  const authClient = await getAuthClient();
  const accessToken = await authClient.getAccessToken();
  return accessToken.token;
}