// Ambient declaration for `*.wgsl?raw` imports used by engine modules.
// Vite provides this via vite/client in the browser path; this file gives
// the engine-only tsconfig (which drops vite/client to enforce no-DOM) the
// same shape, and the Node CLI gets it via bin/wgsl-loader.mjs at runtime.
declare module '*.wgsl?raw' {
  const text: string;
  export default text;
}
