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
  MetaClassificationTestOperator = 641,
  CastOperator = 642,
  MetaCastOperator = 643,
  LiteralInfinity = 678,
  DECIMALVALUE = 683,
  DECIMAL_VALUE = 683,
  EXPVALUE = 684,
  EXP_VALUE = 684,
  ID = 685,
  UNRESTRICTEDNAME = 686,
  UNRESTRICTED_NAME = 686,
  STRINGVALUE = 687,
  STRING_VALUE = 687,
  REGULARCOMMENT = 688,
  REGULAR_COMMENT = 688,
  MLNOTE = 689,
  ML_NOTE = 689,
  SLNOTE = 690,
  SL_NOTE = 690,
  RootNamespace = 190,
  PackageBodyElement = 191,
  _PackageBodyElement = 191,
  Identification = 192,
  _Identification = 192,
  RelationshipBody = 193,
  _RelationshipBody = 193,
  VisibilityIndicator = 194,
  Dependency = 195,
  Annotation = 196,
  OwnedAnnotation = 197,
  AnnotatingMember = 198,
  AnnotatingElement = 199,
  _AnnotatingElement = 199,
  Comment = 200,
  Documentation = 201,
  TextualRepresentation = 202,
  PrefixMetadataAnnotation = 203,
  PrefixMetadataMember = 204,
  PrefixMetadataUsage = 205,
  MetadataUsage = 206,
  MetadataTyping = 207,
  MetadataBody = 208,
  _MetadataBody = 208,
  MetadataBodyUsageMember = 209,
  MetadataBodyUsage = 210,
  MetadataDefinition = 211,
  Package = 212,
  LibraryPackage = 213,
  PackageBody = 214,
  _PackageBody = 214,
  PackageMember = 215,
  ElementFilterMember = 216,
  AliasMember = 217,
  ImportPrefix = 218,
  _ImportPrefix = 218,
  Import = 219,
  MembershipImport = 220,
  ImportedMembership = 221,
  _ImportedMembership = 221,
  NamespaceImport = 222,
  ImportedNamespace = 223,
  _ImportedNamespace = 223,
  FilterPackage = 224,
  FilterPackageImport = 225,
  FilterPackageMembershipImport = 226,
  FilterPackageNamespaceImport = 227,
  FilterPackageMember = 228,
  DefinitionElement = 229,
  _DefinitionElement = 229,
  UsageElement = 230,
  _UsageElement = 230,
  NonOccurrenceUsageElement = 231,
  _NonOccurrenceUsageElement = 231,
  OccurrenceUsageElement = 232,
  _OccurrenceUsageElement = 232,
  StructureUsageElement = 233,
  _StructureUsageElement = 233,
  BehaviorUsageElement = 234,
  _BehaviorUsageElement = 234,
  SubclassificationPart = 235,
  _SubclassificationPart = 235,
  OwnedSubclassification = 236,
  FeatureDeclaration = 237,
  _FeatureDeclaration = 237,
  FeatureSpecializationPart = 238,
  _FeatureSpecializationPart = 238,
  MultiplicityPart = 239,
  _MultiplicityPart = 239,
  FeatureSpecialization = 240,
  _FeatureSpecialization = 240,
  Typings = 241,
  _Typings = 241,
  Subsettings = 242,
  _Subsettings = 242,
  References = 243,
  _References = 243,
  Crosses = 244,
  _Crosses = 244,
  Redefinitions = 245,
  _Redefinitions = 245,
  FeatureTyping = 246,
  OwnedFeatureTyping = 247,
  OwnedSubsetting = 248,
  OwnedReferenceSubsetting = 249,
  OwnedCrossSubsetting = 250,
  OwnedRedefinition = 251,
  OwnedMultiplicity = 252,
  MultiplicityRange = 253,
  MultiplicityExpressionMember = 254,
  Definition = 255,
  _Definition = 255,
  DefinitionBody = 256,
  _DefinitionBody = 256,
  DefinitionBodyItem = 257,
  _DefinitionBodyItem = 257,
  DefinitionMember = 258,
  VariantUsageMember = 259,
  NonOccurrenceUsageMember = 260,
  OccurrenceUsageMember = 261,
  UsageModifier = 262,
  _usage_modifier = 262,
  UsageDeclaration = 263,
  _UsageDeclaration = 263,
  UsageCompletion = 264,
  _UsageCompletion = 264,
  Usage = 265,
  _Usage = 265,
  ValuePart = 266,
  _ValuePart = 266,
  FeatureValue = 267,
  DefaultReferenceUsage = 268,
  ReferenceUsage = 269,
  AttributeDefinition = 270,
  AttributeUsage = 271,
  EnumerationDefinition = 272,
  EnumerationBody = 273,
  _EnumerationBody = 273,
  EnumerationUsageMember = 274,
  EnumeratedValue = 275,
  EnumerationUsage = 276,
  OccurrenceDefinition = 277,
  OccurrenceUsage = 278,
  ItemDefinition = 279,
  ItemUsage = 280,
  PartDefinition = 281,
  PartUsage = 282,
  PortDefinition = 283,
  PortUsage = 284,
  ConjugatedPortTyping = 285,
  ConnectorEndMember = 286,
  ConnectorEnd = 287,
  ConnectionDefinition = 288,
  ConnectionUsage = 289,
  ConnectorPart = 290,
  _ConnectorPart = 290,
  BinaryConnectorPart = 291,
  _BinaryConnectorPart = 291,
  NaryConnectorPart = 292,
  _NaryConnectorPart = 292,
  BindingConnectorAsUsage = 293,
  SuccessionAsUsage = 294,
  InterfaceDefinition = 295,
  InterfaceUsage = 296,
  AllocationDefinition = 297,
  AllocationUsage = 298,
  FlowDefinition = 299,
  FlowUsage = 300,
  SuccessionFlowUsage = 301,
  PayloadFeatureMember = 302,
  PayloadFeature = 303,
  FlowEndMember = 304,
  FlowEnd = 305,
  FlowFeatureMember = 306,
  FlowFeature = 307,
  ActionDefinition = 308,
  ActionBody = 309,
  _ActionBody = 309,
  ActionBodyItem = 310,
  _ActionBodyItem = 310,
  EmptySuccessionMember = 311,
  MultiplicitySourceEnd = 312,
  ActionNodeMember = 313,
  ActionNode = 314,
  _ActionNode = 314,
  IfNode = 315,
  ActionBodyParameter = 316,
  WhileLoopNode = 317,
  ForLoopNode = 318,
  ForVariableDeclaration = 319,
  ControlNode = 320,
  MergeNode = 321,
  DecisionNode = 322,
  JoinNode = 323,
  ForkNode = 324,
  ActionUsage = 325,
  AcceptActionNode = 326,
  SendActionNode = 327,
  AssignActionNode = 328,
  PerformActionUsage = 329,
  CalculationDefinition = 330,
  CalculationBody = 331,
  _CalculationBody = 331,
  ParameterList = 332,
  _ParameterList = 332,
  ParameterMember = 333,
  ReturnParameterMember = 334,
  ResultExpressionMember = 335,
  CalculationUsage = 336,
  ConstraintDefinition = 337,
  ConstraintUsage = 338,
  AssertConstraintUsage = 339,
  RequirementDefinition = 340,
  RequirementBody = 341,
  _RequirementBody = 341,
  RequirementBodyItem = 342,
  _RequirementBodyItem = 342,
  SubjectMember = 343,
  SubjectUsage = 344,
  RequirementConstraintMember = 345,
  RequirementConstraintUsage = 346,
  ActorMember = 347,
  ActorUsage = 348,
  StakeholderMember = 349,
  StakeholderUsage = 350,
  RequirementUsage = 351,
  SatisfyRequirementUsage = 352,
  ConcernDefinition = 353,
  ConcernUsage = 354,
  CaseDefinition = 355,
  CaseBody = 356,
  _CaseBody = 356,
  CaseUsage = 357,
  AnalysisCaseDefinition = 358,
  AnalysisCaseUsage = 359,
  VerificationCaseDefinition = 360,
  VerificationCaseUsage = 361,
  VerificationBody = 362,
  _VerificationBody = 362,
  VerificationBodyItem = 363,
  _VerificationBodyItem = 363,
  VerifyRequirementUsageMember = 364,
  VerifyRequirementUsage = 365,
  ObjectiveMember = 366,
  ObjectiveRequirementUsage = 367,
  UseCaseDefinition = 368,
  UseCaseUsage = 369,
  IncludeUseCaseUsage = 370,
  StateDefinition = 371,
  StateBodyItem = 372,
  _StateBodyItem = 372,
  EntryActionMember = 373,
  DoActionMember = 374,
  ExitActionMember = 375,
  StateActionUsage = 376,
  StateUsage = 377,
  ExhibitStateUsage = 378,
  TransitionUsageMember = 379,
  TransitionUsage = 380,
  ViewDefinition = 381,
  ViewUsage = 382,
  ViewpointDefinition = 383,
  ViewpointUsage = 384,
  RenderingDefinition = 385,
  RenderingUsage = 386,
  OwnedExpressionMember = 387,
  OwnedExpression = 388,
  Expression = 389,
  _Expression = 389,
  OwnedExpressionReference = 390,
  ConditionalExpression = 391,
  NullCoalescingExpression = 392,
  ImpliesExpressionReference = 393,
  ImpliesExpressionMember = 394,
  ImpliesExpression = 395,
  OrExpressionReference = 396,
  OrExpressionMember = 397,
  OrExpression = 398,
  XorExpressionReference = 399,
  XorExpressionMember = 400,
  XorExpression = 401,
  AndExpression = 402,
  EqualityExpressionReference = 403,
  EqualityExpressionMember = 404,
  EqualityExpression = 405,
  EqualityOperator = 406,
  ClassificationExpression = 407,
  ClassificationTestOperator = 408,
  MetadataReference = 409,
  TypeReferenceMember = 410,
  TypeResultMember = 411,
  TypeReference = 412,
  ReferenceTyping = 413,
  RelationalExpression = 414,
  RelationalOperator = 415,
  RangeExpression = 416,
  AdditiveExpression = 417,
  AdditiveOperator = 418,
  MultiplicativeExpression = 419,
  MultiplicativeOperator = 420,
  ExponentiationExpression = 421,
  ExponentiationOperator = 422,
  UnaryExpression = 423,
  UnaryOperator = 424,
  ExtentExpression = 425,
  PostfixOperation = 426,
  _postfix_operation = 426,
  PrimaryExpression = 427,
  FunctionReferenceExpression = 428,
  FunctionReferenceMember = 429,
  FunctionReference = 430,
  FeatureChainMember = 431,
  OwnedFeatureChain = 432,
  BaseExpression = 433,
  _BaseExpression = 433,
  BodyExpression = 434,
  ExpressionBodyMember = 435,
  ExpressionBody = 436,
  SequenceExpression = 437,
  FeatureReferenceExpression = 438,
  FeatureReferenceMember = 439,
  MetadataAccessExpression = 440,
  ElementReferenceMember = 441,
  InvocationExpression = 442,
  ConstructorExpression = 443,
  ConstructorResultMember = 444,
  ConstructorResult = 445,
  InstantiatedTypeMember = 446,
  FeatureChain = 447,
  _FeatureChain = 447,
  OwnedFeatureChaining = 448,
  ArgumentList = 449,
  _ArgumentList = 449,
  PositionalArgumentList = 450,
  _PositionalArgumentList = 450,
  ArgumentMember = 451,
  Argument = 452,
  NamedArgumentList = 453,
  _NamedArgumentList = 453,
  NamedArgumentMember = 454,
  NamedArgument = 455,
  ParameterRedefinition = 456,
  ArgumentValue = 457,
  NullExpression = 458,
  LiteralExpression = 459,
  _LiteralExpression = 459,
  LiteralBoolean = 460,
  BooleanValue = 461,
  LiteralString = 462,
  LiteralInteger = 463,
  LiteralReal = 464,
  RealValue = 465,
  Name = 466,
  GlobalQualification = 467,
  Qualification = 468,
  QualifiedName = 469,
  START = 470,
  _START = 470,
  EOF = 1023,
}

