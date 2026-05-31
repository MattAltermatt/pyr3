import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// #1: single-source the app version from package.json and inject it as a build
// constant, so the top-bar version chip can never drift from the real version.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  define: {
    __PYR3_VERSION__: JSON.stringify(version),
  },
  // Apex custom-domain base. The site serves at https://pyr3.app/ (GitHub
  // Pages custom domain via public/CNAME). All app code uses
  // import.meta.env.BASE_URL, so this is the only line that changes between
  // the apex domain (base '/') and the project-Pages fallback (base '/pyr3/').
  base: '/',
  server: {
    open: false,
  },
  // #33: brotli-dec-wasm loads its `.wasm` via `new URL("...wasm", import.meta.url)`
  // (the standard wasm-bindgen web-target pattern). Vite's dev-server pre-bundles
  // node_modules via esbuild, which breaks that import.meta.url resolution and the
  // wasm fetch falls through to the SPA index.html — `WebAssembly.instantiate`
  // then chokes on HTML magic bytes. Excluding the package from dep-optimization
  // keeps its source unbundled in dev so Vite's native wasm asset handling kicks
  // in. Production build (`vite build`) emits + serves the wasm correctly and is
  // unaffected by this option.
  optimizeDeps: {
    exclude: ['brotli-dec-wasm'],
  },
});
