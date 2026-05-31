/// <reference types="vite/client" />

// #1: build-time version constant injected by vite.config.ts `define`
// (and mirrored in vitest.config.ts). Single-sourced from package.json.
declare const __PYR3_VERSION__: string;
