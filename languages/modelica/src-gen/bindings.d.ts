export declare enum InputEncoding {
  UTF8 = 0,
  UTF16LE = 1,
  UTF16BE = 2,
  UTF32LE = 3,
  UTF32BE = 4,
}
/**
 * Abstract interface for interacting with the underlying WebAssembly or Native C++ runtime.
 * Provides memory read/write and parser invocation methods.
 */
export interface RuntimeAdapter {
  readU32(ptr: number): number;
  readU16(ptr: number): number;
  writeU8Array(ptr: number, data: Uint8Array): void;
  getInputBuffer(): number;
  ensureInputBuffer?(size: number): number;
  setInputEncoding?(enc: number): void;
  parse(
    oldTreePtr: number,
    editStart: number,
    editOldEnd: number,
    editNewEnd: number,
  ): number;
  getNodeFirstChild(ptr: number): number;
  getNodeNextSibling(ptr: number): number;
  getNodeType?(ptr: number): number;
}
/**
 * A lightweight wrapper over a parsed AST node pointer.
 * Used internally by the Parser class to traverse the tree.
 */
export declare class ASTNode {
  private runtime;
  private ptr;
  constructor(runtime: RuntimeAdapter, ptr: number);
  /** Gets the underlying WASM pointer for this node. */
  getPtr(): number;
  /** Gets the semantic type ID of this node. */
  getTypeId(): number;
  /** Gets the first child of this node in the AST. */
  getFirstChild(): ASTNode | null;
  /** Gets the next sibling of this node in the AST. */
  getNextSibling(): ASTNode | null;
}
/**
 * The core Parser facade.
 * Orchestrates memory transfer and invokes the incremental parsing routine.
 */
export declare class Parser {
  private runtime;
  constructor(runtime: RuntimeAdapter);
  /** Sets the expected text encoding (UTF-8, UTF-16, etc.) for parsing. */
  setEncoding(encoding: InputEncoding): void;
  /**
   * Parses the given source string or byte array, optionally performing an incremental parse
   * if an old tree and edit bounds are provided.
   */
  parse(
    source: string | Uint8Array,
    oldTree?: ASTNode | null,
    editStart?: number,
    editOldEnd?: number,
  ): ASTNode | null;
  /** Reads a WASM-allocated length-prefixed string into a JavaScript string. */
  readString(ptr: number): string;
}
/**
 * The WebAssembly runtime implementation for browser and portable Node.js execution.
 * Backed by a WebAssembly linear memory buffer.
 */
export declare class WasmRuntime implements RuntimeAdapter {
  private wasmExports;
  private memory;
  private mem32;
  private mem16;
  private mem8;
  constructor(wasmExports: any, memory: WebAssembly.Memory);
  private ensureMemory;
  readU32(ptr: number): number;
  readU16(ptr: number): number;
  writeU8Array(ptr: number, data: Uint8Array): void;
  getInputBuffer(): number;
  ensureInputBuffer(size: number): number;
  setInputEncoding(enc: number): void;
  parse(
    oldTreePtr: number,
    editStart: number,
    editOldEnd: number,
    editNewEnd: number,
  ): number;
  getNodeFirstChild(ptr: number): number;
  getNodeNextSibling(ptr: number): number;
  getNodeType(ptr: number): number;
  /** Gets the imports needed to instantiate the compiled WASM module. */
  static getWasmImports(
    onTextEdit: (start: number, end: number, text: string) => void,
    getMemory: () => WebAssembly.Memory,
  ): any;
}
/**
 * The Native Addon runtime implementation for high-performance Node.js execution.
 * Proxies calls directly to the N-API module.
 */
export declare class NativeRuntime implements RuntimeAdapter {
  private nativeAddon;
  constructor(nativeAddon: any);
  readU32(ptr: number): number;
  readU16(ptr: number): number;
  writeU8Array(ptr: number, data: Uint8Array): void;
  getInputBuffer(): number;
  ensureInputBuffer(size: number): number;
  setInputEncoding(enc: number): void;
  parse(
    oldTreePtr: number,
    editStart: number,
    editOldEnd: number,
    editNewEnd: number,
  ): number;
  getNodeFirstChild(ptr: number): number;
  getNodeNextSibling(ptr: number): number;
  getNodeType(ptr: number): number;
}
export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface Diagnostic {
  range: Range;
  message: string;
  severity: number;
  code?: number | string;
  startCharOffset?: number;
  endCharOffset?: number;
}
export declare const SYNTAX_NAMES: string[];
export declare const LINT_MESSAGES: Record<string, string>;
export declare const LINT_SEVERITIES: Record<string, number>;
export declare const LINT_CODES: Record<string, string | number>;
export declare const EXTRAS_PATTERN: string;
export declare const FIELD_NAMES: Record<string, number>;
export interface AstChangeListener {
  onFullReset?(newRoot: number): void;
  onNodeRetained(ptr: number, flags?: number): void;
  onNodeDeleted(ptr: number): void;
  onNodeInserted(
    ptr: number,
    typeId: number,
    typeName: string,
    pad: number,
    len: number,
    flags: number,
    children: {
      ptr: number;
      field: string | null;
      invisiblePad: number;
    }[],
  ): void;
  onNodeUpdated(
    newPtr: number,
    oldPtr: number,
    typeId: number,
    typeName: string,
    pad: number,
    len: number,
    flags: number,
    children: {
      ptr: number;
      field: string | null;
      invisiblePad: number;
    }[],
  ): void;
}
export declare function createWasmImports(grammar: any, facade: LspFacade): any;
/**
 * The Language Server Protocol Facade.
 *
 * Provides a high-level API over the WebAssembly runtime for IDE integration,
 * managing memory buffer synchronization, incremental parsing, and diagnostic translation.
 */
