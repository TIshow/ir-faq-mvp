import { SearchServiceClient } from '@google-cloud/discoveryengine';
import { NextResponse } from 'next/server';
import path from 'path';

const keyFilename = path.join(process.cwd(), 'service-account-key.json');

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const searchClient = new SearchServiceClient({
      keyFilename: keyFilename,
    });

    // Try to list data stores to verify connection using service account project
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'hallowed-trail-462613-v1';
    const location = 'global';
    
    const request = {
      parent: `projects/${projectId}/locations/${location}`
    };

    console.log('Attempting to list data stores with project:', projectId);
    const [dataStores] = await searchClient.listDataStores(request);
    
    return NextResponse.json({
      success: true,
      projectId,
      dataStores: dataStores.map(ds => ({
        name: ds.name,
        displayName: ds.displayName,
        contentConfig: ds.contentConfig
      }))
    });

  } catch (error: any) {
    console.error('Debug error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details || 'No additional details'
    }, { status: 500 });
  }
}