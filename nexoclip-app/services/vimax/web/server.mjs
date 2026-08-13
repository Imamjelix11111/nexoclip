import {createReadStream, existsSync, statSync} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readAgentConfig, saveAgentConfig} from './config-store.mjs';
import {TENANT_HEADER, tenantIdFromRequest, tenantRoot} from './tenant.mjs';
import {
  artifactContentType,
  deleteSession,
  listSessionArtifacts,
  readSessionHistory,
  readSessionState,
  resolveArtifactPath,
  storeWorkspaceUpload,
} from './server-lib.mjs';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '..');
const isDev = process.argv.includes('--dev');
const host = process.env.VIMAX_WEB_HOST || '127.0.0.1';
const port = Number(process.env.VIMAX_WEB_PORT || 4173);
const configuredUploadLimit = Number(process.env.VIMAX_WEB_UPLOAD_MAX_BYTES || 100 * 1024 * 1024);
const uploadMaxBytes = Number.isFinite(configuredUploadLimit) && configuredUploadLimit > 0
  ? configuredUploadLimit
  : 100 * 1024 * 1024;
const isProduction = process.env.NODE_ENV === 'production';

// Multi-tenant limits. Each tenant (an authenticated Nexoclip user, identified by
// the proxy) gets its own agent process, event stream, and data root. We cap how
// many agents run at once and reap idle ones to bound memory.
const MAX_ACTIVE_AGENTS = Math.max(1, Number(process.env.VIMAX_MAX_AGENTS || 4));
const AGENT_IDLE_MS = Math.max(60_000, Number(process.env.VIMAX_AGENT_IDLE_MS || 15 * 60 * 1000));
// tenantId -> { agentProcess, activeSessionId, subscribers:Set, stdoutBuffer, lastActivity, idleTimer }
const tenants = new Map();

let vite = null;

// The proxy is the only thing that should reach this service (internal network),
// and it sets the tenant header from the authenticated session. Fall back to a
// shared "default" tenant for direct/dev access without a proxy.
function tenantIdOf(request) {
  return tenantIdFromRequest(request, {production: isProduction});
}

function tenantRootOf(tenantId) {
  return tenantRoot(repoRoot, tenantId);
}

function getTenant(tenantId) {
  let tenant = tenants.get(tenantId);
  if (!tenant) {
    tenant = {agentProcess: null, activeSessionId: '', subscribers: new Set(), stdoutBuffer: '', lastActivity: Date.now(), idleTimer: null};
    tenants.set(tenantId, tenant);
  }
  return tenant;
}

async function ensureTenantRoot(tenantId) {
  const root = tenantRootOf(tenantId);
  await mkdir(root, {recursive: true});
  return root;
}