export declare class LspFacade {
  syntaxNames: string[];
  extrasRegex: RegExp;
  private wasmMemory;
  exports: any;
  lastAstRoot: number;
  private _cachedLineStarts;
  private documentRoots;
  private documentVersions;
  private _idleTimer;
  private _maxMemoryQuotaBytes;
  /**
   * Returns true if a character matches the grammar's `extras` definition (whitespace/trivia).
   * Line breaks (\n, \r) are excluded so diagnostic ranges stay pinned to their line.
   */
  isExtraChar(ch: string): boolean;
  /**
   * Retrieves an interned string path from the WASM linear memory string pool.
   */
  getStringFromPool(id: number): string;
  private _childTailCache;
  private currentInputLength;
  constructor(wasmMemoryOrInstance: any, exports?: any);
  /**
   * Retrieves the AST root for a specific document URI or numeric fileId (or the default/active document).
   */
  getDocumentRoot(uriOrFileId?: string | number): number;
  /**
   * Registers/updates the AST root for a specific document URI.
   */
  setDocumentRoot(uri: string, rootPtr: number, version?: number): void;
  /**
   * Closes a document, unregistering its root from GC and triggering compaction.
   */
  removeDocument(uri: string): void;
  /**
   * Returns all active document roots across open files in the workspace.
   */
  getAllDocumentRoots(): number[];
  /**
   * Schedules a generational sweep/compaction pass.
   * Trigger 1: Quiescence / Idle Timer (1500ms debounce).
   */
  scheduleCompaction(immediate?: boolean): void;
  /**
   * Trigger 2: Checks if allocated memory exceeds high-water mark quota.
   */
  checkMemoryQuota(): void;
  /**
   * Performs compaction protecting all live document roots if requested.
   */
  gcCompact(): void;
  /** Resets the internal parser state and clears all cached data. */
  resetParser(): void;
  getInputEncoding(): number;
  setParserConfig(
    enableBranchA1: boolean,
    enableBranchB: boolean,
    enableBranchC: boolean,
    enableIslandMode?: boolean,
    enableMultiFile?: boolean,
  ): void;
  /**
   * Applies a single incremental edit to the WASM memory buffer and triggers a reparse.
   *
   * @param changeText - The new text being inserted.
   * @param rangeOffset - The UTF-16 character offset where the edit begins.
   * @param rangeLength - The number of UTF-16 characters being replaced.
   * @param newTotalLength - The new total length of the document in UTF-16 characters.
   */
  parseIncremental(
    changeText: string,
    rangeOffset: number,
    rangeLength: number,
    newTotalLength: number,
    uri?: string,
  ): number;
  private _hasTopLevelErrors;
  /**
   * Applies a batch of incremental edits to the WASM memory buffer, coalescing the bounding box
   * and triggering a single reparse to minimize overhead.
   */
  parseIncrementalBatch(
    edits: {
      text: string;
      rangeOffset: number;
      rangeLength: number;
    }[],
    newTotalLength: number,
    uri?: string,
  ): number;
  /**
   * Incrementally patches the lineStarts array after an edit.
   * Instead of rescanning the entire buffer (O(N)), this:
   * 1. Keeps line starts before the edit unchanged
   * 2. Removes line starts within the deleted range
   * 3. Inserts new line starts for newlines in the inserted text
   * 4. Shifts line starts after the edit by the byte delta
   * Complexity: O(edit_size + affected_lines), typically O(1) for single-char edits.
   */
  private _updateLineStarts;
  /**
   * Scans the current WASM input buffer and calculates all line start byte offsets.
   * This is cached and only recalculated when the cache is invalidated by edits.
   * Note: The offsets are stored in UTF-16 bytes (i.e. charIndex * 2) to match
   * the WASM AST's byte offset ranges.
   */
  getLineStarts(): Uint32Array;
  /**
   * Performs a binary search on the cached line starts to map a linear byte offset
   * to a line and character position (LSP format).
   */
  offsetToPos(offset: number, lineStarts: Uint32Array): Position;
  /**
   * Maps a line and character position to a linear byte offset.
   */
  posToOffset(line: number, character: number, lineStarts: Uint32Array): number;
  /**
   * Retrieves syntax and semantic diagnostics from the WASM parser.
   *
   * This bridges the gap between the compact struct-of-arrays representation
   * returned by WASM and the object-oriented LSP `Diagnostic` array.
   * Complex diagnostics with contextual formatting strings (e.g. "Expected '}' but got {0}")
   * are resolved by extracting the underlying text from the source buffer.
   */
  getDiagnostics(astRoot: number): Diagnostic[];
  /**
   * Retrieves semantic tokens for syntax highlighting.
   * Returns a raw `Uint32Array` mapped directly from WASM memory for speed.
   * Array layout is: [lineDelta, charDelta, length, typeId] repeating.
   */
  getSemanticTokens(astRoot: number): Uint32Array;
  /** Retrieves a list of collapsable folding ranges from the parsed syntax tree. */
  getFoldingRanges(astRoot: number): {
    start: Position;
    end: Position;
  }[];
  /** Extracts document symbols (e.g. classes, functions) for the document outline view. */
  getDocumentSymbols(astRoot: number): {
    start: Position;
    end: Position;
    typeId: number;
    nodePtr: number;
  }[];
  /** Locates the definition of the symbol at the given byte offset. */
  getDefinition(
    astRoot: number,
    targetOffset: number,
  ): {
    fileId: number;
    start: number;
    end: number;
  } | null;
  /** Locates all references to the symbol at the given byte offset across registered workspace files. */
  getReferences(
    astRoot: number,
    targetOffset: number,
  ): {
    fileId: number;
    start: number;
    end: number;
  }[];
  /**
   * Generic Completion Context Query.
   * Inspects CST around cursorOffset and returns target expression and replacement range.
   */
  getCompletionContext(
    astRoot: number,
    cursorOffset: number,
  ): {
    hasTarget: boolean;
    targetText: string;
    targetRange: {
      start: number;
      end: number;
    };
    replaceRange: {
      start: number;
      end: number;
    };
  } | null;
  /** Extracts 2D diagram nodes, ports, spatial positions, and edges for visual modeling. */
  getDiagramData(
    astRoot: number,
    projectionId?: number,
  ): {
    nodes: any[];
    edges: any[];
  };
  /** Applies visual diagram actions directly to the Arena AST and returns updated document text. */
  applyDiagramEdits(actions: any[]): {
    text: string;
    edits: any[];
  };
  /** Returns current allocated heap bytes in the WASM linear memory arena. */
  getMemoryUsage(): number;
  /** Registers a document AST root for multi-file workspace LSP operations. */
  registerDocument(fileId: number, astRoot: number): void;
  /** Unregisters a document AST root. */
  unregisterDocument(fileId: number): void;
  /** Clears all registered multi-file document AST roots. */
  clearDocuments(): void;
  /** Evicts a document's full AST from the Tier 2 arena while preserving Tier 1 stubs. */
  evictDocumentAst(fileId: number): void;
  /** Hashes a string using FNV-1a algorithm matching WASM string hash. */
  hashString(str: string): number;
  allocMem(bytes: number): number;
  allocStringInArena(str: string): number;
  /** Registers a declaration stub into the persistent Tier 1 index. */
  registerStub(
    fileId: number,
    symbolId: number,
    parentSymbolId: number,
    kind: number,
    flags: number,
    name: string,
    startByte: number,
    endByte: number,
    merkleLow?: number,
    merkleHigh?: number,
    parentFqn?: string,
  ): number;
  /** Registers an enclosing parent FQN for a given fileId. */
  registerFileParentFQN(fileId: number, parentFQN: string): void;
  /** Binds an FQN string to a specific stub ID. */
  bindFqnStub(fqn: string, stubId: number): void;
  /** Stitches a child stub to its parent package using the parent FQN string. */
  stitchParentFQN(childStubId: number, parentFQN: string): number;
  /** Clears all Tier 1 stubs for a specific fileId or all files if fileId === 0. */
  clearFileStubs(fileId?: number): void;
  /** Alias for clearFileStubs. */
  clearStubs(fileId?: number): void;
  /** Finds all stub symbols matching a name string across the workspace. */
  findStubsByName(name: string): {
    fileId: number;
    symbolId: number;
    parentSymbolId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startByte: number;
    endByte: number;
    merkleLow?: number;
    merkleHigh?: number;
  }[];
  /** Finds all stub symbols matching a name string using WASM SIMD 128-bit vector search. */
  findStubsByNameSIMD(
    name: string,
    preferredFileId?: number,
  ): {
    fileId: number;
    symbolId: number;
    parentSymbolId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startByte: number;
    endByte: number;
    merkleLow?: number;
    merkleHigh?: number;
  }[];
  /** Queries all symbols for a given fileId (fast LSP document symbol outline). */
  getFileSymbols(fileId: number): {
    fileId: number;
    symbolId: number;
    parentSymbolId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startByte: number;
    endByte: number;
    merkleLow?: number;
    merkleHigh?: number;
  }[];
  /** Queries child stub symbols for a parent symbol ID. */
  getStubChildren(parentSymbolId: number): {
    fileId: number;
    symbolId: number;
    parentSymbolId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startByte: number;
    endByte: number;
    merkleLow?: number;
    merkleHigh?: number;
  }[];
  /** Returns total number of registered stub symbols. */
  getStubCount(): number;
  /** Exports Tier 1 stub store and string arena to a Uint8Array binary snapshot. */
  exportStubBinary(): Uint8Array;
  /** Imports Tier 1 stub store and string arena from a binary snapshot. */
  importStubBinary(buffer: Uint8Array): boolean;
  /** Restores Tier 1 stub store from a binary snapshot and returns the restored stub count. */
  restoreStubBinary(buffer: Uint8Array): number;
  /** Bulk registers raw uint32 stub records from worker threads. */
  bulkRegisterStubs(payload: Uint32Array): number;
  /** Indexes all stubs into the Dex-style trigram inverted search map. */
  indexTrigrams(): number;
  /** Dex-style Sub-Millisecond Fuzzy Symbol Search across all indexed stubs in the workspace. */
  fuzzyFindSymbols(
    query: string,
    maxResults?: number,
  ): {
    stubId: number;
    fileId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startByte: number;
    endByte: number;
    score: number;
  }[];
  /** Shifts byte offsets in-place across all stubs in a file after an interior edit. */
  shiftStubByteOffsets(
    fileId: number,
    fromByte: number,
    deltaBytes: number,
  ): number;
  /** Gets or looks up an incremental Salsa 3.0 query node. */
  queryGetNode(
    queryType: number,
    arg1: number,
    arg2?: number,
    arg3?: number,
    arg4?: number,
  ): number;
  /** Allocates a new incremental Salsa 3.0 query node. */
  queryAllocNode(
    queryType: number,
    arg1: number,
    arg2?: number,
    arg3?: number,
    arg4?: number,
  ): number;
  /** Invalidates a query node and cascades dirtying to all subscribers. */
  queryInvalidate(queryNodePtr: number): void;
  /** Gets the cached result value of a query node. */
  queryGetValue(queryNodePtr: number): number;
  /** Sets the cached result value of a query node. */
  querySetValue(queryNodePtr: number, val: number): void;
  /** Gets the cached revision of a query node. */
  queryGetRevision(queryNodePtr: number): number;
  /** Sets the cached revision of a query node. */
  querySetRevision(queryNodePtr: number, rev: number): void;
  /** Gets the cached result Merkle low 32-bits. */
  queryGetMerkleLow(queryNodePtr: number): number;
  /** Gets the cached result Merkle high 32-bits. */
  queryGetMerkleHigh(queryNodePtr: number): number;
  /** Sets the cached result Merkle 64-bit hash. */
  querySetMerkle(queryNodePtr: number, low: number, high: number): void;
  /** Establishes a directed dependency edge from parent to target query. */
  queryAddDependency(parentPtr: number, targetPtr: number): void;
  /** Gets the global database revision counter. */
  queryGetGlobalRevision(): number;
  /** Increments the global database revision counter. */
  queryIncrementRevision(): void;
  /** Registers a negative dependency: records that a query failed because a symbol name was missing. */
  salsaRegisterNegativeDependency(queryPtr: number, name: string): void;
  /** Invalidates queries waiting for a symbol name when that symbol is introduced. */
  salsaInvalidateNegativeDependencies(name: string): number;
  /** Performs O(1) Merkle backdating on a query result. Returns true if semantically identical. */
  salsaBackdateQuery(
    nodePtr: number,
    newMerkleLow: number,
    newMerkleHigh: number,
  ): boolean;
  /** Gets the version counter for a language in the polyglot arena. */
  polyglotGetLangVersion(arenaPtr: number, langId: number): number;
  /** Increments the version counter for a language in the polyglot arena. */
  polyglotIncrementLangVersion(arenaPtr: number, langId: number): number;
  /** Checks if a language version has changed since snapshotVersion. */
  polyglotHasLangChanged(
    arenaPtr: number,
    langId: number,
    snapshotVersion: number,
  ): boolean;
  /** Returns the number of declarative MCP tools registered in WASM. */
  mcpGetToolCount(): number;
  /** Returns the DJB2 name hash for an MCP tool index. */
  mcpGetToolNameHash(index: number): number;
  /** Dispatches an MCP tool call directly in WASM linear memory. */
  mcpDispatchTool(
    toolIndex: number,
    arg1?: number,
    arg2?: number,
    arg3?: number,
  ): number;
  /** Returns the pointer to the MCP result output buffer in WASM linear memory. */
  mcpGetOutputBuffer(): number;
  /** Returns the length of the MCP result output buffer in bytes. */
  mcpGetOutputLength(): number;
  /** Reads the MCP output buffer as a UTF-8 string. */
  mcpGetOutputText(): string;
  /** Adds an OWL 2 axiom to the indexed WASM ontology store. */
  addOntologyAxiom(
    axiomType: number,
    sourceLangId: number,
    subject: string | number,
    predicate?: string | number,
    object?: string | number,
    flags?: number,
    extra?: number,
  ): number;
  /** Evaluates transitive SubClassOf subsumption directly in WASM memory. */
  isSubClassOf(subClass: string, superClass: string): boolean;
  /** Evaluates if two classes are disjoint (directly or through superclasses). */
  areDisjoint(class1: string, class2: string): boolean;
  /** Evaluates if an individual is an instance of a class (directly or through subclass inference). */
  isInstanceOf(individual: string, className: string): boolean;
  /** Computes the transitive closure of reachable nodes along a property from a source individual. */
  getTransitiveClosure(property: string, source: string): number[];
  /** Computes the transitive closure with traversal path edges. */
  getTransitiveClosureWithPath(
    property: string,
    source: string,
  ): {
    reachable: number[];
    path: {
      subject: number;
      object: number;
    }[];
  };
  /** Explains why a subsumption holds by returning the chain of justifying axioms. */
  explainSubsumption(
    subClass: string,
    superClass: string,
  ): {
    axiomType: number;
    sourceLangId: number;
    subjectHash: number;
    predicateHash: number;
    objectHash: number;
    flags: number;
  }[];
  /** Audits global ontology consistency, returning conflicting axioms if inconsistent. */
  checkConsistency(): {
    isConsistent: boolean;
    conflictingAxioms: {
      axiomType: number;
      sourceLangId: number;
      subjectHash: number;
      predicateHash: number;
      objectHash: number;
      flags: number;
    }[];
    explanation?: string;
  };
  /** Classifies an individual, returning direct types and all transitive types. */
  classifyIndividual(individual: string): {
    directTypes: number[];
    allTypes: number[];
  };
  /** Returns all taxonomy nodes from the ontology. */
  getTaxonomy(): {
    classHash: number;
    directSuperClasses: number[];
    directSubClasses: number[];
    equivalentClasses: number[];
  }[];
  computeOntologyIntervalIndex(): void;
  evaluateOntologyPropertyPath(
    propertyName: string,
    pathOp: number,
    stepPropertyName2: string,
    sourceName: string,
  ): number[];
  saturateOntologyELRules(): number;
  /** Queries indexed triples via SPO / POS / OSP pattern matching in WASM memory. */
  queryOntologyTriples(
    subjectPattern?: string,
    predicatePattern?: string,
    objectPattern?: string,
  ): {
    axiomType: number;
    sourceLangId: number;
    subjectHash: number;
    predicateHash: number;
    objectHash: number;
    flags: number;
  }[];
  /** Returns total asserted OWL 2 axioms in the store. */
  getOntologyAxiomCount(): number;
  /** Retracts an axiom by ID in WASM memory using DRed over-deletion and rederivation. */
  retractOntologyAxiom(axiomId: number): number;
  /** Applies an incremental delta of additions and retractions in WASM linear memory. */
  applyOntologyDelta(
    adds: {
      axiomType: number;
      sourceLangId?: number;
      subject: string;
      predicate?: string;
      object?: string;
      flags?: number;
    }[],
    retractions: {
      axiomType: number;
      subject: string;
      predicate?: string;
      object?: string;
    }[],
  ): number;
  /** Saturates functional object properties and unifies individual equivalence classes. */
  saturateFunctionalOntology(): number;
  /** Isolates a Minimal Unsatisfiable Subset (MUS) using QuickXplain in WASM linear memory. */
  quickXplainOntology(): {
    axiomType: number;
    sourceLangId: number;
    subjectHash: number;
    predicateHash: number;
    objectHash: number;
    flags: number;
  }[];
  /** Enumerates all minimal unsatisfiable subsets using Reiter's Hitting Set Tree (HST). */
  allMusOntology(maxCores?: number): number[][];
  /** Clears the WASM ontology store and inverted indices. */
  clearOntology(): void;
  /** Runs the full hybrid interleaved fixpoint cycle in WASM memory. */
  runHybridFixpoint(): number;
  /** Validates advanced OWL 2 / SHACL constraints (asymmetry, irreflexivity, disjoint properties). */
  validateAdvancedConstraints(): {
    subjectHash: number;
    predicateHash: number;
    objectHash: number;
  }[];
  /** Runs Tier 2 WASM Tableau Engine for disjunctive and complex proofs. */
  runTableauSubsumption(subClassName: string, superClassName: string): boolean;
  /** Projects all indexed declaration stubs into OWL 2 axioms. */
  projectStubsToOntology(sourceLangId: number): number;
  /** Projects synthetic symbol with conflict deduplication against real declarations. */
  projectSyntheticSymbol(
    fileId: number,
    symbolId: number,
    parentSymbolId: number,
    kind: number,
    name: string,
    parentFqn?: string,
  ): number;
  /** Creates an arena-native flattener attached to a DaeBuilder. */
  createFlattener(daePtr: number): number;
  /** Flattens an AST class definition into DAE variables and equations. */
  flattenerFlattenClass(flattenerPtr: number, classNodePtr: number): number;
  /** Adds a connector connection equation to the flattener. */
  flattenerAddConnection(
    flattenerPtr: number,
    p1VarId: number,
    p2VarId: number,
    isFlow: boolean,
    isBoundary?: boolean,
  ): number;
  /** Finalizes connection graphs and synthesizes zero-sum flow equations. */
  flattenerFinalizeConnections(flattenerPtr: number): number;
  /** Creates a modification environment in WASM linear memory. */
  flattenerCreateEnv(parentPtr?: number): number;
  /** Binds a parameter override into the modification environment. */
  flattenerEnvBind(
    envPtr: number,
    keyHash: number,
    valExprId: number,
    isFinal?: boolean,
    isEach?: boolean,
  ): void;
  /** Looks up a parameter override in the modification environment. */
  flattenerEnvLookup(envPtr: number, keyHash: number): number;
  /** Executes a named in-DSL compilation pipeline (e.g. 'flatten') in WebAssembly. */
  runPipeline(pipelineName: string, rootNode?: number): number;
  /** Evaluates built-in trigonometric and elementary functions in WASM. */
  mathSin(x: number): number;
  mathCos(x: number): number;
  mathTan(x: number): number;
  mathSqrt(x: number): number;
  mathExp(x: number): number;
  mathLog(x: number): number;
  /** Evaluates CSG sphere Signed Distance Function in WASM. */
  csgSdfSphere(px: number, py: number, pz: number, r: number): number;
  /** Evaluates CSG box Signed Distance Function in WASM. */
  csgSdfBox(
    px: number,
    py: number,
    pz: number,
    hx: number,
    hy: number,
    hz: number,
  ): number;
  /** CSG Boolean Operations. */
  csgOpUnion(d1: number, d2: number): number;
  csgOpIntersect(d1: number, d2: number): number;
  csgOpDifference(d1: number, d2: number): number;
  /** Simplifies an algebraic expression using CAS rewrite rules and constant folding in WASM. */
  casSimplify(daePtr: number, exprId: number): number;
  /** Computes the exact symbolic derivative d(expr) / d(varId) in WASM. */
  casDifferentiate(daePtr: number, exprId: number, targetVarId: number): number;
  /** Creates an Automatic Differentiation Tape instance in WASM. */
  createAdTape(): number;
  /** Pushes an elementary operation node to the AD tape. */
  tapePushOp(
    tapePtr: number,
    op: number,
    left: number,
    right: number,
    val: number,
  ): number;
  /** Runs the reverse-mode AD pass backwards from rootNode. */
  tapeBackward(tapePtr: number, rootNode: number): void;
  /** Retrieves the accumulated gradient for a node on the AD tape. */
  tapeGetGrad(tapePtr: number, nodeIdx: number): number;
  /** Resets the AD tape for the next evaluation pass. */
  tapeReset(tapePtr: number): void;
  /** Creates a fast snapshot checkpoint of the arena allocation state. */
  createArenaSnapshot(): number;
  /** Restores the arena allocation state to a previous snapshot checkpoint. */
  restoreArenaSnapshot(snapshotPtr: number): void;
  /** Formats/unparses the document AST using zero-GC AssemblyScript formatting rules. */
  formatDocument(astRoot: number, preserveFormatting?: boolean): string;
  /** Reads a WASM-allocated length-prefixed UTF-16 string into a JavaScript string. */
  readWasmString(ptr: number): string;
  /** Retrieves available compiler pipelines that can be executed. */
  getPipelines(): {
    id: string;
    label: string;
    target: string;
  }[];
  /** Executes a specific compiler pipeline by its ID. */
  executePipeline(astRoot: number, pipelineId: string): any;
  private _lastDiagBinaryLength;
  /**
   * Read error ranges from the already-populated binary buffer without
   * calling lsp_getDiagnostics again. Only valid after getDiagnostics().
   */
  private readCachedErrorRanges;
  /**
   * Traverses the AST and returns a string representation in Lisp-like S-Expressions.
   * Useful for debugging syntax trees and writing test expectations.
   */
  getAstSExpr(astRoot: number, verbose?: boolean): string;
  /**
   * Traverses the AST and returns an array of HTML strings representing the tree structure.
   * Used for the visual AST inspector.
   */
  getAstHtml(astRoot: number): string[];
  private astListeners;
  addAstChangeListener(listener: AstChangeListener): void;
  /**
   * Appends a child to a parent node in O(1) using a JS-side tail pointer cache.
   * Falls back to the WASM ast_appendChild if the cache misses or the export is unavailable.
   */
  appendChild(parentPtr: number, childPtr: number): void;
  /**
   * Performs a full non-incremental parse of the given text buffer.
   * Used as a fallback or for initial parsing.
   */
  parse(
    text: string,
    editStart?: number,
    editOldEnd?: number,
    editNewEnd?: number,
    uri?: string,
  ): number;
  /**
   * Compares two ASTs generated before and after an edit, and emits
   * a minimal sequence of insertion, deletion, and update events.
   *
   * This bridges the gap between tree-sitter's internal incremental parsing state
   * and higher-level tooling (like the LSP reasoner) that needs to know exactly
   * what semantic nodes changed.
   */
  walkAstDiff(
    oldRoot: number,
    newRoot: number,
    listener: AstChangeListener,
  ): void;
}
export interface Point {
  row: number;
  column: number;
}
/**
 * A Tree-sitter compatible facade for a ModelScript AST Node.
 * Supports zero-copy traversal, field queries, positional lookups,
 * and standard Tree-sitter inspection methods.
 */
