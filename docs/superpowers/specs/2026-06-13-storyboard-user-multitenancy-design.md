# AI Storyboard User-Based Multi-Tenancy MVP

## Goal

Isolate AI Storyboard projects, sessions, uploads, artifacts, and agent runtime state by authenticated Nexoclip user account. For the MVP, `tenantId` is the authenticated user's stable `user.id`.

## Scope

### In scope

- Nexoclip's server-side Vimax proxy derives the tenant ID from the authenticated session.
- The proxy sends `x-nexoclip-tenant` to the internal AI Storyboard service.
- The Storyboard service stores tenant data under `.tenants/<tenantId>/`.
- Sessions, history, uploads, artifacts, and active agent processes are isolated per tenant.
- Requests without a tenant header are rejected outside development mode.
- Tenant IDs are validated and path-safe.
- Existing direct/local development remains possible through the `default` fallback only in development.
- Tests cover header propagation, missing-tenant rejection, tenant path isolation, and cross-tenant session access.

### Out of scope

- Organization/workspace collaboration and membership roles.
- Per-user provider/API-key configuration.
- Billing, quotas, usage metering, or persistent job queues.
- Distributed agent coordination across multiple Storyboard service replicas.
- Reworking unrelated deleted or modified files already present in the working tree.

## Architecture

```text
Authenticated browser
        |
        v
Nexoclip Next.js server proxy
  - verifies/reads current auth session
  - derives user.id
  - overwrites x-nexoclip-tenant
        |
        | internal HTTP
        v
AI Storyboard web server
  - validates tenant header
  - resolves .tenants/<user.id>/
  - owns one runtime/process state per tenant
        |
        v
Python main_agent.py
```

The browser must not be trusted to choose a tenant. The proxy must overwrite any incoming tenant header rather than forward a client-supplied value.

## Tenant identity and authorization

- Canonical MVP identity: authenticated user's stable `user.id`.
- The proxy obtains this value only from the existing server-side auth/session mechanism.
- The proxy sends the value as `x-nexoclip-tenant` to the internal service.
- The Storyboard service accepts only the validated header value. It does not accept tenant IDs from request bodies or query parameters.
- In production, a missing or invalid tenant header returns `401`.
- In development, missing tenant identity may use `default` to preserve standalone local usage. This fallback is disabled when `NODE_ENV=production`.
- Tenant IDs must match `[A-Za-z0-9._-]{1,128}` before being used in a filesystem path.

## Data isolation

All tenant-owned runtime data is rooted at:

```text
ai-engine-storyboard/.tenants/<tenantId>/
```

The existing session and artifact helpers receive this tenant root, so all session IDs, uploads, and artifact paths are resolved beneath it. Every session lookup/delete/upload/artifact request must first operate against the current tenant root; a session belonging to another tenant must appear as not found.

Provider configuration remains global for the MVP and must not be copied into tenant directories. Secrets continue to come from server-side configuration, not browser payloads.

## Runtime isolation and limits

- Maintain one agent process and event subscriber set per tenant.
- Preserve the existing global cap on active agents.
- Preserve idle-agent cleanup.
- A tenant can only start, message, stop, or subscribe to its own agent runtime.
- No cross-tenant event broadcasts.
- Existing active session state is scoped to the tenant runtime and tenant filesystem.

## Proxy contract

For every `/api/vimax/*` request forwarded by Nexoclip:

1. Authenticate the request using the existing Nexoclip auth flow.
2. Resolve the authenticated user's `user.id`.
3. Remove/overwrite any client-provided `x-nexoclip-tenant` header.
4. Set the trusted tenant header to the user ID.
5. Forward the request to `VIMAX_SERVICE_URL`.
6. Preserve response status, streaming/event behavior, and request body semantics.

Unauthenticated requests receive `401` and are not forwarded. The proxy must not expose the internal service URL or allow arbitrary upstream URLs.

## Error handling

- Missing auth at the proxy: `401 Unauthorized`.
- Missing tenant header at the engine in production: `401 Unauthorized`.
- Invalid tenant header: `400` or `401` without filesystem access.
- Unknown session within the current tenant: `404 Project not found`.
- Upload over configured limit: `413`.
- Agent unavailable: existing `409 Agent is not running` behavior.
- Errors must not include API keys, absolute host paths, or another tenant's identifiers/data.

## Migration and compatibility

Existing standalone data outside `.tenants/` is not automatically assigned to a user. Development may continue using the `default` tenant. Production deployments should start with a clean tenant root or perform an explicit, separately reviewed ownership migration.

The implementation must avoid changing unrelated files currently marked deleted or modified in the repository.

## Testing

### Engine tests

- Valid tenant IDs resolve to the expected tenant root.
- Invalid IDs cannot escape the tenant root.
- Production-mode requests without the tenant header return `401`.
- Development-mode requests without the header use `default`.
- Two tenants can have the same session ID without collisions.
- A session, history, upload, or artifact from tenant A is unavailable to tenant B.
- Events from tenant A are not delivered to tenant B.

### Proxy tests

- Authenticated user ID is forwarded as the tenant header.
- Client-supplied tenant header is overwritten.
- Unauthenticated requests are rejected.
- Proxy still forwards request body and response/event stream correctly.

## Success criteria

- Two authenticated users can independently create and use storyboard projects with identical session IDs.
- Neither user can read, mutate, delete, upload to, or receive events from the other user's tenant.
- Direct engine access without trusted tenant identity is blocked in production.
- Existing local standalone development continues to work with the development fallback.
- Relevant automated tests pass.
