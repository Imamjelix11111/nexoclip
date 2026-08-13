# Sprint 1 — MuAPI Proxy and BYOK Flow Audit

**Date:** 2026-04-10  
**Scope:** Read-only audit of the existing MuAPI compatibility and BYOK implementation.  
**Repository:** `Open-Generative-AI`

## Executive summary

The current application is primarily a browser BYOK client. A user enters a MuAPI key, the key is persisted in browser storage, and studio components pass it to MuAPI through `x-api-key`. Next.js provides compatibility proxies for several MuAPI namespaces, but those proxies still depend on the browser-supplied credential. Some server-rendered agent pages read the same key from a client-written cookie.

This is useful compatibility behavior, but it is not yet a SaaS tenant/auth boundary. A SaaS migration must introduce server-owned credentials, authenticated workspace context, tenant-scoped resources, and asynchronous generation jobs without removing the existing compatibility routes.

## 1. Route inventory

### MuAPI compatibility/proxy routes

| Route | Upstream / behavior | Auth behavior | Notes |
|---|---|---|---|
| `app/api/agents/[[...path]]/route.js` | `/api/agents/*` → `https://api.muapi.ai/agents/*` | Reads `x-api-key`; forwards it | GET/POST/PUT/DELETE; removes host, connection, cookie |
| `app/api/app/[[...path]]/route.js` | `/api/app/*` → `https://api.muapi.ai/app/*` | Reads `Authorization: Bearer` or `x-api-key`; forwards as `x-api-key` | Aliases `get_upload_file`; intercepts upload URL |
| `app/api/workflow/[[...path]]/route.js` | `/api/workflow/*` → `https://api.muapi.ai/workflow/*` | Reads `x-api-key`; forwards it | GET/POST/PUT/DELETE; supports workflow CRUD/execution |
| `app/api/api/v1/[[...path]]/route.js` | `/api/api/v1/*` → `https://api.muapi.ai/api/v1/*` | Reads `x-api-key`; forwards it | Compatibility route for a client/library that emits the double `/api/api` prefix |
| `app/api/v1/creative-agent/[[...path]]/route.js` | `/api/v1/creative-agent/*` → MuAPI creative-agent API | Reads Bearer or `x-api-key`; normalizes to `x-api-key` | GET/POST/PATCH/DELETE |
| `app/api/v1/get_upload_url/route.js` | Gets MuAPI S3 upload form fields | Requires Bearer or `x-api-key` | Dedicated upload URL route |
| `app/api/upload-binary/route.js` | Browser form → validated S3 target | Requires key via shared helper | Validates target host/protocol and file types |
| `app/api/v1/upload-binary/route.js` | Browser form → validated S3 target | Requires key via shared helper | Duplicate/compatibility upload route |

### Middleware behavior

`middleware.js` applies security headers to nearly all application responses. The CSP allows direct connections and media from `muapi.ai` and `*.muapi.ai` because generated assets and thumbnails may be served by MuAPI subdomains.

The middleware identifies `/api/workflow`, `/api/app`, and `/api/v1`, but only actively rewrites `/api/v1/*` requests that are not handled by dedicated route handlers to `https://api.muapi.ai`. The dedicated route handlers therefore coexist with a broad rewrite rule. `/api/v1/creative-agent`, `/api/v1/get_upload_url`, and `/api/v1/upload-binary` are explicitly excluded from that rewrite.

Security headers currently include:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- CSP with inline scripts/eval allowed and MuAPI wildcard connections allowed

## 2. Client and server data flow

### Existing BYOK flow

```text
User enters key
  -> localStorage['muapi_key']
  -> client state in StandaloneShell
  -> x-api-key on relative/proxy requests
  -> Next.js compatibility route
  -> x-api-key to MuAPI
```

The main studio shell (`components/StandaloneShell.js`) does the following:

1. Reads `muapi_key` from `localStorage` on mount.
2. Stores a new key in `localStorage` when the user saves it.
3. Writes the same key to a non-HttpOnly `muapi_key` cookie.
4. Injects `x-api-key` into internal Axios requests using an interceptor.
5. Passes `apiKey` as a prop to studio components.
6. Polls the MuAPI account balance every 30 seconds while the key exists.

The legacy client (`src/lib/muapi.js`) reads either `window.__MUAPI_KEY__` or `localStorage['muapi_key']`. The package studio client (`packages/studio/src/muapi.js`) generally receives `apiKey` as an argument and sends it as `x-api-key`.

### Direct versus proxied requests

The package studio client chooses `/api` when running in a browser over HTTP and uses `https://api.muapi.ai` for SSR or Electron/file contexts. This means browser web requests normally use Next.js compatibility routes, while Electron and some non-browser contexts can send the BYOK key directly to MuAPI.

Generation helpers submit a request and then poll `/api/v1/predictions/{requestId}/result`. Image polling defaults to approximately two minutes in the legacy client; video, audio, lip-sync, and several other long-running operations use up to 900 attempts at two seconds each (approximately 30 minutes). This polling is performed by the browser rather than a persistent worker.

