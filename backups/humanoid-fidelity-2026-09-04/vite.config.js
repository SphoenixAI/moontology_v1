import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        go2Test: 'go2-test.html',
      },
    },
  },
});
