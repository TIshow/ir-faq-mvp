import { NextRequest, NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import { config } from '../../../config/env';
import path from 'path';

const keyFilename = path.join(process.cwd(), 'service-account-key.json');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const { projectId, searchEngineId, location } = config.googleCloud;

    console.log('Config values:', {
      projectId,
      searchEngineId,
      location
    });

    // Initialize Google Auth
    const auth = new GoogleAuth({
      keyFilename: keyFilename,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    const authClient = await auth.getClient();
    const accessToken = await authClient.getAccessToken();

    // Build the API endpoint URL based on the official documentation
    const url = `https://discoveryengine.googleapis.com/v1alpha/projects/${projectId}/locations/${location}/collections/default_collection/engines/${searchEngineId}/servingConfigs/default_search:search`;

    console.log('API URL:', url);

    const requestBody = {
      query: query,
      pageSize: 10,
      queryExpansionSpec: {
        condition: "AUTO"
      },
      spellCorrectionSpec: {
        mode: "AUTO"
      },
      languageCode: "ja",
      userInfo: {
        timeZone: "Asia/Tokyo"
      }
    };

    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      throw new Error(`API Error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('API Response:', JSON.stringify(data, null, 2));
    
    return NextResponse.json({
      results: data.results || [],
      totalSize: data.totalSize || 0,
      summary: data.summary || null
    });

  } catch (error: any) {
    console.error('Search error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message 
      },
      { status: 500 }
    );
  }
}