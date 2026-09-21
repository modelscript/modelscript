/**
 * Scanner primitives, lexer contexts, and external scanner types.
 */

/**
 * Built-in scanner primitives that can automatically handle complex, context-sensitive lexing
 * without requiring the user to write manual external C/WASM scanners.
 */
export interface ScannerPrimitives {
  /** Nested block comments: { open: '/*', close: '*\/' } */
  nestedComment?: { open: string; close: string };
  /** Line comments: '//' or '#' */
  lineComment?: string;
  /** Escaped/quoted identifiers: { quote: "'", escape?: '\\' } */
  escapedIdent?: { quote: string; escape?: string };
  /** String literals with escape sequences: { delim: '"', escapes: { '\\n': 10, ... } } */
  stringLiteral?: { delim: string; escapes?: Record<string, number> };
  /** Multi-word keywords that should be lexed as single tokens: ['end if', 'end for'] */
  multiWordKeywords?: string[];
  /** Python-style indentation layout parsing */
  layout?: {
    indent: string;
    dedent: string;
  };
}

/**
 * Input definition for custom language AssemblyScript runtime files.
 */
export type RuntimeFileInput = { filename?: string; content?: string; path?: string } | string;

/**
 * Context provided to an external scanner lambda.
 */
export interface LexerContext {
  /** The lookahead character code at the current lexer position (-1 or 0 if EOF). */
  readonly lookahead: number;
  /** Current byte position in input. */
  readonly pos: number;
  /** Length of the token currently being scanned. */
  readonly length: number;
  /** Custom 32-bit integer scanner state tracked per GLR head. */
  state: number;
  /** Peeks a character code at the given offset relative to current position. */
  peek(offset?: number): number;
  /** Advances the lexer by 1 or more characters. */
  advance(count?: number): void;
  /** Marks the end of the current token. */
  markEnd(): void;
  /** Skips whitespace characters (spaces, tabs, newlines). */
  skipWhitespace(): void;
  /** Checks whether a specific token symbol is expected by the parser in this state. */
  isExpected(token: number | any): boolean;
  /** Returns true if at or beyond EOF. */
  isEof(): boolean;
}

/**
 * Valid tokens interface passed to the external scanner lambda.
 */
export interface ValidTokens {
  /** Returns true if the given terminal symbol is expected in the current parser state. */
  has(token: number | any): boolean;
  [key: number]: boolean;
}

/**
 * First-class external scanner lambda function compiling down to AssemblyScript / WASM.
 */
export type ExternalScannerFunction =
  | (($: Record<string, any>, lexer: LexerContext, valid: ValidTokens) => number)
  | ((lexer: LexerContext, valid: ValidTokens) => number)
  | (($: Record<string, any>) => (lexer: LexerContext, valid: ValidTokens) => number);
