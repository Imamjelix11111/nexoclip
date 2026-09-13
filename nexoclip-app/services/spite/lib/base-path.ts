export function withBasePath(
  path: string,
  basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '',
) {
  const base = basePath.replace(/\/$/, '')
  if (!base || !path.startsWith('/') || path === base || path.startsWith(`${base}/`)) {
    return path
  }
  return path === '/' ? base : `${base}${path}`
}

// Durable outputs live in the main NexoClip app, not the Spite app. Do not
// prefix its authenticated asset endpoint with /spite, or Caddy routes it to
// Spite and returns a 404.
export function withGenerationOutputBasePath(path: string) {
  return path.startsWith('/api/assets/') ? path : withBasePath(path)
}
