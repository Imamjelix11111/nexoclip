import assert from 'node:assert'
import { resolveDurableJobId, shortJobId } from './job-tracing'

assert.equal(resolveDurableJobId({ generationId: 'active-id', lastGenerationId: 'old-id' }), 'active-id')
assert.equal(resolveDurableJobId({ lastGenerationId: 'terminal-id' }), 'terminal-id')
assert.equal(resolveDurableJobId({}), null)
assert.equal(shortJobId('84ca8451-894e-43d7-8e2f-0fee6abfd292'), '84ca8451…')
assert.equal(shortJobId('12345678'), '12345678')
assert.equal(shortJobId('abc'), 'abc')

console.log('ok')
