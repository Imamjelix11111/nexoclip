import { createHash, createHmac } from 'node:crypto'

export interface CanvasAuthorizationPayload {
  userId: string
  projectId: string
  timestamp: number
  nonce: string
  actionDigest?: string
}

export const CANVAS_AUTH_MAX_SKEW_SECONDS = 60

const textEncoder = new TextEncoder()

export function constantTimeEqual(left: string, right: string): boolean {
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

  const { userId, projectId, timestamp, nonce, actionDigest } = payload

  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('Canvas authorization userId is required')
  }

  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Canvas authorization projectId is required')
  }

  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new Error('Canvas authorization nonce is required')
  }

  const parts = [userId, projectId, normalizeTimestamp(timestamp), nonce]
  if (typeof actionDigest !== 'undefined') {
    if (typeof actionDigest !== 'string' || actionDigest.length === 0) {
      throw new Error('Canvas authorization actionDigest must be a non-empty string when provided')
    }
    parts.push(actionDigest)
  }

  return JSON.stringify(parts)
}

export function createCanvasAuthorizationActionDigest(value: Record<string, unknown>): string {
  const normalized = JSON.parse(JSON.stringify(value)) as JsonValue
  return createHash('sha256').update(canonicalizeJson(normalized)).digest('hex')
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
    return constantTimeEqual(expectedSignature, signature)
  } catch {
    return false
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalizeJson(nested)}`).join(',')}}`
}
