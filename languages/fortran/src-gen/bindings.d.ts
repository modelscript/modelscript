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
export interface EditRange {
  startOffset: number;
  oldEndOffset: number;
  newEndOffset: number;
}
export interface SemanticTokensEdit {
  start: number;
  deleteCount: number;
  data: number[];
}
export interface SemanticTokensDeltaResponse {
  resultId: number;
  edits?: SemanticTokensEdit[] | undefined;
  fullTokens?: Uint32Array | undefined;
}
/**
 * Value-Type Tree Cursor for zero-allocation, re-entrant tree traversals.
 */
export declare class WasmTreeCursor {
  private cursorPtr;
  private runtime;
  constructor(runtime: any, rootNode: number);
  reset(rootNode: number): void;
  currentNode(): number;
  currentOffset(): number;
  depth(): number;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
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
    editNewEnd?: number,
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
  code?: number | string | undefined;
  expectedTokens?: string[] | undefined;
  /** Character offset of the diagnostic start within the source text. */
  startOffset?: number | undefined;
  /** Character offset of the diagnostic end within the source text. */
  endOffset?: number | undefined;
}
export declare const SYNTAX_NAMES: string[];
export declare const LINT_MESSAGES: Record<string, string>;
export declare const LINT_SEVERITIES: Record<string, number>;
export declare const LINT_CODES: Record<string, string | number>;
export declare const EXTRAS_PATTERN: string;
export declare const FIELD_NAMES: Record<string, number>;
export declare function getFieldNameById(id: number): string | null;
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
  fieldNames: Record<string, number>;
  lintMessages: Record<string, any>;
  lintSeverities: Record<string, number>;
  private _idToFieldName;
  getFieldNameById(id: number): string | null;
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
  /** Reusable WASM buffer for `TextEditRange` arrays passed to `parseWithEdits`. */
  private _editsScratchPtr;
  private _editsScratchCapacity;
  private currentInputLength;
  readonly rootSourceCode: Map<number, string>;
  readonly uriSourceCode: Map<string, string>;
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
  isCharOffsetKernel(): boolean;
  /**
   * Loads document text into the WASM input buffer without triggering a parse.
   * This ensures that subsequent calls to `getDiagnostics`, `getSemanticTokens`, or CST inspection
   * read the correct source characters even if another document was parsed in the interim.
   */
  loadSource(text: string): void;
  /**
   * Returns all active document roots across open files in the workspace.
   */
  getAllDocumentRoots(): number[];
  /**
   * Schedules a generational sweep/compaction pass.
   * Trigger 1: Quiescence / Idle Timer (1500ms debounce).
   */
  scheduleCompaction(_immediate?: boolean): void;
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
   * Scans the current WASM input buffer and calculates all line start offsets.
   * This is cached and only recalculated when the cache is invalidated by edits.
   */
  getLineStarts(): Uint32Array;
  /**
   * Performs a binary search on the cached line starts to map a linear offset
   * to a line and character position (LSP format).
   */
  offsetToPos(offset: number, lineStarts: Uint32Array): Position;
  /**
   * Maps a line and character position to a linear offset.
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
    sourceCode?: string,
  ): Diagnostic[];
  /**
   * Retrieves semantic tokens for syntax highlighting.
   * Returns a raw `Uint32Array` mapped directly from WASM memory for speed.
   * Array layout is: [byteStart, byteLen, tokenTypeId, bitmask] repeating.
   */
  getSemanticTokens(astRoot: number, sourceCode?: string): Uint32Array;
  /**
   * Retrieves semantic tokens delta edits (LSP 3.16+ textDocument/semanticTokens/full/delta).
   */
  getSemanticTokensDelta(
    astRoot: number,
    prevResultId: number,
  ): SemanticTokensDeltaResponse;
  /**
   * Compares oldTree and newTree to compute the precise modified character spans (ts_tree_get_changed_ranges equivalent).
   */
  getChangedRanges(
    oldTree: number,
    newTree: number,
  ): {
    start: number;
    end: number;
    startOffset: number;
    endOffset: number;
  }[];
  /**
   * Instantiates a new value-type TreeCursor rooted at rootNode.
   */
  createTreeCursor(rootNode: number): WasmTreeCursor;
  /** Retrieves a list of collapsable folding ranges from the parsed syntax tree. */
  getFoldingRanges(astRoot: number): {
    start: Position;
    end: Position;
  }[];
  /** Extracts document symbols (e.g. classes, functions) for the document outline view. */
  getDocumentSymbols(astRoot: number): {
    start: Position;
    end: Position;
    startOffset: number;
    endOffset: number;
    typeId: number;
    nodePtr: number;
  }[];
  private getEncodingDiv;
  /** Locates the definition of the symbol at the given character offset. */
  getDefinition(
    astRoot: number,
    targetOffset: number,
  ): {
    fileId: number;
    start: number;
    end: number;
  } | null;
  /** Locates all references to the symbol at the given character offset across registered workspace files. */
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
    _projectionId?: number,
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
    startOffset: number,
    endOffset: number,
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
    startOffset: number;
    endOffset: number;
    merkleLow?: number | undefined;
    merkleHigh?: number | undefined;
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
    startOffset: number;
    endOffset: number;
    merkleLow?: number | undefined;
    merkleHigh?: number | undefined;
  }[];
  /** Queries all symbols for a given fileId (fast LSP document symbol outline). */
  getFileSymbols(fileId: number): {
    fileId: number;
    symbolId: number;
    parentSymbolId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startOffset: number;
    endOffset: number;
    merkleLow?: number | undefined;
    merkleHigh?: number | undefined;
  }[];
  /** Queries child stub symbols for a parent symbol ID. */
  getStubChildren(parentSymbolId: number): {
    fileId: number;
    symbolId: number;
    parentSymbolId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startOffset: number;
    endOffset: number;
    merkleLow?: number | undefined;
    merkleHigh?: number | undefined;
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
    startOffset: number;
    endOffset: number;
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
    explanation?: string | undefined;
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
      sourceLangId?: number | undefined;
      subject: string;
      predicate?: string | undefined;
      object?: string | undefined;
      flags?: number | undefined;
    }[],
    retractions: {
      axiomType: number;
      subject: string;
      predicate?: string | undefined;
      object?: string | undefined;
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
    editStartOrEdits?: number | EditRange[],
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
  private _cachedChildren;
  private _cachedNamedChildren;
  private _cachedText;
  _fieldId: number;
  constructor(
    tree: Tree,
    ptr: number,
    _startOffset: number,
    parent: SyntaxNode | null,
    _cachedPad: number,
    _cachedLen: number,
    _cachedTypeId: number,
    fieldId?: number,
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
  /**
   * The encoding divisor to convert raw WASM byte offsets to character offsets.
   * UTF-16 (encoding 1 or 2) → div 2; UTF-32 (encoding 3 or 4) → div 4; else 1.
   * Cached per-access via the facade; the encoding never changes mid-session.
   */
  private get _encodingDiv();
  /** The start character offset of this node within the source text. */
  get startOffset(): number;
  /** The end character offset of this node within the source text. */
  get endOffset(): number;
  /** The start character index of the node. Alias for {@link startOffset}. */
  get startIndex(): number;
  /** The end character index of the node. Alias for {@link endOffset}. */
  get endIndex(): number;
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
  descendantForIndex(
    start: number,
    end?: number,
    visited?: Set<number>,
  ): SyntaxNode | null;
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
  readonly _encoding: number;
  readonly _encMult: number;
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
  /** Releases any resources associated with this syntax tree wrapper. */
  delete(): void;
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
  maxActiveAsts?: number | undefined;
  /** Maximum memory threshold in bytes before LRU eviction triggers (default: 128 MB). */
  maxAstMemoryBytes?: number | undefined;
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
    startOffset: number;
    endOffset: number;
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
    syntaxNames?: string[] | undefined;
    fieldNames?: Record<string, number> | undefined;
    lintMessages?: Record<string, any> | undefined;
    lintSeverities?: Record<string, number> | undefined;
  },
): Promise<{
  facade: LspFacade;
  parser: TreeSitterParser;
}>;
/**
 * Synchronously instantiates a WebAssembly parser from a file path, Uint8Array buffer, or ArrayBuffer.
 * Useful for synchronous compiler pipelines and CLI transformations.
 */
