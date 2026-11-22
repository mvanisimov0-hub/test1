import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode "single" собирает всё приложение в один index.html,
// который можно открыть двойным кликом без сервера.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2500,
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