export declare class SyntaxNode {
  readonly tree: Tree;
  readonly ptr: number;
  readonly _startOffset: number;
  readonly parent: SyntaxNode | null;
  readonly _cachedPad: number;
  readonly _cachedLen: number;
  readonly _cachedTypeId: number;
  constructor(
    tree: Tree,
    ptr: number,
    _startOffset: number,
    parent: SyntaxNode | null,
    _cachedPad: number,
    _cachedLen: number,
    _cachedTypeId: number,
  );
  /** Unique integer ID for this node (pointer address). */
  get id(): number;
  /** Gets the semantic type name of this node (e.g., 'ModelicaClassDefinition'). */
  get type(): string;
  /** Numeric type identifier for this node. */
  get typeId(): number;
  /** Grammar type identifier matching typeId. */
  get grammarId(): number;
  /** Semantic grammar type name. */
  get grammarType(): string;
  /** Extracts the substring from the original source code corresponding to this node. */
  get text(): string;
  /** The start character index of the node (UTF-16). */
  get startIndex(): number;
  /** The end character index of the node (UTF-16). */
  get endIndex(): number;
  /** The start byte index of the node (character offset matching Tree-sitter JS). */
  get startByte(): number;
  /** The end byte index of the node (character offset matching Tree-sitter JS). */
  get endByte(): number;
  /**
   * Returns true if this node was inserted by the parser to recover from a syntax error.
   */
  isMissing(): boolean;
  /** Returns true if this node is an extra token (comment/whitespace). */
  isExtra(): boolean;
  /** Returns true if this node has been edited. */
  hasChanges(): boolean;
  /** The line and column where this node starts. */
  get startPosition(): Point;
  /** The line and column where this node ends. */
  get endPosition(): Point;
  /**
   * Returns a list of all visible child nodes by walking the WASM sibling linked list.
   * Recursively flattens invisible nodes (e.g., anonymous sequences) into their parents.
   */
  get children(): SyntaxNode[];
  /** Gets all named children (excluding anonymous tokens and punctuation). */
  get namedChildren(): SyntaxNode[];
  /** Gets the number of children the node has. */
  get childCount(): number;
  /** Gets the number of named children the node has. */
  get namedChildCount(): number;
  /** Gets the first child of the node. */
  get firstChild(): SyntaxNode | null;
  /** Gets the last child of the node. */
  get lastChild(): SyntaxNode | null;
  /** Gets the first named child of the node. */
  get firstNamedChild(): SyntaxNode | null;
  /** Gets the last named child of the node. */
  get lastNamedChild(): SyntaxNode | null;
  /** Gets the next sibling of the node. */
  get nextSibling(): SyntaxNode | null;
  /** Gets the previous sibling of the node. */
  get previousSibling(): SyntaxNode | null;
  /** Gets the next named sibling of the node. */
  get nextNamedSibling(): SyntaxNode | null;
  /** Gets the previous named sibling of the node. */
  get previousNamedSibling(): SyntaxNode | null;
  /** Gets the child at the specified index. */
  child(index: number): SyntaxNode | null;
  /** Gets the named child at the specified index. */
  namedChild(index: number): SyntaxNode | null;
  /**
   * Helper that tests if this node or its WASM subtree contains targetPtr.
   */
  containsPtr(targetPtr: number): boolean;
  /**
   * Looks up a child node by numeric field ID.
   */
  childForFieldId(fieldId: number): SyntaxNode | null;
  /**
   * Looks up a named field on this node and returns the corresponding child syntax node.
   */
  childForFieldName(name: string): SyntaxNode | null;
  /**
   * Returns all child nodes matching the given numeric field ID (e.g. for repeated fields).
   */
  childrenForFieldId(fieldId: number): SyntaxNode[];
  /**
   * Returns all child nodes matching the given field name.
   */
  childrenForFieldName(name: string): SyntaxNode[];
  /**
   * Returns the field name associated with a child at childIndex.
   */
  fieldNameForChild(childIndex: number): string | null;
  /**
   * Returns the field name associated with a named child at namedChildIndex.
   */
  fieldNameForNamedChild(namedChildIndex: number): string | null;
  /** Extracts the source code text for a specific child field. */
  childText(name: string): string;
  /** Returns true if the node is a named (non-anonymous) node. */
  isNamed(): boolean;
  /** Returns true if the node or any of its descendants represents a syntax error. */
  hasError(): boolean;
  /** Finds the smallest syntax node covering the character range [start, end]. */
  descendantForIndex(start: number, end?: number): SyntaxNode | null;
  /** Finds the smallest named syntax node covering the character range [start, end]. */
  namedDescendantForIndex(start: number, end?: number): SyntaxNode | null;
  /** Finds the smallest syntax node covering the given Point range. */
  descendantForPosition(start: Point, end?: Point): SyntaxNode | null;
  /** Finds the smallest named syntax node covering the given Point range. */
  namedDescendantForPosition(start: Point, end?: Point): SyntaxNode | null;
  /** Finds all descendants of the given type name(s). */
  descendantsOfType(
    types: string | string[],
    start?: Point,
    end?: Point,
  ): SyntaxNode[];
  /** Finds the closest ancestor node (or self) matching the given type(s). */
  closest(types: string | string[]): SyntaxNode | null;
  /** Generates the canonical S-expression string representation for this node. */
  toString(): string;
  /** Returns true if this node is equal to other. */
  equals(other: SyntaxNode | null | undefined): boolean;
  /** Creates a stateful TreeCursor for traversing the tree starting at this node. */
  walk(): TreeCursor;
}
/**
 * A Tree-sitter compatible stateful cursor for efficiently walking the syntax tree.
 */
