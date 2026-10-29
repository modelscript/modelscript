// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core Language Grammar Definition & Modular DSL Architecture.
 */

import type { LanguageAction } from "./action-types.js";
import type { ConnectorDefinition } from "./codegraph.js";
import type { Rule, RuleBuilder, RuleLike, TransformCombinator } from "./combinators.js";
import type { ContainerDeclaration } from "./container-types.js";
import type { DiagramConfig, PropertyInspectorConfig } from "./diagram-types.js";
import type { LanguageProtocolHandler } from "./lsp-types.js";
import type { McpDeclarationConfig } from "./mcp-types.js";
import { SOURCE_PATH_SYMBOL, SOURCE_TEXT_SYMBOL, type u32 } from "./primitives.js";
import type { ASTQueryFunction, CompilationPipeline, CompilerLint, ModelProperty } from "./query-types.js";
import type { ExternalScannerFunction, RuntimeFileInput, ScannerPrimitives } from "./scanner-types.js";
import type { TabularConfig } from "./tabular-types.js";
import type { PolyglotConfig } from "./tgg-types.js";
import type { WritebackConfig, WritebackHandler } from "./writeback-types.js";

/**
 * Declaration & Stub metadata configuration for Tier 1 Workspace Indexing.
 */
export interface SymbolConfig<FieldName extends string = string> {
  /** Field name containing the identifier token */
  name: FieldName;
  /** Symbol kind (e.g. 'Class', 'Package', 'Function', 'Variable') or field name containing kind */
  kind?: string | FieldName | undefined;
  /** Whether this symbol introduces a new nested lexical scope (default: true) */
  scope?: boolean | undefined;
  /** Field name containing the declared type (if typed declaration) */
  type?: FieldName | undefined;
  /** Field name containing the base / super class for inheritance */
  extends?: FieldName | undefined;
  /** Field name containing the visibility modifier (e.g. 'public' / 'protected') */
  visibility?: FieldName | undefined;
  /** VS Code Theme Codicon string (e.g. 'symbol-class', 'shield', 'plug') or SVG identifier */
  icon?: string | undefined;
  /** Whether this symbol should appear in the library/project sidebar tree (default: true for definitions) */
  treeVisible?: boolean | undefined;
  /** Category or grouping for tree display (e.g. 'Definitions', 'Requirements', 'Ports') */
  group?: string | undefined;
}

/**
 * Maturity classification for a ModelScript language package.
 * - "stable": Production-grade native WASM GLR parser, Salsa queries, and verification/simulation pipeline.
 * - "beta": Domain-complete parser, lowering, and IDE editor/diagram integration.
 * - "experimental": Early-stage domain parser, DAE/Modelica projection, or experimental support.
 */
export type LanguageMaturity = "stable" | "beta" | "experimental";

/**
 * Configuration options passed to the `language(...)` function.
 * Modeled after Tree-sitter's Grammar API.
 */
