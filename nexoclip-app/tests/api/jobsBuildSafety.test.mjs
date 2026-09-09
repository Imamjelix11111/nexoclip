import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function importRouteWithoutDatabaseUrl(routePath) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `delete process.env.DATABASE_URL; await import(new URL(${JSON.stringify(routePath)}, new URL('file://' + process.cwd() + '/')).href);`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env },
      },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}

test('job route modules import without DATABASE_URL at module evaluation time', async () => {
  const routes = [
    './app/api/jobs/route.js',
    './app/api/jobs/[id]/route.js',
  ];

  for (const route of routes) {
    const { code, stderr } = await importRouteWithoutDatabaseUrl(route);
    assert.equal(code, 0, `${route} failed to import without DATABASE_URL:\n${stderr}`);
  }
});
