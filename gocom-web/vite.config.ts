import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Génère directement dans deploy/wwwroot (comme gocom) pour éviter la copie manuelle
    outDir: '../deploy/wwwroot',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Toutes les requêtes /api sont redirigées vers l'API .NET (évite les soucis CORS)
      '/api': {
        target: 'http://localhost:5044',
        changeOrigin: true,
      },
    },
  },
})