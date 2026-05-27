// Node ESM loader: handle Vite's `import shader from './x.wgsl?raw'` syntax
// by returning the file contents as a default-export module.
//
// Used by `npm run render`. Browser/Vite path is unaffected (Vite supplies
// its own ?raw handling).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Match any URL referencing a .wgsl file regardless of query-string chain
// (`.wgsl`, `.wgsl?raw`, `.wgsl?wgsl?raw` — Node 26's loader can call
// resolve twice and accrete suffixes).
const WGSL_URL = /\.wgsl(\?.*)?$/;

export async function resolve(specifier, context, nextResolve) {
  if (WGSL_URL.test(specifier)) {
    const clean = specifier.replace(/\.wgsl(\?.*)?$/, '.wgsl');
    const resolved = await nextResolve(clean, context);
    return { url: resolved.url + '?wgsl', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (WGSL_URL.test(url)) {
    const path = fileURLToPath(url.replace(/\.wgsl(\?.*)?$/, '.wgsl'));
    const text = readFileSync(path, 'utf8');
    return {
      format: 'module',
      source: `export default ${JSON.stringify(text)};`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
