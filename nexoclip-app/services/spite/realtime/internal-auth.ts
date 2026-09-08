import { createHmac } from 'node:crypto'

export interface CanvasAuthorizationPayload {
  userId: string
  projectId: string
  timestamp: number
  nonce: string
}

export const CANVAS_AUTH_MAX_SKEW_SECONDS = 60

const textEncoder = new TextEncoder()

function safeStringEquals(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let result = leftBytes.length ^ rightBytes.length

  for (let index = 0; index < length; index += 1) {
    result |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return result === 0
}

function requireSecret(secret: string): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Canvas authorization secret is required')
  }

  return secret
}

function normalizeTimestamp(timestamp: number): number {
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error('Canvas authorization timestamp must be a safe integer')
  }

  return timestamp
}

function canonicalizePayload(payload: CanvasAuthorizationPayload): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Canvas authorization payload is required')
  }

  const { userId, projectId, timestamp, nonce } = payload

  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('Canvas authorization userId is required')
  }

  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Canvas authorization projectId is required')
  }

  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new Error('Canvas authorization nonce is required')
  }

  return JSON.stringify([userId, projectId, normalizeTimestamp(timestamp), nonce])
}

export function signCanvasAuthorization(payload: CanvasAuthorizationPayload, secret: string): string {
  return createHmac('sha256', requireSecret(secret)).update(canonicalizePayload(payload)).digest('hex')
}

export function verifyCanvasAuthorization(
  payload: CanvasAuthorizationPayload,
  signature: string,
  secret: string,
): boolean {
  if (typeof signature !== 'string') {
    return false
  }

  try {
    const timestamp = normalizeTimestamp(payload?.timestamp)
    const nowSeconds = Math.floor(Date.now() / 1000)

    if (timestamp < nowSeconds - CANVAS_AUTH_MAX_SKEW_SECONDS) {
      return false
    }

    if (timestamp > nowSeconds + CANVAS_AUTH_MAX_SKEW_SECONDS) {
      return false
    }

    const expectedSignature = signCanvasAuthorization(payload, secret)
    return safeStringEquals(expectedSignature, signature)
  } catch {
    return false
  }
}
