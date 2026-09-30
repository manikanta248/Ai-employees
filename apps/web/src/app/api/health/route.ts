import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe for uptime monitoring. Deeper checks (database) arrive with the database client. */
export function GET() {
  return NextResponse.json(
    { status: 'ok', time: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
