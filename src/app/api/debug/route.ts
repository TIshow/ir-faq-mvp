import { DataStoreServiceClient } from '@google-cloud/discoveryengine';
import { NextResponse } from 'next/server';
import path from 'path';

const keyFilename = path.join(process.cwd(), 'service-account-key.json');

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dataStoreClient = new DataStoreServiceClient({
      keyFilename: keyFilename,
    });

    // Try to list data stores to verify connection using service account project
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'hallowed-trail-462613-v1';
    const location = 'global';
    
    const request = {
      parent: `projects/${projectId}/locations/${location}`
    };

    console.log('Attempting to list data stores with project:', projectId);
    const [dataStores] = await dataStoreClient.listDataStores(request);
    
    return NextResponse.json({
      success: true,
      projectId,
      dataStores: dataStores.map(ds => ({
        name: ds.name,
        displayName: ds.displayName,
        contentConfig: ds.contentConfig
      }))
    });

  } catch (error: unknown) {
    console.error('Debug error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
      details: error && typeof error === 'object' && 'details' in error ? error.details : 'No additional details'
    }, { status: 500 });
  }
}