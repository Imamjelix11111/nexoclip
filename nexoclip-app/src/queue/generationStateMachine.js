export const GENERATION_STATES = ['queued', 'running', 'processing', 'succeeded', 'failed'];

const TRANSITIONS = {
  queued: new Set(['running']),
  running: new Set(['processing', 'succeeded', 'failed']),
  processing: new Set(['succeeded', 'failed']),
  succeeded: new Set(),
  failed: new Set(),
};

export class GenerationTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid generation transition: ${from} -> ${to}`);
    this.name = 'GenerationTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function transitionGeneration(from, to) {
  if (!TRANSITIONS[from]?.has(to)) throw new GenerationTransitionError(from, to);
  return to;
}

export function isRetryableFailure(error = {}) {
  if (error.retryable !== undefined) return error.retryable === true;
  return ['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'GENERATION_TIMEOUT'].includes(error.code);
}

export function retryDelayMs(attempt, { baseDelayMs = 1000, maxDelayMs = 60000 } = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}
