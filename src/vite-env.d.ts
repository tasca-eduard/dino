/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server base URL (http(s) or ws(s)) when the client is hosted separately, e.g. on Vercel. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
