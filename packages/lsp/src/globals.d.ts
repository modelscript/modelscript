// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Connection, Diagnostic, TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SharedCompilerContextLike } from "./lsp-context.js";
import type {
  ClassInstanceLike,
  HierarchySymbolEntryLike,
  HierarchySymbolIndexLike,
  HierarchyWorkspaceLike,
} from "./utils/hierarchy-utils.js";

declare global {
  var parserReady: boolean;
  var parser: unknown;
  var sysml2ParserReady: boolean;
  var sysml2Parser: unknown;
  var stepParserReady: boolean;
  var stepParser: unknown;
  var owl2ParserReady: boolean;
  var owl2Parser: unknown;
  var sharedContext: SharedCompilerContextLike | null;
  var documents: TextDocuments<TextDocument>;
  var fqnCache: Map<string, number>;
  var fqnCacheIndex: Map<string, unknown>;
  var validateTextDocument: (doc: TextDocument) => Promise<void>;
  var activeValidationTimers: Map<string, ReturnType<typeof setTimeout>>;
  var activeValidationPromises: Map<string, Promise<void>>;
  var documentRevisions: Map<string, number>;
  var lastSemanticDiagnostics: Map<string, Diagnostic[]>;
  var verificationDiagnosticsByUri: Map<string, Diagnostic[]>;
  var verificationTimer: ReturnType<typeof setTimeout> | null;
  var revalidationTimer: ReturnType<typeof setTimeout> | null;
  var lastIndexedText: Map<string, string>;
  var dependenciesReady: boolean;
  var getReadyMessage: () => string;
  var injectPredefinedTypes: (index: never) => void;
  var runVerificationForUri: (uri: string) => Promise<unknown>;
  var projectTreeChangedTimer: ReturnType<typeof setTimeout> | null;
  var projectTreeChangedPending: boolean;
  var documentLSPBridges: Map<string, unknown>;
  var diagramCache: Map<string, { version: number | string; data: unknown }>;
  var clearIconCache: (() => void) | undefined;
  var cosimSimulators: Map<string, unknown>;
  var breakpointsMap: Map<string, { line: number; column?: number | undefined }[]>;
  var debuggerResumeCallback: (() => void) | undefined;
  var currentDebugEnv: Map<string, number> | undefined;
  var stepMode: boolean;
  var flattenArenaFromInstance: (classInstance: never, context?: unknown) => unknown;
  var savedLoaderCtx: unknown;
  var activeVerification: AbortController | null;
  var verificationResultsByUri: Map<string, unknown>;
  var simpleHash: (str: string) => number;
  // Hierarchy utility functions
  var getTreeChildrenFast: (
    index: HierarchySymbolIndexLike,
    parentId?: string,
    workspace?: HierarchyWorkspaceLike | null,
  ) => unknown[] | Promise<unknown[]>;
  var classKindFromEntry: (entry: HierarchySymbolEntryLike | null | undefined) => string;
  var isTreeVisible: (entry: HierarchySymbolEntryLike | null | undefined) => boolean;
  var getCompositeName: (entry: HierarchySymbolEntryLike, index: HierarchySymbolIndexLike) => string;
  var hasClassChildren: (index: HierarchySymbolIndexLike, symbolId: number) => boolean;
  var buildClassHierarchy: (classInstance: ClassInstanceLike | null | undefined, visited?: Set<string>) => unknown;
  var buildComponentTree: (classInstance: ClassInstanceLike | null | undefined, depth?: number) => unknown;
  var loadRegistryPackages: (packages: never[], ctx: never) => Promise<void>;
  var loadDependencyFromRegistry: (dep: { name: string; version: string }, ctx: never) => Promise<void>;
  // Constants
  var CLASS_KIND_KEYWORDS: string[];
  var SYSML2_RULE_TO_KIND: Record<string, string>;
  var SYSML2_TREE_KINDS: Set<string>;
  // Other state
  var activeSemanticTimers: Map<string, ReturnType<typeof setTimeout>>;
  var registryUrl: string;
  var csvParser: unknown;
  var csvParserReady: boolean;
  var ModelicaClassInstance: unknown;
  var createModelicaQueryEngine: (...args: never[]) => unknown;
  var createSysML2QueryEngine: (...args: never[]) => unknown;
  var getSharedCstTreeWrapper: () => unknown;
  var sharedFs: unknown;
  var connection: Connection;
}

declare module "occt-import-js" {
  export default function initOpenCascade(): Promise<unknown>;
}

export {};