export declare function createWasmParserSync(
  wasmUrlOrBytes: string | Uint8Array | ArrayBuffer,
  options?: {
    syntaxNames?: string[] | undefined;
    fieldNames?: Record<string, number> | undefined;
    lintMessages?: Record<string, any> | undefined;
    lintSeverities?: Record<string, number> | undefined;
  },
): {
  facade: LspFacade;
  parser: TreeSitterParser;
};

export declare const semanticLegend: { tokenTypes: string[]; tokenModifiers: string[] };

export declare enum SyntaxKind {
  ERROR = 0,
  SourceFile = 64,
  ProgramUnit = 65,
  ProgramDeclaration = 66,
  SubroutineDeclaration = 67,
  FunctionDeclaration = 68,
  ModuleDeclaration = 69,
  ParameterList = 70,
  Statement = 71,
  UseStatement = 72,
  AllocateStatement = 73,
  DeallocateStatement = 74,
  DeclarationStatement = 75,
  AttributeSpec = 76,
  DeclaratorList = 77,
  Declarator = 78,
  SubscriptItem = 79,
  DimensionList = 80,
  DimensionStatement = 81,
  CommonStatement = 82,
  ParameterStatement = 83,
  ParameterAssignmentList = 84,
  ParameterAssignment = 85,
  ImplicitStatement = 86,
  IdentifierList = 87,
  AssignmentStatement = 88,
  Target = 89,
  StateRef = 90,
  PortRef = 91,
  BlockIfStatement = 92,
  ElseIfClause = 93,
  ElseClause = 94,
  InlineIfStatement = 95,
  InlineAction = 96,
  DoStatement = 97,
  CallStatement = 98,
  ReturnStatement = 99,
  ContinueStatement = 100,
  ArgumentList = 101,
  Expression = 102,
  BinaryExpression = 103,
  UnaryExpression = 104,
  PrimaryExpression = 105,
  ArrayOrCallRef = 106,
  START = 107,
  _START = 107,
  EmptyStatement = 110,
  _EmptyStatement = 110,
  PROGRAMKEYWORD = 163,
  PROGRAM_KEYWORD = 163,
  SUBROUTINEKEYWORD = 164,
  SUBROUTINE_KEYWORD = 164,
  FUNCTIONKEYWORD = 165,
  FUNCTION_KEYWORD = 165,
  MODULEKEYWORD = 166,
  MODULE_KEYWORD = 166,
  CONTAINSKEYWORD = 167,
  CONTAINS_KEYWORD = 167,
  USEKEYWORD = 168,
  USE_KEYWORD = 168,
  ALLOCATEKEYWORD = 169,
  ALLOCATE_KEYWORD = 169,
  DEALLOCATEKEYWORD = 170,
  DEALLOCATE_KEYWORD = 170,
  ENDPROGRAM = 171,
  END_PROGRAM = 171,
  ENDSUBROUTINE = 172,
  END_SUBROUTINE = 172,
  ENDFUNCTION = 173,
  END_FUNCTION = 173,
  ENDMODULE = 174,
  END_MODULE = 174,
  KINDPREFIX = 175,
  KIND_PREFIX = 175,
  IFKEYWORD = 176,
  IF_KEYWORD = 176,
  THENKEYWORD = 177,
  THEN_KEYWORD = 177,
  ENDIF = 178,
  END_IF = 178,
  ELSEIF = 179,
  ELSE_IF = 179,
  ELSEKEYWORD = 180,
  ELSE_KEYWORD = 180,
  DOKEYWORD = 181,
  DO_KEYWORD = 181,
  ENDDO = 182,
  END_DO = 182,
  CALLKEYWORD = 183,
  CALL_KEYWORD = 183,
  RETURNKEYWORD = 184,
  RETURN_KEYWORD = 184,
  CONTINUEKEYWORD = 185,
  CONTINUE_KEYWORD = 185,
  COMMONKEYWORD = 186,
  COMMON_KEYWORD = 186,
  PARAMETERKEYWORD = 187,
  PARAMETER_KEYWORD = 187,
  DIMENSIONKEYWORD = 188,
  DIMENSION_KEYWORD = 188,
  IMPLICITKEYWORD = 189,
  IMPLICIT_KEYWORD = 189,
  NONEKEYWORD = 190,
  NONE_KEYWORD = 190,
  INTENTKEYWORD = 191,
  INTENT_KEYWORD = 191,
  INTENTSPEC = 192,
  INTENT_SPEC = 192,
  SAVEKEYWORD = 193,
  SAVE_KEYWORD = 193,
  ALLOCATABLEKEYWORD = 194,
  ALLOCATABLE_KEYWORD = 194,
  OPTIONALKEYWORD = 195,
  OPTIONAL_KEYWORD = 195,
  VALUEKEYWORD = 196,
  VALUE_KEYWORD = 196,
  TYPESPECIFIER = 197,
  TYPE_SPECIFIER = 197,
  STATEARRAY = 198,
  STATE_ARRAY = 198,
  SPECIALCONSTANT = 199,
  SPECIAL_CONSTANT = 199,
  LOGICALOR = 200,
  LOGICAL_OR = 200,
  LOGICALAND = 201,
  LOGICAL_AND = 201,
  EQUALITYOP = 202,
  EQUALITY_OP = 202,
  RELATIONALOP = 203,
  RELATIONAL_OP = 203,
  LOGICALNOT = 204,
  LOGICAL_NOT = 204,
  POWEROP = 205,
  POWER_OP = 205,
  IDENTIFIER = 206,
  PORTIDENTIFIER = 207,
  PORT_IDENTIFIER = 207,
  DIMDIRECTIVE = 208,
  DIM_DIRECTIVE = 208,
  NUMBER = 209,
  STRING = 210,
  BOOLEAN = 211,
  EOF = 1023,
}

