// CI syntax check: every plugin half must remain a valid JavaScript function
// body, because that is exactly how the DeepSeek Harness plugin editor
// evaluates it (code.host / code.client are function bodies, not modules).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failed = false
for (const file of ['plugin/host.js', 'plugin/client.js']) {
  const code = readFileSync(join(root, file), 'utf8')
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)
    console.log(`✓ ${file} — valid function body (${code.length} chars)`)
  } catch (err) {
    failed = true
    console.error(`✗ ${file} — ${err.message}`)
  }
}
if (failed) process.exit(1)
console.log('All plugin halves parse cleanly.')
