// Resolves the package version once at module load. Works in both tsx
// (filesystem read of package.json) and SEA (SEA asset lookup).

import { createRequire } from 'node:module';

declare const require: NodeJS.Require | undefined;
const builtinRequire: NodeJS.Require =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);

function resolveVersion(): string {
  // SEA path: read embedded package.json asset if available.
  try {
    const sea = builtinRequire('node:sea') as { isSea?: () => boolean; getAsset?: (k: string, e?: string) => string };
    if (sea?.isSea?.() && sea.getAsset) {
      try {
        const text = sea.getAsset('package.json', 'utf8');
        return (JSON.parse(text) as { version?: string }).version ?? '0.0.0';
      } catch {
        // fall through
      }
    }
  } catch {
    // not a SEA binary
  }
  // Source / tsx path: walk up to the repo root.
  try {
    const cjsRequire = createRequire(import.meta.url ?? `file://${process.execPath}`);
    return (cjsRequire('../package.json') as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const version: string = resolveVersion();
