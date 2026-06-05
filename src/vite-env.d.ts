/// <reference types="vite/client" />

// #1: build-time version constant injected by vite.config.ts `define`
// (and mirrored in vitest.config.ts). Single-sourced from package.json.
declare const __PYR3_VERSION__: string;

// #103 Phase 2 Task 2.5: build-time date constant ("YYYY-MM-DD") injected
// by vite.config.ts at build time and mirrored in vitest.config.ts. Used
// by the /about page's version chip alongside __PYR3_VERSION__.
declare const __BUILD_DATE__: string;
