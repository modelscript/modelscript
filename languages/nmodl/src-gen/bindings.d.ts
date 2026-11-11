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
  /** Returns true if the node or any of its descendants represents a syntax error. */
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
  Document = 69,
  Block = 70,
  TitleBlock = 71,
  NeuronBlock = 72,
  NeuronStatement = 73,
  UnitsBlock = 74,
  UnitsDef = 75,
  ParameterBlock = 76,
  ParameterDecl = 77,
  StateBlock = 78,
  StateDecl = 79,
  AssignedBlock = 80,
  BreakpointBlock = 81,
  DerivativeBlock = 82,
  InitialBlock = 83,
  ProcedureBlock = 84,
  ProcedureArg = 85,
  FunctionBlock = 86,
  Statement = 87,
  SolveStatement = 88,
  DerivativeEquation = 89,
  AssignmentEquation = 90,
  CallStatement = 91,
  IfStatement = 92,
  Expression = 93,
  BinaryExpr = 94,
  UnaryExpr = 95,
  CallExpr = 96,
  PrimaryExpr = 97,
  START = 98,
  _START = 98,
  CommentLine = 158,
  RestOfLine = 159,
  Identifier = 160,
  NumberLiteral = 161,
  EOF = 1023,
}

export declare enum FieldId {
  Title = 1,
  title = 1,
  Suffix = 2,
  suffix = 2,
  Ion = 3,
  ion = 3,
  Unit = 4,
  unit = 4,
  Target = 5,
  target = 5,
  Name = 6,
  name = 6,
  Value = 7,
  value = 7,
  BlockName = 8,
  blockName = 8,
  Method = 9,
  method = 9,
  Lhs = 10,
  lhs = 10,
  Rhs = 11,
  rhs = 11,
  Func = 12,
  func = 12,
  Cond = 13,
  cond = 13,
}

/** Strips quotes from parser token strings (e.g. '"der"' -> 'der', '":' -> ':') */
export declare function normalizeToken(token: string | null | undefined): string;

