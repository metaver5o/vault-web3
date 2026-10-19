import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    nodePolyfills({
      // Polyfill Node.js crypto used in @web3-vault/core
      include: ["crypto", "buffer", "stream", "util"],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    react(),
  ],
  server: {
    port: 3000,
    proxy: {
      "/v1": "http://localhost:8200",
      // Proxy Trezor Bridge requests to bypass Bridge 3.x CORS restriction.
      // Bridge only whitelists specific origins; tunnelling through Vite avoids
      // the cross-origin issue entirely.
      "/trezor-bridge": {
        target: "http://localhost:21325",
        rewrite: (path: string) => path.replace(/^\/trezor-bridge/, ""),
        changeOrigin: true,
        headers: {
          Origin: "https://connect.trezor.io",
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
