/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module "monaco-editor/esm/vs/editor/edcore.main" {
  export * from "monaco-editor";
}

declare module "monaco-editor/esm/vs/basic-languages/*";
