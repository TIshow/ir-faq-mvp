import { NextRequest, NextResponse } from 'next/server';
import { searchDocuments } from '@/lib/discovery-engine';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { query, pageSize = 10 } = await request.json();
    
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    console.log('Search request:', { query, pageSize });

    const searchResponse = await searchDocuments(query, pageSize);
    
    return NextResponse.json({
      results: searchResponse.results,
      totalSize: searchResponse.totalSize,
      summary: searchResponse.summary
    });

  } catch (error: unknown) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}