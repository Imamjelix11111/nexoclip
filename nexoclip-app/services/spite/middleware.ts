import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkRequiredEnv } from '@/lib/env-check'
import { SESSION_COOKIE_NAME, isSessionValid } from '@/lib/sessions'
import { withBasePath } from '@/lib/base-path'
import { getAuthenticatedUser } from '@/lib/main-session'

// Paths that must stay reachable without a login cookie.
// - /login: the login page itself
// - /setup: shown when required env vars are missing
// - /api/auth/verify + /api/auth/logout: the login/logout endpoints
// - /api/assets/cleanup: scheduled cleanup job, auth via CRON_SECRET
// - /api/r2-image: media proxy, does its own cookie-or-signed-token check
const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/api/auth/verify',
  '/api/auth/logout',
  '/api/assets/cleanup',
  '/api/r2-image',
]

function sanitizedHeaders(headers: Headers) {
  const nextHeaders = new Headers(headers)
  nextHeaders.delete('x-nexoclip-user-id')
  nextHeaders.delete('x-nexoclip-user-verified')
  return nextHeaders
}

export async function middleware(request: NextRequest) {
  const forwardedHeaders = sanitizedHeaders(request.headers)
  const { pathname } = request.nextUrl
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '')
  const appPath = basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? pathname.slice(basePath.length) || '/'
    : pathname

  if (appPath.startsWith('/api/internal/')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // First gate: refuse to boot if required env vars are missing. Sends
  // every request to /setup until the install is configured, so a
  // self-hoster sees clear instructions instead of a broken-looking
  // login screen. The /setup page itself, and Next.js static asset
  // requests, are allowed through so the page can render.
  const envCheck = checkRequiredEnv()
  if (!envCheck.ok) {
    if (appPath === '/setup' || appPath.startsWith('/_next/')) {
      return NextResponse.next({ request: { headers: forwardedHeaders } })
    }
    if (appPath.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Setup required', missing: envCheck.missing },
        { status: 503 },
      )
    }
    return NextResponse.redirect(new URL(withBasePath('/setup', basePath), request.url))
  }

  // Accept either the legacy SPITE login cookie or a valid same-origin
  // nexoclip session from the main app.
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const [mainUser, isSpiteSessionAuthenticated] = await Promise.all([
    getAuthenticatedUser(request),
    isSessionValid(token),
  ])
  const isAuthenticated = Boolean(mainUser) || isSpiteSessionAuthenticated

  const isPublic = PUBLIC_PATHS.some(
    (p) => appPath === p || appPath.startsWith(p + '/'),
  )

  if (isAuthenticated) {
    // Already logged in: bounce away from the login/setup pages.
    if (appPath === '/login' || appPath === '/setup') {
      return NextResponse.redirect(new URL(withBasePath('/', basePath), request.url))
    }
    return NextResponse.next({ request: { headers: forwardedHeaders } })
  }

  // Not logged in:
  if (isPublic) {
    return NextResponse.next({ request: { headers: forwardedHeaders } })
  }

  // Block API routes with a clear 401 (no HTML redirect for data calls).
  if (appPath.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Block pages by sending them to the login screen.
  return NextResponse.redirect(new URL(withBasePath('/login', basePath), request.url))
}

export const config = {
  matcher: [
    '/',
    // Run on everything except Next.js internals and static asset files.
    // The image-extension exemption is anchored to `$` — paths like
    // `/api/r2-image/foo.png/extra` still go through middleware because
    // they don't END in an image extension. Without the anchor, any
    // route containing `.png` (or .svg, .jpg, etc.) anywhere in its
    // path would silently skip authz.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
