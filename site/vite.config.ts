import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Optional trusted local HTTPS for mobile WebCrypto; no change to default binding.
const tlsCertificate = process.env.FORTIX_DEV_TLS_CERT;
const tlsPrivateKey = process.env.FORTIX_DEV_TLS_KEY;
if (Boolean(tlsCertificate) !== Boolean(tlsPrivateKey)) {
  throw new Error("Set both FORTIX_DEV_TLS_CERT and FORTIX_DEV_TLS_KEY for local HTTPS.");
}
const localHttps = tlsCertificate && tlsPrivateKey
  ? { cert: readFileSync(tlsCertificate), key: readFileSync(tlsPrivateKey) }
  : undefined;

export default defineConfig({
  server: { ...(localHttps ? { https: localHttps } : {}) },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three")) {
            return "three";
          }
          if (id.includes("@react-three")) {
            return "r3f";
          }
          if (id.includes("node_modules/motion")) {
            return "motion";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: true,
  },
});
