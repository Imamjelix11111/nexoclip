import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Cancellation is not supported by the BytePlus API' },
    { status: 409 },
  )
}
