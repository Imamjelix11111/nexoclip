import { NextResponse } from 'next/server';
// Provider-neutral boundary. Deployments must inject a verifier and handler before enabling it.
export async function POST() {
  return NextResponse.json({ error: 'No payment provider configured' }, { status: 501 });
}
