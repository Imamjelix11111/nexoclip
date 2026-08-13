import { NextResponse } from 'next/server';

const MUAPI_BASE = 'https://api.muapi.ai';

function normalizeClientKey(request) {
    // Only accept x-api-key header. Cookie-based auth is removed for security:
    // cookies without HttpOnly flag can be stolen by any XSS (CWE-522).
    // A keyless SaaS browser sends the literal strings "null"/"undefined" — treat those as absent.
    const headerKey = request.headers.get('x-api-key');
    if (!headerKey || headerKey === 'null' || headerKey === 'undefined') return null;
    return headerKey;
}

// Reads may fall back to the platform's server-only MuAPI key so a keyless (SaaS)
// browser can still open and view workflows in the builder. Writes and execution
// must NOT fall back — those belong in the metered generations pipeline, so they
// keep requiring an explicit client key.
function resolveApiKey(request, { allowServerFallback }) {
    return normalizeClientKey(request)
        || (allowServerFallback ? (process.env.MUAPI_API_KEY || null) : null);
}

// Execution consumes MuAPI credits and must not silently run on the platform key —
// it belongs in the metered generations pipeline. Authoring (create/update/delete a
// workflow definition) is free, so those writes may use the server key like reads do.
function isExecutionPath(path) {
    return path.includes('api-execute') || /\/node\/[^/]+\/run$/.test(path);
}

function cleanHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.delete('cookie'); // CRITICAL: Stop forwarding browser cookies to MuAPI to avoid auth conflicts
    return headers;
}

export async function GET(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    // Reads: allow the server-only platform key so keyless browsers can load workflows.
    const apiKey = resolveApiKey(request, { allowServerFallback: true });
    // NOTE: apiKey is intentionally NOT logged here to prevent credential leakage (CWE-200)
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            headers,
            method: 'GET',
        });
        const data = await response.json();
        if (path.includes('get-workflow-def')) {
            console.log(`[proxy GET] get-workflow-def response: is_owner=${data?.is_owner}, workflow_id=${data?.workflow_id}`);
        }
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = resolveApiKey(request, { allowServerFallback: !isExecutionPath(path) });
    // NOTE: credential logging removed for security (CWE-200)
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        // Decode body to see what workflow_id is being sent
        try {
            const parsed = JSON.parse(Buffer.from(body).toString('utf-8'));
            console.log(`[proxy POST] body: workflow_id=${parsed.workflow_id}, source_workflow_id=${parsed.source_workflow_id}, name=${parsed.name}`);
        } catch(e) { /* ignore decode errors */ }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body
        });
        const data = await response.json();
        console.log(`[proxy POST] response: status=${response.status}`, JSON.stringify(data).slice(0, 200));
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = resolveApiKey(request, { allowServerFallback: !isExecutionPath(path) });
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const response = await fetch(targetUrl, {
            method: 'DELETE',
            headers
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request, { params }) {
    const slug = await params;
    const pathSegments = slug.path || [];
    const path = pathSegments.join('/');
    
    const { search } = new URL(request.url);
    const targetUrl = `${MUAPI_BASE}/workflow/${path}${search}`;

    const headers = cleanHeaders(request);

    const apiKey = resolveApiKey(request, { allowServerFallback: !isExecutionPath(path) });
    if (apiKey) headers.set('x-api-key', apiKey);

    try {
        const body = await request.arrayBuffer();
        const response = await fetch(targetUrl, {
            method: 'PUT',
            headers,
            body
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
