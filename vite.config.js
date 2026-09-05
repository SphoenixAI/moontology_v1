import { defineConfig } from 'vite';

export default defineConfig({
  // Some source FBXs embed JPEGs with an `_jpg` suffix. Only normalize the
  // loader's MIME lookup; the files, image bytes and texture lookup keys stay intact.
  optimizeDeps: { exclude: ['three/addons/loaders/FBXLoader.js'] },
  plugins: [{
    name: 'fbx-embedded-image-suffix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('/loaders/FBXLoader.js')) return null;
      const original = "const fileName = videoNode.RelativeFilename || videoNode.Filename;";
      if (!code.includes(original)) {
        throw new Error('FBXLoader changed: recheck the embedded-image suffix compatibility patch.');
      }
      return {
        code: code.replace(original,
          "const fileName = ( videoNode.RelativeFilename || videoNode.Filename ).replace( /_(jpg|jpeg|png)$/i, '.$1' );"),
        map: null,
      };
    },
  }],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        go2Test: 'go2-test.html',
      },
    },
  },
});
