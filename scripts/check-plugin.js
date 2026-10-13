// CI syntax check for the installable bundle.
//
// The two halves are checked the way each is actually loaded:
//   * `bundle/index.js` is an ES module — the Cordis Loader imports it, so it
//     must import cleanly and export the plugin surface (`apply`, `inject`).
//   * `bundle/client.js` is a browser script — `window.__ModuleLoader__.load`
//     evaluates it as a plain script, so it must parse as a function body and
//     must not reference an import.
//
// The second check matters because a stray `import` / `export` in the client
// half only fails at page boot, long after install, as a blank slot.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failed = false

/** Report one failure without aborting the other checks. */
function fail(file, message) {
  failed = true
  console.error(`✗ ${file} — ${message}`)
}

// ── bundle/index.js — must load as an ES module ──────────────────────────────
const hostFile = 'bundle/index.js'
try {
  const mod = await import(pathToFileURL(join(root, hostFile)).href)
  const missing = ['apply', 'inject'].filter((name) => typeof mod[name] === 'undefined')
  if (missing.length > 0) {
    fail(hostFile, `missing export(s): ${missing.join(', ')}`)
  } else if (typeof mod.apply !== 'function') {
    fail(hostFile, 'export "apply" is not a function')
  } else if (!Array.isArray(mod.inject)) {
    fail(hostFile, 'export "inject" is not an array')
  } else {
    console.log(`✓ ${hostFile} — ES module loads (export ${Object.keys(mod).sort().join(', ')})`)
  }
} catch (err) {
  fail(hostFile, err.message)
}

// ── bundle/client.js — must parse as a plain script body ─────────────────────
const clientFile = 'bundle/client.js'
const clientCode = readFileSync(join(root, clientFile), 'utf8')
try {
  // eslint-disable-next-line no-new-func
  new Function(clientCode)
  const importLike = clientCode.match(/^\s*(?:import|export)\b/m)
  if (importLike !== null) {
    fail(clientFile, `contains a top-level \`${importLike[1]}\` statement — the browser module is a plain script`)
  } else {
    console.log(`✓ ${clientFile} — valid script body (${clientCode.length} chars)`)
  }
} catch (err) {
  fail(clientFile, err.message)
}

if (failed) process.exit(1)
console.log('All bundle halves load cleanly.')