/** Returns the normalized type of a CST node (stripped of quotes). */
export declare function cstKind(node: SyntaxNode | null | undefined): string;
export interface DocumentNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Document;
}
export declare function isDocument(node: SyntaxNode | null | undefined): node is DocumentNode;
export interface BlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Block;
}
export declare function isBlock(node: SyntaxNode | null | undefined): node is BlockNode;
export interface TitleBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.TitleBlock;
}
export declare function isTitleBlock(node: SyntaxNode | null | undefined): node is TitleBlockNode;
export interface NeuronBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NeuronBlock;
}
export declare function isNeuronBlock(node: SyntaxNode | null | undefined): node is NeuronBlockNode;
export interface NeuronStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NeuronStatement;
}
export declare function isNeuronStatement(node: SyntaxNode | null | undefined): node is NeuronStatementNode;
export interface UnitsBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnitsBlock;
}
export declare function isUnitsBlock(node: SyntaxNode | null | undefined): node is UnitsBlockNode;
export interface UnitsDefNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnitsDef;
}
export declare function isUnitsDef(node: SyntaxNode | null | undefined): node is UnitsDefNode;
export interface ParameterBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterBlock;
}
export declare function isParameterBlock(node: SyntaxNode | null | undefined): node is ParameterBlockNode;
export interface ParameterDeclNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ParameterDecl;
}
export declare function isParameterDecl(node: SyntaxNode | null | undefined): node is ParameterDeclNode;
export interface StateBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StateBlock;
}
export declare function isStateBlock(node: SyntaxNode | null | undefined): node is StateBlockNode;
export interface StateDeclNode extends SyntaxNode {
  readonly typeId: SyntaxKind.StateDecl;
}
export declare function isStateDecl(node: SyntaxNode | null | undefined): node is StateDeclNode;
export interface AssignedBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AssignedBlock;
}
export declare function isAssignedBlock(node: SyntaxNode | null | undefined): node is AssignedBlockNode;
export interface BreakpointBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BreakpointBlock;
}
export declare function isBreakpointBlock(node: SyntaxNode | null | undefined): node is BreakpointBlockNode;
export interface DerivativeBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DerivativeBlock;
}
export declare function isDerivativeBlock(node: SyntaxNode | null | undefined): node is DerivativeBlockNode;
export interface InitialBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.InitialBlock;
}
export declare function isInitialBlock(node: SyntaxNode | null | undefined): node is InitialBlockNode;
export interface ProcedureBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ProcedureBlock;
}
export declare function isProcedureBlock(node: SyntaxNode | null | undefined): node is ProcedureBlockNode;
export interface ProcedureArgNode extends SyntaxNode {
  readonly typeId: SyntaxKind.ProcedureArg;
}
export declare function isProcedureArg(node: SyntaxNode | null | undefined): node is ProcedureArgNode;
export interface FunctionBlockNode extends SyntaxNode {
  readonly typeId: SyntaxKind.FunctionBlock;
}
export declare function isFunctionBlock(node: SyntaxNode | null | undefined): node is FunctionBlockNode;
export interface StatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Statement;
}
export declare function isStatement(node: SyntaxNode | null | undefined): node is StatementNode;
export interface SolveStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.SolveStatement;
}
export declare function isSolveStatement(node: SyntaxNode | null | undefined): node is SolveStatementNode;
export interface DerivativeEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.DerivativeEquation;
}
export declare function isDerivativeEquation(node: SyntaxNode | null | undefined): node is DerivativeEquationNode;
export interface AssignmentEquationNode extends SyntaxNode {
  readonly typeId: SyntaxKind.AssignmentEquation;
}
export declare function isAssignmentEquation(node: SyntaxNode | null | undefined): node is AssignmentEquationNode;
export interface CallStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CallStatement;
}
export declare function isCallStatement(node: SyntaxNode | null | undefined): node is CallStatementNode;
export interface IfStatementNode extends SyntaxNode {
  readonly typeId: SyntaxKind.IfStatement;
}
export declare function isIfStatement(node: SyntaxNode | null | undefined): node is IfStatementNode;
export interface ExpressionNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Expression;
}
export declare function isExpression(node: SyntaxNode | null | undefined): node is ExpressionNode;
export interface BinaryExprNode extends SyntaxNode {
  readonly typeId: SyntaxKind.BinaryExpr;
}
export declare function isBinaryExpr(node: SyntaxNode | null | undefined): node is BinaryExprNode;
export interface UnaryExprNode extends SyntaxNode {
  readonly typeId: SyntaxKind.UnaryExpr;
}
export declare function isUnaryExpr(node: SyntaxNode | null | undefined): node is UnaryExprNode;
export interface CallExprNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CallExpr;
}
export declare function isCallExpr(node: SyntaxNode | null | undefined): node is CallExprNode;
export interface PrimaryExprNode extends SyntaxNode {
  readonly typeId: SyntaxKind.PrimaryExpr;
}
export declare function isPrimaryExpr(node: SyntaxNode | null | undefined): node is PrimaryExprNode;
export interface CommentLineNode extends SyntaxNode {
  readonly typeId: SyntaxKind.CommentLine;
}
export declare function isCommentLine(node: SyntaxNode | null | undefined): node is CommentLineNode;
export interface RestOfLineNode extends SyntaxNode {
  readonly typeId: SyntaxKind.RestOfLine;
}
export declare function isRestOfLine(node: SyntaxNode | null | undefined): node is RestOfLineNode;
export interface IdentifierNode extends SyntaxNode {
  readonly typeId: SyntaxKind.Identifier;
}
export declare function isIdentifier(node: SyntaxNode | null | undefined): node is IdentifierNode;
export interface NumberLiteralNode extends SyntaxNode {
  readonly typeId: SyntaxKind.NumberLiteral;
}
export declare function isNumberLiteral(node: SyntaxNode | null | undefined): node is NumberLiteralNode;
export declare namespace Cst {
  export function kind(node: SyntaxNode | null | undefined): string;
  export function normalize(token: string | null | undefined): string;
  export const Document: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DocumentNode;
  };
  export const Block: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BlockNode;
  };
  export const TitleBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is TitleBlockNode;
    title(node: SyntaxNode | null | undefined): SyntaxNode | null;
    titleList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const NeuronBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NeuronBlockNode;
  };
  export const NeuronStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NeuronStatementNode;
    suffix(node: SyntaxNode | null | undefined): SyntaxNode | null;
    suffixList(node: SyntaxNode | null | undefined): SyntaxNode[];
    ion(node: SyntaxNode | null | undefined): SyntaxNode | null;
    ionList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const UnitsBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnitsBlockNode;
  };
  export const UnitsDef: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnitsDefNode;
    unit(node: SyntaxNode | null | undefined): SyntaxNode | null;
    unitList(node: SyntaxNode | null | undefined): SyntaxNode[];
    target(node: SyntaxNode | null | undefined): SyntaxNode | null;
    targetList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ParameterBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterBlockNode;
  };
  export const ParameterDecl: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ParameterDeclNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    value(node: SyntaxNode | null | undefined): SyntaxNode | null;
    valueList(node: SyntaxNode | null | undefined): SyntaxNode[];
    unit(node: SyntaxNode | null | undefined): SyntaxNode | null;
    unitList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const StateBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StateBlockNode;
  };
  export const StateDecl: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StateDeclNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    unit(node: SyntaxNode | null | undefined): SyntaxNode | null;
    unitList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AssignedBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AssignedBlockNode;
  };
  export const BreakpointBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BreakpointBlockNode;
  };
  export const DerivativeBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DerivativeBlockNode;
    blockName(node: SyntaxNode | null | undefined): SyntaxNode | null;
    blockNameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const InitialBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is InitialBlockNode;
  };
  export const ProcedureBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ProcedureBlockNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const ProcedureArg: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ProcedureArgNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    unit(node: SyntaxNode | null | undefined): SyntaxNode | null;
    unitList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const FunctionBlock: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is FunctionBlockNode;
    name(node: SyntaxNode | null | undefined): SyntaxNode | null;
    nameList(node: SyntaxNode | null | undefined): SyntaxNode[];
    unit(node: SyntaxNode | null | undefined): SyntaxNode | null;
    unitList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Statement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is StatementNode;
  };
  export const SolveStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is SolveStatementNode;
    target(node: SyntaxNode | null | undefined): SyntaxNode | null;
    targetList(node: SyntaxNode | null | undefined): SyntaxNode[];
    method(node: SyntaxNode | null | undefined): SyntaxNode | null;
    methodList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const DerivativeEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is DerivativeEquationNode;
    lhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    lhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
    rhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const AssignmentEquation: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is AssignmentEquationNode;
    lhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    lhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
    rhs(node: SyntaxNode | null | undefined): SyntaxNode | null;
    rhsList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const CallStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CallStatementNode;
    func(node: SyntaxNode | null | undefined): SyntaxNode | null;
    funcList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const IfStatement: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IfStatementNode;
    cond(node: SyntaxNode | null | undefined): SyntaxNode | null;
    condList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const Expression: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is ExpressionNode;
  };
  export const BinaryExpr: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is BinaryExprNode;
  };
  export const UnaryExpr: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is UnaryExprNode;
  };
  export const CallExpr: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CallExprNode;
    func(node: SyntaxNode | null | undefined): SyntaxNode | null;
    funcList(node: SyntaxNode | null | undefined): SyntaxNode[];
  };
  export const PrimaryExpr: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is PrimaryExprNode;
  };
  export const CommentLine: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is CommentLineNode;
  };
  export const RestOfLine: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is RestOfLineNode;
  };
  export const Identifier: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is IdentifierNode;
  };
  export const NumberLiteral: {
    readonly typeId: number;
    readonly type: string;
    is(node: SyntaxNode | null | undefined): node is NumberLiteralNode;
  };
}
