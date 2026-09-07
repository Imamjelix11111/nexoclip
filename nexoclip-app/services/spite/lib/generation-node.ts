import { withBasePath } from './base-path'

export function completeGenerationNode(
  data: Record<string, unknown>,
  outputUrl: string,
): Record<string, unknown> {
  return {
    ...data,
    status: 'completed',
    outputUrl: withBasePath(outputUrl),
    error: null,
    pendingRequestId: undefined,
    pendingProvider: undefined,
    pendingProviderModel: undefined,
    pendingFalEndpoint: undefined,
    pendingStartedAt: undefined,
  }
}
