/* eslint-disable */
declare global {
  var parserReady: boolean;
  var parser: any;
  var sysml2ParserReady: boolean;
  var sysml2Parser: any;
  var stepParserReady: boolean;
  var stepParser: any;
  var owl2ParserReady: boolean;
  var owl2Parser: any;
  var sharedContext: any;
  var documents: any;
  var fqnCache: Map<string, number>;
  var fqnCacheIndex: any;
  var validateTextDocument: (doc: any) => Promise<void>;
  var activeValidationTimers: any;
  var activeValidationPromises: any;
  var documentRevisions: any;
  var lastSemanticDiagnostics: any;
  var verificationDiagnosticsByUri: any;
  var verificationTimer: any;
  var revalidationTimer: any;
  var lastIndexedText: any;
  var dependenciesReady: boolean;
  var getReadyMessage: () => string;
  var injectPredefinedTypes: (index: any) => void;
  var runVerificationForUri: (uri: string) => Promise<any>;
  var projectTreeChangedTimer: any;
  var projectTreeChangedPending: boolean;
  var documentLSPBridges: any;
  var diagramCache: any;
  var clearIconCache: any;
  var cosimSimulators: any;
  var breakpointsMap: any;
  var debuggerResumeCallback: (() => void) | undefined;
  var currentDebugEnv: Map<string, number> | undefined;
  var stepMode: boolean;
  var flattenArenaFromInstance: (classInstance: any, context: any) => any;
  var savedLoaderCtx: any;
  var activeVerification: any;
  var verificationResultsByUri: any;
  var simpleHash: (str: string) => number;
  // Hierarchy utility functions
  var getTreeChildrenFast: (index: any, parentId?: string) => any[];
  var classKindFromEntry: (entry: any) => string;
  var isTreeVisible: (entry: any) => boolean;
  var getCompositeName: (entry: any, index: any) => string;
  var hasClassChildren: (index: any, symbolId: number) => boolean;
  var buildClassHierarchy: (classInstance: any, visited?: Set<string>) => any;
  var buildComponentTree: (classInstance: any, depth?: number) => any;
  var loadRegistryPackages: (packages: any[], ctx: any) => Promise<void>;
  var loadDependencyFromRegistry: (dep: { name: string; version: string }, ctx: any) => Promise<void>;
  // Constants
  var CLASS_KIND_KEYWORDS: string[];
  var SYSML2_RULE_TO_KIND: Record<string, string>;
  var SYSML2_TREE_KINDS: Set<string>;
  // Other state
  var activeSemanticTimers: any;
  var registryUrl: string;
  var csvParser: any;
  var csvParserReady: boolean;
  var ModelicaClassInstance: any;
  var createModelicaQueryEngine: (...args: any[]) => any;
  var createSysML2QueryEngine: (...args: any[]) => any;
  var getSharedCstTreeWrapper: () => any;
  var sharedFs: any;
  var connection: any;
}
export {};
