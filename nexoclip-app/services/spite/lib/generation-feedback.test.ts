import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

import {
  GenerationFeedbackOverlay,
  getGenerationFeedbackState,
  isTerminalGenerationStatus,
  getTerminalGenerationToast,
} from '../components/canvas/nodes/generation-feedback'

test('derives active regeneration state from in_progress output replacement', () => {
  assert.deepEqual(
    getGenerationFeedbackState({ status: 'in_progress', hasOutput: true }),
    {
      isActive: true,
      isRegenerating: true,
      isFailedRegeneration: false,
      frameStyle: {
        border: '1.5px solid rgba(245,158,11,0.9)',
        boxShadow: '0 0 0 1px rgba(245,158,11,0.2), 0 0 24px rgba(245,158,11,0.25)',
      },
    },
  )
})

test('does not mark first-generation in_progress as regeneration', () => {
  assert.equal(getGenerationFeedbackState({ status: 'in_progress', hasOutput: false }).isRegenerating, false)
})

test('marks failed replacement output with a red frame', () => {
  assert.deepEqual(getGenerationFeedbackState({ status: 'failed', hasOutput: true }), {
    isActive: false,
    isRegenerating: false,
    isFailedRegeneration: true,
    frameStyle: {
      border: '1.5px solid rgba(239,68,68,0.9)',
      boxShadow: '0 0 0 1px rgba(239,68,68,0.2), 0 0 24px rgba(239,68,68,0.25)',
    },
  })
})

test('returns a success toast once per regenerated generation id', () => {
  const success = getTerminalGenerationToast({
    mediaKind: 'image',
    generationId: 'g-1',
    generationStatus: 'completed',
    error: null,
    isRegeneration: true,
    lastAnnouncedGenerationId: null,
  })

  assert.deepEqual(success, {
    generationId: 'g-1',
    tone: 'success',
    message: 'Image regenerated successfully',
  })

  assert.equal(
    getTerminalGenerationToast({
      mediaKind: 'image',
      generationId: 'g-1',
      generationStatus: 'completed',
      error: null,
      isRegeneration: true,
      lastAnnouncedGenerationId: 'g-1',
    }),
    null,
  )
})

test('omits terminal notifications for missing or active ids', () => {
  assert.equal(
    getTerminalGenerationToast({
      mediaKind: 'image',
      generationId: null,
      generationStatus: 'completed',
      error: null,
      isRegeneration: true,
      lastAnnouncedGenerationId: null,
    }),
    null,
  )

  assert.equal(
    getTerminalGenerationToast({
      mediaKind: 'video',
      generationId: 'g-1',
      generationStatus: 'in_progress',
      error: null,
      isRegeneration: true,
      lastAnnouncedGenerationId: null,
    }),
    null,
  )
})

test('isTerminalGenerationStatus returns true for terminal statuses', () => {
  assert.equal(isTerminalGenerationStatus('completed'), true)
  assert.equal(isTerminalGenerationStatus('failed'), true)
  assert.equal(isTerminalGenerationStatus('in_progress'), false)
  assert.equal(isTerminalGenerationStatus('queued'), false)
})

test('includes provider error in failed video toast copy', () => {
  const toast = getTerminalGenerationToast({
    mediaKind: 'video',
    generationId: 'g-2',
    generationStatus: 'failed',
    error: 'Provider quota exceeded',
    isRegeneration: true,
    lastAnnouncedGenerationId: null,
  })

  assert.equal(toast?.tone, 'error')
  assert.equal(toast?.generationId, 'g-2')
  assert.equal(toast?.message, 'Video regeneration failed: Provider quota exceeded')
})

test('renders active and failed regeneration overlays with static markup', () => {
  const activeMarkup = renderToStaticMarkup(
    React.createElement(GenerationFeedbackOverlay, {
      state: {
        isActive: true,
        isRegenerating: true,
        isFailedRegeneration: false,
        frameStyle: {
          border: '1.5px solid rgba(245,158,11,0.9)',
          boxShadow: '0 0 0 1px rgba(245,158,11,0.2), 0 0 24px rgba(245,158,11,0.25)',
        },
      },
      error: null,
      onRetry: () => {},
    }),
  )

  assert.match(activeMarkup, /REGENERATING/)
  assert.match(activeMarkup, /Generating new result…/)

  const failedMarkup = renderToStaticMarkup(
    React.createElement(GenerationFeedbackOverlay, {
      state: {
        isActive: true,
        isRegenerating: false,
        isFailedRegeneration: true,
        frameStyle: {
          border: '1.5px solid rgba(239,68,68,0.9)',
          boxShadow: '0 0 0 1px rgba(239,68,68,0.2), 0 0 24px rgba(239,68,68,0.25)',
        },
      },
      error: null,
      onRetry: () => {},
    }),
  )

  assert.match(failedMarkup, /role="alert"/)
  assert.match(failedMarkup, /Retry/)
  assert.match(failedMarkup, /Regeneration failed\./)
  assert.doesNotMatch(activeMarkup, /role="alert"/)
})
