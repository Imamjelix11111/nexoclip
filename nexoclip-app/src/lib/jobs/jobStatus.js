export const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

export function isTransientPollFailure(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