export declare class TreeCursor {
  private stack;
  private current;
  constructor(node: SyntaxNode);
  get nodeType(): string;
  get nodeTypeId(): number;
  get nodeIsNamed(): boolean;
  get nodeIsMissing(): boolean;
  get nodeText(): string;
  get currentNode(): SyntaxNode;
  get startIndex(): number;
  get endIndex(): number;
  get startPosition(): Point;
  get endPosition(): Point;
  get currentFieldName(): string | null;
  get currentFieldId(): number;
  get currentDepth(): number;
  isMissing(): boolean;
  gotoFirstChild(): boolean;
  gotoFirstChildForIndex(index: number): boolean;
  gotoFirstChildForPosition(position: Point): boolean;
  gotoNextSibling(): boolean;
  gotoPreviousSibling(): boolean;
  gotoParent(): boolean;
  reset(node: SyntaxNode): void;
}
/**
 * Represents the root of a parsed syntax tree.
 */
export declare class Tree {
  readonly facade: LspFacade;
  readonly rootPtr: number;
  readonly sourceCode: string;
  lineStarts: number[];
  private _mem32;
  get mem32(): Uint32Array;
  constructor(facade: LspFacade, rootPtr: number, sourceCode: string);
  /** Gets the root node of the syntax tree. */
  get rootNode(): SyntaxNode;
  /** Creates a stateful TreeCursor for traversing the tree starting at the root. */
  walk(): TreeCursor;
  /** Converts a linear byte offset into a row and column Point. */
  offsetToPoint(offset: number): Point;
  /** Converts a row and column Point into a linear character offset. */
  pointToOffset(point: Point): number;
}
/**
 * Tree-sitter standard Parser class interface.
 */
