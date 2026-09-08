# Seedance 2.5 Unfiltered Video Family Design

## Goal
Expose a complete, clearly branded ByteDance Seedance 2.5 Unfiltered model family in Video Studio, matching the regular Seedance 2.5 choices while preserving SaaS-only credited video generation.

## Scope
Add these catalog entries to the existing Studio model registry:

- Seedance 2.5 Unfiltered Text to Video
- Seedance 2.5 Unfiltered Text to Video 480p
- Seedance 2.5 Unfiltered Image to Video
- Seedance 2.5 Unfiltered Image to Video 480p
- Seedance 2.5 Unfiltered First & Last Frame
- Seedance 2.5 Unfiltered First & Last Frame 480p
- Seedance 2.5 Unfiltered Omni Reference
- Seedance 2.5 Unfiltered Omni Reference 480p

All entries use the known unfiltered BytePlus deployment `ep-20260904190604-p8pjl`, are categorized by their existing Video Studio behavior, and preserve provider-native input metadata:

- Text-to-video has no media input.
- Image-to-video requires one first-frame image.
- First-and-last-frame requires first and last frame images.
- Omni Reference accepts multiple reference images.
- Standard variants permit 480p, 720p, and 1080p when represented by the current deployment metadata; 480p variants constrain resolution to 480p.
- All variants expose existing compatible ratio and duration choices.

## Branding
Every Unfiltered entry must have:

```json
{
  "provider": "bytedance",
  "provider_name": "ByteDance"
}
```

This makes Video Studio use its existing `bytedance` provider logo, provider filter, and ByteDance label. The current `byteplus` metadata is replaced because it does not match the UI logo key.

## Routing
The browser continues to submit only a durable SaaS video request. `generateSaasVideo` maps the Studio model ID to `ep-20260904190604-p8pjl`; the server/worker resolves tenant-owned references and submits with server-side BytePlus credentials. The browser receives no provider credential.

All variants share the existing direct-provider registry lookup for the deployment ID. No provider-specific bypass or new public API is introduced.

## Validation and UX
Existing Video Studio helpers derive controls from registry metadata. The entries therefore use the current `imageField`, `lastImageField`, and multi-reference model set conventions to show the correct upload affordances, resolution selector, ratio selector, and duration selector.

“Unfiltered” is a catalog/deployment label only. Provider moderation can still reject a request, including references containing real people. Failures remain safely redacted in the customer job result.

## Testing
Add source-contract tests that verify:

1. All eight Unfiltered IDs appear in the appropriate T2V/I2V lists.
2. Each has ByteDance provider metadata and therefore the existing UI logo key.
3. Each model ID maps to the known unfiltered deployment.
4. First/last and omni variants retain the existing frame/multi-reference behavior.
5. 480p variants expose only 480p.
6. The ordinary Studio model regression suite continues to pass.

## Out of Scope

- Claiming that the provider will accept real-person references.
- Changing the provider’s content policy or retrying a moderation rejection.
- Introducing browser-side BYOK/provider credentials.
- Changing pricing from the existing provisional 10-credit video reservation.
