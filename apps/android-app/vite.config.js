import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 打包成相对路径资源，Capacitor 用 file:// 加载本地页面
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1200
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
