import { NextRequest } from 'next/server';

import { listMapFiles, MapFileError } from './_lib/ts-chunk-utils';

const errorResponse = (error: unknown): Response => {
  if (error instanceof MapFileError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error('Unhandled error in /api/maps', error);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
};

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const files = await listMapFiles();
    return Response.json({ files });
  } catch (error) {
    return errorResponse(error);
  }
}
