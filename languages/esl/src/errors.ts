// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/esl` (ESL1001–ESL5006).
 */

export interface EslDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  symbolName?: string | undefined;
}

export const EslErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "ESL1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `ESL syntax error: ${detail}.`,
  },
  DUPLICATE_DECLARATION: {
    code: 2001,
    id: "ESL2001",
    rule: "duplicate-declaration",
    severity: "error" as const,
    message: (name: string, scope: string) => `Duplicate declaration of identifier '${name}' in '${scope}'.`,
  },
  UNDEFINED_IDENTIFIER: {
    code: 2002,
    id: "ESL2002",
    rule: "undefined-identifier",
    severity: "error" as const,
    message: (name: string, scope: string) => `Identifier '${name}' is not declared in '${scope}'.`,
  },
  INVALID_DERIVATIVE_TARGET: {
    code: 3001,
    id: "ESL3001",
    rule: "invalid-derivative-target",
    severity: "error" as const,
    message: (name: string, reason: string) => `Invalid derivative target '${name}'': ${reason}.`,
  },
  MISMATCHED_BLOCK_END: {
    code: 4001,
    id: "ESL4001",
    rule: "mismatched-block-end",
    severity: "error" as const,
    message: (kind: string, name: string, actual: string) =>
      `Mismatched block terminator for ${kind} '${name}': expected 'END ${name}' or 'END', found '${actual}'.`,
  },
  INVALID_WHEN_DISCONTINUITY: {
    code: 5001,
    id: "ESL5001",
    rule: "invalid-when-discontinuity",
    severity: "error" as const,
    message: (reason: string) => `Invalid WHEN discontinuity expression: ${reason}.`,
  },
  SUBMODEL_ARITY_MISMATCH: {
    code: 5006,
    id: "ESL5006",
    rule: "submodel-arity-mismatch",
    severity: "error" as const,
    message: (callee: string, expected: number, actual: number) =>
      `Submodel '${callee}' expects ${expected} argument(s), but ${actual} were provided.`,
  },
} as const;

export type EslErrorCodeKey = keyof typeof EslErrorCode;
