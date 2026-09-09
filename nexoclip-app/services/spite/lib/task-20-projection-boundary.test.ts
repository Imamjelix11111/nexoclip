import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOTS = [
  resolve(SERVICE_ROOT, 'app'),
  resolve(SERVICE_ROOT, 'lib'),
  resolve(SERVICE_ROOT, 'realtime'),
  resolve(SERVICE_ROOT, 'scripts'),
]

const ALLOWED_MUTATORS = new Map<string, Set<string>>([
  ['app/api/projects/[projectId]/route.ts', new Set(['delete'])],
  ['app/api/settings/clear-data/route.ts', new Set(['delete'])],
  ['realtime/projector.ts', new Set(['delete', 'insert'])],
])

const MUTATION_RE = /\b(insert into|update|delete from)\s+canvas_(nodes|edges)\b/g

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath))
      continue
    }
    if (entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

test('projection compatibility tables are only mutated by projector or lifecycle cleanup boundaries', async () => {
  const sourceFiles = (await Promise.all(SOURCE_ROOTS.map((root) => walk(root)))).flat()
  const offenders: Array<{ file: string; verb: string }> = []
  const allowHits = new Set<string>()

  for (const file of sourceFiles) {
    const relativePath = relative(SERVICE_ROOT, file).replace(/\\/g, '/')
    const contents = (await readFile(file, 'utf8')).toLowerCase()
    const matches = [...contents.matchAll(MUTATION_RE)]

    for (const match of matches) {
      const verb = match[1].startsWith('insert') ? 'insert' : match[1].startsWith('update') ? 'update' : 'delete'
      const allowedVerbs = ALLOWED_MUTATORS.get(relativePath)
      if (!allowedVerbs?.has(verb)) {
        offenders.push({ file: relativePath, verb })
        continue
      }
      allowHits.add(`${relativePath}:${verb}`)
    }
  }

  assert.deepEqual(offenders, [])
  assert.deepEqual([...allowHits].sort(), [
    'app/api/projects/[projectId]/route.ts:delete',
    'app/api/settings/clear-data/route.ts:delete',
    'realtime/projector.ts:delete',
    'realtime/projector.ts:insert',
  ])
})
