/// <reference types="vite/client" />

/** Version in package.json, injected at build time (vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  /** Where the free library is published; a fork points it at its own copy. */
  readonly VITE_LIBRARY_BASE_URL?: string;
}
