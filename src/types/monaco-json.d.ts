declare module "monaco-editor/language/json/monaco.contribution" {
  type SeverityLevel = "error" | "warning" | "ignore";

  interface DiagnosticsOptions {
    validate?: boolean;
    allowComments?: boolean;
    schemas?: {
      uri: string;
      fileMatch?: string[];
      schema?: unknown;
    }[];
    enableSchemaRequest?: boolean;
    schemaValidation?: SeverityLevel;
    schemaRequest?: SeverityLevel;
    trailingCommas?: SeverityLevel;
  }

  interface LanguageServiceDefaults {
    setDiagnosticsOptions(options: DiagnosticsOptions): void;
  }

  export const jsonDefaults: LanguageServiceDefaults;
}