export interface LanguageOptions<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** The name of the language (e.g., 'modelica', 'javascript'). */
  name: string;

  /** Maturity level of this language integration ('stable' | 'beta' | 'experimental'). */
  maturity?: LanguageMaturity | undefined;

  /** Optional file path of the language source file for Direct Source AST extraction. */
  sourcePath?: string | undefined;

  /** Optional source code text of the language file for in-memory AST extraction. */
  sourceText?: string | undefined;

  /** Internal symbol property for source path */
  [SOURCE_PATH_SYMBOL]?: string | undefined;
  /** Internal symbol property for source text */
  [SOURCE_TEXT_SYMBOL]?: string | undefined;

  /**
   * Declarative Compilation & Lowering Pipelines (e.g. DAE Flattening, BLT Decomposition)
   */
  pipelines?: Record<string, CompilationPipeline<RuleName, FieldName, QueryName, ModelAttrs>> | undefined;

  /**
   * Declarative Physical Connector Port Definitions
   */
  connectors?: Record<string, ConnectorDefinition> | undefined;

  /**
   * Domain-Specific Abstract Interpretation & Solver Domains (DAE, Simulation, Reasoner, Octagon)
   */
  domains?: Record<string, any> | undefined;

  /**
   * Declarative Dataflow & Control Flow Analysis Configuration
   */
  dataflow?: any;

  /**
   * A rule name or token representing the language's typical keyword structure.
   * Tree-sitter uses this for keyword extraction optimization.
   */
  word?: string | RuleBuilder<RuleName, FieldName> | undefined;

  /**
   * A dictionary of grammar rules defining the language's syntax.
   * Keys are rule names, values are functions that compose rules.
   */
  rules?: Record<RuleName, RuleBuilder<RuleName, FieldName>> | undefined;

  /**
   * Host Queries allow WASM to call out to the host environment (Node.js/V8)
   * for complex semantic resolutions (e.g. multi-file workspace lookups) via FFI.
   */
  hostQueries?: Record<string, (facade: any, arg1: u32, arg2: u32, arg3: u32) => u32> | undefined;

  /**
   * Tokens to skip automatically (e.g., whitespace, comments) everywhere in the grammar.
   */
  extras?: (($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => RuleLike<any>[]) | undefined;

  /** Composable Scanner Primitives (Phase 1) */
  primitives?: ScannerPrimitives | undefined;

  /** External Scanner (Context-Sensitive Lexing) */
  externals?: (($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => Rule<any>[]) | undefined;

  /** External scanner logic compiled down to zero-overhead AssemblyScript / WASM. */
  scanner?:
    | ExternalScannerFunction
    | { scan: ExternalScannerFunction }
    | ((currentPos: number, scannerState: number) => number)
    | undefined;

  /**
   * Tree-sitter Parity: Rules that serve as supertypes (interfaces/abstract classes)
   * in the generated AST. Useful for aliases and unifying node queries.
   */
  supertypes?: (($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => Rule<any>[]) | undefined;

  /** Rules that should be inlined directly into their parents during codegen to reduce AST depth. */
  inline?: NoInfer<RuleName>[] | undefined;

  /** Expected GLR conflicts. Specifies arrays of rule names that can legitimately conflict. */
  conflicts?:
    | (($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => RuleLike<any>[][])
    | NoInfer<RuleName>[][]
    | undefined;

  /** When true, any unwhitelisted grammar conflicts will throw a compilation error instead of logging a warning. */
  strictConflicts?: boolean | undefined;

  /** Default precedence/associativity matrices for conflict resolution. */
  precedences?: string[][] | undefined;

  /**
   * Declarative bracket pairs for delimiter tracking, indentation, and AST balance hash.
   * Defaults to `[["{", "}"], ["[", "]"], ["(", ")"]]` if not specified.
   */
  brackets?: [string, string][] | undefined;

  /** Reserved keywords to omit from generic identifier matching. */
  reserved?: Record<string, ($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => Rule<any>[]> | undefined;

  model?:
    | Partial<
        Record<
          NoInfer<RuleName>,
          Record<string, ModelProperty | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>>
        >
      >
    | undefined;

  /** Queries (imperative AssemblyScript methods) */
  queries?: Record<QueryName, ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>> | undefined;

  /** Diagnostic Rules (imperative AssemblyScript methods) */
  lints?: Record<string, CompilerLint<RuleName, FieldName, QueryName, ModelAttrs>> | undefined;

  /** Canonical Diagnostic / Error Codes Dictionary */
  errorCodes?: Record<string, any> | undefined;

  /**
   * First-Class AssemblyScript / TypeScript Custom Classes
   * Injected as zero-GC `@unmanaged export class` definitions into WebAssembly linear memory.
   */
  classes?:
    | ((new (...args: any[]) => any) | ((...args: any[]) => any))[]
    | Record<string, (new (...args: any[]) => any) | ((...args: any[]) => any)>
    | undefined;

  /**
   * First-Class AssemblyScript / TypeScript Custom Helper Functions
   * Injected as exported functions into WebAssembly linear memory.
   */
  functions?: ((...args: any[]) => any)[] | Record<string, (...args: any[]) => any> | undefined;

  /**
   * Supplemental language-specific AssemblyScript runtime files
   * (e.g. Modelica-specific flattener, connection managers, or custom solvers).
   * Can be file objects with content, file objects with path, or direct file paths.
   */
  runtimeFiles?: RuntimeFileInput[] | undefined;

  /**
   * Optional directory containing supplemental AssemblyScript (.ts) runtime files
   * to automatically bundle into the WASM module.
   */
  runtimeDir?: string | undefined;

  /** Optional human-friendly display name (e.g. 'SysML v2'). Defaults to capitalized name. */
  displayName?: string | undefined;

  /** File extensions associated with this language (e.g. ['.sysml', '.sysml2']). */
  fileExtensions?: string[] | undefined;

  /** Dedicated Declaration & Stub Symbol Schema for Tier 1 Workspace Indexing and fast F12 */
  symbols?: Partial<Record<RuleName, SymbolConfig<FieldName>>> | undefined;

  /** Built-in Language Server Protocol features */
  lsp?:
    | {
        /** The file extension associated with this language (e.g. '.mo'). Defaults to '.<name>' */
        fileExtension?: string | undefined;
        /** File extensions associated with this language (e.g. ['.sysml', '.sysml2']). */
        fileExtensions?: string[] | undefined;
        /** Relative paths to light and dark mode file icons */
        icons?:
          | {
              light: string;
              dark: string;
            }
          | undefined;
        /** List of node types that can be folded */
        folding?: NoInfer<RuleName>[] | undefined;
        /** List of node types that define a new variable scope */
        outline?: NoInfer<RuleName>[] | undefined;
        /** AssemblyScript callback or function name for goto definition */
        definition?: string | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs> | undefined;
        /**
         * Language-specific custom LSP protocol handlers.
         * Handlers receive a `LanguageRequestContext` and request parameters,
         * allowing language packages to implement custom JSON-RPC endpoints
         * (e.g. CAD component extraction, geometry export, multi-body generation).
         */
        handlers?: Record<string, LanguageProtocolHandler> | undefined;
      }
    | undefined;

  /** Zero-GC Code Formatter & Unparser Configuration */
  formatting?:
    | {
        indentSize?: number | undefined;
        newlineBeforeBrace?: boolean | undefined;
        rules?: Record<string, (node: any, out: any) => void> | undefined;
      }
    | undefined;

  /** Declarative 2D Diagram & Visual Modeling Configuration */
  diagram?: DiagramConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;

  /** Declarative & Programmatic Bidirectional Tabular View / Spreadsheet Editor Configuration */
  tabular?: TabularConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;

  /** Declarative Property Inspector Configuration */
  properties?: PropertyInspectorConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;

  /** Declarative Control Flow Graph Nodes Configuration */
  cfgNodes?:
    | Record<
        string,
        {
          condition?: string | undefined;
          trueBranch?: string | undefined;
          falseBranch?: string | undefined;
          branchList?: string | undefined;
          isLoop?: boolean | undefined;
          isBreak?: boolean | undefined;
          isContinue?: boolean | undefined;
          isReturn?: boolean | undefined;
          tryBody?: string | undefined;
          catchBody?: string | undefined;
          finallyBody?: string | undefined;
        }
      >
    | undefined;

  /** Declarative Lattice-Based Data Flow Analysis Engine Configuration */
  analysis?:
    | Record<
        string,
        {
          lattice?: string[] | undefined;
          direction?: "forward" | "backward" | undefined;
          join?: ((...args: any[]) => any) | undefined;
          transfer?: ((...args: any[]) => any) | undefined;
        }
      >
    | undefined;

  /** Equality Saturation and E-Graph Algebraic Simplifications */
  simplification?:
    | {
        rules: (
          | {
              name: string;
              lhs: TransformCombinator | string | ((...args: any[]) => any);
              rhs: TransformCombinator | string | ((...args: any[]) => any);
            }
          | Record<string, (...args: any[]) => [any, any] | any>
          | Record<string, any>
        )[];
      }
    | undefined;

  /** Zero-GC Hindley-Milner Type System Engine Configuration */
  typeSystem?:
    | {
        constraints?: ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs> | undefined;
        subtypingPredicates?: (string | ((db: any, sourceId: number, targetId: number) => boolean))[] | undefined;
        customCode?: string | undefined;
      }
    | undefined;

  /** DL-Lite / Datalog Semantic Reasoning Engine Configuration */
  semantics?:
    | {
        rules?: (string | ((...args: any[]) => any) | object)[] | undefined;
        axioms?: (string | ((...args: any[]) => any) | object)[] | undefined;
        vocabularies?: string[] | undefined;
        extensions?: Record<string, string[]> | undefined;
        maxArity?: number | undefined;
        extraction?: Record<string, string> | undefined;
        typeExtraction?: Record<string, string> | undefined;
        pathResolution?:
          | {
              ownership: string;
              naming: string;
              subsetting?: string | undefined;
            }
          | boolean
          | undefined;
        reasoner?:
          | {
              maxFacts?: number | undefined;
            }
          | undefined;
      }
    | undefined;

  /** Target Hardware & Backend Code Generation Options */
  targets?:
    | {
        /** WebGPU Compute Shader Options */
        webgpu?:
          | {
              tileSize?: number | undefined;
              workgroupSize?: [number, number] | undefined;
            }
          | undefined;
        /** WebAssembly Text (WAT) Emitter Options */
        wat?:
          | {
              exportName?: string | undefined;
              simd?: boolean | undefined;
            }
          | undefined;
        /** WASM Interface Types (WIT) Generator Options */
        wit?:
          | {
              package?: string | undefined;
              world?: string | undefined;
            }
          | undefined;
        /** CUDA GPU Kernel Emitter Options */
        cuda?:
          | {
              blockSize?: number | undefined;
              gridSize?: number | undefined;
              arch?: string | undefined;
            }
          | undefined;
        /** LLVM IR Backend Options */
        llvm?:
          | {
              targetTriple?: string | undefined;
              optLevel?: number | undefined;
            }
          | undefined;
      }
    | undefined;

  /** Module System Configuration */
  moduleSystem?:
    | {
        resolve_module?: boolean | undefined;
      }
    | undefined;

  /** Error Recovery Configuration */
  recovery?:
    | {
        /** Sync tokens for error recovery anchors */
        sync?: string[] | undefined;
        /** Token names or strings treated as scope delimiters for insertion penalties */
        delimiters?: string[] | undefined;
        /** Operator strings penalized during insertion */
        operators?: string[] | undefined;
        /** Rule names classified as structural scope boundaries for unwind penalties */
        structuralRules?: NoInfer<RuleName>[] | undefined;
      }
    | undefined;

  /**
   * Polyglot Cross-Language Transformation Configuration.
   * Declares Triple Graph Grammar (TGG) rules for bidirectional model projection.
   */
  polyglot?: PolyglotConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;

  /**
   * Declarative Model Context Protocol (MCP) Configuration.
   * Defines AI/LLM tools, resources, and prompt templates compiled to zero-copy in-WASM handlers.
   */
  mcp?: McpDeclarationConfig<RuleName, FieldName, QueryName, ModelAttrs> | undefined;

  /**
   * First-Class Language Actions & Tools.
   * Defines commands, UI manifestations (toolbar buttons, menus, hotkeys),
   * VS Code Language Model tools, and domain execution logic.
   */
  actions?: LanguageAction[] | undefined;

  /**
   * Declarative Container & Archive Configuration (.ssp, .fmu, .molib, .jar, etc.).
   * Defines custom extractor lambdas, manifest routing, and polyglot target projections.
   */
  container?: ContainerDeclaration<RuleName> | undefined;

  /**
   * Starter / scaffolding project templates contributed by this language.
   */
  templates?:
    | {
        id: string;
        title: string;
        description: string;
        category?: string | undefined;
        files: Record<string, string>;
      }[]
    | undefined;

  /**
   * Requirements & traceability configuration for spreadsheet/matrix editors.
   */
  requirements?:
    | {
        requirementRules?: string[] | undefined;
        matrixRules?: string[] | undefined;
      }
    | undefined;

  /**
   * Declarative or functional Bi-Directional Writeback configuration.
   * Defines how values edited in markdown previews, spreadsheets, property inspectors,
   * or digital thread twins are patched back into source code for this language.
   */
  writeback?: WritebackConfig | WritebackHandler | undefined;
}

/**
 * Main entry point for defining a new language grammar.
 *
 * @param options The language configuration object
 * @returns The unaltered configuration object (preserves types for downstream compilation)
 */
export function language<
  RuleName extends string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
>(
  options: LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>,
): LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  if (options.sourcePath) {
    (options as any)[SOURCE_PATH_SYMBOL] = options.sourcePath;
  }
  if (options.sourceText) {
    (options as any)[SOURCE_TEXT_SYMBOL] = options.sourceText;
  }

  // Auto-detect caller source file path via stack trace if not explicitly provided
  if (!(options as any)[SOURCE_PATH_SYMBOL] && !(options as any)[SOURCE_TEXT_SYMBOL]) {
    try {
      const err = new Error();
      if (err.stack) {
        const lines = err.stack.split("\n");
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (
            line.includes("/dsl.") ||
            line.includes("\\dsl.") ||
            line.includes("/dsl/") ||
            line.includes("\\dsl\\") ||
            line.includes("/packages/dsl/") ||
            line.includes("\\packages\\dsl\\") ||
            line.includes("/packages/runtime/") ||
            line.includes("\\packages\\runtime\\") ||
            line.includes("/packages/language/") ||
            line.includes("\\packages\\language\\") ||
            line.includes("node_modules") ||
            line.includes("internal/")
          ) {
            continue;
          }
          const match = line.match(/(?:file:\/\/)?(\/[^:\s)]+):(?:\d+):(?:\d+)/);
          if (match && match[1]) {
            (options as any)[SOURCE_PATH_SYMBOL] = match[1];
            break;
          }
        }
      }
    } catch {
      // Ignore stack inspection failures in restricted runtimes
    }
  }

  return options;
}

/** Alias for `language` grammar definition */
export const grammar = language;

// ---------------------------------------------------------------------------
// Re-exports from focused sub-modules (100% backward compatibility)
// ---------------------------------------------------------------------------

export * from "./action-types.js";
export * from "./codegraph.js";
export * from "./combinators.js";
export * from "./config-types.js";
export * from "./container-types.js";
export * from "./dae-types.js";
export * from "./diagram-types.js";
export * from "./lsp-types.js";
export * from "./mcp-types.js";
export * from "./primitives.js";
export * from "./query-types.js";
export * from "./scanner-types.js";
export * from "./tabular-types.js";
export * from "./tgg-types.js";

export {
  AffineArithmeticMixin,
  CSGMixin,
  McCormickMixin,
  SparsityMixin,
  StandardAdjointMixin,
  StandardHessianMixin,
  StandardIntervalMixin,
  StandardTangentMixin,
} from "../codegen/transform_mixins.js";
