import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_POLYDATA_API_BASE_URL || 'http://127.0.0.1:5000';

  return {
    plugins: [preact()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/wm-api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/wm-api/, ''),
        },
      },
    },
  };
});
