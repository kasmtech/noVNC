import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import { ViteMinifyPlugin } from 'vite-plugin-minify';
import ViteRestart from 'vite-plugin-restart'

function packageVersion() {
  return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
}

function kasmvncVersion() {
  if (process.env.KASMVNC_VERSION) {
    return process.env.KASMVNC_VERSION;
  }
  try {
    const fromFile = readFileSync(new URL('./kasmvnc-version.txt', import.meta.url), 'utf8').trim();
    return fromFile || packageVersion();
  } catch (e) {
    // No local override file: use package.json, as before this change.
    return packageVersion();
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: '',
  define: {
    __KASMVNC_VERSION__: JSON.stringify(kasmvncVersion()),
  },
  server: {
    host: '0.0.0.0'
  },
  plugins: [
    viteCommonjs(),
    envCompatible(),
    ViteMinifyPlugin(),
    ViteRestart({restart: ['core/**', 'app/**','kasmvnc-version.txt']}),
  ],
  build: {
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: {
        main: './index.html',
        screen: './screen.html',
      },
      output: {
        entryFileNames: '[name].bundle.js'
      }
    }
  },
})
