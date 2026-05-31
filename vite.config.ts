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
});
