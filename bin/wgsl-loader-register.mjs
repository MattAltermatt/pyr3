// Register the WGSL loader with Node's ESM hooks system.
// Used in addition to tsx (which handles .ts files) so that pyr3's
// `import shader from './x.wgsl?raw'` syntax works under Node.
import { register } from 'node:module';

// PYR3-069: resolve the loader relative to THIS file, not the process CWD.
// `pathToFileURL('./bin/wgsl-loader.mjs')` only worked when Node was launched
// from the repo root; `new URL('./…', import.meta.url)` works from anywhere.
register(new URL('./wgsl-loader.mjs', import.meta.url));
