export type BytePlusTrustStatus = 'not_trusted' | 'processing' | 'active' | 'failed'

export interface BytePlusTrustState {
  status: BytePlusTrustStatus
  error?: { code?: string; message?: string }
}

export function bytePlusTrustUrl(assetId: string) {
  return `/api/assets/${encodeURIComponent(assetId)}/byteplus-trust`
}

export function safeBytePlusTrustError(error?: { code?: string; message?: string }) {
  return error?.code === 'BYTEPLUS_ASSETS_NOT_CONFIGURED'
    ? 'BytePlus trusted assets are not configured. Ask an administrator to complete setup.'
    : 'Could not trust this image. Try again.'
}

export function trustForSeedanceView(type: string, state: BytePlusTrustState) {
  if (type !== 'image') return null

  if (state.status === 'processing') {
    return { label: 'Trusting for Seedance', action: 'Trusting…', disabled: true }
  }
  if (state.status === 'active') {
    return { label: 'Trusted for Seedance', action: null, disabled: true }
  }
  if (state.status === 'failed') {
    return {
      label: 'Trust failed',
      action: 'Retry trust',
      disabled: false,
      message: safeBytePlusTrustError(state.error),
    }
  }
  return { label: 'Not trusted for Seedance', action: 'Trust for Seedance', disabled: false }
}

export function shouldPollBytePlusTrust({
  detailVisible,
  type,
  status,
}: {
  detailVisible: boolean
  type?: string
  status?: BytePlusTrustStatus
}) {
  return detailVisible && type === 'image' && status === 'processing'
}

export function applyBytePlusTrustState<T extends { id: string; byteplus_trust?: BytePlusTrustState }>(
  assets: T[] | undefined,
  assetId: string,
  state: BytePlusTrustState,
) {
  return assets?.map(asset => asset.id === assetId ? { ...asset, byteplus_trust: state } : asset)
}

export async function requestBytePlusTrust(
  assetId: string,
  method: 'GET' | 'POST',
  fetchFn: typeof fetch = fetch,
): Promise<BytePlusTrustState> {
  const response = await fetchFn(bytePlusTrustUrl(assetId), { method })
  const payload = await response.json().catch(() => ({})) as {
    status?: BytePlusTrustStatus
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    return { status: 'failed', error: { code: payload.error?.code } }
  }
  if (!['not_trusted', 'processing', 'active', 'failed'].includes(payload.status ?? '')) {
    return { status: 'failed' }
  }
  return { status: payload.status!, error: payload.error && { code: payload.error.code } }
}
