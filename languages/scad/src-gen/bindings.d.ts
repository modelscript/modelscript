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
  getDiagnostics(
    astRoot: number,
    rangeStart?: number,
    rangeEnd?: number,
  ): Diagnostic[];
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
    oldRoot?: number,
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
  private _cachedHasError;
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
  parse(
    source: string | Uint8Array,
    oldTree?: Tree | null,
    editStart?: number,
    editOldEnd?: number,
    editNewEnd?: number,
    uri?: string,
  ): Tree | null;
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
  EmptyStatement = 107,
  _EmptyStatement = 107,
  IDENTIFIER = 146,
  NUMBER = 147,
  STRING = 148,
  UNDEF = 150,
  SourceFile = 64,
  Statement = 65,
  BlockStatement = 66,
  VariableDeclaration = 67,
  ModuleDeclaration = 68,
  FunctionDeclaration = 69,
  IfStatement = 70,
  ForStatement = 71,
  ParameterList = 72,
  Parameter = 73,
  ArgumentList = 74,
  Argument = 75,
  PrefixSolid = 76,
  TransformOp = 77,
  LinearExtrudeOp = 78,
  BooleanOp = 79,
  TagPortOp = 80,
  ChainedSolidStatement = 81,
  ChainedSolid = 82,
  MethodCall = 83,
  MethodName = 84,
  PrimarySolid = 85,
  CubePrimitive = 86,
  CylinderPrimitive = 87,
  SpherePrimitive = 88,
  PolyhedronPrimitive = 89,
  PolygonPrimitive = 90,
  CirclePrimitive = 91,
  SquarePrimitive = 92,
  ModuleInstantiation = 93,
  Expression = 94,
  ConditionalExpression = 95,
  BinaryExpression = 96,
  UnaryExpression = 97,
  PostfixExpression = 98,
  PrimaryExpression = 99,
  ParenthesizedExpression = 100,
  VectorLiteral = 101,
  RangeLiteral = 102,
  BOOLEAN = 103,
  START = 104,
  _START = 104,
  EOF = 1023,
}

export enum FieldId {
  Name = 1,
  name = 1,
  Value = 2,
  value = 2,
  Parameters = 3,
  parameters = 3,
  Body = 4,
  body = 4,
  Condition = 5,
  condition = 5,
  Consequence = 6,
  consequence = 6,
  Alternative = 7,
  alternative = 7,
  Var = 8,
  var = 8,
  Range = 9,
  range = 9,
  Default = 10,
  default = 10,
  Operator = 11,
  operator = 11,
  Child = 12,
  child = 12,
  Args = 13,
  args = 13,
  Solid = 14,
  solid = 14,
  Receiver = 15,
  receiver = 15,
  Method = 16,
  method = 16,
  Left = 17,
  left = 17,
  Right = 18,
  right = 18,
  Operand = 19,
  operand = 19,
  Index = 20,
  index = 20,
  FunctionNode = 21,
  function = 21,
  Arguments = 22,
  arguments = 22,
  Expression = 23,
  expression = 23,
  Start = 24,
  start = 24,
  Step = 25,
  step = 25,
  End = 26,
  end = 26,
}

