import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Writes .br and .gz copies of every compressible asset; src/server/app.ts sends them to browsers
// that accept them. Monaco and its workers are ~11MB raw, ~2.5MB gzip, ~1.9MB brotli.
function precompress(): Plugin {
  let assetsDir = '';
  return {
    name: 'bincode-precompress',
    apply: 'build',
    configResolved(config) {
      assetsDir = path.resolve(config.root, config.build.outDir, config.build.assetsDir);
    },
    closeBundle() {
      for (const name of fs.readdirSync(assetsDir)) {
        if (!/\.(js|css|svg|ttf)$/.test(name)) continue;
        const file = path.join(assetsDir, name);
        const data = fs.readFileSync(file);
        if (data.length < 1024) continue;
        const brotli = zlib.brotliCompressSync(data, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
          },
        });
        fs.writeFileSync(`${file}.br`, brotli);
        fs.writeFileSync(`${file}.gz`, zlib.gzipSync(data, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  plugins: [react(), precompress()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
