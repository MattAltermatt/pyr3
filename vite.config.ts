import { defineConfig } from 'vite';

export default defineConfig({
  // Apex custom-domain base. The site serves at https://pyr3.app/ (GitHub
  // Pages custom domain via public/CNAME). All app code uses
  // import.meta.env.BASE_URL, so this is the only line that changes between
  // the apex domain (base '/') and the project-Pages fallback (base '/pyr3/').
  base: '/',
  server: {
    open: false,
  },
});
