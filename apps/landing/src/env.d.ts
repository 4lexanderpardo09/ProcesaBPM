interface ImportMetaEnv {
  /** Google Analytics 4 measurement id (G-…); empty: no analytics. */
  readonly PUBLIC_GA_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
