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
export interface Edit {
  startIndex?: number;
  oldEndIndex?: number;
  newEndIndex?: number;
  startPosition?: Point;
  oldEndPosition?: Point;
  newEndPosition?: Point;
  startByte?: number;
  oldEndByte?: number;
  newEndByte?: number;
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
  /** Releases the WASM-side cursor back to the pool. The cursor must not be used afterwards. */
  dispose(): void;
  /** Returns the cursor to the pool if it is garbage-collected without an explicit dispose(). */
  private static _registry;
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
  private _u32View;
  /** Returns a Uint32Array over linear memory, reallocated only when `memory.grow` replaces the buffer. */
  private _u32;
  exports: any;
  lastAstRoot: number;
  private _cachedLineStarts;
  private documentRoots;
  private documentVersions;
  private _uriToFileId;
  private _fileIdToUri;
  private _nextFileId;
  private _idleTimer;
  private _maxMemoryQuotaBytes;
  private _lastInputBufferUri;
  private _lastInputBufferLength;
  /**
   * Retrieves or assigns a stable numeric fileId for a given URI.
   */
  getFileId(uri: string): number;
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
  scheduleCompaction(immediate?: boolean): void;
  /**
   * Trigger 2: Checks if live allocated arena memory exceeds high-water mark quota.
   */
  checkMemoryQuota(): void;
  /**
   * Reclaims WASM slab arenas for closed/stale documents and resets parser
   * generations cleanly once all open document roots have been closed.
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
    kind?: "comment" | "imports" | "region";
    defaultCollapsed?: boolean;
  }[];
  /** Retrieves 1-based Monaco FoldingRange entries from the parsed syntax tree. */
  getMonacoFoldingRanges(astRoot: number): {
    start: number;
    end: number;
    kind?: "comment" | "imports" | "region";
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
  private _strScratchPtr;
  private _strScratchCapacity;
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
  _nextSibling: SyntaxNode | null | undefined;
  _prevSibling: SyntaxNode | null | undefined;
  _nextNamedSibling: SyntaxNode | null | undefined;
  _prevNamedSibling: SyntaxNode | null | undefined;
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
  get merkleLow(): number;
  get merkleHigh(): number;
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
  /** The start byte offset of this node within the UTF-8 source text. */
  get startByte(): number;
  /** The end byte offset of this node within the UTF-8 source text. */
  get endByte(): number;
  /**
   * Returns true if this node was inserted by the parser to recover from a syntax error.
   */
  get isMissing(): boolean;
  /** Returns true if this node is an extra token (comment/whitespace). */
  get isExtra(): boolean;
  /** Returns true if this node has been edited. */
  get hasChanges(): boolean;
  /** The parse state of the node. */
  get parseState(): number;
  /** The next parse state of the node. */
  get nextParseState(): number;
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
  /** Finds the first child whose endIndex is greater than the given index. */
  firstChildForIndex(index: number): SyntaxNode | null;
  /** Finds the first named child whose endIndex is greater than the given index. */
  firstNamedChildForIndex(index: number): SyntaxNode | null;
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
  get isNamed(): boolean;
  private _cachedHasError;
  /** Evaluates whether this node or any of its descendants has a syntax error. */
  private _computeHasError;
  /**
   * Returns true if the node or any of its descendants represents a syntax error.
   * Defined as a getter property that can also be called as a method (node.hasError())
   * for backward compatibility with tests and callers expecting either signature.
   */
  get hasError(): boolean;
  /** Returns true if this node itself represents a syntax error. */
  get isError(): boolean;
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
  /** Gets the total count of all recursive descendant nodes. */
  get descendantCount(): number;
  /**
   * Get the immediate child that contains the given descendant node.
   * Note that this returns the descendant itself if it is an immediate child.
   */
  childWithDescendant(descendant: SyntaxNode): SyntaxNode | null;
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
  get nodeStateId(): number;
  get currentDescendantIndex(): number;
  get nodeText(): string;
  get currentNode(): SyntaxNode;
  get startIndex(): number;
  get endIndex(): number;
  get startPosition(): Point;
  get endPosition(): Point;
  get currentFieldName(): string | null;
  get currentFieldId(): number;
  get currentDepth(): number;
  get isMissing(): boolean;
  reset(node: SyntaxNode): void;
  resetTo(cursor: TreeCursor): void;
  gotoFirstChild(): boolean;
  gotoLastChild(): boolean;
  gotoFirstChildForIndex(index: number): boolean;
  gotoFirstChildForPosition(position: Point): boolean;
  gotoNextSibling(): boolean;
  gotoPreviousSibling(): boolean;
  gotoParent(): boolean;
  gotoDescendant(goalDescendantIndex: number): void;
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
  private _rootNode;
  /** Gets the root node of the syntax tree. */
  get rootNode(): SyntaxNode;
  lastEdit: Edit | null;
  private _lsTyped;
  private _lsTypedSrc;
  private _lineStartsTyped;
  private _isPureAscii;
  /** Lazily-built cumulative UTF-8 byte length per UTF-16 offset (length n+1); null when pure ASCII. */
  private _utf8Prefix;
  private _ensureUtf8Index;
  /**
   * Converts a linear UTF-16 code unit offset to a UTF-8 byte offset in O(1)
   * (one-time O(n) index build for non-ASCII sources).
   */
  offsetToByte(charOffset: number): number;
  /**
   * Converts a UTF-8 byte offset to a linear UTF-16 code unit offset in O(log n).
   * Offsets falling inside a multi-byte character round up to the next character boundary.
   */
  byteToOffset(byteOffset: number): number;
  /**
   * Applies an edit transaction record to the tree, storing the modified bounds
   * for the next incremental parse call. Correctly harmonizes UTF-8 byte offsets
   * and UTF-16 code unit indices.
   *
   * `startByte`/`oldEndByte` are resolved against this tree's (old) source. `newEndByte`
   * can only be resolved against the NEW source, so it is deferred until `parse()` when
   * no `newEndIndex` is supplied.
   */
  edit(edit: Edit): Tree;
  rootNodeWithOffset(offsetBytes: number, offsetExtent: Point): SyntaxNode;
  getChangedRanges(other: Tree): Range[];
  getIncludedRanges(): Range[];
  getText(node: SyntaxNode): string;
  getEditedRange(): Range | null;
  printDotGraph(fd?: number): void;
  /** Creates a stateful TreeCursor for traversing the tree starting at the root. */
  walk(): TreeCursor;
  /** Converts a linear UTF-16 code unit offset into a row and column Point. */
  offsetToPoint(offset: number): Point;
  /** Converts a row and column Point into a linear UTF-16 character offset. */
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
  /**
   * Parses `source` using a specific multi-format entry point (e.g. `"raw"`, `"dyr"`, `"seq"`, `"con"`, `"idv"`).
   * Prepends the Private-Use-Area format sentinel (`\uE000<format>\uE001`) for zero-conflict GLR dispatch.
   */
  parseFormat(
    source: string | Uint8Array,
    format: string,
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
/**
 * Registers a pre-instantiated WebAssembly GLR parser in `globalThis.__msWasmParsers`
 * so synchronous language parsers and workspace linters can use it inside browser WebWorkers
 * without Node.js `fs` or `node:module`.
 */
export declare function registerPreloadedWasmParser(
  langId: string,
  parser: TreeSitterParser | null | undefined,
  facade?: LspFacade | null,
): void;
/**
 * Retrieves a pre-instantiated WebAssembly GLR parser from `globalThis` if registered
 * by `ParserService` (browser WebWorker or Node LSP server).
 */
export declare function getPreloadedWasmParser(
  langId: string,
): TreeSitterParser | undefined;
/**
 * Resolves the filesystem path or URL to a language package's `parser.wasm` without `node:module`.
 */
export declare function resolveLanguageWasmPath(
  importMetaUrl: string,
  langId?: string,
): string;
/**
 * Isomorphic helper that returns the pre-loaded WASM GLR parser in browser WebWorkers
 * (`globalThis.__msWasmParsers`) and lazily loads `parser.wasm` synchronously in Node.js CLI/tests.
 */
export declare function getOrLoadLanguageWasmParser<TParser = TreeSitterParser>(
  langId: string,
  importMetaUrl: string,
  syncFactory?: (wasmPath: string) => {
    parser: TParser;
  },
): TParser;
export interface WasmSyntaxErrorSpan {
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}
/**
 * Walks a WASM GLR `SyntaxNode` root and extracts bounded `ERROR` / `isMissing` syntax error spans
 * (1-indexed lines and columns).
 */
export declare function collectWasmSyntaxErrors(
  rootNode: unknown,
  maxErrors?: number,
): WasmSyntaxErrorSpan[];

export declare const semanticLegend: { tokenTypes: string[]; tokenModifiers: string[] };

export declare enum SyntaxKind {
  ERROR = 0,
  QueryUnit = 77,
  Prologue = 78,
  BaseDecl = 79,
  PrefixDecl = 80,
  SelectQuery = 81,
  SelectClause = 82,
  SelectProjection = 83,
  ConstructQuery = 84,
  ConstructTemplate = 85,
  DescribeQuery = 86,
  AskQuery = 87,
  InsertDataUpdate = 88,
  DeleteDataUpdate = 89,
  DeleteInsertUpdate = 90,
  InsertWhereUpdate = 91,
  SubSelect = 92,
  DatasetClause = 93,
  WhereClause = 94,
  GroupGraphPattern = 95,
  GraphPatternItem = 96,
  GroupOrUnionGraphPattern = 97,
  OptionalGraphPattern = 98,
  MinusGraphPattern = 99,
  GraphGraphPattern = 100,
  ServiceGraphPattern = 101,
  FilterClause = 102,
  Constraint = 103,
  BindClause = 104,
  ValuesClause = 105,
  ValuesRow = 106,
  DataBlockValue = 107,
  TriplesBlock = 108,
  TriplesSameSubject = 109,
  PropertyListNotEmpty = 110,
  OptionalPropertyObjectPair = 111,
  _OptionalPropertyObjectPair = 111,
  PropertyObjectPair = 112,
  VerbPathOrSimple = 113,
  PathAlternative = 114,
  PathSequence = 115,
  PathEltOrInverse = 116,
  PathElt = 117,
  PathMod = 118,
  PathNegatedPropertySet = 119,
  PathPrimary = 120,
  BlankNodePropertyList = 121,
  Collection = 122,
  ObjectList = 123,
  SolutionModifier = 124,
  GroupClause = 125,
  GroupCondition = 126,
  HavingClause = 127,
  OrderClause = 128,
  OrderCondition = 129,
  LimitOffsetClauses = 130,
  LimitClause = 131,
  OffsetClause = 132,
  Expression = 133,
  ConditionalOrExpression = 134,
  ConditionalAndExpression = 135,
  RelationalExpression = 136,
  AdditiveExpression = 137,
  MultiplicativeExpression = 138,
  UnaryExpression = 139,
  PrimaryExpression = 140,
  BrackettedExpression = 141,
  ExpressionList = 142,
  BuiltInCall = 143,
  VarOrTerm = 144,
  Iri = 145,
  RDFLiteral = 146,
  NumericLiteral = 147,
  BooleanLiteral = 148,
  START = 149,
  _START = 149,
  VAR = 233,
  IRIREF = 234,
  PNAMELN = 235,
  PNAME_LN = 235,
  PNAMENS = 236,
  PNAME_NS = 236,
  BLANKNODELABEL = 237,
  BLANK_NODE_LABEL = 237,
  STRINGLITERAL = 238,
  STRING_LITERAL = 238,
  LANGTAG = 239,
  DECIMALORDOUBLE = 240,
  DECIMAL_OR_DOUBLE = 240,
  INTEGER = 241,
  IDENT = 242,
  EOF = 1023,
}

export declare enum FieldId {
  Iri = 1,
  iri = 1,
  Prefix = 2,
  prefix = 2,
  Expr = 3,
  expr = 3,
  Alias = 4,
  alias = 4,
  Graph = 5,
  graph = 5,
  Endpoint = 6,
  endpoint = 6,
  Var = 7,
  var = 7,
  Subject = 8,
  subject = 8,
  Verb = 9,
  verb = 9,
  Objects = 10,
  objects = 10,
  Count = 11,
  count = 11,
  Fn = 12,
  fn = 12,
}

/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
export interface QueryUnitNode extends SyntaxNode {
  readonly typeId: SyntaxKind.QueryUnit;
}
export declare function isQueryUnit(node: SyntaxNode | null | undefined): node is QueryUnitNode;
export interface PrologueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Prologue;
}
export declare function isPrologue(node: SyntaxNode | null | undefined): node is PrologueNode;
export interface BaseDeclNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BaseDecl;
}
export declare function isBaseDecl(node: SyntaxNode | null | undefined): node is BaseDeclNode;
export interface PrefixDeclNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrefixDecl;
}
export declare function isPrefixDecl(node: SyntaxNode | null | undefined): node is PrefixDeclNode;
export interface SelectQueryNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SelectQuery;
}
export declare function isSelectQuery(node: SyntaxNode | null | undefined): node is SelectQueryNode;
export interface SelectClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SelectClause;
}
export declare function isSelectClause(node: SyntaxNode | null | undefined): node is SelectClauseNode;
export interface SelectProjectionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SelectProjection;
}
export declare function isSelectProjection(node: SyntaxNode | null | undefined): node is SelectProjectionNode;
export interface ConstructQueryNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstructQuery;
}
export declare function isConstructQuery(node: SyntaxNode | null | undefined): node is ConstructQueryNode;
export interface ConstructTemplateNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConstructTemplate;
}
export declare function isConstructTemplate(node: SyntaxNode | null | undefined): node is ConstructTemplateNode;
export interface DescribeQueryNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DescribeQuery;
}
export declare function isDescribeQuery(node: SyntaxNode | null | undefined): node is DescribeQueryNode;
export interface AskQueryNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AskQuery;
}
export declare function isAskQuery(node: SyntaxNode | null | undefined): node is AskQueryNode;
export interface InsertDataUpdateNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InsertDataUpdate;
}
export declare function isInsertDataUpdate(node: SyntaxNode | null | undefined): node is InsertDataUpdateNode;
export interface DeleteDataUpdateNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DeleteDataUpdate;
}
export declare function isDeleteDataUpdate(node: SyntaxNode | null | undefined): node is DeleteDataUpdateNode;
export interface DeleteInsertUpdateNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DeleteInsertUpdate;
}
export declare function isDeleteInsertUpdate(node: SyntaxNode | null | undefined): node is DeleteInsertUpdateNode;
export interface InsertWhereUpdateNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InsertWhereUpdate;
}
export declare function isInsertWhereUpdate(node: SyntaxNode | null | undefined): node is InsertWhereUpdateNode;
export interface SubSelectNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SubSelect;
}
export declare function isSubSelect(node: SyntaxNode | null | undefined): node is SubSelectNode;
export interface DatasetClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DatasetClause;
}
export declare function isDatasetClause(node: SyntaxNode | null | undefined): node is DatasetClauseNode;
export interface WhereClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.WhereClause;
}
export declare function isWhereClause(node: SyntaxNode | null | undefined): node is WhereClauseNode;
export interface GroupGraphPatternNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GroupGraphPattern;
}
export declare function isGroupGraphPattern(node: SyntaxNode | null | undefined): node is GroupGraphPatternNode;
export interface GraphPatternItemNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GraphPatternItem;
}
export declare function isGraphPatternItem(node: SyntaxNode | null | undefined): node is GraphPatternItemNode;
export interface GroupOrUnionGraphPatternNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GroupOrUnionGraphPattern;
}
export declare function isGroupOrUnionGraphPattern(node: SyntaxNode | null | undefined): node is GroupOrUnionGraphPatternNode;
export interface OptionalGraphPatternNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OptionalGraphPattern;
}
export declare function isOptionalGraphPattern(node: SyntaxNode | null | undefined): node is OptionalGraphPatternNode;
export interface MinusGraphPatternNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MinusGraphPattern;
}
export declare function isMinusGraphPattern(node: SyntaxNode | null | undefined): node is MinusGraphPatternNode;
export interface GraphGraphPatternNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GraphGraphPattern;
}
export declare function isGraphGraphPattern(node: SyntaxNode | null | undefined): node is GraphGraphPatternNode;
export interface ServiceGraphPatternNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ServiceGraphPattern;
}
export declare function isServiceGraphPattern(node: SyntaxNode | null | undefined): node is ServiceGraphPatternNode;
export interface FilterClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FilterClause;
}
export declare function isFilterClause(node: SyntaxNode | null | undefined): node is FilterClauseNode;
export interface ConstraintNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Constraint;
}
export declare function isConstraint(node: SyntaxNode | null | undefined): node is ConstraintNode;
export interface BindClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BindClause;
}
export declare function isBindClause(node: SyntaxNode | null | undefined): node is BindClauseNode;
export interface ValuesClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ValuesClause;
}
export declare function isValuesClause(node: SyntaxNode | null | undefined): node is ValuesClauseNode;
export interface ValuesRowNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ValuesRow;
}
export declare function isValuesRow(node: SyntaxNode | null | undefined): node is ValuesRowNode;
export interface DataBlockValueNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DataBlockValue;
}
export declare function isDataBlockValue(node: SyntaxNode | null | undefined): node is DataBlockValueNode;
export interface TriplesBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TriplesBlock;
}
export declare function isTriplesBlock(node: SyntaxNode | null | undefined): node is TriplesBlockNode;
export interface TriplesSameSubjectNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TriplesSameSubject;
}
export declare function isTriplesSameSubject(node: SyntaxNode | null | undefined): node is TriplesSameSubjectNode;
export interface PropertyListNotEmptyNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PropertyListNotEmpty;
}
export declare function isPropertyListNotEmpty(node: SyntaxNode | null | undefined): node is PropertyListNotEmptyNode;
export interface PropertyObjectPairNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PropertyObjectPair;
}
export declare function isPropertyObjectPair(node: SyntaxNode | null | undefined): node is PropertyObjectPairNode;
export interface VerbPathOrSimpleNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VerbPathOrSimple;
}
export declare function isVerbPathOrSimple(node: SyntaxNode | null | undefined): node is VerbPathOrSimpleNode;
export interface PathAlternativeNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathAlternative;
}
export declare function isPathAlternative(node: SyntaxNode | null | undefined): node is PathAlternativeNode;
export interface PathSequenceNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathSequence;
}
export declare function isPathSequence(node: SyntaxNode | null | undefined): node is PathSequenceNode;
export interface PathEltOrInverseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathEltOrInverse;
}
export declare function isPathEltOrInverse(node: SyntaxNode | null | undefined): node is PathEltOrInverseNode;
export interface PathEltNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathElt;
}
export declare function isPathElt(node: SyntaxNode | null | undefined): node is PathEltNode;
export interface PathModNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathMod;
}
export declare function isPathMod(node: SyntaxNode | null | undefined): node is PathModNode;
export interface PathNegatedPropertySetNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathNegatedPropertySet;
}
export declare function isPathNegatedPropertySet(node: SyntaxNode | null | undefined): node is PathNegatedPropertySetNode;
export interface PathPrimaryNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PathPrimary;
}
export declare function isPathPrimary(node: SyntaxNode | null | undefined): node is PathPrimaryNode;
export interface BlankNodePropertyListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BlankNodePropertyList;
}
export declare function isBlankNodePropertyList(node: SyntaxNode | null | undefined): node is BlankNodePropertyListNode;
export interface CollectionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Collection;
}
export declare function isCollection(node: SyntaxNode | null | undefined): node is CollectionNode;
export interface ObjectListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ObjectList;
}
export declare function isObjectList(node: SyntaxNode | null | undefined): node is ObjectListNode;
export interface SolutionModifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SolutionModifier;
}
export declare function isSolutionModifier(node: SyntaxNode | null | undefined): node is SolutionModifierNode;
export interface GroupClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GroupClause;
}
export declare function isGroupClause(node: SyntaxNode | null | undefined): node is GroupClauseNode;
export interface GroupConditionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.GroupCondition;
}
export declare function isGroupCondition(node: SyntaxNode | null | undefined): node is GroupConditionNode;
export interface HavingClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.HavingClause;
}
export declare function isHavingClause(node: SyntaxNode | null | undefined): node is HavingClauseNode;
export interface OrderClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OrderClause;
}
export declare function isOrderClause(node: SyntaxNode | null | undefined): node is OrderClauseNode;
export interface OrderConditionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OrderCondition;
}
export declare function isOrderCondition(node: SyntaxNode | null | undefined): node is OrderConditionNode;
export interface LimitOffsetClausesNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LimitOffsetClauses;
}
export declare function isLimitOffsetClauses(node: SyntaxNode | null | undefined): node is LimitOffsetClausesNode;
export interface LimitClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LimitClause;
}
export declare function isLimitClause(node: SyntaxNode | null | undefined): node is LimitClauseNode;
export interface OffsetClauseNode extends SyntaxNode {
  readonly typeId: SyntaxKind.OffsetClause;
}
export declare function isOffsetClause(node: SyntaxNode | null | undefined): node is OffsetClauseNode;
export interface ExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Expression;
}
export declare function isExpression(node: SyntaxNode | null | undefined): node is ExpressionNode;
export interface ConditionalOrExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConditionalOrExpression;
}
export declare function isConditionalOrExpression(node: SyntaxNode | null | undefined): node is ConditionalOrExpressionNode;
export interface ConditionalAndExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ConditionalAndExpression;
}
export declare function isConditionalAndExpression(node: SyntaxNode | null | undefined): node is ConditionalAndExpressionNode;
export interface RelationalExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RelationalExpression;
}
export declare function isRelationalExpression(node: SyntaxNode | null | undefined): node is RelationalExpressionNode;
export interface AdditiveExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AdditiveExpression;
}
export declare function isAdditiveExpression(node: SyntaxNode | null | undefined): node is AdditiveExpressionNode;
export interface MultiplicativeExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.MultiplicativeExpression;
}
export declare function isMultiplicativeExpression(node: SyntaxNode | null | undefined): node is MultiplicativeExpressionNode;
export interface UnaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnaryExpression;
}
export declare function isUnaryExpression(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
export interface PrimaryExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrimaryExpression;
}
export declare function isPrimaryExpression(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
export interface BrackettedExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BrackettedExpression;
}
export declare function isBrackettedExpression(node: SyntaxNode | null | undefined): node is BrackettedExpressionNode;
export interface ExpressionListNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ExpressionList;
}
export declare function isExpressionList(node: SyntaxNode | null | undefined): node is ExpressionListNode;
export interface BuiltInCallNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BuiltInCall;
}
export declare function isBuiltInCall(node: SyntaxNode | null | undefined): node is BuiltInCallNode;
export interface VarOrTermNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VarOrTerm;
}
export declare function isVarOrTerm(node: SyntaxNode | null | undefined): node is VarOrTermNode;
export interface IriNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Iri;
}
export declare function isIri(node: SyntaxNode | null | undefined): node is IriNode;
export interface RDFLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RDFLiteral;
}
export declare function isRDFLiteral(node: SyntaxNode | null | undefined): node is RDFLiteralNode;
export interface NumericLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NumericLiteral;
}
export declare function isNumericLiteral(node: SyntaxNode | null | undefined): node is NumericLiteralNode;
export interface BooleanLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BooleanLiteral;
}
export declare function isBooleanLiteral(node: SyntaxNode | null | undefined): node is BooleanLiteralNode;
export interface VARNode extends SyntaxNode {
  readonly typeId: SyntaxKind.VAR;
}
export declare function isVAR(node: SyntaxNode | null | undefined): node is VARNode;
export interface IRIREFNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IRIREF;
}
export declare function isIRIREF(node: SyntaxNode | null | undefined): node is IRIREFNode;
export interface PNAMELNNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PNAMELN;
}
export declare function isPNAMELN(node: SyntaxNode | null | undefined): node is PNAMELNNode;
export interface PNAMENSNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PNAMENS;
}
export declare function isPNAMENS(node: SyntaxNode | null | undefined): node is PNAMENSNode;
export interface BLANKNODELABELNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BLANKNODELABEL;
}
export declare function isBLANKNODELABEL(node: SyntaxNode | null | undefined): node is BLANKNODELABELNode;
export interface STRINGLITERALNode extends SyntaxNode {
  readonly typeId: SyntaxKind.STRINGLITERAL;
}
export declare function isSTRINGLITERAL(node: SyntaxNode | null | undefined): node is STRINGLITERALNode;
export interface LANGTAGNode extends SyntaxNode {
  readonly typeId: SyntaxKind.LANGTAG;
}
export declare function isLANGTAG(node: SyntaxNode | null | undefined): node is LANGTAGNode;
export interface DECIMALORDOUBLENode extends SyntaxNode {
  readonly typeId: SyntaxKind.DECIMALORDOUBLE;
}
export declare function isDECIMALORDOUBLE(node: SyntaxNode | null | undefined): node is DECIMALORDOUBLENode;
export interface INTEGERNode extends SyntaxNode {
  readonly typeId: SyntaxKind.INTEGER;
}
export declare function isINTEGER(node: SyntaxNode | null | undefined): node is INTEGERNode;
export interface IDENTNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IDENT;
}
export declare function isIDENT(node: SyntaxNode | null | undefined): node is IDENTNode;
export declare namespace Cst {
  export function kind(node: SyntaxNode | null | undefined): string;
  export function normalize(token: string | null | undefined): string;
  export const QueryUnit: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is QueryUnitNode;
  };
  export const Prologue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrologueNode;
  };
  export const BaseDecl: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BaseDeclNode;
    iri(node: SyntaxNode | null | undefined): SyntaxNode | null;
    iriList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrefixDecl: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrefixDeclNode;
    prefix(node: SyntaxNode | null | undefined): SyntaxNode | null;
    prefixList(node: SyntaxNode | null | undefined): SyntaxNode[];
    iri(node: SyntaxNode | null | undefined): SyntaxNode | null;
    iriList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const SelectQuery: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SelectQueryNode;
  };
  export const SelectClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SelectClauseNode;
  };
  export const SelectProjection: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SelectProjectionNode;
    expr(node: SyntaxNode | null | undefined): SyntaxNode | null;
    exprList(node: SyntaxNode | null | undefined): SyntaxNode[];
    alias(node: SyntaxNode | null | undefined): SyntaxNode | null;
    aliasList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ConstructQuery: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstructQueryNode;
  };
  export const ConstructTemplate: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstructTemplateNode;
  };
  export const DescribeQuery: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DescribeQueryNode;
  };
  export const AskQuery: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AskQueryNode;
  };
  export const InsertDataUpdate: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InsertDataUpdateNode;
  };
  export const DeleteDataUpdate: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeleteDataUpdateNode;
  };
  export const DeleteInsertUpdate: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DeleteInsertUpdateNode;
  };
  export const InsertWhereUpdate: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InsertWhereUpdateNode;
  };
  export const SubSelect: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SubSelectNode;
  };
  export const DatasetClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DatasetClauseNode;
    iri(node: SyntaxNode | null | undefined): SyntaxNode | null;
    iriList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const WhereClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is WhereClauseNode;
  };
  export const GroupGraphPattern: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GroupGraphPatternNode;
  };
  export const GraphPatternItem: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GraphPatternItemNode;
  };
  export const GroupOrUnionGraphPattern: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GroupOrUnionGraphPatternNode;
  };
  export const OptionalGraphPattern: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OptionalGraphPatternNode;
  };
  export const MinusGraphPattern: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MinusGraphPatternNode;
  };
  export const GraphGraphPattern: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GraphGraphPatternNode;
    graph(node: SyntaxNode | null | undefined): SyntaxNode | null;
    graphList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ServiceGraphPattern: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ServiceGraphPatternNode;
    endpoint(node: SyntaxNode | null | undefined): SyntaxNode | null;
    endpointList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FilterClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FilterClauseNode;
  };
  export const Constraint: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConstraintNode;
  };
  export const BindClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BindClauseNode;
    expr(node: SyntaxNode | null | undefined): SyntaxNode | null;
    exprList(node: SyntaxNode | null | undefined): SyntaxNode[];
    var(node: SyntaxNode | null | undefined): SyntaxNode | null;
    varList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ValuesClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ValuesClauseNode;
  };
  export const ValuesRow: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ValuesRowNode;
  };
  export const DataBlockValue: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DataBlockValueNode;
  };
  export const TriplesBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TriplesBlockNode;
  };
  export const TriplesSameSubject: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TriplesSameSubjectNode;
    subject(node: SyntaxNode | null | undefined): SyntaxNode | null;
    subjectList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PropertyListNotEmpty: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PropertyListNotEmptyNode;
  };
  export const PropertyObjectPair: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PropertyObjectPairNode;
    verb(node: SyntaxNode | null | undefined): SyntaxNode | null;
    verbList(node: SyntaxNode | null | undefined): SyntaxNode[];
    objects(node: SyntaxNode | null | undefined): SyntaxNode | null;
    objectsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VerbPathOrSimple: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VerbPathOrSimpleNode;
  };
  export const PathAlternative: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathAlternativeNode;
  };
  export const PathSequence: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathSequenceNode;
  };
  export const PathEltOrInverse: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathEltOrInverseNode;
  };
  export const PathElt: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathEltNode;
  };
  export const PathMod: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathModNode;
  };
  export const PathNegatedPropertySet: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathNegatedPropertySetNode;
  };
  export const PathPrimary: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PathPrimaryNode;
  };
  export const BlankNodePropertyList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BlankNodePropertyListNode;
  };
  export const Collection: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CollectionNode;
  };
  export const ObjectList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ObjectListNode;
  };
  export const SolutionModifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SolutionModifierNode;
  };
  export const GroupClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GroupClauseNode;
  };
  export const GroupCondition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is GroupConditionNode;
  };
  export const HavingClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is HavingClauseNode;
  };
  export const OrderClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OrderClauseNode;
  };
  export const OrderCondition: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OrderConditionNode;
  };
  export const LimitOffsetClauses: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LimitOffsetClausesNode;
  };
  export const LimitClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LimitClauseNode;
    count(node: SyntaxNode | null | undefined): SyntaxNode | null;
    countList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const OffsetClause: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is OffsetClauseNode;
    count(node: SyntaxNode | null | undefined): SyntaxNode | null;
    countList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Expression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionNode;
  };
  export const ConditionalOrExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConditionalOrExpressionNode;
  };
  export const ConditionalAndExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ConditionalAndExpressionNode;
  };
  export const RelationalExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RelationalExpressionNode;
  };
  export const AdditiveExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AdditiveExpressionNode;
  };
  export const MultiplicativeExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is MultiplicativeExpressionNode;
  };
  export const UnaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnaryExpressionNode;
  };
  export const PrimaryExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimaryExpressionNode;
  };
  export const BrackettedExpression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BrackettedExpressionNode;
  };
  export const ExpressionList: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionListNode;
  };
  export const BuiltInCall: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BuiltInCallNode;
    fn(node: SyntaxNode | null | undefined): SyntaxNode | null;
    fnList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const VarOrTerm: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VarOrTermNode;
  };
  export const Iri: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IriNode;
  };
  export const RDFLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RDFLiteralNode;
  };
  export const NumericLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NumericLiteralNode;
  };
  export const BooleanLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BooleanLiteralNode;
  };
  export const VAR: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is VARNode;
  };
  export const IRIREF: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IRIREFNode;
  };
  export const PNAMELN: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PNAMELNNode;
  };
  export const PNAMENS: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PNAMENSNode;
  };
  export const BLANKNODELABEL: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BLANKNODELABELNode;
  };
  export const STRINGLITERAL: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is STRINGLITERALNode;
  };
  export const LANGTAG: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is LANGTAGNode;
  };
  export const DECIMALORDOUBLE: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DECIMALORDOUBLENode;
  };
  export const INTEGER: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is INTEGERNode;
  };
  export const IDENT: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IDENTNode;
  };
}
