# BytePlus Dedicated Unfiltered Endpoints Design

## Goal

Expose three additional Canvas models that route to the customer's dedicated BytePlus ModelArk inference endpoints while preserving all existing standard model routes.

## Scope

Add these distinct Canvas model options:

- `Seedance 2.0 Unfiltered`
- `Seedance 2.5 Unfiltered`
- `Seedream 5.0 Pro Unfiltered`

The word “Unfiltered” is the customer-assigned endpoint label. The application must not claim or assume that BytePlus content moderation is disabled. Provider moderation responses remain authoritative.

## Routing

Canvas submits stable application aliases rather than ModelArk endpoint IDs:

| Canvas label | Application alias | Environment variable |
|---|---|---|
| Seedance 2.0 Unfiltered | `byteplus/seedance-2.0-unfiltered` | `BYTEPLUS_SEEDANCE_2_ENDPOINT` |
| Seedance 2.5 Unfiltered | `byteplus/seedance-2.5-unfiltered` | `BYTEPLUS_SEEDANCE_2_5_ENDPOINT` |
| Seedream 5.0 Pro Unfiltered | `byteplus/seedream-5.0-pro-unfiltered` | `BYTEPLUS_SEEDREAM_5_ENDPOINT` |

Current endpoint values are:

```env
BYTEPLUS_SEEDANCE_2_ENDPOINT=ep-20260916130459-fw94z
BYTEPLUS_SEEDANCE_2_5_ENDPOINT=ep-20260916130618-t2z5j
BYTEPLUS_SEEDREAM_5_ENDPOINT=ep-20260916130838-dkscq
```

Endpoint IDs are configuration, not UI model identifiers. This allows endpoint replacement without changing persisted Canvas settings or application code.

## Provider Resolution

`providerRegistry` continues to identify the aliases as BytePlus models. A dedicated endpoint resolver translates only the three new aliases to environment-configured endpoint IDs immediately before the provider adapter is called.

Existing standard model aliases remain unchanged and continue to resolve to base ModelArk model IDs.

If a dedicated alias is selected but its endpoint environment variable is empty, resolution fails closed with:

```text
code: BYTEPLUS_ENDPOINT_NOT_CONFIGURED
status: 503
```

The application must not silently fall back to a base model because that would change the user's selected execution path.

## Provider Calls

- Seedance 2.0 and 2.5 endpoint IDs use the existing asynchronous video task API at `/contents/generations/tasks`.
- Seedream 5.0 Pro endpoint ID uses the existing image generation API at `/images/generations`.
- Existing BytePlus API key and base URL configuration are reused.
- Reference ordering and mention identity prompts remain unchanged.
- BytePlus provider errors, including real-person moderation rejections, remain intact at the adapter boundary and follow existing durable-job error handling.

## Canvas Model Catalog

The three new choices are added alongside—not in place of—the standard models. Their persisted values are the application aliases above. No database migration is required because model identifiers are already strings.

Seedream 5.0 Pro Unfiltered uses the existing Seedream ratio and resolution controls supported by the BytePlus image adapter. Seedance Unfiltered entries use the same duration and resolution capabilities as their corresponding standard entries.

## Configuration

Document the three environment variables in local and production environment examples. Values are configured for local Docker and separately in deployment infrastructure. API keys remain secrets and must never be embedded in client bundles or committed endpoint-specific request credentials.

Endpoint IDs may appear in server configuration but the UI persists only application aliases.

## Testing

Add behavioral tests for:

1. each dedicated alias resolves to the correct configured endpoint ID;
2. standard aliases still resolve to base model IDs;
3. missing endpoint configuration fails with `BYTEPLUS_ENDPOINT_NOT_CONFIGURED`;
4. all three models appear in the Canvas catalog with the intended labels and controls;
5. video endpoint IDs use the video task adapter path;
6. image endpoint IDs use the image generation adapter path;
7. provider moderation errors are not converted into successful fallback calls.

Run focused provider/catalog tests, the full Spite test suite, relevant main-app provider tests, and production builds. Rebuild local Docker without removing volumes. Remote push or deployment requires separate authorization.

## Non-Goals

- Building BytePlus Assets API integration.
- Implementing real-person H5/API verification.
- Guaranteeing that ModelArk accepts real-person references.
- Disabling provider moderation.
- Replacing standard BytePlus model choices.
- Adding a database migration.
