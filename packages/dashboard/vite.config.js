import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // './' makes all asset paths relative — works on any subfolder without configuration
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