export enum FieldId {
  DeclaredShortName = 1,
  declaredShortName = 1,
  DeclaredName = 2,
  declaredName = 2,
  Client = 3,
  client = 3,
  Supplier = 4,
  supplier = 4,
  AnnotatedElement = 5,
  annotatedElement = 5,
  OwnedRelatedElement = 6,
  ownedRelatedElement = 6,
  Locale = 7,
  locale = 7,
  Body = 8,
  body = 8,
  Language = 9,
  language = 9,
  OwnedRelationship = 10,
  ownedRelationship = 10,
  Type = 11,
  type = 11,
  IsStandard = 12,
  isStandard = 12,
  MemberShortName = 13,
  memberShortName = 13,
  MemberElement = 14,
  memberElement = 14,
  IsImportAll = 15,
  isImportAll = 15,
  ImportedMembership = 16,
  importedMembership = 16,
  IsRecursive = 17,
  isRecursive = 17,
  ImportedNamespace = 18,
  importedNamespace = 18,
  Superclassifier = 19,
  superclassifier = 19,
  IsOrdered = 20,
  isOrdered = 20,
  IsNonunique = 21,
  isNonunique = 21,
  LowerBound = 22,
  lowerBound = 22,
  UpperBound = 23,
  upperBound = 23,
  IsEnd = 24,
  isEnd = 24,
  Direction = 25,
  direction = 25,
  IsDerived = 26,
  isDerived = 26,
  IsAbstract = 27,
  isAbstract = 27,
  IsVariation = 28,
  isVariation = 28,
  IsConstant = 29,
  isConstant = 29,
  IsRef = 30,
  isRef = 30,
  IsRedefine = 31,
  isRedefine = 31,
  IsSubsetting = 32,
  isSubsetting = 32,
  IsInitial = 33,
  isInitial = 33,
  IsDefault = 34,
  isDefault = 34,
  ConjugatedPortDefinition = 35,
  conjugatedPortDefinition = 35,
  Guard = 36,
  guard = 36,
  Condition = 37,
  condition = 37,
  ThenBody = 38,
  thenBody = 38,
  ElseBody = 39,
  elseBody = 39,
  UntilCondition = 40,
  untilCondition = 40,
  Variable = 41,
  variable = 41,
  Range = 42,
  range = 42,
  SentItem = 43,
  sentItem = 43,
  Receiver = 44,
  receiver = 44,
  AssignedValue = 45,
  assignedValue = 45,
  TargetFeature = 46,
  targetFeature = 46,
  IsNegated = 47,
  isNegated = 47,
  ConstraintKind = 48,
  constraintKind = 48,
  SatisfyingFeature = 49,
  satisfyingFeature = 49,
  IsParallel = 50,
  isParallel = 50,
  Source = 51,
  source = 51,
  Trigger = 52,
  trigger = 52,
  Effect = 53,
  effect = 53,
  Operator = 54,
  operator = 54,
  Operand = 55,
  operand = 55,
  ThenOperand = 56,
  thenOperand = 56,
  ElseOperand = 57,
  elseOperand = 57,
  TypeReference = 58,
  typeReference = 58,
  TypeResult = 59,
  typeResult = 59,
  IndexOperand = 60,
  indexOperand = 60,
  FilterOperand = 61,
  filterOperand = 61,
  InvocationType = 62,
  invocationType = 62,
  FunctionRef = 63,
  functionRef = 63,
  Collect = 64,
  collect = 64,
  Select = 65,
  select = 65,
  FeatureChain = 66,
  featureChain = 66,
  Base = 67,
  base = 67,
  Result = 68,
  result = 68,
  Chaining = 69,
  chaining = 69,
  ChainingFeature = 70,
  chainingFeature = 70,
  Argument = 71,
  argument = 71,
  NamedArgument = 72,
  namedArgument = 72,
  ParameterRedefinition = 73,
  parameterRedefinition = 73,
  Value = 74,
  value = 74,
  RedefinedFeature = 75,
  redefinedFeature = 75,
  Name = 76,
  name = 76,
}

