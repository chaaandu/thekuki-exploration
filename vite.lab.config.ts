import { defineConfig } from 'vite';

// Development-only lab for the 3D jars (not part of the theme build).
export default defineConfig({
  root: 'lab',
  publicDir: false,
  server: { port: 5180, strictPort: true, host: '127.0.0.1', fs: { allow: ['..'] } },
  optimizeDeps: { include: ['react', 'react-dom/client', '@react-three/fiber', '@react-three/drei', 'three'] },
});