function touchTenant(tenantId, tenant) {
  tenant.lastActivity = Date.now();
  if (tenant.idleTimer) clearTimeout(tenant.idleTimer);
  tenant.idleTimer = setTimeout(() => {
    if (tenant.agentProcess) stopAgent(tenantId, 'idle');
  }, AGENT_IDLE_MS);
  if (tenant.idleTimer.unref) tenant.idleTimer.unref();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
  try {
    const tenantId = tenantIdOf(request);
    const tenant = getTenant(tenantId);
    if (url.pathname === '/api/events' && request.method === 'GET') {
      return openEventStream(request, response, tenant);
    }
    const tenantRoot = await ensureTenantRoot(tenantId);
    if (url.pathname === '/api/sessions' && request.method === 'GET') {
      return sendJson(response, 200, await readSessionState(tenantRoot));
    }
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return sendJson(response, 200, await readAgentConfig(tenantRoot));
    }
    if (url.pathname === '/api/config' && request.method === 'PUT') {
      const config = await saveAgentConfig(tenantRoot, await readJsonBody(request));
      stopAgent(tenantId, 'config');
      return sendJson(response, 200, config);
    }
    if (url.pathname === '/api/sessions' && request.method === 'DELETE') {
      const sessionId = url.searchParams.get('session') || '';
      const current = await readSessionState(tenantRoot);
      if (!current.sessions.some((session) => session.sessionId === sessionId)) {
        return sendJson(response, 404, {error: 'Project not found'});
      }
      if (sessionId === tenant.activeSessionId) stopAgent(tenantId, 'delete');
      const state = await deleteSession(tenantRoot, sessionId);
      tenant.activeSessionId = state.activeSessionId;
      broadcast(tenant, {type: 'sessions_changed', ...state});
      return sendJson(response, 200, state);
    }
    if (url.pathname === '/api/history' && request.method === 'GET') {
      return sendJson(response, 200, {messages: await readSessionHistory(tenantRoot, url.searchParams.get('session') || '')});
    }
    if (url.pathname === '/api/artifacts' && request.method === 'GET') {
      return sendJson(response, 200, {artifacts: await listSessionArtifacts(tenantRoot, url.searchParams.get('session') || '')});
    }
    if (url.pathname === '/api/artifact' && request.method === 'GET') {
      return streamArtifact(response, tenantRoot, url.searchParams.get('session') || '', url.searchParams.get('path') || '', request.headers.range);
    }
    if (url.pathname === '/api/uploads' && request.method === 'POST') {
      const sessionId = url.searchParams.get('session') || '';
      const fileName = url.searchParams.get('name') || '';
      const current = await readSessionState(tenantRoot);
      if (!current.sessions.some((session) => session.sessionId === sessionId)) {
        return sendJson(response, 404, {error: 'Project not found'});
      }
      const declaredSize = Number(request.headers['content-length'] || 0);
      if (declaredSize > uploadMaxBytes) {
        return sendJson(response, 413, {error: `File exceeds the ${formatByteLimit(uploadMaxBytes)} upload limit`});
      }
      const data = await readBinaryBody(request, uploadMaxBytes);
      const file = await storeWorkspaceUpload(tenantRoot, sessionId, fileName, data);
      return sendJson(response, 201, {file});
    }
    if (url.pathname === '/api/agent/start' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
      if (projectName.length > 64) {
        return sendJson(response, 400, {error: 'Project name must be 64 characters or fewer'});
      }
      await startAgent(tenantId, {newSession: body.newSession === true, sessionId, projectName});
      return sendJson(response, 200, {ok: true});
    }
    if (url.pathname === '/api/messages' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const text = String(body.text || '').trim();
      if (!text) return sendJson(response, 400, {error: 'Message text is required'});
      if (!tenant.agentProcess?.stdin.writable) return sendJson(response, 409, {error: 'Agent is not running'});
      tenant.agentProcess.stdin.write(`${text}\n`);
      touchTenant(tenantId, tenant);
      return sendJson(response, 202, {ok: true});
    }
    if (url.pathname === '/api/agent/stop' && request.method === 'POST') {
      stopAgent(tenantId, 'user');
      return sendJson(response, 200, {ok: true});
    }
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return sendJson(response, 200, {
        ok: true,
        agentRunning: Boolean(tenant.agentProcess),
        activeSessionId: tenant.activeSessionId,
        activeAgents: countActiveAgents(),
        maxAgents: MAX_ACTIVE_AGENTS,
      });
    }
    if (url.pathname === '/assets/vimax.png' && request.method === 'GET') {
      response.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600'});
      createReadStream(path.join(repoRoot, 'assets', 'vimax.png')).pipe(response);
      return;
    }
    if (vite) {
      vite.middlewares(request, response, () => sendJson(response, 404, {error: 'Not found'}));
      return;
    }
    return serveProductionApp(response, url.pathname);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    sendJson(response, status, {error: error instanceof Error ? error.message : String(error)});
  }
});

if (isDev) {
  vite = await (await import('vite')).createServer({
    root: webRoot,
    server: {middlewareMode: true, hmr: {server}},
    appType: 'spa',
  });
}

