import { NextResponse } from 'next/server'

export async function POST() {
  const providers = {
    google: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    byteplus: Boolean(process.env.BYTEPLUS_API_KEY),
  }
  return NextResponse.json({
    connected: Object.values(providers).every(Boolean),
    providers,
    note: 'Credential presence verified. Validity is confirmed on generation.',
  })
}
