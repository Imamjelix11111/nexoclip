import type { CSSProperties, ReactNode } from 'react'
import { CircleNotch } from '@phosphor-icons/react'

export type FeedbackGenerationStatus = 'idle' | 'submitting' | 'in_queue' | 'in_progress' | 'completed' | 'failed'

export type GenerationFeedbackState = {
  isActive: boolean
  isRegenerating: boolean
  isFailedRegeneration: boolean
  frameStyle: CSSProperties
}

const REGENERATION_FRAME_STYLE: CSSProperties = {
  border: '1.5px solid rgba(245,158,11,0.9)',
  boxShadow: '0 0 0 1px rgba(245,158,11,0.2), 0 0 24px rgba(245,158,11,0.25)',
}

const FAILED_REGENERATION_FRAME_STYLE: CSSProperties = {
  border: '1.5px solid rgba(239,68,68,0.9)',
  boxShadow: '0 0 0 1px rgba(239,68,68,0.2), 0 0 24px rgba(239,68,68,0.25)',
}

const ACTIVE_STATUSES = new Set<FeedbackGenerationStatus>(['submitting', 'in_queue', 'in_progress'])

export function getGenerationFeedbackState(input: {
  status: FeedbackGenerationStatus
  hasOutput: boolean
}): GenerationFeedbackState {
  const isActive = ACTIVE_STATUSES.has(input.status)
  const isRegenerating = isActive && input.hasOutput
  const isFailedRegeneration = input.status === 'failed' && input.hasOutput

  return {
    isActive,
    isRegenerating,
    isFailedRegeneration,
    frameStyle: isRegenerating ? REGENERATION_FRAME_STYLE : isFailedRegeneration ? FAILED_REGENERATION_FRAME_STYLE : {},
  }
}

export function isTerminalGenerationStatus(status: unknown): boolean {
  return status === 'completed' || status === 'failed'
}

export function getTerminalGenerationToast(input: {
  mediaKind: 'image' | 'video'
  generationId: string | null
  generationStatus: unknown
  error: string | null
  isRegeneration: boolean
  lastAnnouncedGenerationId: string | null
}): { generationId: string; tone: 'success' | 'error'; message: string } | null {
  if (!input.generationId || input.generationId === input.lastAnnouncedGenerationId) return null

  const status = String(input.generationStatus)
  if (status !== 'completed' && status !== 'failed') return null

  if (status === 'completed') {
    return {
      generationId: input.generationId,
      tone: 'success',
      message: `${input.mediaKind === 'image' ? 'Image' : 'Video'} ${input.isRegeneration ? 'regenerated' : 'generated'} successfully`,
    }
  }

  return {
    generationId: input.generationId,
    tone: 'error',
    message: `${input.mediaKind === 'image' ? 'Image' : 'Video'} ${input.isRegeneration ? 'regeneration' : 'generation'} failed${input.error ? `: ${input.error}` : ''}`,
  }
}

export function GenerationFeedbackOverlay(props: {
  state: GenerationFeedbackState
  error: string | null
  onRetry: () => void
}): ReactNode {
  if (!props.state.isRegenerating && !props.state.isFailedRegeneration) return null

  return (
    <div
      className="absolute inset-0 z-20 overflow-hidden bg-black/60 backdrop-blur-[1px] pointer-events-none"
    >
      {props.state.isRegenerating ? (
        <div role="status" aria-live="polite" aria-atomic="true" className="flex h-full w-full flex-col items-center justify-center gap-2 text-white">
          <CircleNotch className="motion-safe:animate-spin" aria-hidden={true} />
          <span className="text-xs font-medium">Generating new result…</span>
          <span className="text-[10px] font-mono tracking-[0.3em] text-white/70">REGENERATING</span>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center p-3">
          <div role="alert" className="pointer-events-none max-w-full rounded-md border border-red-400/40 bg-black/70 px-3 py-2 text-center text-xs text-red-100">
            <div className="whitespace-pre-wrap">{props.error !== null ? props.error : 'Regeneration failed.'}</div>
            <button
              type="button"
              onClick={props.onRetry}
              aria-label="Retry regeneration"
              className="pointer-events-auto mt-2 rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white hover:bg-white/20"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