### Upload flow

1. Client requests upload fields from MuAPI through `/api/app/get_file_upload_url` or `/api/v1/get_upload_url`.
2. The app replaces the returned S3 URL with `/api/upload-binary` in one compatibility path and adds the original target as a hidden form field.
3. The binary proxy validates the target and file type.
4. The server posts the reconstructed form to S3.

The shared `src/lib/uploadProxyTarget.js` rejects non-HTTPS targets, private/loopback/IP-literal hosts, and hosts outside AWS S3 patterns or `UPLOAD_PROXY_ALLOWED_HOSTS`. It also blocks executable/script-like extensions and MIME types.

## 3. API-key inventory

### Storage locations

| Location | Usage | Exposure |
|---|---|---|
| `localStorage['muapi_key']` | Main shell and legacy client | Readable by any JavaScript executing in the origin; vulnerable to XSS or malicious third-party script |
| Non-HttpOnly `muapi_key` cookie | Written by `StandaloneShell`; read by SSR agent pages | Sent with requests and readable by JavaScript; can be stolen by XSS |
| `window.__MUAPI_KEY__` | Legacy client override | Browser global; readable by page scripts |
| React/component state and props | `apiKey` passed to studios | Runtime browser memory; can be exposed by client-side compromise |
| Request `x-api-key` | Browser → local proxy and sometimes browser → MuAPI | Credential is present in browser network requests |
| Request `Authorization: Bearer` | Accepted by selected compatibility routes | Normalized server-side to `x-api-key`; still originates from caller |

No central `MU_API_KEY` or `MUAPI_API_KEY` use was found in the primary Next.js app path. The repository does contain separate package/example references such as `MU_API_KEY` in the Open AI Design Agent server example; those must not be treated as production SaaS credential handling without separate review.

### Relevant readers and senders

- `components/StandaloneShell.js`: reads/writes localStorage and cookie; injects request header.
- `src/components/AuthModal.js`: writes `localStorage['muapi_key']`.
- `app/agents/**/page.js`: reads `muapi_key` cookie during server rendering and calls MuAPI directly with the key.
- `app/agents/**/**Client.js`: reads localStorage/cookie fallback and sends `x-api-key` through client requests.
- `packages/studio/src/muapi.js`: accepts API key as a function argument and sends `x-api-key`.
- `src/lib/muapi.js`: reads browser key and sends `x-api-key` directly or through its configured base URL.
- `src/lib/uploadProxyTarget.js`: accepts Bearer or `x-api-key` for upload proxy authorization.
- Compatibility route handlers: read caller-provided credentials and forward only the normalized MuAPI header.

## 4. Findings and risk assessment

### F-01 — BYOK credentials are browser-resident (High)

The primary key is stored in localStorage and also copied to a JavaScript-readable cookie. Any XSS, compromised dependency, injected script, or browser extension with page access can retrieve it. This is expected for a BYOK desktop/web compatibility mode, but it is incompatible with server-owned SaaS credentials.

**Recommendation:** Keep this behavior only for compatibility mode. New SaaS flows must use an application session and a server/worker-only MuAPI credential. Do not migrate the raw BYOK key into the SaaS database.

### F-02 — SSR agent pages forward a client-written credential (High)

Agent pages read `muapi_key` from cookies and call MuAPI during server rendering. Although the route proxy removes cookies before forwarding, these pages explicitly extract and use the cookie value.

**Recommendation:** New authenticated pages should resolve a server session and workspace membership. Avoid direct MuAPI calls from page components; use service/repository boundaries and route handlers.

### F-03 — Multiple auth conventions increase migration risk (Medium)

Routes inconsistently accept only `x-api-key` or accept both Bearer and `x-api-key`. The app route and creative-agent route normalize Bearer to `x-api-key`; workflow and agents do not accept Bearer. This is compatibility behavior, but it makes a future session-to-provider transition easy to implement inconsistently.

**Recommendation:** Introduce one internal auth extraction/context helper for new SaaS routes. Leave compatibility routes unchanged until covered by regression tests.

### F-04 — Long-running work is browser-polled (High for SaaS migration)

Video, audio, lip-sync, workflow, and related operations can poll for up to roughly 30 minutes in the browser. Browser tabs, network interruptions, and page unloads can lose progress tracking. This also prevents reliable credit reservation/settlement and retry semantics.

**Recommendation:** The first SaaS workflow should submit a durable generation job and return immediately. A persistent worker should submit/poll MuAPI, persist output metadata, and settle credits.

### F-05 — Proxy surface is duplicated and scattered (Medium)

There are namespace-specific route handlers, a double-prefix compatibility route, middleware rewrite behavior, and duplicate binary upload routes. This is understandable for backward compatibility but increases the chance of inconsistent header handling, response parsing, and error behavior.

**Recommendation:** Do not broadly rewrite or delete these routes. Add shared proxy utilities only when a change is required, and add route-level tests around auth forwarding and cookie stripping.

