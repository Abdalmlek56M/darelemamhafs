import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // Two backends run locally: the legacy API on 5080 (all /api/* + the SPA)
    // and the new API on 5081 (/api/v1/*). Vite resolves proxy keys in declaration
    // order, so the more specific "/api/v1" must stay ABOVE "/api" — otherwise every
    // /api/v1/* call (teacher/supervisor portals) would hit the legacy host and 404.
    proxy: {
      '/api/v1': 'http://localhost:5081',
      '/api': 'http://localhost:5080',
      '/health': 'http://localhost:5080',
    },
  },
  build: {
    // In a release build, ASP.NET Core serves this exact UI and the API from one origin.
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'vendor-motion'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react'
        },
      },
    },
  },
})
