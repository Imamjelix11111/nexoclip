# SPITE OpenRouter Provider Migration Design

## Goal

Replace SPITE's fal.ai generation transport with OpenRouter as the primary provider, while falling back to supported direct providers. Preserve the current model catalog and cost estimates during this migration.

## Scope

- OpenRouter is primary for image and video generation.
- Direct fallback is enabled only for explicit, verified mappings:
  - Google/Gemini for supported image models.
  - OpenAI for supported image and video models.
  - BytePlus for supported image and video models.
- Models without a verified direct mapping remain OpenRouter-only.
- Existing output persistence to Cloudflare R2 and metadata persistence to Neon remain unchanged.
- Existing model display metadata and cost estimates remain unchanged for now.
- fal.ai balance UI and fal.ai-specific API behavior are removed or replaced with provider availability information.
- No new providers are introduced.

## Architecture

SPITE will own a provider layer under `services/spite/lib/providers/`, adapted from the existing implementation in `src/providers/`. Route handlers call this layer rather than constructing provider URLs directly.

```text
SPITE UI
  -> SPITE generation route handlers
  -> provider router
     -> OpenRouter image/video adapter (primary)
     -> direct provider adapter (eligible retryable failures only)
        -> Google/Gemini image
        -> OpenAI image/video
        -> BytePlus image/video
  -> R2 output persistence
  -> Neon metadata persistence
```

The root provider implementation is a reference, not a cross-package runtime import. Keeping a SPITE-local copy avoids coupling this standalone service to the parent application's module system and deployment layout.

## Model Mapping

The existing SPITE model registry remains the UI source of truth. Provider-facing model identifiers will be added alongside existing display metadata. Existing `falModel` fields may be renamed where needed, but model names, controls, and cost data will not be redesigned.

Only confirmed OpenRouter identifiers will be enabled. A model without a valid OpenRouter identifier must be reported as unavailable rather than sending its old fal.ai endpoint to OpenRouter. Direct fallback occurs only through an explicit model-to-provider mapping.

## Request Flow

### Images

Image submissions call OpenRouter synchronously through `/api/v1/images`. The adapter normalizes URL and base64 outputs into SPITE's current output shape. Eligible routing failures invoke the mapped direct provider once.

### Videos

Video submissions call OpenRouter's asynchronous video endpoint. SPITE persists the returned provider and job identifier, then polls using the same provider. Completed video content is fetched, normalized, uploaded to R2, and recorded in Neon.

Cancellation and recovery operate through provider capabilities. If a provider does not support cancellation or recovery, the route returns a clear unsupported response rather than calling a fal.ai URL.

## Fallback Policy

Fallback is allowed for explicit mappings when the primary fails because of provider availability, rate limiting, timeout/network failure, authorization/routing gaps, or a confirmed unsupported model route. Invalid user input does not trigger fallback. There is at most one fallback attempt; providers are not chained indefinitely.

## Environment

Required:

- `OPENROUTER_API_KEY`

Optional fallback credentials:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `OPENAI_API_KEY`
- `BYTEPLUS_API_KEY`
- `BYTEPLUS_BASE_URL`

`FAL_KEY` is removed from the required environment check, setup instructions, and runtime paths. Secrets remain server-only.

## Error Handling

Adapters return normalized errors containing a stable code, HTTP status, and safe message. Route handlers do not expose provider response bodies, credentials, or internal URLs. Failed submissions roll back spend reservations using the existing idempotent mechanism. Polling preserves provider identity so jobs are never polled against the wrong backend.

## Testing

Tests will cover:

- OpenRouter image request and response normalization.
- OpenRouter video submit, poll, and content retrieval.
- Direct fallback eligibility and provider selection.
- No fallback for invalid requests or unmapped models.
- Route-level missing-key and provider-error behavior.
- Model mappings do not send legacy fal.ai endpoint IDs to OpenRouter.

Verification includes the focused test suite, TypeScript/build checks, lint where available, and route smoke tests without making billable generation requests.

## Non-goals

- Repricing models or replacing the existing cost table.
- Adding direct adapters for Kling, Flux, Ideogram, MiniMax, or other providers not already supported in the root provider layer.
- Changing R2, Neon, canvas behavior, or authentication.
- Maintaining fal.ai as a fallback.
