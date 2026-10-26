// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/step — Standard Diagnostic Error Codes (T1001–T1010).
 */

export const StepErrorCode = {
  STEP_SYNTAX_ERROR: {
    code: 1001,
    rule: "step-syntax-error",
    severity: "error" as const,
    message: (detail: string) => `STEP file syntax error: ${detail}.`,
  },
  MISSING_HEADER_SECTION: {
    code: 1002,
    rule: "missing-header-section",
    severity: "error" as const,
    message: () => `STEP exchange file is missing mandatory 'HEADER;' section.`,
  },
  MISSING_SCHEMA_DECLARATION: {
    code: 1003,
    rule: "missing-schema-declaration",
    severity: "warning" as const,
    message: () => `STEP header lacks a recognized 'FILE_SCHEMA' declaration (e.g. AP203, AP214, AP242).`,
  },
  MISSING_DATA_SECTION: {
    code: 1004,
    rule: "missing-data-section",
    severity: "error" as const,
    message: () => `STEP exchange file is missing mandatory 'DATA;' section.`,
  },
  UNRESOLVED_ENTITY_REFERENCE: {
    code: 1005,
    rule: "unresolved-entity-reference",
    severity: "error" as const,
    message: (entityId: number | string) => `Referenced STEP entity '#${entityId}' is not defined in the DATA section.`,
  },
  DUPLICATE_ENTITY_ID: {
    code: 1006,
    rule: "duplicate-entity-id",
    severity: "error" as const,
    message: (entityId: number | string) => `Entity ID '#${entityId}' is declared more than once in the DATA section.`,
  },
  EMPTY_DATA_SECTION: {
    code: 1007,
    rule: "empty-data-section",
    severity: "warning" as const,
    message: () => `STEP DATA section contains no entity records.`,
  },
  UNSUPPORTED_AP_SCHEMA: {
    code: 1008,
    rule: "unsupported-ap-schema",
    severity: "warning" as const,
    message: (schema: string) =>
      `Application Protocol schema '${schema}' may not support complete PMI or B-Rep extraction.`,
  },
} as const;

export type StepErrorCodeKey = keyof typeof StepErrorCode;