server.listen(port, host, () => {
  console.log(`ViMax Web: http://${host}:${port} (multi-tenant, max ${MAX_ACTIVE_AGENTS} agents)`);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function countActiveAgents() {
  let count = 0;
  for (const tenant of tenants.values()) if (tenant.agentProcess) count += 1;
  return count;
}

// Free a slot by stopping the least-recently-used agent that isn't the caller.
function evictLruAgent(exceptTenantId) {
  let oldestId = null;
  let oldestAt = Infinity;
  for (const [id, tenant] of tenants) {
    if (id === exceptTenantId || !tenant.agentProcess) continue;
    if (tenant.lastActivity < oldestAt) {
      oldestAt = tenant.lastActivity;
      oldestId = id;
    }
  }
  if (oldestId) stopAgent(oldestId, 'evicted');
}

async function startAgent(tenantId, {newSession, sessionId, projectName = ''}) {
  if (newSession && sessionId) throw new Error('Choose either a new or existing session');
  const tenant = getTenant(tenantId);
  const tenantRoot = await ensureTenantRoot(tenantId);

  stopAgent(tenantId, 'switch');
  if (countActiveAgents() >= MAX_ACTIVE_AGENTS) evictLruAgent(tenantId);

  const {command, args} = agentCommand();
  const sessionArgs = newSession
    ? ['--new-session', ...(projectName ? ['--new-session-name', projectName] : [])]
    : sessionId
      ? ['--session', sessionId]
      : [];
  tenant.activeSessionId = sessionId;
  const child = spawn(command, [...args, 'main_agent.py', '--jsonl', '--stdin-repl', ...sessionArgs], {
    cwd: repoRoot,
    // Data (.vimax / .working_dir) is namespaced per tenant via this env; cwd stays
    // repoRoot so Python imports, config, and assets still resolve.
    env: {...process.env, VIMAX_WORKSPACE_ROOT: tenantRoot},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  tenant.agentProcess = child;
  tenant.stdoutBuffer = '';
  touchTenant(tenantId, tenant);
  broadcast(tenant, {type: 'bridge_status', status: 'starting', message: newSession ? 'Creating workspace' : 'Opening workspace'});

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (tenant.agentProcess !== child) return;
    tenant.stdoutBuffer += String(chunk);
    const lines = tenant.stdoutBuffer.split(/\r?\n/);
    tenant.stdoutBuffer = lines.pop() || '';
    for (const line of lines) consumeAgentLine(tenantId, tenant, tenantRoot, line);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (tenant.agentProcess !== child) return;
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) broadcast(tenant, {type: 'terminal', stream: 'stderr', line});
    }
  });
  child.on('error', (error) => {
    if (tenant.agentProcess !== child) return;
    broadcast(tenant, {type: 'error', message: `Agent process error: ${error.message}`});
  });
  child.on('exit', (code, signal) => {
    if (tenant.agentProcess !== child) return;
    tenant.agentProcess = null;
    broadcast(tenant, {
      type: 'bridge_status',
      status: code === 0 || signal === 'SIGTERM' ? 'stopped' : 'error',
      message: signal ? `Agent stopped by ${signal}` : `Agent exited with code ${code ?? 0}`,
    });
  });
  setTimeout(async () => {
    if (tenant.agentProcess !== child) return;
    const state = await readSessionState(tenantRoot);
    tenant.activeSessionId = state.activeSessionId || sessionId || tenant.activeSessionId;
    broadcast(tenant, {type: 'sessions_changed', ...state, activeSessionId: tenant.activeSessionId});
    broadcast(tenant, {type: 'bridge_status', status: 'ready', message: 'Agent ready'});
  }, 350);
}

function consumeAgentLine(tenantId, tenant, tenantRoot, line) {
  if (!line.trim()) return;
  try {
    const event = JSON.parse(line);
    if (event.type === 'session') tenant.activeSessionId = event.session?.active_session_id || tenant.activeSessionId;
    broadcast(tenant, event);
    if (event.type === 'session') {
      readSessionState(tenantRoot).then((state) => broadcast(tenant, {type: 'sessions_changed', ...state}));
    }
  } catch {
    broadcast(tenant, {type: 'terminal', stream: 'stdout', line});
  }
}