/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
export interface RootNamespaceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RootNamespace;
}
export declare function isRootNamespace(node: SyntaxNode | null | undefined): node is RootNamespaceNode;
export interface VisibilityIndicatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VisibilityIndicator;
}
export declare function isVisibilityIndicator(node: SyntaxNode | null | undefined): node is VisibilityIndicatorNode;
export interface DependencyNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Dependency;
}
export declare function isDependency(node: SyntaxNode | null | undefined): node is DependencyNode;
export interface AnnotationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Annotation;
}
export declare function isAnnotation(node: SyntaxNode | null | undefined): node is AnnotationNode;
export interface OwnedAnnotationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedAnnotation;
}
export declare function isOwnedAnnotation(node: SyntaxNode | null | undefined): node is OwnedAnnotationNode;
export interface AnnotatingMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AnnotatingMember;
}
export declare function isAnnotatingMember(node: SyntaxNode | null | undefined): node is AnnotatingMemberNode;
export interface CommentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Comment;
}
export declare function isComment(node: SyntaxNode | null | undefined): node is CommentNode;
export interface DocumentationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Documentation;
}
export declare function isDocumentation(node: SyntaxNode | null | undefined): node is DocumentationNode;
export interface TextualRepresentationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TextualRepresentation;
}
export declare function isTextualRepresentation(node: SyntaxNode | null | undefined): node is TextualRepresentationNode;
export interface PrefixMetadataAnnotationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrefixMetadataAnnotation;
}
export declare function isPrefixMetadataAnnotation(node: SyntaxNode | null | undefined): node is PrefixMetadataAnnotationNode;
export interface PrefixMetadataMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrefixMetadataMember;
}
export declare function isPrefixMetadataMember(node: SyntaxNode | null | undefined): node is PrefixMetadataMemberNode;
export interface PrefixMetadataUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrefixMetadataUsage;
}
export declare function isPrefixMetadataUsage(node: SyntaxNode | null | undefined): node is PrefixMetadataUsageNode;
export interface MetadataUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataUsage;
}
export declare function isMetadataUsage(node: SyntaxNode | null | undefined): node is MetadataUsageNode;
export interface MetadataTypingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataTyping;
}
export declare function isMetadataTyping(node: SyntaxNode | null | undefined): node is MetadataTypingNode;
export interface MetadataBodyUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataBodyUsageMember;
}
export declare function isMetadataBodyUsageMember(node: SyntaxNode | null | undefined): node is MetadataBodyUsageMemberNode;
export interface MetadataBodyUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataBodyUsage;
}
export declare function isMetadataBodyUsage(node: SyntaxNode | null | undefined): node is MetadataBodyUsageNode;
export interface MetadataDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataDefinition;
}
export declare function isMetadataDefinition(node: SyntaxNode | null | undefined): node is MetadataDefinitionNode;
export interface PackageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Package;
}
export declare function isPackage(node: SyntaxNode | null | undefined): node is PackageNode;
export interface LibraryPackageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LibraryPackage;
}
export declare function isLibraryPackage(node: SyntaxNode | null | undefined): node is LibraryPackageNode;
export interface PackageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PackageMember;
}
export declare function isPackageMember(node: SyntaxNode | null | undefined): node is PackageMemberNode;
export interface ElementFilterMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementFilterMember;
}
export declare function isElementFilterMember(node: SyntaxNode | null | undefined): node is ElementFilterMemberNode;
export interface AliasMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AliasMember;
}
export declare function isAliasMember(node: SyntaxNode | null | undefined): node is AliasMemberNode;
export interface ImportNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Import;
}
export declare function isImport(node: SyntaxNode | null | undefined): node is ImportNode;
export interface MembershipImportNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MembershipImport;
}
export declare function isMembershipImport(node: SyntaxNode | null | undefined): node is MembershipImportNode;
export interface NamespaceImportNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NamespaceImport;
}
export declare function isNamespaceImport(node: SyntaxNode | null | undefined): node is NamespaceImportNode;
export interface FilterPackageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FilterPackage;
}
export declare function isFilterPackage(node: SyntaxNode | null | undefined): node is FilterPackageNode;
export interface FilterPackageImportNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FilterPackageImport;
}
export declare function isFilterPackageImport(node: SyntaxNode | null | undefined): node is FilterPackageImportNode;
export interface FilterPackageMembershipImportNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FilterPackageMembershipImport;
}
export declare function isFilterPackageMembershipImport(node: SyntaxNode | null | undefined): node is FilterPackageMembershipImportNode;
export interface FilterPackageNamespaceImportNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FilterPackageNamespaceImport;
}
export declare function isFilterPackageNamespaceImport(node: SyntaxNode | null | undefined): node is FilterPackageNamespaceImportNode;
export interface FilterPackageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FilterPackageMember;
}
export declare function isFilterPackageMember(node: SyntaxNode | null | undefined): node is FilterPackageMemberNode;
export interface OwnedSubclassificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedSubclassification;
}
export declare function isOwnedSubclassification(node: SyntaxNode | null | undefined): node is OwnedSubclassificationNode;
export interface FeatureTypingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FeatureTyping;
}
export declare function isFeatureTyping(node: SyntaxNode | null | undefined): node is FeatureTypingNode;
export interface OwnedFeatureTypingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedFeatureTyping;
}
export declare function isOwnedFeatureTyping(node: SyntaxNode | null | undefined): node is OwnedFeatureTypingNode;
export interface OwnedSubsettingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedSubsetting;
}
export declare function isOwnedSubsetting(node: SyntaxNode | null | undefined): node is OwnedSubsettingNode;
export interface OwnedReferenceSubsettingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedReferenceSubsetting;
}
export declare function isOwnedReferenceSubsetting(node: SyntaxNode | null | undefined): node is OwnedReferenceSubsettingNode;
export interface OwnedCrossSubsettingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedCrossSubsetting;
}
export declare function isOwnedCrossSubsetting(node: SyntaxNode | null | undefined): node is OwnedCrossSubsettingNode;
export interface OwnedRedefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedRedefinition;
}
export declare function isOwnedRedefinition(node: SyntaxNode | null | undefined): node is OwnedRedefinitionNode;
export interface OwnedMultiplicityNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedMultiplicity;
}
export declare function isOwnedMultiplicity(node: SyntaxNode | null | undefined): node is OwnedMultiplicityNode;
export interface MultiplicityRangeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MultiplicityRange;
}
export declare function isMultiplicityRange(node: SyntaxNode | null | undefined): node is MultiplicityRangeNode;
export interface MultiplicityExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MultiplicityExpressionMember;
}
export declare function isMultiplicityExpressionMember(node: SyntaxNode | null | undefined): node is MultiplicityExpressionMemberNode;
export interface DefinitionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DefinitionMember;
}
export declare function isDefinitionMember(node: SyntaxNode | null | undefined): node is DefinitionMemberNode;
export interface VariantUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VariantUsageMember;
}
export declare function isVariantUsageMember(node: SyntaxNode | null | undefined): node is VariantUsageMemberNode;
export interface NonOccurrenceUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NonOccurrenceUsageMember;
}
export declare function isNonOccurrenceUsageMember(node: SyntaxNode | null | undefined): node is NonOccurrenceUsageMemberNode;
export interface OccurrenceUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OccurrenceUsageMember;
}
export declare function isOccurrenceUsageMember(node: SyntaxNode | null | undefined): node is OccurrenceUsageMemberNode;
export interface FeatureValueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FeatureValue;
}
export declare function isFeatureValue(node: SyntaxNode | null | undefined): node is FeatureValueNode;
export interface DefaultReferenceUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DefaultReferenceUsage;
}
export declare function isDefaultReferenceUsage(node: SyntaxNode | null | undefined): node is DefaultReferenceUsageNode;
export interface ReferenceUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ReferenceUsage;
}
export declare function isReferenceUsage(node: SyntaxNode | null | undefined): node is ReferenceUsageNode;
export interface AttributeDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AttributeDefinition;
}
export declare function isAttributeDefinition(node: SyntaxNode | null | undefined): node is AttributeDefinitionNode;
export interface AttributeUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AttributeUsage;
}
export declare function isAttributeUsage(node: SyntaxNode | null | undefined): node is AttributeUsageNode;
export interface EnumerationDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EnumerationDefinition;
}
export declare function isEnumerationDefinition(node: SyntaxNode | null | undefined): node is EnumerationDefinitionNode;
export interface EnumerationUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EnumerationUsageMember;
}
export declare function isEnumerationUsageMember(node: SyntaxNode | null | undefined): node is EnumerationUsageMemberNode;
export interface EnumeratedValueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EnumeratedValue;
}
export declare function isEnumeratedValue(node: SyntaxNode | null | undefined): node is EnumeratedValueNode;
export interface EnumerationUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EnumerationUsage;
}
export declare function isEnumerationUsage(node: SyntaxNode | null | undefined): node is EnumerationUsageNode;
export interface OccurrenceDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OccurrenceDefinition;
}
export declare function isOccurrenceDefinition(node: SyntaxNode | null | undefined): node is OccurrenceDefinitionNode;
export interface OccurrenceUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OccurrenceUsage;
}
export declare function isOccurrenceUsage(node: SyntaxNode | null | undefined): node is OccurrenceUsageNode;
export interface ItemDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ItemDefinition;
}
export declare function isItemDefinition(node: SyntaxNode | null | undefined): node is ItemDefinitionNode;
export interface ItemUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ItemUsage;
}
export declare function isItemUsage(node: SyntaxNode | null | undefined): node is ItemUsageNode;
export interface PartDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PartDefinition;
}
export declare function isPartDefinition(node: SyntaxNode | null | undefined): node is PartDefinitionNode;
export interface PartUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PartUsage;
}
export declare function isPartUsage(node: SyntaxNode | null | undefined): node is PartUsageNode;
export interface PortDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PortDefinition;
}
export declare function isPortDefinition(node: SyntaxNode | null | undefined): node is PortDefinitionNode;
export interface PortUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PortUsage;
}
export declare function isPortUsage(node: SyntaxNode | null | undefined): node is PortUsageNode;
export interface ConjugatedPortTypingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConjugatedPortTyping;
}
export declare function isConjugatedPortTyping(node: SyntaxNode | null | undefined): node is ConjugatedPortTypingNode;
export interface ConnectorEndMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConnectorEndMember;
}
export declare function isConnectorEndMember(node: SyntaxNode | null | undefined): node is ConnectorEndMemberNode;
export interface ConnectorEndNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConnectorEnd;
}
export declare function isConnectorEnd(node: SyntaxNode | null | undefined): node is ConnectorEndNode;
export interface ConnectionDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConnectionDefinition;
}
export declare function isConnectionDefinition(node: SyntaxNode | null | undefined): node is ConnectionDefinitionNode;
export interface ConnectionUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConnectionUsage;
}
export declare function isConnectionUsage(node: SyntaxNode | null | undefined): node is ConnectionUsageNode;
export interface BindingConnectorAsUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BindingConnectorAsUsage;
}
export declare function isBindingConnectorAsUsage(node: SyntaxNode | null | undefined): node is BindingConnectorAsUsageNode;
export interface SuccessionAsUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SuccessionAsUsage;
}
export declare function isSuccessionAsUsage(node: SyntaxNode | null | undefined): node is SuccessionAsUsageNode;
export interface InterfaceDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InterfaceDefinition;
}
export declare function isInterfaceDefinition(node: SyntaxNode | null | undefined): node is InterfaceDefinitionNode;
export interface InterfaceUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InterfaceUsage;
}
export declare function isInterfaceUsage(node: SyntaxNode | null | undefined): node is InterfaceUsageNode;
export interface AllocationDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AllocationDefinition;
}
export declare function isAllocationDefinition(node: SyntaxNode | null | undefined): node is AllocationDefinitionNode;
export interface AllocationUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AllocationUsage;
}
export declare function isAllocationUsage(node: SyntaxNode | null | undefined): node is AllocationUsageNode;
export interface FlowDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FlowDefinition;
}
export declare function isFlowDefinition(node: SyntaxNode | null | undefined): node is FlowDefinitionNode;
export interface FlowUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FlowUsage;
}
export declare function isFlowUsage(node: SyntaxNode | null | undefined): node is FlowUsageNode;
export interface SuccessionFlowUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SuccessionFlowUsage;
}
export declare function isSuccessionFlowUsage(node: SyntaxNode | null | undefined): node is SuccessionFlowUsageNode;
export interface PayloadFeatureMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PayloadFeatureMember;
}
export declare function isPayloadFeatureMember(node: SyntaxNode | null | undefined): node is PayloadFeatureMemberNode;
export interface PayloadFeatureNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PayloadFeature;
}
export declare function isPayloadFeature(node: SyntaxNode | null | undefined): node is PayloadFeatureNode;
export interface FlowEndMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FlowEndMember;
}
export declare function isFlowEndMember(node: SyntaxNode | null | undefined): node is FlowEndMemberNode;
export interface FlowEndNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FlowEnd;
}
export declare function isFlowEnd(node: SyntaxNode | null | undefined): node is FlowEndNode;
export interface FlowFeatureMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FlowFeatureMember;
}
export declare function isFlowFeatureMember(node: SyntaxNode | null | undefined): node is FlowFeatureMemberNode;
export interface FlowFeatureNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FlowFeature;
}
export declare function isFlowFeature(node: SyntaxNode | null | undefined): node is FlowFeatureNode;
export interface ActionDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ActionDefinition;
}
export declare function isActionDefinition(node: SyntaxNode | null | undefined): node is ActionDefinitionNode;
export interface EmptySuccessionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EmptySuccessionMember;
}
export declare function isEmptySuccessionMember(node: SyntaxNode | null | undefined): node is EmptySuccessionMemberNode;
export interface MultiplicitySourceEndNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MultiplicitySourceEnd;
}
export declare function isMultiplicitySourceEnd(node: SyntaxNode | null | undefined): node is MultiplicitySourceEndNode;
export interface ActionNodeMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ActionNodeMember;
}
export declare function isActionNodeMember(node: SyntaxNode | null | undefined): node is ActionNodeMemberNode;
export interface IfNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IfNode;
}
export declare function isIfNode(node: SyntaxNode | null | undefined): node is IfNodeNode;
export interface ActionBodyParameterNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ActionBodyParameter;
}
export declare function isActionBodyParameter(node: SyntaxNode | null | undefined): node is ActionBodyParameterNode;
export interface WhileLoopNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.WhileLoopNode;
}
export declare function isWhileLoopNode(node: SyntaxNode | null | undefined): node is WhileLoopNodeNode;
export interface ForLoopNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForLoopNode;
}
export declare function isForLoopNode(node: SyntaxNode | null | undefined): node is ForLoopNodeNode;
export interface ForVariableDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForVariableDeclaration;
}
export declare function isForVariableDeclaration(node: SyntaxNode | null | undefined): node is ForVariableDeclarationNode;
export interface ControlNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ControlNode;
}
export declare function isControlNode(node: SyntaxNode | null | undefined): node is ControlNodeNode;
export interface MergeNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MergeNode;
}
export declare function isMergeNode(node: SyntaxNode | null | undefined): node is MergeNodeNode;
export interface DecisionNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DecisionNode;
}
export declare function isDecisionNode(node: SyntaxNode | null | undefined): node is DecisionNodeNode;
export interface JoinNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.JoinNode;
}
export declare function isJoinNode(node: SyntaxNode | null | undefined): node is JoinNodeNode;
export interface ForkNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForkNode;
}
export declare function isForkNode(node: SyntaxNode | null | undefined): node is ForkNodeNode;
export interface ActionUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ActionUsage;
}
export declare function isActionUsage(node: SyntaxNode | null | undefined): node is ActionUsageNode;
export interface AcceptActionNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AcceptActionNode;
}
export declare function isAcceptActionNode(node: SyntaxNode | null | undefined): node is AcceptActionNodeNode;
export interface SendActionNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SendActionNode;
}
export declare function isSendActionNode(node: SyntaxNode | null | undefined): node is SendActionNodeNode;
export interface AssignActionNodeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AssignActionNode;
}
export declare function isAssignActionNode(node: SyntaxNode | null | undefined): node is AssignActionNodeNode;
export interface PerformActionUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PerformActionUsage;
}
export declare function isPerformActionUsage(node: SyntaxNode | null | undefined): node is PerformActionUsageNode;
export interface CalculationDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CalculationDefinition;
}
export declare function isCalculationDefinition(node: SyntaxNode | null | undefined): node is CalculationDefinitionNode;
export interface ParameterMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterMember;
}
export declare function isParameterMember(node: SyntaxNode | null | undefined): node is ParameterMemberNode;
export interface ReturnParameterMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ReturnParameterMember;
}
export declare function isReturnParameterMember(node: SyntaxNode | null | undefined): node is ReturnParameterMemberNode;
export interface ResultExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ResultExpressionMember;
}
export declare function isResultExpressionMember(node: SyntaxNode | null | undefined): node is ResultExpressionMemberNode;
export interface CalculationUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CalculationUsage;
}
export declare function isCalculationUsage(node: SyntaxNode | null | undefined): node is CalculationUsageNode;
export interface ConstraintDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstraintDefinition;
}
export declare function isConstraintDefinition(node: SyntaxNode | null | undefined): node is ConstraintDefinitionNode;
export interface ConstraintUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstraintUsage;
}
export declare function isConstraintUsage(node: SyntaxNode | null | undefined): node is ConstraintUsageNode;
export interface AssertConstraintUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AssertConstraintUsage;
}
export declare function isAssertConstraintUsage(node: SyntaxNode | null | undefined): node is AssertConstraintUsageNode;
export interface RequirementDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RequirementDefinition;
}
export declare function isRequirementDefinition(node: SyntaxNode | null | undefined): node is RequirementDefinitionNode;
export interface SubjectMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SubjectMember;
}
export declare function isSubjectMember(node: SyntaxNode | null | undefined): node is SubjectMemberNode;
export interface SubjectUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SubjectUsage;
}
export declare function isSubjectUsage(node: SyntaxNode | null | undefined): node is SubjectUsageNode;
export interface RequirementConstraintMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RequirementConstraintMember;
}
export declare function isRequirementConstraintMember(node: SyntaxNode | null | undefined): node is RequirementConstraintMemberNode;
export interface RequirementConstraintUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RequirementConstraintUsage;
}
export declare function isRequirementConstraintUsage(node: SyntaxNode | null | undefined): node is RequirementConstraintUsageNode;
export interface ActorMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ActorMember;
}
export declare function isActorMember(node: SyntaxNode | null | undefined): node is ActorMemberNode;
export interface ActorUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ActorUsage;
}
export declare function isActorUsage(node: SyntaxNode | null | undefined): node is ActorUsageNode;
export interface StakeholderMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StakeholderMember;
}
export declare function isStakeholderMember(node: SyntaxNode | null | undefined): node is StakeholderMemberNode;
export interface StakeholderUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StakeholderUsage;
}
export declare function isStakeholderUsage(node: SyntaxNode | null | undefined): node is StakeholderUsageNode;
export interface RequirementUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RequirementUsage;
}
export declare function isRequirementUsage(node: SyntaxNode | null | undefined): node is RequirementUsageNode;
export interface SatisfyRequirementUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SatisfyRequirementUsage;
}
export declare function isSatisfyRequirementUsage(node: SyntaxNode | null | undefined): node is SatisfyRequirementUsageNode;
export interface ConcernDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConcernDefinition;
}
export declare function isConcernDefinition(node: SyntaxNode | null | undefined): node is ConcernDefinitionNode;
export interface ConcernUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConcernUsage;
}
export declare function isConcernUsage(node: SyntaxNode | null | undefined): node is ConcernUsageNode;
export interface CaseDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CaseDefinition;
}
export declare function isCaseDefinition(node: SyntaxNode | null | undefined): node is CaseDefinitionNode;
export interface CaseUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CaseUsage;
}
export declare function isCaseUsage(node: SyntaxNode | null | undefined): node is CaseUsageNode;
export interface AnalysisCaseDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AnalysisCaseDefinition;
}
export declare function isAnalysisCaseDefinition(node: SyntaxNode | null | undefined): node is AnalysisCaseDefinitionNode;
export interface AnalysisCaseUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AnalysisCaseUsage;
}
export declare function isAnalysisCaseUsage(node: SyntaxNode | null | undefined): node is AnalysisCaseUsageNode;
export interface VerificationCaseDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VerificationCaseDefinition;
}
export declare function isVerificationCaseDefinition(node: SyntaxNode | null | undefined): node is VerificationCaseDefinitionNode;
export interface VerificationCaseUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VerificationCaseUsage;
}
export declare function isVerificationCaseUsage(node: SyntaxNode | null | undefined): node is VerificationCaseUsageNode;
export interface VerifyRequirementUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VerifyRequirementUsageMember;
}
export declare function isVerifyRequirementUsageMember(node: SyntaxNode | null | undefined): node is VerifyRequirementUsageMemberNode;
export interface VerifyRequirementUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VerifyRequirementUsage;
}
export declare function isVerifyRequirementUsage(node: SyntaxNode | null | undefined): node is VerifyRequirementUsageNode;
export interface ObjectiveMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ObjectiveMember;
}
export declare function isObjectiveMember(node: SyntaxNode | null | undefined): node is ObjectiveMemberNode;
export interface ObjectiveRequirementUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ObjectiveRequirementUsage;
}
export declare function isObjectiveRequirementUsage(node: SyntaxNode | null | undefined): node is ObjectiveRequirementUsageNode;
export interface UseCaseDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UseCaseDefinition;
}
export declare function isUseCaseDefinition(node: SyntaxNode | null | undefined): node is UseCaseDefinitionNode;
export interface UseCaseUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UseCaseUsage;
}
export declare function isUseCaseUsage(node: SyntaxNode | null | undefined): node is UseCaseUsageNode;
export interface IncludeUseCaseUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IncludeUseCaseUsage;
}
export declare function isIncludeUseCaseUsage(node: SyntaxNode | null | undefined): node is IncludeUseCaseUsageNode;
export interface StateDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StateDefinition;
}
export declare function isStateDefinition(node: SyntaxNode | null | undefined): node is StateDefinitionNode;
export interface EntryActionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EntryActionMember;
}
export declare function isEntryActionMember(node: SyntaxNode | null | undefined): node is EntryActionMemberNode;
export interface DoActionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DoActionMember;
}
export declare function isDoActionMember(node: SyntaxNode | null | undefined): node is DoActionMemberNode;
export interface ExitActionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExitActionMember;
}
export declare function isExitActionMember(node: SyntaxNode | null | undefined): node is ExitActionMemberNode;
export interface StateActionUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StateActionUsage;
}
export declare function isStateActionUsage(node: SyntaxNode | null | undefined): node is StateActionUsageNode;
export interface StateUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StateUsage;
}
export declare function isStateUsage(node: SyntaxNode | null | undefined): node is StateUsageNode;
export interface ExhibitStateUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExhibitStateUsage;
}
export declare function isExhibitStateUsage(node: SyntaxNode | null | undefined): node is ExhibitStateUsageNode;
export interface TransitionUsageMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TransitionUsageMember;
}
export declare function isTransitionUsageMember(node: SyntaxNode | null | undefined): node is TransitionUsageMemberNode;
export interface TransitionUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TransitionUsage;
}
export declare function isTransitionUsage(node: SyntaxNode | null | undefined): node is TransitionUsageNode;
export interface ViewDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ViewDefinition;
}
export declare function isViewDefinition(node: SyntaxNode | null | undefined): node is ViewDefinitionNode;
export interface ViewUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ViewUsage;
}
export declare function isViewUsage(node: SyntaxNode | null | undefined): node is ViewUsageNode;
export interface ViewpointDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ViewpointDefinition;
}
export declare function isViewpointDefinition(node: SyntaxNode | null | undefined): node is ViewpointDefinitionNode;
export interface ViewpointUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ViewpointUsage;
}
export declare function isViewpointUsage(node: SyntaxNode | null | undefined): node is ViewpointUsageNode;
export interface RenderingDefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RenderingDefinition;
}
export declare function isRenderingDefinition(node: SyntaxNode | null | undefined): node is RenderingDefinitionNode;
export interface RenderingUsageNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RenderingUsage;
}
export declare function isRenderingUsage(node: SyntaxNode | null | undefined): node is RenderingUsageNode;
export interface OwnedExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedExpressionMember;
}
export declare function isOwnedExpressionMember(node: SyntaxNode | null | undefined): node is OwnedExpressionMemberNode;
export interface OwnedExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedExpression;
}
export declare function isOwnedExpression(node: SyntaxNode | null | undefined): node is OwnedExpressionNode;
export interface OwnedExpressionReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedExpressionReference;
}
export declare function isOwnedExpressionReference(node: SyntaxNode | null | undefined): node is OwnedExpressionReferenceNode;
export interface ConditionalExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConditionalExpression;
}
export declare function isConditionalExpression(node: SyntaxNode | null | undefined): node is ConditionalExpressionNode;
export interface NullCoalescingExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NullCoalescingExpression;
}
export declare function isNullCoalescingExpression(node: SyntaxNode | null | undefined): node is NullCoalescingExpressionNode;
export interface ImpliesExpressionReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ImpliesExpressionReference;
}
export declare function isImpliesExpressionReference(node: SyntaxNode | null | undefined): node is ImpliesExpressionReferenceNode;
export interface ImpliesExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ImpliesExpressionMember;
}
export declare function isImpliesExpressionMember(node: SyntaxNode | null | undefined): node is ImpliesExpressionMemberNode;
export interface ImpliesExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ImpliesExpression;
}
export declare function isImpliesExpression(node: SyntaxNode | null | undefined): node is ImpliesExpressionNode;
export interface OrExpressionReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OrExpressionReference;
}
export declare function isOrExpressionReference(node: SyntaxNode | null | undefined): node is OrExpressionReferenceNode;
export interface OrExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OrExpressionMember;
}
export declare function isOrExpressionMember(node: SyntaxNode | null | undefined): node is OrExpressionMemberNode;
export interface OrExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OrExpression;
}
export declare function isOrExpression(node: SyntaxNode | null | undefined): node is OrExpressionNode;
export interface XorExpressionReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.XorExpressionReference;
}
export declare function isXorExpressionReference(node: SyntaxNode | null | undefined): node is XorExpressionReferenceNode;
export interface XorExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.XorExpressionMember;
}
export declare function isXorExpressionMember(node: SyntaxNode | null | undefined): node is XorExpressionMemberNode;
export interface XorExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.XorExpression;
}
export declare function isXorExpression(node: SyntaxNode | null | undefined): node is XorExpressionNode;
export interface AndExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AndExpression;
}
export declare function isAndExpression(node: SyntaxNode | null | undefined): node is AndExpressionNode;
export interface EqualityExpressionReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EqualityExpressionReference;
}
export declare function isEqualityExpressionReference(node: SyntaxNode | null | undefined): node is EqualityExpressionReferenceNode;
export interface EqualityExpressionMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EqualityExpressionMember;
}
export declare function isEqualityExpressionMember(node: SyntaxNode | null | undefined): node is EqualityExpressionMemberNode;
export interface EqualityExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EqualityExpression;
}
export declare function isEqualityExpression(node: SyntaxNode | null | undefined): node is EqualityExpressionNode;
export interface EqualityOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EqualityOperator;
}
export declare function isEqualityOperator(node: SyntaxNode | null | undefined): node is EqualityOperatorNode;
export interface ClassificationExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassificationExpression;
}
export declare function isClassificationExpression(node: SyntaxNode | null | undefined): node is ClassificationExpressionNode;
export interface ClassificationTestOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ClassificationTestOperator;
}
export declare function isClassificationTestOperator(node: SyntaxNode | null | undefined): node is ClassificationTestOperatorNode;
export interface MetadataReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataReference;
}
export declare function isMetadataReference(node: SyntaxNode | null | undefined): node is MetadataReferenceNode;
export interface TypeReferenceMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TypeReferenceMember;
}
export declare function isTypeReferenceMember(node: SyntaxNode | null | undefined): node is TypeReferenceMemberNode;
export interface TypeResultMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TypeResultMember;
}
export declare function isTypeResultMember(node: SyntaxNode | null | undefined): node is TypeResultMemberNode;
export interface TypeReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TypeReference;
}
export declare function isTypeReference(node: SyntaxNode | null | undefined): node is TypeReferenceNode;
export interface ReferenceTypingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ReferenceTyping;
}
export declare function isReferenceTyping(node: SyntaxNode | null | undefined): node is ReferenceTypingNode;
export interface RelationalExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RelationalExpression;
}
export declare function isRelationalExpression(node: SyntaxNode | null | undefined): node is RelationalExpressionNode;
export interface RelationalOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RelationalOperator;
}
export declare function isRelationalOperator(node: SyntaxNode | null | undefined): node is RelationalOperatorNode;
export interface RangeExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RangeExpression;
}
export declare function isRangeExpression(node: SyntaxNode | null | undefined): node is RangeExpressionNode;
export interface AdditiveExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AdditiveExpression;
}
export declare function isAdditiveExpression(node: SyntaxNode | null | undefined): node is AdditiveExpressionNode;
export interface AdditiveOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AdditiveOperator;
}
export declare function isAdditiveOperator(node: SyntaxNode | null | undefined): node is AdditiveOperatorNode;
export interface MultiplicativeExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MultiplicativeExpression;
}
export declare function isMultiplicativeExpression(node: SyntaxNode | null | undefined): node is MultiplicativeExpressionNode;
export interface MultiplicativeOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MultiplicativeOperator;
}
export declare function isMultiplicativeOperator(node: SyntaxNode | null | undefined): node is MultiplicativeOperatorNode;
export interface ExponentiationExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExponentiationExpression;
}
export declare function isExponentiationExpression(node: SyntaxNode | null | undefined): node is ExponentiationExpressionNode;
export interface ExponentiationOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExponentiationOperator;
}
export declare function isExponentiationOperator(node: SyntaxNode | null | undefined): node is ExponentiationOperatorNode;
export interface UnaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnaryExpression;
}
export declare function isUnaryExpression(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
export interface UnaryOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnaryOperator;
}
export declare function isUnaryOperator(node: SyntaxNode | null | undefined): node is UnaryOperatorNode;
export interface ExtentExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExtentExpression;
}
export declare function isExtentExpression(node: SyntaxNode | null | undefined): node is ExtentExpressionNode;
export interface PrimaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrimaryExpression;
}
export declare function isPrimaryExpression(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
export interface FunctionReferenceExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionReferenceExpression;
}
export declare function isFunctionReferenceExpression(node: SyntaxNode | null | undefined): node is FunctionReferenceExpressionNode;
export interface FunctionReferenceMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionReferenceMember;
}
export declare function isFunctionReferenceMember(node: SyntaxNode | null | undefined): node is FunctionReferenceMemberNode;
export interface FunctionReferenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionReference;
}
export declare function isFunctionReference(node: SyntaxNode | null | undefined): node is FunctionReferenceNode;
export interface FeatureChainMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FeatureChainMember;
}
export declare function isFeatureChainMember(node: SyntaxNode | null | undefined): node is FeatureChainMemberNode;
export interface OwnedFeatureChainNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedFeatureChain;
}
export declare function isOwnedFeatureChain(node: SyntaxNode | null | undefined): node is OwnedFeatureChainNode;
export interface BodyExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BodyExpression;
}
export declare function isBodyExpression(node: SyntaxNode | null | undefined): node is BodyExpressionNode;
export interface ExpressionBodyMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExpressionBodyMember;
}
export declare function isExpressionBodyMember(node: SyntaxNode | null | undefined): node is ExpressionBodyMemberNode;
export interface ExpressionBodyNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExpressionBody;
}
export declare function isExpressionBody(node: SyntaxNode | null | undefined): node is ExpressionBodyNode;
export interface SequenceExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SequenceExpression;
}
export declare function isSequenceExpression(node: SyntaxNode | null | undefined): node is SequenceExpressionNode;
export interface FeatureReferenceExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FeatureReferenceExpression;
}
export declare function isFeatureReferenceExpression(node: SyntaxNode | null | undefined): node is FeatureReferenceExpressionNode;
export interface FeatureReferenceMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FeatureReferenceMember;
}
export declare function isFeatureReferenceMember(node: SyntaxNode | null | undefined): node is FeatureReferenceMemberNode;
export interface MetadataAccessExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetadataAccessExpression;
}
export declare function isMetadataAccessExpression(node: SyntaxNode | null | undefined): node is MetadataAccessExpressionNode;
export interface ElementReferenceMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElementReferenceMember;
}
export declare function isElementReferenceMember(node: SyntaxNode | null | undefined): node is ElementReferenceMemberNode;
export interface InvocationExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InvocationExpression;
}
export declare function isInvocationExpression(node: SyntaxNode | null | undefined): node is InvocationExpressionNode;
export interface ConstructorExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstructorExpression;
}
export declare function isConstructorExpression(node: SyntaxNode | null | undefined): node is ConstructorExpressionNode;
export interface ConstructorResultMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstructorResultMember;
}
export declare function isConstructorResultMember(node: SyntaxNode | null | undefined): node is ConstructorResultMemberNode;
export interface ConstructorResultNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstructorResult;
}
export declare function isConstructorResult(node: SyntaxNode | null | undefined): node is ConstructorResultNode;
export interface InstantiatedTypeMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InstantiatedTypeMember;
}
export declare function isInstantiatedTypeMember(node: SyntaxNode | null | undefined): node is InstantiatedTypeMemberNode;
export interface OwnedFeatureChainingNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OwnedFeatureChaining;
}
export declare function isOwnedFeatureChaining(node: SyntaxNode | null | undefined): node is OwnedFeatureChainingNode;
export interface ArgumentMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArgumentMember;
}
export declare function isArgumentMember(node: SyntaxNode | null | undefined): node is ArgumentMemberNode;
export interface ArgumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Argument;
}
export declare function isArgument(node: SyntaxNode | null | undefined): node is ArgumentNode;
export interface NamedArgumentMemberNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NamedArgumentMember;
}
export declare function isNamedArgumentMember(node: SyntaxNode | null | undefined): node is NamedArgumentMemberNode;
export interface NamedArgumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NamedArgument;
}
export declare function isNamedArgument(node: SyntaxNode | null | undefined): node is NamedArgumentNode;
export interface ParameterRedefinitionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterRedefinition;
}
export declare function isParameterRedefinition(node: SyntaxNode | null | undefined): node is ParameterRedefinitionNode;
export interface ArgumentValueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArgumentValue;
}
export declare function isArgumentValue(node: SyntaxNode | null | undefined): node is ArgumentValueNode;
export interface NullExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NullExpression;
}
export declare function isNullExpression(node: SyntaxNode | null | undefined): node is NullExpressionNode;
export interface LiteralBooleanNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LiteralBoolean;
}
export declare function isLiteralBoolean(node: SyntaxNode | null | undefined): node is LiteralBooleanNode;
export interface BooleanValueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BooleanValue;
}
export declare function isBooleanValue(node: SyntaxNode | null | undefined): node is BooleanValueNode;
export interface LiteralStringNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LiteralString;
}
export declare function isLiteralString(node: SyntaxNode | null | undefined): node is LiteralStringNode;
export interface LiteralIntegerNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LiteralInteger;
}
export declare function isLiteralInteger(node: SyntaxNode | null | undefined): node is LiteralIntegerNode;
export interface LiteralRealNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LiteralReal;
}
export declare function isLiteralReal(node: SyntaxNode | null | undefined): node is LiteralRealNode;
export interface RealValueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RealValue;
}
export declare function isRealValue(node: SyntaxNode | null | undefined): node is RealValueNode;
export interface NameNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Name;
}
export declare function isName(node: SyntaxNode | null | undefined): node is NameNode;
export interface GlobalQualificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GlobalQualification;
}
export declare function isGlobalQualification(node: SyntaxNode | null | undefined): node is GlobalQualificationNode;
export interface QualificationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Qualification;
}
export declare function isQualification(node: SyntaxNode | null | undefined): node is QualificationNode;
export interface QualifiedNameNode extends SyntaxNode {
  readonly typeId: SyntaxKind.QualifiedName;
}
export declare function isQualifiedName(node: SyntaxNode | null | undefined): node is QualifiedNameNode;
export interface MetaClassificationTestOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetaClassificationTestOperator;
}
export declare function isMetaClassificationTestOperator(node: SyntaxNode | null | undefined): node is MetaClassificationTestOperatorNode;
export interface CastOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CastOperator;
}
export declare function isCastOperator(node: SyntaxNode | null | undefined): node is CastOperatorNode;
export interface MetaCastOperatorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MetaCastOperator;
}
export declare function isMetaCastOperator(node: SyntaxNode | null | undefined): node is MetaCastOperatorNode;
export interface LiteralInfinityNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LiteralInfinity;
}
export declare function isLiteralInfinity(node: SyntaxNode | null | undefined): node is LiteralInfinityNode;
export interface DECIMALVALUENode extends SyntaxNode {
  readonly typeId: SyntaxKind.DECIMALVALUE;
}
export declare function isDECIMALVALUE(node: SyntaxNode | null | undefined): node is DECIMALVALUENode;
export interface EXPVALUENode extends SyntaxNode {
  readonly typeId: SyntaxKind.EXPVALUE;
}
export declare function isEXPVALUE(node: SyntaxNode | null | undefined): node is EXPVALUENode;
export interface IDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ID;
}
export declare function isID(node: SyntaxNode | null | undefined): node is IDNode;
export interface UNRESTRICTEDNAMENode extends SyntaxNode {
  readonly typeId: SyntaxKind.UNRESTRICTEDNAME;
}
export declare function isUNRESTRICTEDNAME(node: SyntaxNode | null | undefined): node is UNRESTRICTEDNAMENode;
export interface STRINGVALUENode extends SyntaxNode {
  readonly typeId: SyntaxKind.STRINGVALUE;
}
export declare function isSTRINGVALUE(node: SyntaxNode | null | undefined): node is STRINGVALUENode;
export interface REGULARCOMMENTNode extends SyntaxNode {
  readonly typeId: SyntaxKind.REGULARCOMMENT;
}
export declare function isREGULARCOMMENT(node: SyntaxNode | null | undefined): node is REGULARCOMMENTNode;
export interface MLNOTENode extends SyntaxNode {
  readonly typeId: SyntaxKind.MLNOTE;
}
export declare function isMLNOTE(node: SyntaxNode | null | undefined): node is MLNOTENode;
export interface SLNOTENode extends SyntaxNode {
  readonly typeId: SyntaxKind.SLNOTE;
}
export declare function isSLNOTE(node: SyntaxNode | null | undefined): node is SLNOTENode;
export namespace Cst {
  export function kind(node: SyntaxNode | null | undefined): string;
  export function normalize(token: string | null | undefined): string;
  export const RootNamespace: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RootNamespaceNode;
  };
  export const VisibilityIndicator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VisibilityIndicatorNode;
  };
  export const Dependency: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DependencyNode;
    client(node: SyntaxNode | null | undefined): SyntaxNode | null;
    clientList(node: SyntaxNode | null | undefined): SyntaxNode[];
    supplier(node: SyntaxNode | null | undefined): SyntaxNode | null;
    supplierList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Annotation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AnnotationNode;
    annotatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    annotatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedAnnotation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedAnnotationNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AnnotatingMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AnnotatingMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Comment: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CommentNode;
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    locale(node: SyntaxNode | null | undefined): SyntaxNode | null;
    localeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Documentation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DocumentationNode;
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    locale(node: SyntaxNode | null | undefined): SyntaxNode | null;
    localeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TextualRepresentation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TextualRepresentationNode;
    language(node: SyntaxNode | null | undefined): SyntaxNode | null;
    languageList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrefixMetadataAnnotation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrefixMetadataAnnotationNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrefixMetadataMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrefixMetadataMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrefixMetadataUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrefixMetadataUsageNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetadataUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataUsageNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetadataTyping: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataTypingNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetadataBodyUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataBodyUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetadataBodyUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataBodyUsageNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetadataDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataDefinitionNode;
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Package: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PackageNode;
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const LibraryPackage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LibraryPackageNode;
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isStandard(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isStandardList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PackageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PackageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ElementFilterMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementFilterMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AliasMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AliasMemberNode;
    memberElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    memberElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
    memberShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    memberShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Import: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImportNode;
  };
  export const MembershipImport: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MembershipImportNode;
    isImportAll(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isImportAllList(node: SyntaxNode | null | undefined): SyntaxNode[];
    importedMembership(node: SyntaxNode | null | undefined): SyntaxNode | null;
    importedMembershipList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRecursive(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRecursiveList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NamespaceImport: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NamespaceImportNode;
    isImportAll(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isImportAllList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
    importedNamespace(node: SyntaxNode | null | undefined): SyntaxNode | null;
    importedNamespaceList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRecursive(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRecursiveList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FilterPackage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FilterPackageNode;
  };
  export const FilterPackageImport: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FilterPackageImportNode;
  };
  export const FilterPackageMembershipImport: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FilterPackageMembershipImportNode;
    importedMembership(node: SyntaxNode | null | undefined): SyntaxNode | null;
    importedMembershipList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRecursive(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRecursiveList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FilterPackageNamespaceImport: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FilterPackageNamespaceImportNode;
    importedNamespace(node: SyntaxNode | null | undefined): SyntaxNode | null;
    importedNamespaceList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRecursive(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRecursiveList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FilterPackageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FilterPackageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedSubclassification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedSubclassificationNode;
    superclassifier(node: SyntaxNode | null | undefined): SyntaxNode | null;
    superclassifierList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FeatureTyping: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FeatureTypingNode;
  };
  export const OwnedFeatureTyping: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedFeatureTypingNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedSubsetting: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedSubsettingNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedReferenceSubsetting: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedReferenceSubsettingNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedCrossSubsetting: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedCrossSubsettingNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedRedefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedRedefinitionNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedMultiplicity: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedMultiplicityNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MultiplicityRange: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MultiplicityRangeNode;
    lowerBound(node: SyntaxNode | null | undefined): SyntaxNode | null;
    lowerBoundList(node: SyntaxNode | null | undefined): SyntaxNode[];
    upperBound(node: SyntaxNode | null | undefined): SyntaxNode | null;
    upperBoundList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MultiplicityExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MultiplicityExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DefinitionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DefinitionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VariantUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VariantUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NonOccurrenceUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NonOccurrenceUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OccurrenceUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OccurrenceUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FeatureValue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FeatureValueNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isInitial(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isInitialList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDefault(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDefaultList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DefaultReferenceUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DefaultReferenceUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ReferenceUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ReferenceUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AttributeDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AttributeDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AttributeUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AttributeUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EnumerationDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EnumerationDefinitionNode;
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EnumerationUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EnumerationUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EnumeratedValue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EnumeratedValueNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EnumerationUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EnumerationUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OccurrenceDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OccurrenceDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OccurrenceUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OccurrenceUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ItemDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ItemDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ItemUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ItemUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PartDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PartDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PartUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PartUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PortDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PortDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PortUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PortUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConjugatedPortTyping: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConjugatedPortTypingNode;
    conjugatedPortDefinition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conjugatedPortDefinitionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConnectorEndMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConnectorEndMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConnectorEnd: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConnectorEndNode;
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConnectionDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConnectionDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConnectionUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConnectionUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BindingConnectorAsUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BindingConnectorAsUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SuccessionAsUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SuccessionAsUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    guard(node: SyntaxNode | null | undefined): SyntaxNode | null;
    guardList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const InterfaceDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InterfaceDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const InterfaceUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InterfaceUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AllocationDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AllocationDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AllocationUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AllocationUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FlowDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FlowDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FlowUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FlowUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SuccessionFlowUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SuccessionFlowUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PayloadFeatureMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PayloadFeatureMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PayloadFeature: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PayloadFeatureNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FlowEndMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FlowEndMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FlowEnd: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FlowEndNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FlowFeatureMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FlowFeatureMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FlowFeature: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FlowFeatureNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ActionDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ActionDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EmptySuccessionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EmptySuccessionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MultiplicitySourceEnd: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MultiplicitySourceEndNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ActionNodeMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ActionNodeMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const IfNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IfNodeNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    thenBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    thenBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseBody(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseBodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ActionBodyParameter: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ActionBodyParameterNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const WhileLoopNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is WhileLoopNodeNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    untilCondition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    untilConditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForLoopNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForLoopNodeNode;
    variable(node: SyntaxNode | null | undefined): SyntaxNode | null;
    variableList(node: SyntaxNode | null | undefined): SyntaxNode[];
    range(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rangeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForVariableDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForVariableDeclarationNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ControlNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ControlNodeNode;
  };
  export const MergeNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MergeNodeNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DecisionNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DecisionNodeNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const JoinNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is JoinNodeNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForkNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForkNodeNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ActionUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ActionUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AcceptActionNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AcceptActionNodeNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SendActionNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SendActionNodeNode;
    sentItem(node: SyntaxNode | null | undefined): SyntaxNode | null;
    sentItemList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    receiver(node: SyntaxNode | null | undefined): SyntaxNode | null;
    receiverList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AssignActionNode: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AssignActionNodeNode;
    assignedValue(node: SyntaxNode | null | undefined): SyntaxNode | null;
    assignedValueList(node: SyntaxNode | null | undefined): SyntaxNode[];
    targetFeature(node: SyntaxNode | null | undefined): SyntaxNode | null;
    targetFeatureList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PerformActionUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PerformActionUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CalculationDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CalculationDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ReturnParameterMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ReturnParameterMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ResultExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ResultExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CalculationUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CalculationUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstraintDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstraintDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstraintUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstraintUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AssertConstraintUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AssertConstraintUsageNode;
    isNegated(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNegatedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RequirementDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RequirementDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SubjectMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SubjectMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SubjectUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SubjectUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RequirementConstraintMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RequirementConstraintMemberNode;
    constraintKind(node: SyntaxNode | null | undefined): SyntaxNode | null;
    constraintKindList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RequirementConstraintUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RequirementConstraintUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ActorMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ActorMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ActorUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ActorUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const StakeholderMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StakeholderMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const StakeholderUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StakeholderUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RequirementUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RequirementUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SatisfyRequirementUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SatisfyRequirementUsageNode;
    isNegated(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNegatedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    satisfyingFeature(node: SyntaxNode | null | undefined): SyntaxNode | null;
    satisfyingFeatureList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConcernDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConcernDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConcernUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConcernUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CaseDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CaseDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CaseUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CaseUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AnalysisCaseDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AnalysisCaseDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AnalysisCaseUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AnalysisCaseUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VerificationCaseDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VerificationCaseDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VerificationCaseUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VerificationCaseUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VerifyRequirementUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VerifyRequirementUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VerifyRequirementUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VerifyRequirementUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ObjectiveMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ObjectiveMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ObjectiveRequirementUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ObjectiveRequirementUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const UseCaseDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UseCaseDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const UseCaseUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UseCaseUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const IncludeUseCaseUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IncludeUseCaseUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const StateDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StateDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isParallel(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isParallelList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EntryActionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EntryActionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DoActionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DoActionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ExitActionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExitActionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const StateActionUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StateActionUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const StateUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StateUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isParallel(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isParallelList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ExhibitStateUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExhibitStateUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isParallel(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isParallelList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TransitionUsageMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TransitionUsageMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TransitionUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TransitionUsageNode;
    source(node: SyntaxNode | null | undefined): SyntaxNode | null;
    sourceList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    trigger(node: SyntaxNode | null | undefined): SyntaxNode | null;
    triggerList(node: SyntaxNode | null | undefined): SyntaxNode[];
    guard(node: SyntaxNode | null | undefined): SyntaxNode | null;
    guardList(node: SyntaxNode | null | undefined): SyntaxNode[];
    effect(node: SyntaxNode | null | undefined): SyntaxNode | null;
    effectList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ViewDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ViewDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ViewUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ViewUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ViewpointDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ViewpointDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ViewpointUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ViewpointUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RenderingDefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RenderingDefinitionNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RenderingUsage: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RenderingUsageNode;
    declaredShortName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredShortNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declaredName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaredNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isEnd(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isEndList(node: SyntaxNode | null | undefined): SyntaxNode[];
    direction(node: SyntaxNode | null | undefined): SyntaxNode | null;
    directionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isDerived(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isDerivedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isAbstract(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isAbstractList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isVariation(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isVariationList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isConstant(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isConstantList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isRedefine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isRedefineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isSubsetting(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isSubsettingList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isOrdered(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isOrderedList(node: SyntaxNode | null | undefined): SyntaxNode[];
    isNonunique(node: SyntaxNode | null | undefined): SyntaxNode | null;
    isNonuniqueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedExpressionNode;
  };
  export const OwnedExpressionReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedExpressionReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConditionalExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConditionalExpressionNode;
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    thenOperand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    thenOperandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    elseOperand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    elseOperandList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NullCoalescingExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NullCoalescingExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ImpliesExpressionReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImpliesExpressionReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ImpliesExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImpliesExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ImpliesExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImpliesExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OrExpressionReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OrExpressionReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OrExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OrExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OrExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OrExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const XorExpressionReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is XorExpressionReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const XorExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is XorExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const XorExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is XorExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AndExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AndExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EqualityExpressionReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EqualityExpressionReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EqualityExpressionMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EqualityExpressionMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EqualityExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EqualityExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const EqualityOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EqualityOperatorNode;
  };
  export const ClassificationExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassificationExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    typeReference(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeReferenceList(node: SyntaxNode | null | undefined): SyntaxNode[];
    typeResult(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeResultList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ClassificationTestOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ClassificationTestOperatorNode;
  };
  export const MetadataReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TypeReferenceMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TypeReferenceMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TypeResultMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TypeResultMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TypeReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TypeReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ReferenceTyping: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ReferenceTypingNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RelationalExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RelationalExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RelationalOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RelationalOperatorNode;
  };
  export const RangeExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RangeExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AdditiveExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AdditiveExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AdditiveOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AdditiveOperatorNode;
  };
  export const MultiplicativeExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MultiplicativeExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MultiplicativeOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MultiplicativeOperatorNode;
  };
  export const ExponentiationExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExponentiationExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ExponentiationOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExponentiationOperatorNode;
  };
  export const UnaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const UnaryOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnaryOperatorNode;
  };
  export const ExtentExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExtentExpressionNode;
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    typeResult(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeResultList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrimaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
    base(node: SyntaxNode | null | undefined): SyntaxNode | null;
    baseList(node: SyntaxNode | null | undefined): SyntaxNode[];
    featureChain(node: SyntaxNode | null | undefined): SyntaxNode | null;
    featureChainList(node: SyntaxNode | null | undefined): SyntaxNode[];
    indexOperand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    indexOperandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    filterOperand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    filterOperandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    invocationType(node: SyntaxNode | null | undefined): SyntaxNode | null;
    invocationTypeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    collect(node: SyntaxNode | null | undefined): SyntaxNode | null;
    collectList(node: SyntaxNode | null | undefined): SyntaxNode[];
    select(node: SyntaxNode | null | undefined): SyntaxNode | null;
    selectList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    functionRef(node: SyntaxNode | null | undefined): SyntaxNode | null;
    functionRefList(node: SyntaxNode | null | undefined): SyntaxNode[];
    argument(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argumentList(node: SyntaxNode | null | undefined): SyntaxNode[];
    namedArgument(node: SyntaxNode | null | undefined): SyntaxNode | null;
    namedArgumentList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionReferenceExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionReferenceExpressionNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionReferenceMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionReferenceMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionReference: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionReferenceNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FeatureChainMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FeatureChainMemberNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedFeatureChain: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedFeatureChainNode;
    chaining(node: SyntaxNode | null | undefined): SyntaxNode | null;
    chainingList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BodyExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BodyExpressionNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ExpressionBodyMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionBodyMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ExpressionBody: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionBodyNode;
  };
  export const SequenceExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SequenceExpressionNode;
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FeatureReferenceExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FeatureReferenceExpressionNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FeatureReferenceMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FeatureReferenceMemberNode;
    memberElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    memberElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetadataAccessExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetadataAccessExpressionNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ElementReferenceMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElementReferenceMemberNode;
    memberElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    memberElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const InvocationExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InvocationExpressionNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    argument(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argumentList(node: SyntaxNode | null | undefined): SyntaxNode[];
    namedArgument(node: SyntaxNode | null | undefined): SyntaxNode | null;
    namedArgumentList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstructorExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstructorExpressionNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    result(node: SyntaxNode | null | undefined): SyntaxNode | null;
    resultList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstructorResultMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstructorResultMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstructorResult: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstructorResultNode;
    argument(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argumentList(node: SyntaxNode | null | undefined): SyntaxNode[];
    namedArgument(node: SyntaxNode | null | undefined): SyntaxNode | null;
    namedArgumentList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const InstantiatedTypeMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InstantiatedTypeMemberNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OwnedFeatureChaining: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OwnedFeatureChainingNode;
    chainingFeature(node: SyntaxNode | null | undefined): SyntaxNode | null;
    chainingFeatureList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ArgumentMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Argument: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentNode;
    ownedRelationship(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelationshipList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NamedArgumentMember: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NamedArgumentMemberNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NamedArgument: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NamedArgumentNode;
    parameterRedefinition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    parameterRedefinitionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterRedefinition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterRedefinitionNode;
    redefinedFeature(node: SyntaxNode | null | undefined): SyntaxNode | null;
    redefinedFeatureList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ArgumentValue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentValueNode;
    ownedRelatedElement(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ownedRelatedElementList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NullExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NullExpressionNode;
  };
  export const LiteralBoolean: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LiteralBooleanNode;
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BooleanValue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BooleanValueNode;
  };
  export const LiteralString: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LiteralStringNode;
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const LiteralInteger: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LiteralIntegerNode;
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const LiteralReal: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LiteralRealNode;
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const RealValue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RealValueNode;
  };
  export const Name: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NameNode;
  };
  export const GlobalQualification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GlobalQualificationNode;
  };
  export const Qualification: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is QualificationNode;
  };
  export const QualifiedName: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is QualifiedNameNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MetaClassificationTestOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetaClassificationTestOperatorNode;
  };
  export const CastOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CastOperatorNode;
  };
  export const MetaCastOperator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MetaCastOperatorNode;
  };
  export const LiteralInfinity: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LiteralInfinityNode;
  };
  export const DECIMALVALUE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DECIMALVALUENode;
  };
  export const EXPVALUE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EXPVALUENode;
  };
  export const ID: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IDNode;
  };
  export const UNRESTRICTEDNAME: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UNRESTRICTEDNAMENode;
  };
  export const STRINGVALUE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is STRINGVALUENode;
  };
  export const REGULARCOMMENT: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is REGULARCOMMENTNode;
  };
  export const MLNOTE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MLNOTENode;
  };
  export const SLNOTE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SLNOTENode;
  };
}