/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
export interface SourceFileNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SourceFile;
}
export declare function isSourceFile(node: SyntaxNode | null | undefined): node is SourceFileNode;
export interface StatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Statement;
}
export declare function isStatement(node: SyntaxNode | null | undefined): node is StatementNode;
export interface BlockStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BlockStatement;
}
export declare function isBlockStatement(node: SyntaxNode | null | undefined): node is BlockStatementNode;
export interface VariableDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VariableDeclaration;
}
export declare function isVariableDeclaration(node: SyntaxNode | null | undefined): node is VariableDeclarationNode;
export interface ModuleDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ModuleDeclaration;
}
export declare function isModuleDeclaration(node: SyntaxNode | null | undefined): node is ModuleDeclarationNode;
export interface FunctionDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionDeclaration;
}
export declare function isFunctionDeclaration(node: SyntaxNode | null | undefined): node is FunctionDeclarationNode;
export interface IfStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IfStatement;
}
export declare function isIfStatement(node: SyntaxNode | null | undefined): node is IfStatementNode;
export interface ForStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ForStatement;
}
export declare function isForStatement(node: SyntaxNode | null | undefined): node is ForStatementNode;
export interface ParameterListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterList;
}
export declare function isParameterList(node: SyntaxNode | null | undefined): node is ParameterListNode;
export interface ParameterNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Parameter;
}
export declare function isParameter(node: SyntaxNode | null | undefined): node is ParameterNode;
export interface ArgumentListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArgumentList;
}
export declare function isArgumentList(node: SyntaxNode | null | undefined): node is ArgumentListNode;
export interface ArgumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Argument;
}
export declare function isArgument(node: SyntaxNode | null | undefined): node is ArgumentNode;
export interface PrefixSolidNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrefixSolid;
}
export declare function isPrefixSolid(node: SyntaxNode | null | undefined): node is PrefixSolidNode;
export interface TransformOpNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TransformOp;
}
export declare function isTransformOp(node: SyntaxNode | null | undefined): node is TransformOpNode;
export interface LinearExtrudeOpNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LinearExtrudeOp;
}
export declare function isLinearExtrudeOp(node: SyntaxNode | null | undefined): node is LinearExtrudeOpNode;
export interface BooleanOpNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BooleanOp;
}
export declare function isBooleanOp(node: SyntaxNode | null | undefined): node is BooleanOpNode;
export interface TagPortOpNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TagPortOp;
}
export declare function isTagPortOp(node: SyntaxNode | null | undefined): node is TagPortOpNode;
export interface ChainedSolidStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ChainedSolidStatement;
}
export declare function isChainedSolidStatement(node: SyntaxNode | null | undefined): node is ChainedSolidStatementNode;
export interface ChainedSolidNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ChainedSolid;
}
export declare function isChainedSolid(node: SyntaxNode | null | undefined): node is ChainedSolidNode;
export interface MethodCallNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MethodCall;
}
export declare function isMethodCall(node: SyntaxNode | null | undefined): node is MethodCallNode;
export interface MethodNameNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MethodName;
}
export declare function isMethodName(node: SyntaxNode | null | undefined): node is MethodNameNode;
export interface PrimarySolidNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrimarySolid;
}
export declare function isPrimarySolid(node: SyntaxNode | null | undefined): node is PrimarySolidNode;
export interface CubePrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CubePrimitive;
}
export declare function isCubePrimitive(node: SyntaxNode | null | undefined): node is CubePrimitiveNode;
export interface CylinderPrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CylinderPrimitive;
}
export declare function isCylinderPrimitive(node: SyntaxNode | null | undefined): node is CylinderPrimitiveNode;
export interface SpherePrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SpherePrimitive;
}
export declare function isSpherePrimitive(node: SyntaxNode | null | undefined): node is SpherePrimitiveNode;
export interface PolyhedronPrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PolyhedronPrimitive;
}
export declare function isPolyhedronPrimitive(node: SyntaxNode | null | undefined): node is PolyhedronPrimitiveNode;
export interface PolygonPrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PolygonPrimitive;
}
export declare function isPolygonPrimitive(node: SyntaxNode | null | undefined): node is PolygonPrimitiveNode;
export interface CirclePrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CirclePrimitive;
}
export declare function isCirclePrimitive(node: SyntaxNode | null | undefined): node is CirclePrimitiveNode;
export interface SquarePrimitiveNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SquarePrimitive;
}
export declare function isSquarePrimitive(node: SyntaxNode | null | undefined): node is SquarePrimitiveNode;
export interface ModuleInstantiationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ModuleInstantiation;
}
export declare function isModuleInstantiation(node: SyntaxNode | null | undefined): node is ModuleInstantiationNode;
export interface ExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Expression;
}
export declare function isExpression(node: SyntaxNode | null | undefined): node is ExpressionNode;
export interface ConditionalExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConditionalExpression;
}
export declare function isConditionalExpression(node: SyntaxNode | null | undefined): node is ConditionalExpressionNode;
export interface BinaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BinaryExpression;
}
export declare function isBinaryExpression(node: SyntaxNode | null | undefined): node is BinaryExpressionNode;
export interface UnaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnaryExpression;
}
export declare function isUnaryExpression(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
export interface PostfixExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PostfixExpression;
}
export declare function isPostfixExpression(node: SyntaxNode | null | undefined): node is PostfixExpressionNode;
export interface PrimaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrimaryExpression;
}
export declare function isPrimaryExpression(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
export interface ParenthesizedExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParenthesizedExpression;
}
export declare function isParenthesizedExpression(node: SyntaxNode | null | undefined): node is ParenthesizedExpressionNode;
export interface VectorLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VectorLiteral;
}
export declare function isVectorLiteral(node: SyntaxNode | null | undefined): node is VectorLiteralNode;
export interface RangeLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RangeLiteral;
}
export declare function isRangeLiteral(node: SyntaxNode | null | undefined): node is RangeLiteralNode;
export interface BOOLEANNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BOOLEAN;
}
export declare function isBOOLEAN(node: SyntaxNode | null | undefined): node is BOOLEANNode;
export interface IDENTIFIERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IDENTIFIER;
}
export declare function isIDENTIFIER(node: SyntaxNode | null | undefined): node is IDENTIFIERNode;
export interface NUMBERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NUMBER;
}
export declare function isNUMBER(node: SyntaxNode | null | undefined): node is NUMBERNode;
export interface STRINGNode extends SyntaxNode {
  readonly typeId: SyntaxKind.STRING;
}
export declare function isSTRING(node: SyntaxNode | null | undefined): node is STRINGNode;
export interface UNDEFNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UNDEF;
}
export declare function isUNDEF(node: SyntaxNode | null | undefined): node is UNDEFNode;
export namespace Cst {
  export function kind(node: SyntaxNode | null | undefined): string;
  export function normalize(token: string | null | undefined): string;
  export const SourceFile: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SourceFileNode;
  };
  export const Statement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StatementNode;
  };
  export const BlockStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BlockStatementNode;
  };
  export const VariableDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VariableDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ModuleDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ModuleDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    parameters(node: SyntaxNode | null | undefined): SyntaxNode | null;
    parametersList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
    parameters(node: SyntaxNode | null | undefined): SyntaxNode | null;
    parametersList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const IfStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IfStatementNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    consequence(node: SyntaxNode | null | undefined): SyntaxNode | null;
    consequenceList(node: SyntaxNode | null | undefined): SyntaxNode[];
    alternative(node: SyntaxNode | null | undefined): SyntaxNode | null;
    alternativeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ForStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ForStatementNode;
    var(node: SyntaxNode | null | undefined): SyntaxNode | null;
    varList(node: SyntaxNode | null | undefined): SyntaxNode[];
    range(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rangeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    body(node: SyntaxNode | null | undefined): SyntaxNode | null;
    bodyList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterListNode;
  };
  export const Parameter: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    default(node: SyntaxNode | null | undefined): SyntaxNode | null;
    defaultList(node: SyntaxNode | null | undefined): SyntaxNode[];
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
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrefixSolid: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrefixSolidNode;
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    child(node: SyntaxNode | null | undefined): SyntaxNode | null;
    childList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const TransformOp: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TransformOpNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const LinearExtrudeOp: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LinearExtrudeOpNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BooleanOp: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BooleanOpNode;
  };
  export const TagPortOp: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TagPortOpNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ChainedSolidStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ChainedSolidStatementNode;
    solid(node: SyntaxNode | null | undefined): SyntaxNode | null;
    solidList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ChainedSolid: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ChainedSolidNode;
    receiver(node: SyntaxNode | null | undefined): SyntaxNode | null;
    receiverList(node: SyntaxNode | null | undefined): SyntaxNode[];
    method(node: SyntaxNode | null | undefined): SyntaxNode | null;
    methodList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MethodCall: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MethodCallNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const MethodName: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MethodNameNode;
  };
  export const PrimarySolid: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimarySolidNode;
  };
  export const CubePrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CubePrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CylinderPrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CylinderPrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SpherePrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SpherePrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PolyhedronPrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PolyhedronPrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PolygonPrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PolygonPrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CirclePrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CirclePrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SquarePrimitive: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SquarePrimitiveNode;
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ModuleInstantiation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ModuleInstantiationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    args(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Expression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionNode;
  };
  export const ConditionalExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConditionalExpressionNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    consequence(node: SyntaxNode | null | undefined): SyntaxNode | null;
    consequenceList(node: SyntaxNode | null | undefined): SyntaxNode[];
    alternative(node: SyntaxNode | null | undefined): SyntaxNode | null;
    alternativeList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BinaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BinaryExpressionNode;
    left(node: SyntaxNode | null | undefined): SyntaxNode | null;
    leftList(node: SyntaxNode | null | undefined): SyntaxNode[];
    operator(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operatorList(node: SyntaxNode | null | undefined): SyntaxNode[];
    right(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rightList(node: SyntaxNode | null | undefined): SyntaxNode[];
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
  export const PostfixExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PostfixExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
    index(node: SyntaxNode | null | undefined): SyntaxNode | null;
    indexList(node: SyntaxNode | null | undefined): SyntaxNode[];
    function(node: SyntaxNode | null | undefined): SyntaxNode | null;
    functionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    arguments(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argumentsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrimaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
  };
  export const ParenthesizedExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParenthesizedExpressionNode;
    expression(node: SyntaxNode | null | undefined): SyntaxNode | null;
    expressionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VectorLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VectorLiteralNode;
  };
  export const RangeLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RangeLiteralNode;
    start(node: SyntaxNode | null | undefined): SyntaxNode | null;
    startList(node: SyntaxNode | null | undefined): SyntaxNode[];
    step(node: SyntaxNode | null | undefined): SyntaxNode | null;
    stepList(node: SyntaxNode | null | undefined): SyntaxNode[];
    end(node: SyntaxNode | null | undefined): SyntaxNode | null;
    endList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BOOLEAN: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BOOLEANNode;
  };
  export const IDENTIFIER: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IDENTIFIERNode;
  };
  export const NUMBER: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NUMBERNode;
  };
  export const STRING: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is STRINGNode;
  };
  export const UNDEF: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UNDEFNode;
  };
}
