// Register the WGSL loader with Node's ESM hooks system.
// Used in addition to tsx (which handles .ts files) so that pyr3's
// `import shader from './x.wgsl?raw'` syntax works under Node.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(pathToFileURL('./bin/wgsl-loader.mjs'));