export declare enum FieldId {
  Name = 1,
  name = 1,
  Parameters = 2,
  parameters = 2,
  ReturnType = 3,
  returnType = 3,
  Module = 4,
  module = 4,
  Items = 5,
  items = 5,
  Type = 6,
  type = 6,
  Len = 7,
  len = 7,
  Kind = 8,
  kind = 8,
  Declarators = 9,
  declarators = 9,
  Intent = 10,
  intent = 10,
  Dimensions = 11,
  dimensions = 11,
  Init = 12,
  init = 12,
  Variables = 13,
  variables = 13,
  Assignments = 14,
  assignments = 14,
  Value = 15,
  value = 15,
  Target = 16,
  target = 16,
  Array = 17,
  array = 17,
  Index = 18,
  index = 18,
  Dim = 19,
  dim = 19,
  Condition = 20,
  condition = 20,
  Action = 21,
  action = 21,
  Label = 22,
  label = 22,
  Variable = 23,
  variable = 23,
  Start = 24,
  start = 24,
  End = 25,
  end = 25,
  Step = 26,
  step = 26,
  Subroutine = 27,
  subroutine = 27,
  Arguments = 28,
  arguments = 28,
  Left = 29,
  left = 29,
  Right = 30,
  right = 30,
  Operand = 31,
  operand = 31,
  Expr = 32,
  expr = 32,
  Callee = 33,
  callee = 33,
}