### F-06 — Proxy logs require payload discipline (Medium)

Workflow proxy logs include workflow IDs, source IDs, names, response status, and a truncated serialized response. The legacy client logs request URLs, payloads, submit responses, and result URLs. Current inspected logs do not intentionally print raw API keys, but payloads or provider responses could contain sensitive user data or URLs.

**Recommendation:** Remove or gate verbose generation logs in production. Redact credentials and signed URLs. Log only request/job IDs, status, duration, and bounded error codes.

### F-07 — CSP permits broad MuAPI subdomains and unsafe script directives (Medium)

`connect-src` and media sources permit `https://*.muapi.ai`, while `script-src` allows `unsafe-inline` and `unsafe-eval`. The MuAPI wildcard may be operationally necessary for current assets, but broad script directives increase the impact of an XSS finding.

**Recommendation:** Preserve compatibility initially, then tighten CSP after asset domains are enumerated and inline/eval usage is reduced.

### Positive controls already present

- Proxy handlers remove `cookie`, `host`, and connection-related headers before forwarding in most paths.
- Several handlers explicitly avoid logging credentials.
- Upload proxy validates HTTPS, blocks private/loopback destinations, restricts target hosts, and blocks dangerous file types.
- `packages/studio/src/persistKey.js` scopes some persisted studio state by a short hash of the identity/key and migrates the old shared key. This reduces cross-identity local state leakage, but it does not protect the raw credential itself.

## 5. First workflow suitable for SaaS migration

### Recommendation: image generation

Start with the existing image-generation path exposed by `packages/studio/src/muapi.js` (`generateImage`) and the corresponding image studio component.

Reasons:

- It already has a clear submit → prediction ID → result shape.
- Payloads are comparatively small and easy to validate.
- Output normalization is simple (`outputs[0]`, `url`, or `output.url`).
- It exercises the core SaaS concerns: auth, tenant scope, cost estimation, credit reservation, job creation, provider adapter, polling, output persistence, and status reads.
- It avoids beginning with workflow execution or multi-asset video pipelines, which have more complex inputs and longer runtimes.

The migration should introduce a new SaaS endpoint/service rather than replacing the compatibility call:

```text
Browser session
  -> POST /api/generations
  -> auth + workspace authorization
  -> validate image request
  -> estimate/reserve credits + create generation job
  -> return 202 + job ID

Persistent worker
  -> claim job idempotently
  -> MuAPI adapter submits image request
  -> poll/retry outside request lifecycle
  -> persist provider usage/output
  -> capture or release reservation

Browser
  -> GET /api/generations/{id}
```

## 6. Minimum safe migration changes

1. **Preserve compatibility routes.** Existing BYOK users and Electron flows must continue to work.
2. **Define a separate SaaS auth boundary.** New routes must not use `muapi_key` as identity or authorization.
3. **Keep central provider credentials server/worker-only.** Never expose them through `NEXT_PUBLIC_*`, browser state, cookies, logs, or response payloads.
4. **Add tenant context before business APIs.** Resolve the authenticated user, workspace membership, and role on the server; never trust a client-provided `workspace_id`.
5. **Separate route/service/provider concerns.** Route handlers validate HTTP input; services own business rules; MuAPI adapter owns provider details.
6. **Return a durable job instead of waiting.** Do not poll MuAPI in a Next.js request or require a browser tab to remain open.
7. **Add idempotency before credit mutation.** Job creation and credit reservation must be transactionally safe and retryable.
8. **Redact logs and secrets.** Remove verbose payload/response logging from production generation paths.
9. **Add regression tests before proxy refactors.** Cover credential forwarding, cookie stripping, upload target validation, and compatibility route status propagation.
10. **Treat BYOK as an explicit legacy mode.** Document its browser-storage risk and avoid coupling it to the future tenant model.

## 7. Suggested follow-up sequence for Sprint 1

1. Decide the authentication/session provider; this remains an open product decision.
2. Add raw PostgreSQL migration runner and initial tenant/workspace schema.
3. Add server-side auth and workspace membership context.
4. Add repository/service boundaries and workspace/project APIs.
5. Add object-storage metadata and signed upload flow for SaaS assets.
6. Add the image-generation job contract without changing compatibility routes.
7. Implement the worker/provider adapter in Sprint 2.

## 8. Audit acceptance checklist

- [x] Route inventory under `app/api` completed.
- [x] MuAPI client locations and generation/polling flow identified.
- [x] Browser storage, cookie, Bearer, and `x-api-key` usage identified.
- [x] Middleware rewrite and security-header behavior documented.
- [x] First SaaS migration candidate identified.
- [x] Secret-exposure risks and minimum safe migration changes documented.
- [x] Existing compatibility behavior preserved; no production code changed during audit.

## Verification notes

The audit used repository inspection only. No source files were modified as part of this audit. The repository had an unrelated pre-existing untracked `AGENTS.md`; it was preserved.