export declare class TreeSitterParser {
  private languageBinding;
  setLanguage(language: any): void;
  getLanguage(): any;
  parse(source: string | Uint8Array, oldTree?: Tree | null): Tree | null;
  reset(): void;
}
export declare const WasmLanguageBinding: typeof LspFacade;
export default WasmLanguageBinding;
export interface LruAstCacheOptions {
  /** Maximum number of full document ASTs to keep in memory simultaneously (default: 100). */
  maxActiveAsts?: number;
  /** Maximum memory threshold in bytes before LRU eviction triggers (default: 128 MB). */
  maxAstMemoryBytes?: number;
}
/**
 * Tier 2 On-Demand LRU Full AST Cache.
 * Evicts inactive ASTs to prevent WASM heap exhaustion in large monorepos.
 */
export declare class LruAstCache {
  readonly facade: LspFacade;
  private activeRoots;
  maxActiveAsts: number;
  maxAstMemoryBytes: number;
  constructor(facade: LspFacade, options?: LruAstCacheOptions);
  get activeCount(): number;
  has(fileId: number): boolean;
  get(fileId: number): number | undefined;
  set(fileId: number, astRoot: number, isDirty?: boolean): void;
  markDirty(fileId: number, isDirty: boolean): void;
  evict(fileId: number): boolean;
  evictIfNecessary(): void;
  clear(): void;
}
/**
 * Manages workspace-wide multi-file symbol indexing and Two-Tier storage.
 */
export declare class LspWorkspaceManager {
  readonly facade: LspFacade;
  readonly astCache: LruAstCache;
  private uriToFileId;
  private fileIdToUri;
  private nextFileId;
  constructor(facade: LspFacade, options?: LruAstCacheOptions);
  getFileId(uri: string): number;
  getUri(fileId: number): string | undefined;
  indexFile(uri: string, content: string, keepAst?: boolean): number;
  getDefinition(
    uri: string,
    offset: number,
  ): {
    uri: string;
    start: number;
    end: number;
  } | null;
  findSymbolsFuzzy(
    query: string,
    maxResults?: number,
  ): {
    uri: string;
    stubId: number;
    kind: number;
    startByte: number;
    endByte: number;
    score: number;
  }[];
}
/**
 * Asynchronously loads a ModelScript language WebAssembly parser module from a URL,
 * local file path, or in-memory byte buffer and wraps it in a high-performance LspFacade and TreeSitterParser.
 */
export declare function createWasmParser(
  wasmUrlOrBytes: string | Uint8Array | ArrayBuffer,
  options?: {
    syntaxNames?: string[];
  },
): Promise<{
  facade: LspFacade;
  parser: TreeSitterParser;
}>;

export const semanticLegend: { tokenTypes: string[]; tokenModifiers: string[] };

