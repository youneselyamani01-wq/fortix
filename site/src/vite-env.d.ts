/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_URL?: string;
  readonly VITE_VERIFIER_URL?: string;
  readonly VITE_DOCS_URL?: string;
  readonly VITE_GITHUB_URL?: string;
  readonly VITE_CANONICAL_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
