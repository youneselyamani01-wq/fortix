import { readFileSync } from "node:fs";
import vinext from "vinext";
import { defineConfig } from "vite";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// Local reproduction has no deployment bindings or credentials.
const d1: string | undefined = undefined;
const r2: string | undefined = undefined;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

// Optional trusted local HTTPS for mobile WebCrypto; no change to default binding.
const tlsCertificate = process.env.FORTIX_DEV_TLS_CERT;
const tlsPrivateKey = process.env.FORTIX_DEV_TLS_KEY;
if (Boolean(tlsCertificate) !== Boolean(tlsPrivateKey)) {
  throw new Error("Set both FORTIX_DEV_TLS_CERT and FORTIX_DEV_TLS_KEY for local HTTPS.");
}
const localHttps = tlsCertificate && tlsPrivateKey
  ? { cert: readFileSync(tlsCertificate), key: readFileSync(tlsPrivateKey) }
  : undefined;

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(localHttps ? { https: localHttps } : {}),
      ...(process.env.FORTIX_LAN_MODE === "1" ? { strictPort: true } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
