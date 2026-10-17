/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  /** Where the free library is published; a fork points it at its own copy. */
  readonly VITE_LIBRARY_BASE_URL?: string;
}