export enum SyntaxKind {
  ERROR = 0,
  Identifier = 325,
  identifier = 325,
  StringLiteral = 326,
  string_literal = 326,
  UnsignedInteger = 327,
  unsigned_integer = 327,
  UnsignedReal = 328,
  unsigned_real = 328,
  Program = 103,
  program = 103,
  StoredDefinition = 104,
  stored_definition = 104,
  WithinClause = 105,
  within_clause = 105,
  ClassDefinition = 106,
  class_definition = 106,
  ClassPrefixes = 107,
  class_prefixes = 107,
  ClassSpecifier = 108,
  class_specifier = 108,
  LongClassSpecifier = 109,
  long_class_specifier = 109,
  ShortClassSpecifier = 110,
  short_class_specifier = 110,
  DerClassSpecifier = 111,
  der_class_specifier = 111,
  BasePrefix = 112,
  base_prefix = 112,
  EnumList = 113,
  enum_list = 113,
  EnumerationLiteral = 114,
  enumeration_literal = 114,
  Composition = 115,
  composition = 115,
  ExternalClause = 116,
  external_clause = 116,
  LanguageSpecification = 117,
  language_specification = 117,
  ExternalFunctionCall = 118,
  external_function_call = 118,
  ElementList = 119,
  element_list = 119,
  Element = 120,
  element = 120,
  ImportClause = 121,
  import_clause = 121,
  ImportList = 122,
  import_list = 122,
  ExtendsClause = 123,
  extends_clause = 123,
  ConstrainingClause = 124,
  constraining_clause = 124,
  ClassOrInheritanceModification = 125,
  class_or_inheritance_modification = 125,
  ArgumentOrInheritanceModificationList = 126,
  argument_or_inheritance_modification_list = 126,
  InheritanceModification = 127,
  inheritance_modification = 127,
  ComponentClause = 128,
  component_clause = 128,
  TypePrefix = 129,
  type_prefix = 129,
  ComponentList = 130,
  component_list = 130,
  ComponentDeclaration = 131,
  component_declaration = 131,
  ConditionAttribute = 132,
  condition_attribute = 132,
  Declaration = 133,
  declaration = 133,
  Modification = 134,
  modification = 134,
  ModificationExpression = 135,
  modification_expression = 135,
  ClassModification = 136,
  class_modification = 136,
  ArgumentList = 137,
  argument_list = 137,
  Argument = 138,
  argument = 138,
  ElementModificationOrReplaceable = 139,
  element_modification_or_replaceable = 139,
  ElementModification = 140,
  element_modification = 140,
  ElementRedeclaration = 141,
  element_redeclaration = 141,
  ElementReplaceable = 142,
  element_replaceable = 142,
  ComponentClause1 = 143,
  component_clause1 = 143,
  ComponentDeclaration1 = 144,
  component_declaration1 = 144,
  ShortClassDefinition = 145,
  short_class_definition = 145,
  EquationSection = 146,
  equation_section = 146,
  AlgorithmSection = 147,
  algorithm_section = 147,
  SomeEquation = 148,
  some_equation = 148,
  EquationOrProcedure = 149,
  equation_or_procedure = 149,
  SimpleEquation = 150,
  simple_equation = 150,
  Statement = 151,
  statement = 151,
  StatementOrProcedure = 152,
  statement_or_procedure = 152,
  AssignmentStatement = 153,
  assignment_statement = 153,
  FunctionCall = 154,
  function_call = 154,
  IfEquation = 155,
  if_equation = 155,
  IfStatement = 156,
  if_statement = 156,
  ForEquation = 157,
  for_equation = 157,
  ForStatement = 158,
  for_statement = 158,
  ForIndices = 159,
  for_indices = 159,
  ForIndex = 160,
  for_index = 160,
  WhileStatement = 161,
  while_statement = 161,
  WhenEquation = 162,
  when_equation = 162,
  WhenStatement = 163,
  when_statement = 163,
  ConnectEquation = 164,
  connect_equation = 164,
  Expression = 165,
  expression = 165,
  Primary = 166,
  primary = 166,
  UnsignedNumber = 167,
  unsigned_number = 167,
  TypeSpecifier = 168,
  type_specifier = 168,
  Name = 169,
  name = 169,
  ComponentReference = 170,
  component_reference = 170,
  ResultReference = 171,
  result_reference = 171,
  FunctionCallArgs = 172,
  function_call_args = 172,
  FunctionArguments = 173,
  function_arguments = 173,
  FunctionArgumentsNonFirst = 174,
  function_arguments_non_first = 174,
  ArrayArguments = 175,
  array_arguments = 175,
  ArrayArgumentsNonFirst = 176,
  array_arguments_non_first = 176,
  NamedArguments = 177,
  named_arguments = 177,
  NamedArgument = 178,
  named_argument = 178,
  FunctionArgument = 179,
  function_argument = 179,
  FunctionPartialApplication = 180,
  function_partial_application = 180,
  OutputExpressionList = 181,
  output_expression_list = 181,
  ExpressionList = 182,
  expression_list = 182,
  ArraySubscripts = 183,
  array_subscripts = 183,
  Subscript = 184,
  subscript = 184,
  Description = 185,
  description = 185,
  DescriptionString = 186,
  description_string = 186,
  AnnotationClause = 187,
  annotation_clause = 187,
  START = 188,
  _START = 188,
  EOF = 1023,
}

export enum FieldId {
  ClassSpecifier = 1,
  class_specifier = 1,
  Name = 2,
  name = 2,
  Description = 3,
  description = 3,
  Composition = 4,
  composition = 4,
  EndName = 5,
  end_name = 5,
  TypeSpecifier = 6,
  type_specifier = 6,
  TypePrefix = 7,
  type_prefix = 7,
  Declaration = 8,
  declaration = 8,
  Modification = 9,
  modification = 9,
  ClassModification = 10,
  class_modification = 10,
  ModificationExpression = 11,
  modification_expression = 11,
  Lhs = 12,
  lhs = 12,
  Rhs = 13,
  rhs = 13,
  Target = 14,
  target = 14,
  Value = 15,
  value = 15,
  Args = 16,
  args = 16,
  Condition = 17,
  condition = 17,
  Body = 18,
  body = 18,
  ElseCondition = 19,
  elseCondition = 19,
  ElseBody = 20,
  elseBody = 20,
  FinalBody = 21,
  finalBody = 21,
  Indices = 22,
  indices = 22,
  Variable = 23,
  variable = 23,
  Range = 24,
  range = 24,
  Left = 25,
  left = 25,
  Right = 26,
  right = 26,
  Operand = 27,
  operand = 27,
  Flexible = 28,
  flexible = 28,
  Expression = 29,
  expression = 29,
}