function openEventStream(request, response, tenant) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(`data: ${JSON.stringify({type: 'bridge_status', status: tenant.agentProcess ? 'ready' : 'idle', message: tenant.agentProcess ? 'Agent connected' : 'Agent idle'})}\n\n`);
  tenant.subscribers.add(response);
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
  request.on('close', () => {
    clearInterval(heartbeat);
    tenant.subscribers.delete(response);
  });
}

function broadcast(tenant, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const subscriber of tenant.subscribers) subscriber.write(payload);
}

function stopAgent(tenantId, reason) {
  const tenant = tenants.get(tenantId);
  if (!tenant?.agentProcess) return;
  const child = tenant.agentProcess;
  tenant.agentProcess = null;
  if (tenant.idleTimer) {
    clearTimeout(tenant.idleTimer);
    tenant.idleTimer = null;
  }
  child.kill('SIGTERM');
  const message = reason === 'switch'
    ? 'Switching workspace'
    : reason === 'config'
      ? 'Configuration updated'
      : reason === 'evicted'
        ? 'Paused to free capacity — reopen to resume'
        : reason === 'idle'
          ? 'Paused after inactivity'
          : 'Generation stopped';
  broadcast(tenant, {type: 'bridge_status', status: 'stopped', message});
}

function agentCommand() {
  if (process.env.VIMAX_AGENT_COMMAND) {
    return {command: process.env.VIMAX_AGENT_COMMAND, args: splitArgs(process.env.VIMAX_AGENT_ARGS || '')};
  }
  const configuredPython = process.env.VIMAX_PYTHON_CMD;
  if (configuredPython) return {command: configuredPython, args: []};
  const bundledUv = process.env.VIMAX_UV_CMD || path.join(process.env.HOME || '', '.local', 'bin', 'uv');
  if (bundledUv && existsSync(bundledUv)) return {command: bundledUv, args: ['run', 'python']};
  const venvPython = path.join(repoRoot, '.venv', 'bin', 'python3');
  if (existsSync(venvPython)) return {command: venvPython, args: []};
  return {command: 'uv', args: ['run', 'python']};
}

function splitArgs(value) {
  return value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length > 1_000_000) throw new Error('Request body is too large');
  return JSON.parse(text);
}

async function readBinaryBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`File exceeds the ${formatByteLimit(maxBytes)} upload limit`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function formatByteLimit(bytes) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function sendJson(response, status, payload) {
  if (response.writableEnded) return;
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(payload));
}

async function streamArtifact(response, tenantRoot, sessionId, relativePath, rangeHeader) {
  const filePath = resolveArtifactPath(tenantRoot, sessionId, relativePath);
  if (!existsSync(filePath)) return sendJson(response, 404, {error: 'Artifact not found'});
  const contentType = artifactContentType(filePath);
  const size = statSync(filePath).size;
  const baseHeaders = {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=60',
    'Accept-Ranges': 'bytes',
  };

  // Byte-range support is required for <video> playback in Safari (and enables
  // seeking elsewhere): the browser sends `Range` and expects 206 Partial
  // Content. Without it Safari refuses to play and shows no poster frame.
  const range = parseRange(rangeHeader, size);
  if (range) {
    const {start, end} = range;
    response.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    createReadStream(filePath, {start, end}).pipe(response);
    return;
  }

  response.writeHead(200, {...baseHeaders, 'Content-Length': size});
  createReadStream(filePath).pipe(response);
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start = rawStart === '' ? null : Number(rawStart);
  let end = rawEnd === '' ? null : Number(rawEnd);
  if (start === null && end === null) return null;
  if (start === null) {
    // Suffix range: last N bytes.
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return {start, end};
}

async function serveProductionApp(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(webRoot, 'dist', requested);
  const distRoot = path.resolve(webRoot, 'dist');
  const safeCandidate = candidate.startsWith(`${distRoot}${path.sep}`) ? candidate : path.join(distRoot, 'index.html');
  const filePath = existsSync(safeCandidate) ? safeCandidate : path.join(distRoot, 'index.html');
  const body = await readFile(filePath);
  response.writeHead(200, {'Content-Type': artifactContentType(filePath)});
  response.end(body);
}

function shutdown() {
  for (const tenantId of tenants.keys()) stopAgent(tenantId, 'shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}
