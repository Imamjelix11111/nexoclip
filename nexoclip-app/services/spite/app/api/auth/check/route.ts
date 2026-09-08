import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser, createRequestAuthenticationChecker } from '@/lib/main-session'
import { isSessionValid } from '@/lib/sessions'

interface AuthCheckDeps {
  getAuthenticatedUser?: typeof getAuthenticatedUser
  isSessionValid?: typeof isSessionValid
}

export function createAuthCheckHandler(deps: AuthCheckDeps = {}) {
  const isAuthenticatedRequest = createRequestAuthenticationChecker({
    getAuthenticatedUser: deps.getAuthenticatedUser,
    isSessionValid: deps.isSessionValid,
  })

  return async function GET(request: Request | NextRequest) {
    if (await isAuthenticatedRequest(request)) {
      return NextResponse.json({ authenticated: true })
    }
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
}

const GET_HANDLER = createAuthCheckHandler()

export async function GET(request: NextRequest) {
  return GET_HANDLER(request)
}