/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
export interface ProgramNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Program;
}
export declare function isProgram(node: SyntaxNode | null | undefined): node is ProgramNode;
export interface StoredDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StoredDefinition;
}
export declare function isStoredDefinition(node: SyntaxNode | null | undefined): node is StoredDefinitionNode;
export interface WithinClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.WithinClause;
}
export declare function isWithinClause(node: SyntaxNode | null | undefined): node is WithinClauseNode;
export interface ClassDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassDefinition;
}
export declare function isClassDefinition(node: SyntaxNode | null | undefined): node is ClassDefinitionNode;
export interface ClassPrefixesNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassPrefixes;
}
export declare function isClassPrefixes(node: SyntaxNode | null | undefined): node is ClassPrefixesNode;
export interface ClassSpecifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassSpecifier;
}
export declare function isClassSpecifier(node: SyntaxNode | null | undefined): node is ClassSpecifierNode;
export interface LongClassSpecifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LongClassSpecifier;
}
export declare function isLongClassSpecifier(node: SyntaxNode | null | undefined): node is LongClassSpecifierNode;
export interface ShortClassSpecifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ShortClassSpecifier;
}
export declare function isShortClassSpecifier(node: SyntaxNode | null | undefined): node is ShortClassSpecifierNode;
export interface DerClassSpecifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DerClassSpecifier;
}
export declare function isDerClassSpecifier(node: SyntaxNode | null | undefined): node is DerClassSpecifierNode;
export interface BasePrefixNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BasePrefix;
}
export declare function isBasePrefix(node: SyntaxNode | null | undefined): node is BasePrefixNode;
export interface EnumListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EnumList;
}
export declare function isEnumList(node: SyntaxNode | null | undefined): node is EnumListNode;
export interface EnumerationLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EnumerationLiteral;
}
export declare function isEnumerationLiteral(node: SyntaxNode | null | undefined): node is EnumerationLiteralNode;
export interface CompositionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Composition;
}
export declare function isComposition(node: SyntaxNode | null | undefined): node is CompositionNode;
export interface ExternalClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExternalClause;
}
export declare function isExternalClause(node: SyntaxNode | null | undefined): node is ExternalClauseNode;
export interface LanguageSpecificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LanguageSpecification;
}
export declare function isLanguageSpecification(node: SyntaxNode | null | undefined): node is LanguageSpecificationNode;
export interface ExternalFunctionCallNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExternalFunctionCall;
}
export declare function isExternalFunctionCall(node: SyntaxNode | null | undefined): node is ExternalFunctionCallNode;
export interface ElementListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementList;
}
export declare function isElementList(node: SyntaxNode | null | undefined): node is ElementListNode;
export interface ElementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Element;
}
export declare function isElement(node: SyntaxNode | null | undefined): node is ElementNode;
export interface ImportClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ImportClause;
}
export declare function isImportClause(node: SyntaxNode | null | undefined): node is ImportClauseNode;
export interface ImportListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ImportList;
}
export declare function isImportList(node: SyntaxNode | null | undefined): node is ImportListNode;
export interface ExtendsClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExtendsClause;
}
export declare function isExtendsClause(node: SyntaxNode | null | undefined): node is ExtendsClauseNode;
export interface ConstrainingClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstrainingClause;
}
export declare function isConstrainingClause(node: SyntaxNode | null | undefined): node is ConstrainingClauseNode;
export interface ClassOrInheritanceModificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassOrInheritanceModification;
}
export declare function isClassOrInheritanceModification(node: SyntaxNode | null | undefined): node is ClassOrInheritanceModificationNode;
export interface ArgumentOrInheritanceModificationListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArgumentOrInheritanceModificationList;
}
export declare function isArgumentOrInheritanceModificationList(node: SyntaxNode | null | undefined): node is ArgumentOrInheritanceModificationListNode;
export interface InheritanceModificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InheritanceModification;
}
export declare function isInheritanceModification(node: SyntaxNode | null | undefined): node is InheritanceModificationNode;
export interface ComponentClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ComponentClause;
}
export declare function isComponentClause(node: SyntaxNode | null | undefined): node is ComponentClauseNode;
export interface TypePrefixNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TypePrefix;
}
export declare function isTypePrefix(node: SyntaxNode | null | undefined): node is TypePrefixNode;
export interface ComponentListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ComponentList;
}
export declare function isComponentList(node: SyntaxNode | null | undefined): node is ComponentListNode;
export interface ComponentDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ComponentDeclaration;
}
export declare function isComponentDeclaration(node: SyntaxNode | null | undefined): node is ComponentDeclarationNode;
export interface ConditionAttributeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConditionAttribute;
}
export declare function isConditionAttribute(node: SyntaxNode | null | undefined): node is ConditionAttributeNode;
export interface DeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Declaration;
}
export declare function isDeclaration(node: SyntaxNode | null | undefined): node is DeclarationNode;
export interface ModificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Modification;
}
export declare function isModification(node: SyntaxNode | null | undefined): node is ModificationNode;
export interface ModificationExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ModificationExpression;
}
export declare function isModificationExpression(node: SyntaxNode | null | undefined): node is ModificationExpressionNode;
export interface ClassModificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassModification;
}
export declare function isClassModification(node: SyntaxNode | null | undefined): node is ClassModificationNode;
export interface ArgumentListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArgumentList;
}
export declare function isArgumentList(node: SyntaxNode | null | undefined): node is ArgumentListNode;
export interface ArgumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Argument;
}
export declare function isArgument(node: SyntaxNode | null | undefined): node is ArgumentNode;
export interface ElementModificationOrReplaceableNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementModificationOrReplaceable;
}
export declare function isElementModificationOrReplaceable(node: SyntaxNode | null | undefined): node is ElementModificationOrReplaceableNode;
export interface ElementModificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementModification;
}
export declare function isElementModification(node: SyntaxNode | null | undefined): node is ElementModificationNode;
export interface ElementRedeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementRedeclaration;
}
export declare function isElementRedeclaration(node: SyntaxNode | null | undefined): node is ElementRedeclarationNode;
export interface ElementReplaceableNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementReplaceable;
}
export declare function isElementReplaceable(node: SyntaxNode | null | undefined): node is ElementReplaceableNode;
export interface ComponentClause1Node extends SyntaxNode {
  readonly typeId: SyntaxKind.ComponentClause1;
}
export declare function isComponentClause1(node: SyntaxNode | null | undefined): node is ComponentClause1Node;
export interface ComponentDeclaration1Node extends SyntaxNode {
  readonly typeId: SyntaxKind.ComponentDeclaration1;
}
export declare function isComponentDeclaration1(node: SyntaxNode | null | undefined): node is ComponentDeclaration1Node;
export interface ShortClassDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ShortClassDefinition;
}
export declare function isShortClassDefinition(node: SyntaxNode | null | undefined): node is ShortClassDefinitionNode;
export interface EquationSectionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EquationSection;
}
export declare function isEquationSection(node: SyntaxNode | null | undefined): node is EquationSectionNode;
export interface AlgorithmSectionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AlgorithmSection;
}
export declare function isAlgorithmSection(node: SyntaxNode | null | undefined): node is AlgorithmSectionNode;
export interface SomeEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SomeEquation;
}
export declare function isSomeEquation(node: SyntaxNode | null | undefined): node is SomeEquationNode;
export interface EquationOrProcedureNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EquationOrProcedure;
}
export declare function isEquationOrProcedure(node: SyntaxNode | null | undefined): node is EquationOrProcedureNode;
export interface SimpleEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SimpleEquation;
}
export declare function isSimpleEquation(node: SyntaxNode | null | undefined): node is SimpleEquationNode;
export interface StatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Statement;
}
export declare function isStatement(node: SyntaxNode | null | undefined): node is StatementNode;
export interface StatementOrProcedureNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StatementOrProcedure;
}
export declare function isStatementOrProcedure(node: SyntaxNode | null | undefined): node is StatementOrProcedureNode;
export interface AssignmentStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AssignmentStatement;
}
export declare function isAssignmentStatement(node: SyntaxNode | null | undefined): node is AssignmentStatementNode;
export interface FunctionCallNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionCall;
}
export declare function isFunctionCall(node: SyntaxNode | null | undefined): node is FunctionCallNode;
export interface IfEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IfEquation;
}
export declare function isIfEquation(node: SyntaxNode | null | undefined): node is IfEquationNode;
export interface IfStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IfStatement;
}
export declare function isIfStatement(node: SyntaxNode | null | undefined): node is IfStatementNode;
export interface ForEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForEquation;
}
export declare function isForEquation(node: SyntaxNode | null | undefined): node is ForEquationNode;
export interface ForStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForStatement;
}
export declare function isForStatement(node: SyntaxNode | null | undefined): node is ForStatementNode;
export interface ForIndicesNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForIndices;
}
export declare function isForIndices(node: SyntaxNode | null | undefined): node is ForIndicesNode;
export interface ForIndexNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForIndex;
}
export declare function isForIndex(node: SyntaxNode | null | undefined): node is ForIndexNode;
export interface WhileStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.WhileStatement;
}
export declare function isWhileStatement(node: SyntaxNode | null | undefined): node is WhileStatementNode;
export interface WhenEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.WhenEquation;
}
export declare function isWhenEquation(node: SyntaxNode | null | undefined): node is WhenEquationNode;
export interface WhenStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.WhenStatement;
}
export declare function isWhenStatement(node: SyntaxNode | null | undefined): node is WhenStatementNode;
export interface ConnectEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConnectEquation;
}
export declare function isConnectEquation(node: SyntaxNode | null | undefined): node is ConnectEquationNode;
export interface ExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Expression;
}
export declare function isExpression(node: SyntaxNode | null | undefined): node is ExpressionNode;
export interface PrimaryNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Primary;
}
export declare function isPrimary(node: SyntaxNode | null | undefined): node is PrimaryNode;
export interface UnsignedNumberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnsignedNumber;
}
export declare function isUnsignedNumber(node: SyntaxNode | null | undefined): node is UnsignedNumberNode;
export interface TypeSpecifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TypeSpecifier;
}
export declare function isTypeSpecifier(node: SyntaxNode | null | undefined): node is TypeSpecifierNode;
export interface NameNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Name;
}
export declare function isName(node: SyntaxNode | null | undefined): node is NameNode;
export interface ComponentReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ComponentReference;
}
export declare function isComponentReference(node: SyntaxNode | null | undefined): node is ComponentReferenceNode;
export interface ResultReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ResultReference;
}
export declare function isResultReference(node: SyntaxNode | null | undefined): node is ResultReferenceNode;
export interface FunctionCallArgsNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionCallArgs;
}
export declare function isFunctionCallArgs(node: SyntaxNode | null | undefined): node is FunctionCallArgsNode;
export interface FunctionArgumentsNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionArguments;
}
export declare function isFunctionArguments(node: SyntaxNode | null | undefined): node is FunctionArgumentsNode;
export interface FunctionArgumentsNonFirstNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionArgumentsNonFirst;
}
export declare function isFunctionArgumentsNonFirst(node: SyntaxNode | null | undefined): node is FunctionArgumentsNonFirstNode;
export interface ArrayArgumentsNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArrayArguments;
}
export declare function isArrayArguments(node: SyntaxNode | null | undefined): node is ArrayArgumentsNode;
export interface ArrayArgumentsNonFirstNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArrayArgumentsNonFirst;
}
export declare function isArrayArgumentsNonFirst(node: SyntaxNode | null | undefined): node is ArrayArgumentsNonFirstNode;
export interface NamedArgumentsNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NamedArguments;
}
export declare function isNamedArguments(node: SyntaxNode | null | undefined): node is NamedArgumentsNode;
export interface NamedArgumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NamedArgument;
}
export declare function isNamedArgument(node: SyntaxNode | null | undefined): node is NamedArgumentNode;
export interface FunctionArgumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionArgument;
}
export declare function isFunctionArgument(node: SyntaxNode | null | undefined): node is FunctionArgumentNode;
export interface FunctionPartialApplicationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionPartialApplication;
}
export declare function isFunctionPartialApplication(node: SyntaxNode | null | undefined): node is FunctionPartialApplicationNode;
export interface OutputExpressionListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OutputExpressionList;
}
export declare function isOutputExpressionList(node: SyntaxNode | null | undefined): node is OutputExpressionListNode;
export interface ExpressionListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExpressionList;
}
export declare function isExpressionList(node: SyntaxNode | null | undefined): node is ExpressionListNode;
export interface ArraySubscriptsNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArraySubscripts;
}
export declare function isArraySubscripts(node: SyntaxNode | null | undefined): node is ArraySubscriptsNode;
export interface SubscriptNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Subscript;
}
export declare function isSubscript(node: SyntaxNode | null | undefined): node is SubscriptNode;
export interface DescriptionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Description;
}
export declare function isDescription(node: SyntaxNode | null | undefined): node is DescriptionNode;
export interface DescriptionStringNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DescriptionString;
}
export declare function isDescriptionString(node: SyntaxNode | null | undefined): node is DescriptionStringNode;
export interface AnnotationClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AnnotationClause;
}
export declare function isAnnotationClause(node: SyntaxNode | null | undefined): node is AnnotationClauseNode;
export interface IdentifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Identifier;
}
export declare function isIdentifier(node: SyntaxNode | null | undefined): node is IdentifierNode;
export interface StringLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StringLiteral;
}
export declare function isStringLiteral(node: SyntaxNode | null | undefined): node is StringLiteralNode;
export interface UnsignedIntegerNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnsignedInteger;
}
export declare function isUnsignedInteger(node: SyntaxNode | null | undefined): node is UnsignedIntegerNode;
export interface UnsignedRealNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnsignedReal;
}
export declare function isUnsignedReal(node: SyntaxNode | null | undefined): node is UnsignedRealNode;
export namespace Cst {
  export function kind(node: SyntaxNode | null | undefined): string;
  export function normalize(token: string | null | undefined): string;
  export const Program: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ProgramNode;
  };
  export const StoredDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StoredDefinitionNode;
  };
  export const WithinClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is WithinClauseNode;
  };
  export const ClassDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassDefinitionNode;
    classSpecifier(node: SyntaxNode | null | undefined): SyntaxNode | null;
    classSpecifierList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ClassPrefixes: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassPrefixesNode;
  };
  export const ClassSpecifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassSpecifierNode;
  };
  export const LongClassSpecifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LongClassSpecifierNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    description(node: SyntaxNode | null | undefined): SyntaxNode | null;
    descriptionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    composition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    compositionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    endName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    endNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ShortClassSpecifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ShortClassSpecifierNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DerClassSpecifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DerClassSpecifierNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BasePrefix: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BasePrefixNode;
  };
  export const EnumList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EnumListNode;
  };
  export const EnumerationLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EnumerationLiteralNode;
  };
  export const Composition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CompositionNode;
  };
  export const ExternalClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExternalClauseNode;
  };
  export const LanguageSpecification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LanguageSpecificationNode;
  };
  export const ExternalFunctionCall: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExternalFunctionCallNode;
  };
  export const ElementList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementListNode;
  };
  export const Element: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementNode;
  };
  export const ImportClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImportClauseNode;
  };
  export const ImportList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImportListNode;
  };
  export const ExtendsClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExtendsClauseNode;
    typeSpecifier(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeSpecifierList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstrainingClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstrainingClauseNode;
  };
  export const ClassOrInheritanceModification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassOrInheritanceModificationNode;
  };
  export const ArgumentOrInheritanceModificationList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentOrInheritanceModificationListNode;
  };
  export const InheritanceModification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InheritanceModificationNode;
  };
  export const ComponentClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ComponentClauseNode;
    typePrefix(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typePrefixList(node: SyntaxNode | null | undefined): SyntaxNode[];
    typeSpecifier(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeSpecifierList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TypePrefix: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TypePrefixNode;
  };
  export const ComponentList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ComponentListNode;
  };
  export const ComponentDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ComponentDeclarationNode;
    declaration(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declarationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    description(node: SyntaxNode | null | undefined): SyntaxNode | null;
    descriptionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConditionAttribute: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConditionAttributeNode;
  };
  export const Declaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    modification(node: SyntaxNode | null | undefined): SyntaxNode | null;
    modificationList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Modification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ModificationNode;
    classModification(node: SyntaxNode | null | undefined): SyntaxNode | null;
    classModificationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    modificationExpression(node: SyntaxNode | null | undefined): SyntaxNode | null;
    modificationExpressionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ModificationExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ModificationExpressionNode;
  };
  export const ClassModification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassModificationNode;
  };
  export const ArgumentList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentListNode;
  };
  export const Argument: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentNode;
  };
  export const ElementModificationOrReplaceable: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementModificationOrReplaceableNode;
  };
  export const ElementModification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementModificationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    modification(node: SyntaxNode | null | undefined): SyntaxNode | null;
    modificationList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ElementRedeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementRedeclarationNode;
  };
  export const ElementReplaceable: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementReplaceableNode;
  };
  export const ComponentClause1: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ComponentClause1Node;
    typePrefix(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typePrefixList(node: SyntaxNode | null | undefined): SyntaxNode[];
    typeSpecifier(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeSpecifierList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ComponentDeclaration1: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ComponentDeclaration1Node;
  };
  export const ShortClassDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ShortClassDefinitionNode;
  };
  export const EquationSection: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EquationSectionNode;
  };
  export const AlgorithmSection: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AlgorithmSectionNode;
  };
  export const SomeEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SomeEquationNode;
  };
  export const EquationOrProcedure: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EquationOrProcedureNode;
  };
  export const SimpleEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SimpleEquationNode;
    lhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    lhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
    rhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Statement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StatementNode;
  };
  export const StatementOrProcedure: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StatementOrProcedureNode;
  };
  export const AssignmentStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AssignmentStatementNode;
    target(node: SyntaxNode | null | undefined): SyntaxNode | null;
    targetList(node: SyntaxNode | null | undefined): SyntaxNode[];
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionCall: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionCallNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const IfEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IfEquationNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseCondition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseConditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    finalBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    finalBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const IfStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IfStatementNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseCondition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseConditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    finalBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    finalBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForEquationNode;
    indices(node: SyntaxNode | null | undefined): SyntaxNode | null;
    indicesList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForStatementNode;
    indices(node: SyntaxNode | null | undefined): SyntaxNode | null;
    indicesList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForIndices: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForIndicesNode;
  };
  export const ForIndex: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForIndexNode;
    variable(node: SyntaxNode | null | undefined): SyntaxNode | null;
    variableList(node: SyntaxNode | null | undefined): SyntaxNode[];
    range(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rangeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const WhileStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is WhileStatementNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const WhenEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is WhenEquationNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseCondition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseConditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const WhenStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is WhenStatementNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseCondition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseConditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConnectEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConnectEquationNode;
    lhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    lhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
    rhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Expression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionNode;
    left(node: SyntaxNode | null | undefined): SyntaxNode | null;
    leftList(node: SyntaxNode | null | undefined): SyntaxNode[];
    right(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rightList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Primary: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimaryNode;
  };
  export const UnsignedNumber: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnsignedNumberNode;
  };
  export const TypeSpecifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TypeSpecifierNode;
  };
  export const Name: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NameNode;
  };
  export const ComponentReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ComponentReferenceNode;
  };
  export const ResultReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ResultReferenceNode;
  };
  export const FunctionCallArgs: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionCallArgsNode;
  };
  export const FunctionArguments: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionArgumentsNode;
  };
  export const FunctionArgumentsNonFirst: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionArgumentsNonFirstNode;
  };
  export const ArrayArguments: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArrayArgumentsNode;
  };
  export const ArrayArgumentsNonFirst: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArrayArgumentsNonFirstNode;
  };
  export const NamedArguments: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NamedArgumentsNode;
  };
  export const NamedArgument: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NamedArgumentNode;
  };
  export const FunctionArgument: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionArgumentNode;
  };
  export const FunctionPartialApplication: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionPartialApplicationNode;
  };
  export const OutputExpressionList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OutputExpressionListNode;
  };
  export const ExpressionList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionListNode;
  };
  export const ArraySubscripts: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArraySubscriptsNode;
  };
  export const Subscript: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SubscriptNode;
    flexible(node: SyntaxNode | null | undefined): SyntaxNode | null;
    flexibleList(node: SyntaxNode | null | undefined): SyntaxNode[];
    expression(node: SyntaxNode | null | undefined): SyntaxNode | null;
    expressionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Description: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DescriptionNode;
  };
  export const DescriptionString: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DescriptionStringNode;
  };
  export const AnnotationClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AnnotationClauseNode;
  };
  export const Identifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IdentifierNode;
  };
  export const StringLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StringLiteralNode;
  };
  export const UnsignedInteger: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnsignedIntegerNode;
  };
  export const UnsignedReal: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnsignedRealNode;
  };
}