/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
export interface SourceFileNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SourceFile;
}
export declare function isSourceFile(node: SyntaxNode | null | undefined): node is SourceFileNode;
export interface ProgramUnitNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ProgramUnit;
}
export declare function isProgramUnit(node: SyntaxNode | null | undefined): node is ProgramUnitNode;
export interface ProgramDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ProgramDeclaration;
}
export declare function isProgramDeclaration(node: SyntaxNode | null | undefined): node is ProgramDeclarationNode;
export interface SubroutineDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SubroutineDeclaration;
}
export declare function isSubroutineDeclaration(node: SyntaxNode | null | undefined): node is SubroutineDeclarationNode;
export interface FunctionDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionDeclaration;
}
export declare function isFunctionDeclaration(node: SyntaxNode | null | undefined): node is FunctionDeclarationNode;
export interface ModuleDeclarationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ModuleDeclaration;
}
export declare function isModuleDeclaration(node: SyntaxNode | null | undefined): node is ModuleDeclarationNode;
export interface ParameterListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterList;
}
export declare function isParameterList(node: SyntaxNode | null | undefined): node is ParameterListNode;
export interface StatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Statement;
}
export declare function isStatement(node: SyntaxNode | null | undefined): node is StatementNode;
export interface UseStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UseStatement;
}
export declare function isUseStatement(node: SyntaxNode | null | undefined): node is UseStatementNode;
export interface AllocateStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AllocateStatement;
}
export declare function isAllocateStatement(node: SyntaxNode | null | undefined): node is AllocateStatementNode;
export interface DeallocateStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DeallocateStatement;
}
export declare function isDeallocateStatement(node: SyntaxNode | null | undefined): node is DeallocateStatementNode;
export interface DeclarationStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DeclarationStatement;
}
export declare function isDeclarationStatement(node: SyntaxNode | null | undefined): node is DeclarationStatementNode;
export interface AttributeSpecNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AttributeSpec;
}
export declare function isAttributeSpec(node: SyntaxNode | null | undefined): node is AttributeSpecNode;
export interface DeclaratorListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DeclaratorList;
}
export declare function isDeclaratorList(node: SyntaxNode | null | undefined): node is DeclaratorListNode;
export interface DeclaratorNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Declarator;
}
export declare function isDeclarator(node: SyntaxNode | null | undefined): node is DeclaratorNode;
export interface SubscriptItemNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SubscriptItem;
}
export declare function isSubscriptItem(node: SyntaxNode | null | undefined): node is SubscriptItemNode;
export interface DimensionListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DimensionList;
}
export declare function isDimensionList(node: SyntaxNode | null | undefined): node is DimensionListNode;
export interface DimensionStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DimensionStatement;
}
export declare function isDimensionStatement(node: SyntaxNode | null | undefined): node is DimensionStatementNode;
export interface CommonStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CommonStatement;
}
export declare function isCommonStatement(node: SyntaxNode | null | undefined): node is CommonStatementNode;
export interface ParameterStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterStatement;
}
export declare function isParameterStatement(node: SyntaxNode | null | undefined): node is ParameterStatementNode;
export interface ParameterAssignmentListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterAssignmentList;
}
export declare function isParameterAssignmentList(node: SyntaxNode | null | undefined): node is ParameterAssignmentListNode;
export interface ParameterAssignmentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterAssignment;
}
export declare function isParameterAssignment(node: SyntaxNode | null | undefined): node is ParameterAssignmentNode;
export interface ImplicitStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ImplicitStatement;
}
export declare function isImplicitStatement(node: SyntaxNode | null | undefined): node is ImplicitStatementNode;
export interface IdentifierListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IdentifierList;
}
export declare function isIdentifierList(node: SyntaxNode | null | undefined): node is IdentifierListNode;
export interface AssignmentStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AssignmentStatement;
}
export declare function isAssignmentStatement(node: SyntaxNode | null | undefined): node is AssignmentStatementNode;
export interface TargetNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Target;
}
export declare function isTarget(node: SyntaxNode | null | undefined): node is TargetNode;
export interface StateRefNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StateRef;
}
export declare function isStateRef(node: SyntaxNode | null | undefined): node is StateRefNode;
export interface PortRefNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PortRef;
}
export declare function isPortRef(node: SyntaxNode | null | undefined): node is PortRefNode;
export interface BlockIfStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BlockIfStatement;
}
export declare function isBlockIfStatement(node: SyntaxNode | null | undefined): node is BlockIfStatementNode;
export interface ElseIfClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElseIfClause;
}
export declare function isElseIfClause(node: SyntaxNode | null | undefined): node is ElseIfClauseNode;
export interface ElseClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ElseClause;
}
export declare function isElseClause(node: SyntaxNode | null | undefined): node is ElseClauseNode;
export interface InlineIfStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InlineIfStatement;
}
export declare function isInlineIfStatement(node: SyntaxNode | null | undefined): node is InlineIfStatementNode;
export interface InlineActionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InlineAction;
}
export declare function isInlineAction(node: SyntaxNode | null | undefined): node is InlineActionNode;
export interface DoStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DoStatement;
}
export declare function isDoStatement(node: SyntaxNode | null | undefined): node is DoStatementNode;
export interface CallStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CallStatement;
}
export declare function isCallStatement(node: SyntaxNode | null | undefined): node is CallStatementNode;
export interface ReturnStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ReturnStatement;
}
export declare function isReturnStatement(node: SyntaxNode | null | undefined): node is ReturnStatementNode;
export interface ContinueStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ContinueStatement;
}
export declare function isContinueStatement(node: SyntaxNode | null | undefined): node is ContinueStatementNode;
export interface ArgumentListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArgumentList;
}
export declare function isArgumentList(node: SyntaxNode | null | undefined): node is ArgumentListNode;
export interface ExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Expression;
}
export declare function isExpression(node: SyntaxNode | null | undefined): node is ExpressionNode;
export interface BinaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BinaryExpression;
}
export declare function isBinaryExpression(node: SyntaxNode | null | undefined): node is BinaryExpressionNode;
export interface UnaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnaryExpression;
}
export declare function isUnaryExpression(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
export interface PrimaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrimaryExpression;
}
export declare function isPrimaryExpression(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
export interface ArrayOrCallRefNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ArrayOrCallRef;
}
export declare function isArrayOrCallRef(node: SyntaxNode | null | undefined): node is ArrayOrCallRefNode;
export interface PROGRAMKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PROGRAMKEYWORD;
}
export declare function isPROGRAMKEYWORD(node: SyntaxNode | null | undefined): node is PROGRAMKEYWORDNode;
export interface SUBROUTINEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SUBROUTINEKEYWORD;
}
export declare function isSUBROUTINEKEYWORD(node: SyntaxNode | null | undefined): node is SUBROUTINEKEYWORDNode;
export interface FUNCTIONKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FUNCTIONKEYWORD;
}
export declare function isFUNCTIONKEYWORD(node: SyntaxNode | null | undefined): node is FUNCTIONKEYWORDNode;
export interface MODULEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MODULEKEYWORD;
}
export declare function isMODULEKEYWORD(node: SyntaxNode | null | undefined): node is MODULEKEYWORDNode;
export interface CONTAINSKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CONTAINSKEYWORD;
}
export declare function isCONTAINSKEYWORD(node: SyntaxNode | null | undefined): node is CONTAINSKEYWORDNode;
export interface USEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.USEKEYWORD;
}
export declare function isUSEKEYWORD(node: SyntaxNode | null | undefined): node is USEKEYWORDNode;
export interface ALLOCATEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ALLOCATEKEYWORD;
}
export declare function isALLOCATEKEYWORD(node: SyntaxNode | null | undefined): node is ALLOCATEKEYWORDNode;
export interface DEALLOCATEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DEALLOCATEKEYWORD;
}
export declare function isDEALLOCATEKEYWORD(node: SyntaxNode | null | undefined): node is DEALLOCATEKEYWORDNode;
export interface ENDPROGRAMNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ENDPROGRAM;
}
export declare function isENDPROGRAM(node: SyntaxNode | null | undefined): node is ENDPROGRAMNode;
export interface ENDSUBROUTINENode extends SyntaxNode {
  readonly typeId: SyntaxKind.ENDSUBROUTINE;
}
export declare function isENDSUBROUTINE(node: SyntaxNode | null | undefined): node is ENDSUBROUTINENode;
export interface ENDFUNCTIONNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ENDFUNCTION;
}
export declare function isENDFUNCTION(node: SyntaxNode | null | undefined): node is ENDFUNCTIONNode;
export interface ENDMODULENode extends SyntaxNode {
  readonly typeId: SyntaxKind.ENDMODULE;
}
export declare function isENDMODULE(node: SyntaxNode | null | undefined): node is ENDMODULENode;
export interface KINDPREFIXNode extends SyntaxNode {
  readonly typeId: SyntaxKind.KINDPREFIX;
}
export declare function isKINDPREFIX(node: SyntaxNode | null | undefined): node is KINDPREFIXNode;
export interface IFKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IFKEYWORD;
}
export declare function isIFKEYWORD(node: SyntaxNode | null | undefined): node is IFKEYWORDNode;
export interface THENKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.THENKEYWORD;
}
export declare function isTHENKEYWORD(node: SyntaxNode | null | undefined): node is THENKEYWORDNode;
export interface ENDIFNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ENDIF;
}
export declare function isENDIF(node: SyntaxNode | null | undefined): node is ENDIFNode;
export interface ELSEIFNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ELSEIF;
}
export declare function isELSEIF(node: SyntaxNode | null | undefined): node is ELSEIFNode;
export interface ELSEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ELSEKEYWORD;
}
export declare function isELSEKEYWORD(node: SyntaxNode | null | undefined): node is ELSEKEYWORDNode;
export interface DOKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DOKEYWORD;
}
export declare function isDOKEYWORD(node: SyntaxNode | null | undefined): node is DOKEYWORDNode;
export interface ENDDONode extends SyntaxNode {
  readonly typeId: SyntaxKind.ENDDO;
}
export declare function isENDDO(node: SyntaxNode | null | undefined): node is ENDDONode;
export interface CALLKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CALLKEYWORD;
}
export declare function isCALLKEYWORD(node: SyntaxNode | null | undefined): node is CALLKEYWORDNode;
export interface RETURNKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RETURNKEYWORD;
}
export declare function isRETURNKEYWORD(node: SyntaxNode | null | undefined): node is RETURNKEYWORDNode;
export interface CONTINUEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CONTINUEKEYWORD;
}
export declare function isCONTINUEKEYWORD(node: SyntaxNode | null | undefined): node is CONTINUEKEYWORDNode;
export interface COMMONKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.COMMONKEYWORD;
}
export declare function isCOMMONKEYWORD(node: SyntaxNode | null | undefined): node is COMMONKEYWORDNode;
export interface PARAMETERKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PARAMETERKEYWORD;
}
export declare function isPARAMETERKEYWORD(node: SyntaxNode | null | undefined): node is PARAMETERKEYWORDNode;
export interface DIMENSIONKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DIMENSIONKEYWORD;
}
export declare function isDIMENSIONKEYWORD(node: SyntaxNode | null | undefined): node is DIMENSIONKEYWORDNode;
export interface IMPLICITKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IMPLICITKEYWORD;
}
export declare function isIMPLICITKEYWORD(node: SyntaxNode | null | undefined): node is IMPLICITKEYWORDNode;
export interface NONEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NONEKEYWORD;
}
export declare function isNONEKEYWORD(node: SyntaxNode | null | undefined): node is NONEKEYWORDNode;
export interface INTENTKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.INTENTKEYWORD;
}
export declare function isINTENTKEYWORD(node: SyntaxNode | null | undefined): node is INTENTKEYWORDNode;
export interface INTENTSPECNode extends SyntaxNode {
  readonly typeId: SyntaxKind.INTENTSPEC;
}
export declare function isINTENTSPEC(node: SyntaxNode | null | undefined): node is INTENTSPECNode;
export interface SAVEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SAVEKEYWORD;
}
export declare function isSAVEKEYWORD(node: SyntaxNode | null | undefined): node is SAVEKEYWORDNode;
export interface ALLOCATABLEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ALLOCATABLEKEYWORD;
}
export declare function isALLOCATABLEKEYWORD(node: SyntaxNode | null | undefined): node is ALLOCATABLEKEYWORDNode;
export interface OPTIONALKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OPTIONALKEYWORD;
}
export declare function isOPTIONALKEYWORD(node: SyntaxNode | null | undefined): node is OPTIONALKEYWORDNode;
export interface VALUEKEYWORDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VALUEKEYWORD;
}
export declare function isVALUEKEYWORD(node: SyntaxNode | null | undefined): node is VALUEKEYWORDNode;
export interface TYPESPECIFIERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TYPESPECIFIER;
}
export declare function isTYPESPECIFIER(node: SyntaxNode | null | undefined): node is TYPESPECIFIERNode;
export interface STATEARRAYNode extends SyntaxNode {
  readonly typeId: SyntaxKind.STATEARRAY;
}
export declare function isSTATEARRAY(node: SyntaxNode | null | undefined): node is STATEARRAYNode;
export interface SPECIALCONSTANTNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SPECIALCONSTANT;
}
export declare function isSPECIALCONSTANT(node: SyntaxNode | null | undefined): node is SPECIALCONSTANTNode;
export interface LOGICALORNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LOGICALOR;
}
export declare function isLOGICALOR(node: SyntaxNode | null | undefined): node is LOGICALORNode;
export interface LOGICALANDNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LOGICALAND;
}
export declare function isLOGICALAND(node: SyntaxNode | null | undefined): node is LOGICALANDNode;
export interface EQUALITYOPNode extends SyntaxNode {
  readonly typeId: SyntaxKind.EQUALITYOP;
}
export declare function isEQUALITYOP(node: SyntaxNode | null | undefined): node is EQUALITYOPNode;
export interface RELATIONALOPNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RELATIONALOP;
}
export declare function isRELATIONALOP(node: SyntaxNode | null | undefined): node is RELATIONALOPNode;
export interface LOGICALNOTNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LOGICALNOT;
}
export declare function isLOGICALNOT(node: SyntaxNode | null | undefined): node is LOGICALNOTNode;
export interface POWEROPNode extends SyntaxNode {
  readonly typeId: SyntaxKind.POWEROP;
}
export declare function isPOWEROP(node: SyntaxNode | null | undefined): node is POWEROPNode;
export interface IDENTIFIERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IDENTIFIER;
}
export declare function isIDENTIFIER(node: SyntaxNode | null | undefined): node is IDENTIFIERNode;
export interface PORTIDENTIFIERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PORTIDENTIFIER;
}
export declare function isPORTIDENTIFIER(node: SyntaxNode | null | undefined): node is PORTIDENTIFIERNode;
export interface DIMDIRECTIVENode extends SyntaxNode {
  readonly typeId: SyntaxKind.DIMDIRECTIVE;
}
export declare function isDIMDIRECTIVE(node: SyntaxNode | null | undefined): node is DIMDIRECTIVENode;
export interface NUMBERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NUMBER;
}
export declare function isNUMBER(node: SyntaxNode | null | undefined): node is NUMBERNode;
export interface STRINGNode extends SyntaxNode {
  readonly typeId: SyntaxKind.STRING;
}
export declare function isSTRING(node: SyntaxNode | null | undefined): node is STRINGNode;
export interface BOOLEANNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BOOLEAN;
}
export declare function isBOOLEAN(node: SyntaxNode | null | undefined): node is BOOLEANNode;
export declare namespace Cst {
  export function kind(node: SyntaxNode | null | undefined): string;
  export function normalize(token: string | null | undefined): string;
  export const SourceFile: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SourceFileNode;
  };
  export const ProgramUnit: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ProgramUnitNode;
  };
  export const ProgramDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ProgramDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SubroutineDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SubroutineDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    parameters(node: SyntaxNode | null | undefined): SyntaxNode | null;
    parametersList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    returnType(node: SyntaxNode | null | undefined): SyntaxNode | null;
    returnTypeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    parameters(node: SyntaxNode | null | undefined): SyntaxNode | null;
    parametersList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ModuleDeclaration: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ModuleDeclarationNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterListNode;
  };
  export const Statement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StatementNode;
  };
  export const UseStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UseStatementNode;
    module(node: SyntaxNode | null | undefined): SyntaxNode | null;
    moduleList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AllocateStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AllocateStatementNode;
    items(node: SyntaxNode | null | undefined): SyntaxNode | null;
    itemsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DeallocateStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeallocateStatementNode;
    items(node: SyntaxNode | null | undefined): SyntaxNode | null;
    itemsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DeclarationStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeclarationStatementNode;
    type(node: SyntaxNode | null | undefined): SyntaxNode | null;
    typeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    declarators(node: SyntaxNode | null | undefined): SyntaxNode | null;
    declaratorsList(node: SyntaxNode | null | undefined): SyntaxNode[];
    len(node: SyntaxNode | null | undefined): SyntaxNode | null;
    lenList(node: SyntaxNode | null | undefined): SyntaxNode[];
    kind(node: SyntaxNode | null | undefined): SyntaxNode | null;
    kindList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AttributeSpec: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AttributeSpecNode;
    intent(node: SyntaxNode | null | undefined): SyntaxNode | null;
    intentList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DeclaratorList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeclaratorListNode;
  };
  export const Declarator: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeclaratorNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    dimensions(node: SyntaxNode | null | undefined): SyntaxNode | null;
    dimensionsList(node: SyntaxNode | null | undefined): SyntaxNode[];
    init(node: SyntaxNode | null | undefined): SyntaxNode | null;
    initList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SubscriptItem: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SubscriptItemNode;
  };
  export const DimensionList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DimensionListNode;
  };
  export const DimensionStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DimensionStatementNode;
  };
  export const CommonStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CommonStatementNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    variables(node: SyntaxNode | null | undefined): SyntaxNode | null;
    variablesList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterStatementNode;
    assignments(node: SyntaxNode | null | undefined): SyntaxNode | null;
    assignmentsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterAssignmentList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterAssignmentListNode;
  };
  export const ParameterAssignment: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterAssignmentNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ImplicitStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ImplicitStatementNode;
  };
  export const IdentifierList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IdentifierListNode;
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
  export const Target: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TargetNode;
  };
  export const StateRef: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StateRefNode;
    array(node: SyntaxNode | null | undefined): SyntaxNode | null;
    arrayList(node: SyntaxNode | null | undefined): SyntaxNode[];
    index(node: SyntaxNode | null | undefined): SyntaxNode | null;
    indexList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PortRef: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PortRefNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    dim(node: SyntaxNode | null | undefined): SyntaxNode | null;
    dimList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const BlockIfStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BlockIfStatementNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ElseIfClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElseIfClauseNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ElseClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ElseClauseNode;
  };
  export const InlineIfStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InlineIfStatementNode;
    condition(node: SyntaxNode | null | undefined): SyntaxNode | null;
    conditionList(node: SyntaxNode | null | undefined): SyntaxNode[];
    action(node: SyntaxNode | null | undefined): SyntaxNode | null;
    actionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const InlineAction: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InlineActionNode;
  };
  export const DoStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DoStatementNode;
    variable(node: SyntaxNode | null | undefined): SyntaxNode | null;
    variableList(node: SyntaxNode | null | undefined): SyntaxNode[];
    start(node: SyntaxNode | null | undefined): SyntaxNode | null;
    startList(node: SyntaxNode | null | undefined): SyntaxNode[];
    end(node: SyntaxNode | null | undefined): SyntaxNode | null;
    endList(node: SyntaxNode | null | undefined): SyntaxNode[];
    label(node: SyntaxNode | null | undefined): SyntaxNode | null;
    labelList(node: SyntaxNode | null | undefined): SyntaxNode[];
    step(node: SyntaxNode | null | undefined): SyntaxNode | null;
    stepList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CallStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CallStatementNode;
    subroutine(node: SyntaxNode | null | undefined): SyntaxNode | null;
    subroutineList(node: SyntaxNode | null | undefined): SyntaxNode[];
    arguments(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argumentsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ReturnStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ReturnStatementNode;
  };
  export const ContinueStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ContinueStatementNode;
    label(node: SyntaxNode | null | undefined): SyntaxNode | null;
    labelList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ArgumentList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArgumentListNode;
  };
  export const Expression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionNode;
  };
  export const BinaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BinaryExpressionNode;
    left(node: SyntaxNode | null | undefined): SyntaxNode | null;
    leftList(node: SyntaxNode | null | undefined): SyntaxNode[];
    right(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rightList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const UnaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
    operand(node: SyntaxNode | null | undefined): SyntaxNode | null;
    operandList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrimaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
    expr(node: SyntaxNode | null | undefined): SyntaxNode | null;
    exprList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ArrayOrCallRef: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ArrayOrCallRefNode;
    callee(node: SyntaxNode | null | undefined): SyntaxNode | null;
    calleeList(node: SyntaxNode | null | undefined): SyntaxNode[];
    arguments(node: SyntaxNode | null | undefined): SyntaxNode | null;
    argumentsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PROGRAMKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PROGRAMKEYWORDNode;
  };
  export const SUBROUTINEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SUBROUTINEKEYWORDNode;
  };
  export const FUNCTIONKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FUNCTIONKEYWORDNode;
  };
  export const MODULEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MODULEKEYWORDNode;
  };
  export const CONTAINSKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CONTAINSKEYWORDNode;
  };
  export const USEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is USEKEYWORDNode;
  };
  export const ALLOCATEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ALLOCATEKEYWORDNode;
  };
  export const DEALLOCATEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DEALLOCATEKEYWORDNode;
  };
  export const ENDPROGRAM: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ENDPROGRAMNode;
  };
  export const ENDSUBROUTINE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ENDSUBROUTINENode;
  };
  export const ENDFUNCTION: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ENDFUNCTIONNode;
  };
  export const ENDMODULE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ENDMODULENode;
  };
  export const KINDPREFIX: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is KINDPREFIXNode;
  };
  export const IFKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IFKEYWORDNode;
  };
  export const THENKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is THENKEYWORDNode;
  };
  export const ENDIF: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ENDIFNode;
  };
  export const ELSEIF: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ELSEIFNode;
  };
  export const ELSEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ELSEKEYWORDNode;
  };
  export const DOKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DOKEYWORDNode;
  };
  export const ENDDO: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ENDDONode;
  };
  export const CALLKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CALLKEYWORDNode;
  };
  export const RETURNKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RETURNKEYWORDNode;
  };
  export const CONTINUEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CONTINUEKEYWORDNode;
  };
  export const COMMONKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is COMMONKEYWORDNode;
  };
  export const PARAMETERKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PARAMETERKEYWORDNode;
  };
  export const DIMENSIONKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DIMENSIONKEYWORDNode;
  };
  export const IMPLICITKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IMPLICITKEYWORDNode;
  };
  export const NONEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NONEKEYWORDNode;
  };
  export const INTENTKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is INTENTKEYWORDNode;
  };
  export const INTENTSPEC: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is INTENTSPECNode;
  };
  export const SAVEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SAVEKEYWORDNode;
  };
  export const ALLOCATABLEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ALLOCATABLEKEYWORDNode;
  };
  export const OPTIONALKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OPTIONALKEYWORDNode;
  };
  export const VALUEKEYWORD: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VALUEKEYWORDNode;
  };
  export const TYPESPECIFIER: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TYPESPECIFIERNode;
  };
  export const STATEARRAY: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is STATEARRAYNode;
  };
  export const SPECIALCONSTANT: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SPECIALCONSTANTNode;
  };
  export const LOGICALOR: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LOGICALORNode;
  };
  export const LOGICALAND: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LOGICALANDNode;
  };
  export const EQUALITYOP: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is EQUALITYOPNode;
  };
  export const RELATIONALOP: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RELATIONALOPNode;
  };
  export const LOGICALNOT: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LOGICALNOTNode;
  };
  export const POWEROP: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is POWEROPNode;
  };
  export const IDENTIFIER: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IDENTIFIERNode;
  };
  export const PORTIDENTIFIER: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PORTIDENTIFIERNode;
  };
  export const DIMDIRECTIVE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DIMDIRECTIVENode;
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
  export const BOOLEAN: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BOOLEANNode;
  };
}
