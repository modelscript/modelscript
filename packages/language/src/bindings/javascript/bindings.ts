// @ts-nocheck
// Auto-generated TypeScript Wrapper for __LANG_NAME__

export enum InputEncoding {
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
  parse(oldTreePtr: number, editStart: number, editOldEnd: number, editNewEnd: number): number;

  getNodeFirstChild(ptr: number): number;
  getNodeNextSibling(ptr: number): number;
  getNodeType?(ptr: number): number;
}

/**
 * A lightweight wrapper over a parsed AST node pointer.
 * Used internally by the Parser class to traverse the tree.
 */
export class ASTNode {
  constructor(
    private runtime: RuntimeAdapter,
    private ptr: number,
  ) {}

  /** Gets the underlying WASM pointer for this node. */
  getPtr(): number {
    return this.ptr;
  }

  /** Gets the semantic type ID of this node. */
  getTypeId(): number {
    return this.runtime.getNodeType ? this.runtime.getNodeType(this.ptr) : this.runtime.readU32(this.ptr) & 0x03ff;
  }

  /** Gets the first child of this node in the AST. */
  getFirstChild(): ASTNode | null {
    const childPtr = this.runtime.getNodeFirstChild(this.ptr);
    return childPtr === 0 ? null : new ASTNode(this.runtime, childPtr);
  }

  /** Gets the next sibling of this node in the AST. */
  getNextSibling(): ASTNode | null {
    const siblingPtr = this.runtime.getNodeNextSibling(this.ptr);
    return siblingPtr === 0 ? null : new ASTNode(this.runtime, siblingPtr);
  }
}

/**
 * The core Parser facade.
 * Orchestrates memory transfer and invokes the incremental parsing routine.
 */
export class Parser {
  constructor(private runtime: RuntimeAdapter) {}

  /** Sets the expected text encoding (UTF-8, UTF-16, etc.) for parsing. */
  setEncoding(encoding: InputEncoding): void {
    if (this.runtime.setInputEncoding) {
      this.runtime.setInputEncoding(encoding);
    }
  }

  /**
   * Parses the given source string or byte array, optionally performing an incremental parse
   * if an old tree and edit bounds are provided.
   */
  parse(
    source: string | Uint8Array,
    oldTree: ASTNode | null = null,
    editStart: number = 0,
    editOldEnd: number = 0,
  ): ASTNode | null {
    let view: Uint8Array;
    if (typeof source === "string") {
      view = new TextEncoder().encode(source);
    } else {
      view = source;
    }

    const inputPtr = this.runtime.ensureInputBuffer
      ? this.runtime.ensureInputBuffer(view.length)
      : this.runtime.getInputBuffer();
    this.runtime.writeU8Array(inputPtr, view);

    // Explicitly set the input length so the WASM parser knows the byte bounds
    if ((this.runtime as any).wasmExports && (this.runtime as any).wasmExports.setInputLength) {
      (this.runtime as any).wasmExports.setInputLength(view.length);
    } else if ((this.runtime as any).nativeAddon && (this.runtime as any).nativeAddon.setInputLength) {
      (this.runtime as any).nativeAddon.setInputLength(view.length);
    }

    const oldTreePtr = oldTree ? oldTree.getPtr() : 0;
    const astRoot = this.runtime.parse(oldTreePtr, editStart, editOldEnd, view.length);
    return astRoot === 0 ? null : new ASTNode(this.runtime, astRoot);
  }

  /** Reads a WASM-allocated length-prefixed string into a JavaScript string. */
  readString(ptr: number): string {
    if (ptr === 0) return "";
    const lenBytes = this.runtime.readU32(ptr - 4);
    const lenChars = lenBytes / 2;
    if (lenChars <= 0) return "";
    const codes = new Uint16Array(lenChars);
    for (let i = 0; i < lenChars; i++) {
      codes[i] = this.runtime.readU16(ptr + i * 2);
    }
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-16le").decode(codes);
    }
    return String.fromCharCode.apply(null, Array.from(codes));
  }
}

/**
 * The WebAssembly runtime implementation for browser and portable Node.js execution.
 * Backed by a WebAssembly linear memory buffer.
 */
export class WasmRuntime implements RuntimeAdapter {
  private mem32: Uint32Array;
  private mem16: Uint16Array;
  private mem8: Uint8Array;

  constructor(
    private wasmExports: any,
    private memory: WebAssembly.Memory,
  ) {
    this.mem32 = new Uint32Array(memory.buffer);
    this.mem16 = new Uint16Array(memory.buffer);
    this.mem8 = new Uint8Array(memory.buffer);
  }

  private ensureMemory(): void {
    if (this.mem32.byteLength === 0 || this.mem32.buffer !== this.memory.buffer) {
      this.mem32 = new Uint32Array(this.memory.buffer);
      this.mem16 = new Uint16Array(this.memory.buffer);
      this.mem8 = new Uint8Array(this.memory.buffer);
    }
  }

  readU32(ptr: number): number {
    this.ensureMemory();
    return this.mem32[ptr / 4];
  }
  readU16(ptr: number): number {
    this.ensureMemory();
    return this.mem16[ptr / 2];
  }
  writeU8Array(ptr: number, data: Uint8Array): void {
    this.ensureMemory();
    this.mem8.set(data, ptr);
  }

  getInputBuffer(): number {
    return this.wasmExports.getInputBuffer
      ? this.wasmExports.getInputBuffer()
      : this.wasmExports.lsp_getInputBuffer
        ? this.wasmExports.lsp_getInputBuffer()
        : 0;
  }
  ensureInputBuffer(size: number): number {
    return this.wasmExports.ensureInputBuffer ? this.wasmExports.ensureInputBuffer(size) : this.getInputBuffer();
  }
  setInputEncoding(enc: number): void {
    if (this.wasmExports.setInputEncoding) this.wasmExports.setInputEncoding(enc);
  }
  parse(oldTreePtr: number, editStart: number, editOldEnd: number, editNewEnd: number): number {
    return this.wasmExports.parse(oldTreePtr, editStart, editOldEnd, editNewEnd);
  }

  getNodeFirstChild(ptr: number): number {
    this.ensureMemory();
    return this.mem32[(ptr + 12) / 4];
  }
  getNodeNextSibling(ptr: number): number {
    this.ensureMemory();
    return this.mem32[(ptr + 16) / 4];
  }
  getNodeType(ptr: number): number {
    this.ensureMemory();
    return this.mem32[ptr / 4] & 0x03ff;
  }

  /** Gets the imports needed to instantiate the compiled WASM module. */
  static getWasmImports(
    onTextEdit: (start: number, end: number, text: string) => void,
    getMemory: () => WebAssembly.Memory,
  ): any {
    return {
      env: {
        emitTextEdit: (startByte: number, endByte: number, newSourcePtr: number) => {
          const memory = getMemory();
          if (!memory) return;

          const memoryArray = new Uint16Array(memory.buffer);
          const lenBytes = new Uint32Array(memory.buffer)[(newSourcePtr - 4) / 4];
          const lenChars = lenBytes / 2;
          let str = "";
          const offset = newSourcePtr / 2;
          for (let i = 0; i < lenChars; i++) {
            str += String.fromCharCode(memoryArray[offset + i]);
          }

          onTextEdit(startByte, endByte, str);
        },
      },
    };
  }
}

/**
 * The Native Addon runtime implementation for high-performance Node.js execution.
 * Proxies calls directly to the N-API module.
 */
export class NativeRuntime implements RuntimeAdapter {
  constructor(private nativeAddon: any) {}

  readU32(ptr: number): number {
    return this.nativeAddon.readU32(ptr);
  }
  readU16(ptr: number): number {
    return this.nativeAddon.readU16(ptr);
  }
  writeU8Array(ptr: number, data: Uint8Array): void {
    this.nativeAddon.writeU8Array(ptr, data);
  }

  getInputBuffer(): number {
    return this.nativeAddon.getInputBuffer();
  }
  ensureInputBuffer(size: number): number {
    return this.nativeAddon.ensureInputBuffer ? this.nativeAddon.ensureInputBuffer(size) : this.getInputBuffer();
  }
  setInputEncoding(enc: number): void {
    if (this.nativeAddon.setInputEncoding) this.nativeAddon.setInputEncoding(enc);
  }
  parse(oldTreePtr: number, editStart: number, editOldEnd: number, editNewEnd: number): number {
    return this.nativeAddon.parse(oldTreePtr, editStart, editOldEnd, editNewEnd);
  }

  getNodeFirstChild(ptr: number): number {
    return this.nativeAddon.getNodeFirstChild(ptr);
  }
  getNodeNextSibling(ptr: number): number {
    return this.nativeAddon.getNodeNextSibling(ptr);
  }
  getNodeType(ptr: number): number {
    return this.nativeAddon.getNodeType ? this.nativeAddon.getNodeType(ptr) : this.readU32(ptr) & 0x03ff;
  }
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

declare const __SYNTAX_NAMES_LITERAL__: string[];
export const SYNTAX_NAMES: string[] = typeof __SYNTAX_NAMES_LITERAL__ !== "undefined" ? __SYNTAX_NAMES_LITERAL__ : [];

declare const __LINT_MESSAGES_LITERAL__: Record<string, string>;
export const LINT_MESSAGES: Record<string, string> =
  typeof __LINT_MESSAGES_LITERAL__ !== "undefined" ? __LINT_MESSAGES_LITERAL__ : {};

declare const __LINT_SEVERITIES_LITERAL__: Record<string, number>;
export const LINT_SEVERITIES: Record<string, number> =
  typeof __LINT_SEVERITIES_LITERAL__ !== "undefined" ? __LINT_SEVERITIES_LITERAL__ : {};

declare const __LINT_CODES_LITERAL__: Record<string, string | number>;
export const LINT_CODES: Record<string, string | number> =
  typeof __LINT_CODES_LITERAL__ !== "undefined" ? __LINT_CODES_LITERAL__ : {};

declare const __EXTRAS_PATTERN_LITERAL__: string;
export const EXTRAS_PATTERN: string = "__EXTRAS_PATTERN_LITERAL__";

declare const __FIELD_NAMES_LITERAL__: Record<string, number>;
export const FIELD_NAMES: Record<string, number> =
  typeof __FIELD_NAMES_LITERAL__ !== "undefined" ? __FIELD_NAMES_LITERAL__ : {};

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
    children: { ptr: number; field: string | null; invisiblePad: number }[],
  ): void;
  onNodeUpdated(
    newPtr: number,
    oldPtr: number,
    typeId: number,
    typeName: string,
    pad: number,
    len: number,
    flags: number,
    children: { ptr: number; field: string | null; invisiblePad: number }[],
  ): void;
}

export function createWasmImports(grammar: any, facade: LspFacade): any {
  const hostQueries: Record<string, any> = grammar.hostQueries || {};
  const queryKeys = Object.keys(hostQueries);

  return {
    host: {
      runHostQuery: (queryId: number, arg1: number, arg2: number, arg3: number): number => {
        if (queryId > 0 && queryId <= queryKeys.length) {
          const queryName = queryKeys[queryId - 1];
          return hostQueries[queryName](facade, arg1, arg2, arg3);
        }
        return 0;
      },
    },
  };
}

/**
 * The Language Server Protocol Facade.
 *
 * Provides a high-level API over the WebAssembly runtime for IDE integration,
 * managing memory buffer synchronization, incremental parsing, and diagnostic translation.
 */
export class LspFacade {
  public syntaxNames: string[] = SYNTAX_NAMES;
  public extrasRegex: RegExp = new RegExp(
    EXTRAS_PATTERN !== "__EXTRAS_PATTERN_LITERAL__" ? EXTRAS_PATTERN : "\\s",
    "u",
  );
  private wasmMemory: WebAssembly.Memory;
  public exports: any;
  public lastAstRoot: number = 0;
  private _cachedLineStarts: Uint32Array | null = null;
  private documentRoots = new Map<string, number>();
  private documentVersions = new Map<string, number>();
  private _idleTimer: any = null;
  private _maxMemoryQuotaBytes: number = 32 * 1024 * 1024; // 32MB threshold

  /**
   * Returns true if a character matches the grammar's `extras` definition (whitespace/trivia).
   * Line breaks (\n, \r) are excluded so diagnostic ranges stay pinned to their line.
   */
  public isExtraChar(ch: string): boolean {
    if (ch === "\n" || ch === "\r") return false;
    return this.extrasRegex.test(ch);
  }

  /**
   * Retrieves an interned string path from the WASM linear memory string pool.
   */
  public getStringFromPool(id: number): string {
    if (!this.exports || id === 0) return "";
    if (this.exports.graph_getStringLength && this.exports.graph_copyString) {
      const len = this.exports.graph_getStringLength(id);
      if (len === 0) return "";
      const bufPtr = this.exports.lsp_getBinaryBuffer ? this.exports.lsp_getBinaryBuffer() : 0;
      if (bufPtr === 0) return "";
      this.exports.graph_copyString(id, bufPtr);
      const u8 = new Uint8Array(len);
      u8.set(new Uint8Array(this.wasmMemory.buffer, bufPtr, len));
      if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8").decode(u8);
      }
      let str = "";
      for (let i = 0; i < len; i++) str += String.fromCharCode(u8[i]);
      return str;
    }
    return "";
  }
  private _childTailCache = new Map<number, number>();
  private currentInputLength: number = 0;

  constructor(wasmMemoryOrInstance: any, exports?: any) {
    if (wasmMemoryOrInstance && wasmMemoryOrInstance.exports) {
      this.wasmMemory = wasmMemoryOrInstance.exports.memory || wasmMemoryOrInstance.memory;
      this.exports = wasmMemoryOrInstance.exports;
    } else {
      this.wasmMemory = wasmMemoryOrInstance;
      this.exports = exports;
    }
    if (this.exports && this.exports.memory) {
      this.wasmMemory = this.exports.memory;
    }

    if (this.exports && this.exports.initCompiler) {
      this.exports.initCompiler();
    }
  }

  /**
   * Retrieves the AST root for a specific document URI or numeric fileId (or the default/active document).
   */
  public getDocumentRoot(uriOrFileId?: string | number): number {
    if (typeof uriOrFileId === "number") {
      if (this.exports.lsp_getDocumentRoot) {
        return this.exports.lsp_getDocumentRoot(uriOrFileId);
      }
      return this.lastAstRoot;
    }
    if (typeof uriOrFileId === "string" && this.documentRoots.has(uriOrFileId)) {
      return this.documentRoots.get(uriOrFileId)!;
    }
    return this.lastAstRoot;
  }

  /**
   * Registers/updates the AST root for a specific document URI.
   */
  public setDocumentRoot(uri: string, rootPtr: number, version: number = 0): void {
    const oldRoot = this.documentRoots.get(uri);
    if (oldRoot && oldRoot !== rootPtr && this.exports.dropRoot) {
      this.exports.dropRoot(oldRoot);
    }
    this.documentRoots.set(uri, rootPtr);
    this.documentVersions.set(uri, version);
    if (rootPtr && this.exports.registerRoot) {
      this.exports.registerRoot(rootPtr);
    }
    this.lastAstRoot = rootPtr;
  }

  /**
   * Closes a document, unregistering its root from GC and triggering compaction.
   */
  public removeDocument(uri: string): void {
    const root = this.documentRoots.get(uri);
    if (root && this.exports.dropRoot) {
      this.exports.dropRoot(root);
    }
    this.documentRoots.delete(uri);
    this.documentVersions.delete(uri);
    if (this.lastAstRoot === root) {
      this.lastAstRoot = 0;
    }
    // Trigger 3: Document lifecycle event (cleanup on close)
    this.scheduleCompaction(true);
  }

  /**
   * Returns all active document roots across open files in the workspace.
   */
  public getAllDocumentRoots(): number[] {
    const roots = Array.from(this.documentRoots.values()).filter((r) => r > 0);
    if (roots.length === 0 && this.lastAstRoot > 0) roots.push(this.lastAstRoot);
    return roots;
  }

  /**
   * Schedules a generational sweep/compaction pass.
   * Trigger 1: Quiescence / Idle Timer (1500ms debounce).
   */
  public scheduleCompaction(immediate: boolean = false): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Trigger 2: Checks if allocated memory exceeds high-water mark quota.
   */
  public checkMemoryQuota(): void {
    // In immutable append-only arena, memory is reset on generation boundaries (didOpen/didClose/config)
  }

  /**
   * Performs compaction protecting all live document roots if requested.
   */
  public gcCompact(): void {
    // No-op during active editing sessions to preserve append-only immutability
  }

  /** Resets the internal parser state and clears all cached data. */
  resetParser(): void {
    if (this.exports.resetParser) {
      this.exports.resetParser();
    }
    this.lastAstRoot = 0;
    this.documentRoots.clear();
    this.documentVersions.clear();
    this._cachedLineStarts = null;
    this._childTailCache.clear();
  }

  public getInputEncoding(): number {
    return this._inputEncoding !== undefined
      ? this._inputEncoding
      : this.exports.lsp_getInputEncoding
        ? this.exports.lsp_getInputEncoding()
        : 1;
  }

  setParserConfig(
    enableBranchA1: boolean,
    enableBranchB: boolean,
    enableBranchC: boolean,
    enableIslandMode: boolean = false,
    enableMultiFile: boolean = true,
  ): void {
    if (this.exports.configEnableBranchA1) {
      this.exports.configEnableBranchA1.value = enableBranchA1 ? 1 : 0;
    }
    if (this.exports.configEnableBranchB) {
      this.exports.configEnableBranchB.value = enableBranchB ? 1 : 0;
    }
    if (this.exports.configEnableBranchC) {
      this.exports.configEnableBranchC.value = enableBranchC ? 1 : 0;
    }
    if (this.exports.configEnableIslandMode) {
      this.exports.configEnableIslandMode.value = enableIslandMode ? 1 : 0;
    }
    if (this.exports.configEnableMultiFile) {
      this.exports.configEnableMultiFile.value = enableMultiFile ? 1 : 0;
    }
  }

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
  ): number {
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    if (!this.exports.parse || !getInputBuf) return 0;

    // Invalidate cached line starts on every edit.
    // The full rescan in getLineStarts() is O(N) but runs lazily once per edit.
    this._cachedLineStarts = null;
    this._childTailCache.clear(); // Invalidate tail pointers on edit
    this.currentInputLength = newTotalLength;

    if (this.exports.abortSuspend) this.exports.abortSuspend();

    const lenBytes = newTotalLength * 2;
    const prevAstRoot = this.getDocumentRoot(uri);

    // Fast path for empty input (e.g., clearing the editor)
    if (newTotalLength <= 0) {
      if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
      if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(0);
      const newAstRoot = this.exports.parse(0, 0, 0, 0);
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
      if (this.astListeners && this.astListeners.length > 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(prevAstRoot, newAstRoot, listener);
        }
      }
      this.scheduleCompaction(false);
      this._cachedLineStarts = new Uint32Array([0]);
      return newAstRoot;
    }

    const oldTotalLength = newTotalLength + rangeLength - changeText.length;

    const oldTextPtr = getInputBuf();

    // Snapshot old buffer contents BEFORE ensureInputBuffer which may grow memory
    // and detach existing typed array views
    let oldSnapshot: Uint16Array | null = null;
    if (oldTotalLength > 0) {
      const oldView = new Uint16Array(this.wasmMemory.buffer, oldTextPtr, oldTotalLength);
      oldSnapshot = new Uint16Array(oldTotalLength);
      oldSnapshot.set(oldView);
    }

    const maxLen = Math.max(oldTotalLength, newTotalLength);
    const lenBytesAlloc = maxLen * 2;
    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytesAlloc) : oldTextPtr;

    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, maxLen);

    // If the buffer was reallocated, copy the snapshot into the new buffer
    if (oldTextPtr !== textPtr && oldSnapshot) {
      const safeCopyLen = Math.min(oldSnapshot.length, memArray16.length);
      memArray16.set(oldSnapshot.subarray(0, safeCopyLen));
    }

    if (changeText.length !== rangeLength) {
      const sourceIndex = rangeOffset + rangeLength;
      const targetIndex = rangeOffset + changeText.length;
      const count = newTotalLength - targetIndex;
      if (count > 0) {
        memArray16.copyWithin(targetIndex, sourceIndex, sourceIndex + count);
      }
    }

    for (let i = 0; i < changeText.length; i++) {
      memArray16[rangeOffset + i] = changeText.charCodeAt(i);
    }
    if (newTotalLength < maxLen) {
      memArray16.fill(0, newTotalLength, maxLen);
    }

    this._inputEncoding = 1;
    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    const preview = changeText.length > 30 ? changeText.substring(0, 30) + "..." : changeText;
    console.log(
      `[Bindings] parseIncremental START: changeText="${preview.replace(/\n/g, "\\n")}" (len ${changeText.length}), offset=${rangeOffset}, rangeLen=${rangeLength}, newTotalLen=${newTotalLength}, prevRoot=${prevAstRoot}`,
    );

    let editStart = rangeOffset * 2;
    let editOldEnd = (rangeOffset + rangeLength) * 2;
    let editNewEnd = (rangeOffset + changeText.length) * 2;

    let baseRoot = prevAstRoot;
    if (baseRoot === 0 || (editStart === 0 && editOldEnd === 0 && editNewEnd === 0)) {
      baseRoot = 0; // Force full reparse internally if offsets are zeroed or initial parse
      editStart = 0;
      editOldEnd = 0;
      editNewEnd = 0;
    }

    const _t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let newAstRoot = this.exports.parse(baseRoot, editStart, editOldEnd, editNewEnd);
    const _t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncremental WASM parse finished in ${Math.round(_t1 - _t0)}ms -> newAstRoot=${newAstRoot}`,
    );

    if (this.astListeners && this.astListeners.length > 0) {
      for (const listener of this.astListeners) {
        this.walkAstDiff(prevAstRoot, newAstRoot, listener);
      }
    }
    const _t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncremental diff finished in ${Math.round(_t2 - _t1)}ms (total ${Math.round(_t2 - _t0)}ms)`,
    );

    const isCatastrophic = this.exports.lsp_isCatastrophicError ? this.exports.lsp_isCatastrophicError() : false;
    if (isCatastrophic) {
      this.lastAstRoot = 0;
      if (uri) this.setDocumentRoot(uri, 0);
    } else {
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
    }

    // Trigger 2: Check memory quota after parse
    this.checkMemoryQuota();
    // Trigger 1: Schedule idle compaction
    this.scheduleCompaction(false);

    return newAstRoot;
  }

  private _hasTopLevelErrors(astRoot: number): boolean {
    if (astRoot === 0) return false;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const rootW0 = mem32[astRoot >>> 2];
    const rootFlags = (rootW0 >>> 10) & 0x0fff;
    if ((rootFlags & (128 | 256)) !== 0) return true;

    let childPtr = mem32[(astRoot + 12) >>> 2];
    while (childPtr !== 0) {
      const cFlags = (mem32[childPtr >>> 2] >>> 10) & 0x0fff;
      if ((cFlags & (128 | 256)) !== 0) return true;
      childPtr = mem32[(childPtr + 16) >>> 2];
    }
    return false;
  }

  /**
   * Applies a batch of incremental edits to the WASM memory buffer, coalescing the bounding box
   * and triggering a single reparse to minimize overhead.
   */
  parseIncrementalBatch(
    edits: { text: string; rangeOffset: number; rangeLength: number }[],
    newTotalLength: number,
    uri?: string,
  ): number {
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    if (!this.exports.parse || !getInputBuf) return 0;
    if (!edits || edits.length === 0) return this.getDocumentRoot(uri);

    this._cachedLineStarts = null;
    this._childTailCache.clear();

    // First, compute the bounding box of all edits in original coordinates
    let minOrigStart = Infinity;
    let maxOrigEnd = -Infinity;
    let netDelta = 0;

    for (const edit of edits) {
      const origStart = edit.rangeOffset;
      const origEnd = edit.rangeOffset + edit.rangeLength;
      if (origStart < minOrigStart) minOrigStart = origStart;
      if (origEnd > maxOrigEnd) maxOrigEnd = origEnd;
      netDelta += edit.text.length - edit.rangeLength;
    }
    if (minOrigStart === Infinity) minOrigStart = 0;

    const oldTotalLength = this.currentInputLength > 0 ? this.currentInputLength : newTotalLength - netDelta;

    const prevAstRoot = this.getDocumentRoot(uri);

    if (newTotalLength <= 0) {
      if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
      if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(0);
      const newAstRoot = this.exports.parse(0, 0, 0, 0);
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
      if (this.astListeners && this.astListeners.length > 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(prevAstRoot, newAstRoot, listener);
        }
      }
      this.scheduleCompaction(false);
      this._cachedLineStarts = new Uint32Array([0]);
      this.currentInputLength = 0;
      return newAstRoot;
    }

    if (this.exports.abortSuspend) this.exports.abortSuspend();
    const lenBytes = newTotalLength * 2;
    const oldTextPtr = this.exports.getInputBuffer();

    let oldSnapshot: Uint16Array | null = null;
    if (oldTotalLength > 0) {
      const oldView = new Uint16Array(this.wasmMemory.buffer, oldTextPtr, oldTotalLength);
      oldSnapshot = new Uint16Array(oldTotalLength);
      oldSnapshot.set(oldView);
    }

    const maxLen = Math.max(oldTotalLength, newTotalLength);
    const lenBytesAlloc = maxLen * 2;
    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytesAlloc) : oldTextPtr;
    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, maxLen);

    if (oldTextPtr !== textPtr && oldSnapshot) {
      const safeCopyLen = Math.min(oldSnapshot.length, memArray16.length);
      memArray16.set(oldSnapshot.subarray(0, safeCopyLen));
    }

    console.log(
      `[Bindings] parseIncrementalBatch START: ${edits.length} edits, netDelta=${netDelta}, oldLen=${oldTotalLength}, newLen=${newTotalLength}, prevRoot=${prevAstRoot}`,
    );
    let currentLen = oldTotalLength;
    for (const edit of edits) {
      if (edit.text.length !== edit.rangeLength) {
        const sourceIndex = edit.rangeOffset + edit.rangeLength;
        const targetIndex = edit.rangeOffset + edit.text.length;
        const count = currentLen - sourceIndex;
        if (count > 0) {
          memArray16.copyWithin(targetIndex, sourceIndex, sourceIndex + count);
        }
      }
      for (let i = 0; i < edit.text.length; i++) {
        memArray16[edit.rangeOffset + i] = edit.text.charCodeAt(i);
      }
      currentLen = currentLen - edit.rangeLength + edit.text.length;
    }
    if (newTotalLength < maxLen) {
      memArray16.fill(0, newTotalLength, maxLen);
    }
    this._cachedLineStarts = null;

    this.currentInputLength = newTotalLength;

    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    const maxNewEnd = maxOrigEnd + netDelta;

    let editStartByte = minOrigStart * 2;
    let editOldEndByte = maxOrigEnd * 2;
    let editNewEndByte = maxNewEnd * 2;

    let baseRoot = prevAstRoot;
    if (baseRoot === 0 || (editStartByte === 0 && editOldEndByte === 0 && editNewEndByte === 0)) {
      baseRoot = 0;
      editStartByte = 0;
      editOldEndByte = 0;
      editNewEndByte = 0;
    }

    const _t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const newAstRoot = this.exports.parse(baseRoot, editStartByte, editOldEndByte, editNewEndByte);
    const _t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncrementalBatch WASM parse finished in ${Math.round(_t1 - _t0)}ms -> newAstRoot=${newAstRoot}`,
    );

    if (this.astListeners && this.astListeners.length > 0) {
      for (const listener of this.astListeners) {
        this.walkAstDiff(prevAstRoot, newAstRoot, listener);
      }
    }
    const _t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncrementalBatch diff finished in ${Math.round(_t2 - _t1)}ms (total ${Math.round(_t2 - _t0)}ms)`,
    );

    const isCatastrophic = this.exports.lsp_isCatastrophicError ? this.exports.lsp_isCatastrophicError() : false;
    if (isCatastrophic) {
      this.lastAstRoot = 0;
      if (uri) this.setDocumentRoot(uri, 0);
    } else {
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
    }

    this.checkMemoryQuota();
    this.scheduleCompaction(false);

    return newAstRoot;
  }

  /**
   * Incrementally patches the lineStarts array after an edit.
   * Instead of rescanning the entire buffer (O(N)), this:
   * 1. Keeps line starts before the edit unchanged
   * 2. Removes line starts within the deleted range
   * 3. Inserts new line starts for newlines in the inserted text
   * 4. Shifts line starts after the edit by the byte delta
   * Complexity: O(edit_size + affected_lines), typically O(1) for single-char edits.
   */
  private _updateLineStarts(
    old: Uint32Array,
    rangeOffset: number,
    rangeLength: number,
    changeText: string,
  ): Uint32Array {
    const editStartByte = rangeOffset * 2;
    const editOldEndByte = (rangeOffset + rangeLength) * 2;
    const editNewEndByte = (rangeOffset + changeText.length) * 2;
    const delta = editNewEndByte - editOldEndByte;

    // Find two split points in the old lineStarts array:
    // prefixEnd:  first index where old[i] > editStartByte (entries IN or AFTER the edit zone)
    // suffixStart: first index where old[i] > editOldEndByte (entries AFTER the deleted range)
    //
    // Entries [0, prefixEnd) are unchanged (before the edit).
    // Entries [prefixEnd, suffixStart) are removed (inside the deleted range).
    // Entries [suffixStart, old.length) are shifted by delta (after the edit).
    let prefixEnd = old.length;
    let suffixStart = old.length;

    for (let i = 0; i < old.length; i++) {
      if (old[i] > editStartByte && prefixEnd === old.length) {
        prefixEnd = i;
      }
      if (old[i] > editOldEndByte) {
        suffixStart = i;
        break;
      }
    }

    // If all entries are <= editStartByte, prefixEnd stays at old.length
    // and suffixStart stays at old.length (nothing to remove or shift).
    // Ensure prefixEnd <= suffixStart.
    if (prefixEnd > suffixStart) prefixEnd = suffixStart;

    // Count new newlines in changeText
    const newLineStarts: number[] = [];
    for (let i = 0; i < changeText.length; i++) {
      const c = changeText.charCodeAt(i);
      if (c === 13) {
        if (i + 1 < changeText.length && changeText.charCodeAt(i + 1) === 10) {
          newLineStarts.push((rangeOffset + i + 2) * 2);
          i++; // Skip LF
        } else {
          newLineStarts.push((rangeOffset + i + 1) * 2);
        }
      } else if (c === 10 || c === 0x2028 || c === 0x2029) {
        newLineStarts.push((rangeOffset + i + 1) * 2);
      }
    }

    // Build the new array:
    // [0..prefixEnd) unchanged + newLineStarts + [suffixStart..end) shifted by delta
    const beforeCount = prefixEnd;
    const afterCount = old.length - suffixStart;
    const result = new Uint32Array(beforeCount + newLineStarts.length + afterCount);

    // Copy unchanged prefix
    for (let i = 0; i < beforeCount; i++) {
      result[i] = old[i];
    }

    // Insert new line starts from the inserted text
    for (let i = 0; i < newLineStarts.length; i++) {
      result[beforeCount + i] = newLineStarts[i];
    }

    // Copy and shift suffix
    const writeStart = beforeCount + newLineStarts.length;
    for (let i = 0; i < afterCount; i++) {
      result[writeStart + i] = old[suffixStart + i] + delta;
    }

    return result;
  }

  /**
   * Scans the current WASM input buffer and calculates all line start byte offsets.
   * This is cached and only recalculated when the cache is invalidated by edits.
   * Note: The offsets are stored in UTF-16 bytes (i.e. charIndex * 2) to match
   * the WASM AST's byte offset ranges.
   */
  public getLineStarts(): Uint32Array {
    if (this._cachedLineStarts) return this._cachedLineStarts;

    const encoding = this.getInputEncoding();

    let lenBytes = this.currentInputLength;
    if (encoding === 1) lenBytes *= 2;
    else if (encoding === 2) lenBytes *= 4;

    if (this.currentInputLength === 0) {
      lenBytes = this.exports.inputLength?.value ?? this.exports.inputLength ?? 0;
    }

    const starts: number[] = [0];

    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    const inputBufPtr = getInputBuf ? getInputBuf() : 0;

    if (encoding === 0) {
      const lenChars = lenBytes;
      const textBuffer = new Uint8Array(this.wasmMemory.buffer, inputBufPtr, lenChars);
      for (let i = 0; i < lenChars; i++) {
        const c = textBuffer[i];
        if (c === 13) {
          if (i + 1 < lenChars && textBuffer[i + 1] === 10) {
            starts.push(i + 2);
            i++;
          } else {
            starts.push(i + 1);
          }
        } else if (c === 10) {
          starts.push(i + 1);
        }
      }
    } else {
      const lenChars = lenBytes / 2;
      const textBuffer = new Uint16Array(this.wasmMemory.buffer, inputBufPtr, lenChars);
      for (let i = 0; i < lenChars; i++) {
        const c = textBuffer[i];
        if (c === 13) {
          if (i + 1 < lenChars && textBuffer[i + 1] === 10) {
            starts.push((i + 2) * 2);
            i++;
          } else {
            starts.push((i + 1) * 2);
          }
        } else if (c === 10 || c === 0x2028 || c === 0x2029) {
          starts.push((i + 1) * 2);
        }
      }
    }

    const lineStarts = new Uint32Array(starts);
    this._cachedLineStarts = lineStarts;
    return lineStarts;
  }

  /**
   * Performs a binary search on the cached line starts to map a linear byte offset
   * to a line and character position (LSP format).
   */
  private offsetToPos(offset: number, lineStarts: Uint32Array): Position {
    let low = 0;
    let high = lineStarts.length - 1;
    let line = 0;
    while (low <= high) {
      let mid = (low + high) >> 1;
      if (lineStarts[mid] <= offset) {
        line = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const encoding = this.getInputEncoding();
    const charDiv = encoding === 1 ? 2 : 1;
    const charOffset = Math.floor((offset - lineStarts[line]) / charDiv);
    return { line, character: charOffset };
  }

  /**
   * Retrieves syntax and semantic diagnostics from the WASM parser.
   *
   * This bridges the gap between the compact struct-of-arrays representation
   * returned by WASM and the object-oriented LSP `Diagnostic` array.
   * Complex diagnostics with contextual formatting strings (e.g. "Expected '}' but got {0}")
   * are resolved by extracting the underlying text from the source buffer.
   */
  getDiagnostics(astRoot: number): Diagnostic[] {
    this._lastDiagBinaryLength = 0;
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getDiagnostics(astRoot);
    const diags: Diagnostic[] = [];

    if (numElements === 0 || !this.exports.lsp_getBinaryBuffer) return diags;

    const memory = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();

    // Pre-calculate all needed nodePtr offsets in a single O(N) pass
    // to prevent O(N^2) lockups caused by repeated WASM lsp_findNodeOffset calls.
    const requiredNodePtrs = new Set<number>();
    for (let i = 0; i < numElements * 7; i += 7) {
      const arg0 = memory[(dirPtr >> 2) + i + 3];
      const arg1 = memory[(dirPtr >> 2) + i + 4];
      const arg2 = memory[(dirPtr >> 2) + i + 5];
      const arg3 = memory[(dirPtr >> 2) + i + 6];
      if (arg0) requiredNodePtrs.add(arg0);
      if (arg1) requiredNodePtrs.add(arg1);
      if (arg2) requiredNodePtrs.add(arg2);
      if (arg3) requiredNodePtrs.add(arg3);
    }

    const offsetCache = new Map<number, number>();
    if (requiredNodePtrs.size > 0 && astRoot) {
      const encoding = this.getInputEncoding();
      const encStep = encoding === 1 ? 2 : 1;
      let stackPtrs = new Uint32Array(50000);
      let stackOffsets = new Uint32Array(50000);
      let stackTop = 0;

      const getNodePad = (ptr: number): number => {
        if (this.exports.lsp_getNodeLeadingPad) {
          return this.exports.lsp_getNodeLeadingPad(ptr);
        }
        if (this.exports.getNodeLeadingPad) {
          return this.exports.getNodeLeadingPad(ptr);
        }
        const typeFlags = memory[ptr / 4];
        const envHashPadding = memory[(ptr + 4) / 4];
        const rawPad = typeFlags >>> 22;
        const isFat = ((envHashPadding >>> 23) & 1) === 1;
        return isFat && this.exports.getFatPaddingPtr ? memory[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      };

      const getNodeLen = (ptr: number): number => {
        return memory[(ptr + 4) / 4] & 0x007fffff;
      };

      stackPtrs[0] = astRoot;
      stackOffsets[0] = getNodePad(astRoot);
      stackTop = 1;

      let iterations = 0;
      while (stackTop > 0 && ++iterations < 100000) {
        stackTop--;
        const current = stackPtrs[stackTop];
        const nodeStart = stackOffsets[stackTop];
        if (requiredNodePtrs.has(current)) {
          offsetCache.set(current, nodeStart);
          requiredNodePtrs.delete(current);
          if (requiredNodePtrs.size === 0) break;
        }

        const child = memory[(current + 12) / 4];
        if (child !== 0) {
          let childCount = 0;
          let c = child;
          while (c !== 0 && childCount < 5000) {
            childCount++;
            c = memory[(c + 16) / 4];
          }

          if (stackTop + childCount < 50000) {
            let currOffset = nodeStart;
            let consumedInParent = 0;
            let idx = 0;
            c = child;
            while (c !== 0 && idx < childCount) {
              const cPad = getNodePad(c);
              const cLen = getNodeLen(c);
              if (idx > 0) {
                currOffset += cPad;
              }
              const childStart = currOffset;
              const slot = stackTop + (childCount - 1 - idx);
              stackPtrs[slot] = c;
              stackOffsets[slot] = childStart;
              currOffset = childStart + cLen;
              consumedInParent += cLen;
              idx++;
              c = memory[(c + 16) / 4];
            }
            stackTop += childCount;
          }
        }
      }
    }

    for (let i = 0; i < numElements * 7; i += 7) {
      let startByte = memory[(dirPtr >> 2) + i];
      let endByte = memory[(dirPtr >> 2) + i + 1];
      const lintId = memory[(dirPtr >> 2) + i + 2];
      const arg0 = memory[(dirPtr >> 2) + i + 3];
      const arg1 = memory[(dirPtr >> 2) + i + 4];
      const arg2 = memory[(dirPtr >> 2) + i + 5];
      const arg3 = memory[(dirPtr >> 2) + i + 6];

      if (arg0 > 0 && offsetCache.has(arg0)) {
        startByte = offsetCache.get(arg0)!;
        const nodeLen = memory[(arg0 + 4) / 4] & 0x007fffff;
        endByte = startByte + (nodeLen > 0 ? nodeLen : this.getInputEncoding() === 1 ? 2 : 1);
      }

      const rawLintId = lintId & 0x7fff;
      let msg = lintId > 0 && lintId < 0x8000 ? `Linter Rule ${lintId}` : "Syntax Error";
      let severity = lintId > 0 && lintId < 0x8000 ? 2 : 1; // 1 = Error (Syntax), 2 = Warning (Linter)
      let codeStr: number | string | undefined = lintId > 0 && lintId < 0x8000 ? lintId : undefined;

      if (rawLintId === 0) {
        if (arg0 === 1 && arg1 > 0) {
          let symName = (this.syntaxNames && this.syntaxNames[arg1]) || `token_${arg1}`;
          if (symName.startsWith("T_")) symName = symName.substring(2);
          if (symName.startsWith('"') && symName.endsWith('"')) {
            symName = symName.substring(1, symName.length - 1);
          }
          msg = `Syntax Error: Missing '${symName}'`;
        }
      }

      if (rawLintId > 0) {
        const key = LINT_MESSAGES[lintId.toString()]
          ? lintId.toString()
          : LINT_MESSAGES[rawLintId.toString()]
            ? rawLintId.toString()
            : null;
        if (lintId < 0x8000 && key !== null) {
          if (LINT_SEVERITIES[key]) {
            severity = LINT_SEVERITIES[key];
          }
          let msgVal = LINT_MESSAGES[key];
          if (typeof msgVal === "function") {
            const lenBytes = this.exports.inputLength
              ? typeof this.exports.inputLength.value === "number"
                ? this.exports.inputLength.value
                : Number(this.exports.inputLength) || 0
              : 0;
            const inputBufPtr = this.exports.getInputBuffer
              ? this.exports.getInputBuffer()
              : this.exports.lsp_getInputBuffer
                ? this.exports.lsp_getInputBuffer()
                : 0;
            let chars = "";
            if (inputBufPtr > 0 && startByte < lenBytes && endByte <= lenBytes && startByte <= endByte) {
              const sliceLen = endByte - startByte;
              const slice = new Uint8Array(sliceLen);
              slice.set(new Uint8Array(this.wasmMemory.buffer, inputBufPtr + startByte, sliceLen));
              const encoding = this.getInputEncoding();
              if (encoding === 1) {
                chars = new TextDecoder("utf-16le").decode(slice);
              } else {
                chars = new TextDecoder("utf-8").decode(slice);
              }
            }

            const createContext = (nodePtr: number, fallbackText: string) => {
              let syntaxNode: SyntaxNode | null = null;
              let text = fallbackText;

              const isAlignedAddress = nodePtr > 0 && nodePtr % 4 === 0 && nodePtr / 4 < memory.length - 4;
              if (isAlignedAddress && this.exports.getChildByFieldId) {
                const typeFlags = memory[nodePtr / 4];
                const typeId = typeFlags & 0x03ff;
                const pad = typeFlags >>> 22;
                const len = memory[(nodePtr + 4) / 4] & 0x007fffff;
                let actualStart = -1;
                if (offsetCache.has(nodePtr)) {
                  actualStart = offsetCache.get(nodePtr)!;
                } else if (this.exports.lsp_findNodeOffset) {
                  try {
                    const offset = this.exports.lsp_findNodeOffset(astRoot, nodePtr);
                    memory = new Uint32Array(this.wasmMemory.buffer);
                    if (offset >= 0) actualStart = offset;
                  } catch (_e) {
                    // Safe fallback if pointer is not in active tree
                  }
                }

                if (actualStart >= 0) {
                  const dummyTree = {
                    sourceCode: {
                      substring: (start: number, end: number) => {
                        const currentBuf = this.wasmMemory.buffer;
                        const inputPtr = this.exports.getInputBuffer
                          ? this.exports.getInputBuffer()
                          : this.exports.lsp_getInputBuffer
                            ? this.exports.lsp_getInputBuffer()
                            : 0;
                        const totalLenBytes = this.exports.inputLength
                          ? typeof this.exports.inputLength.value === "number"
                            ? this.exports.inputLength.value
                            : Number(this.exports.inputLength) || 0
                          : 0;
                        const totalLenChars = Math.floor(totalLenBytes / 2);
                        if (inputPtr > 0 && start >= 0 && end <= totalLenChars && start <= end) {
                          const byteLen = (end - start) * 2;
                          const u8 = new Uint8Array(byteLen);
                          u8.set(new Uint8Array(currentBuf, inputPtr + start * 2, byteLen));
                          return new TextDecoder("utf-16le").decode(u8);
                        }
                        return "";
                      },
                    },
                    mem32: memory,
                    offsetToPoint: (o: number) => this.offsetToPos(o, lineStarts),
                    facade: this,
                  };
                  syntaxNode = new SyntaxNode(dummyTree as any, nodePtr, actualStart, null, pad, len, typeId);
                  text = dummyTree.sourceCode.substring(syntaxNode.startIndex, syntaxNode.endIndex);
                }
              }

              const isAstNode = syntaxNode !== null;
              const nodeText = isAstNode ? text : fallbackText !== "" ? fallbackText : String(nodePtr);

              return new Proxy(
                {},
                {
                  get: (target, prop: string | symbol) => {
                    if (prop === "text") return nodeText;
                    if (prop === "field") return (name: string) => (syntaxNode ? syntaxNode.childText(name) : "");
                    if (prop === "asNumber") return () => Number(nodePtr);
                    if (prop === "asSymbol") return () => this.getStringFromPool(nodePtr) || String(nodePtr);
                    if (prop === "toString") return () => nodeText;
                    if (prop === "valueOf") return () => Number(nodePtr);
                    if (prop === "fields") {
                      return new Proxy(
                        {},
                        {
                          get: (_, fieldName: string) => (syntaxNode ? syntaxNode.childText(fieldName) : ""),
                        },
                      );
                    }
                    if (typeof prop === "symbol") {
                      if (prop === Symbol.toPrimitive) {
                        return (hint: string) => (hint === "number" ? Number(nodePtr) : nodeText);
                      }
                      return undefined;
                    }
                    if (syntaxNode) {
                      const cText = syntaxNode.childText(prop);
                      if (cText) return cText;
                    }
                    return "";
                  },
                },
              );
            };

            const ctxTarget = createContext(arg0, chars);
            const ctx1 = createContext(arg1, "");
            const ctx2 = createContext(arg2, "");
            const ctx3 = createContext(arg3, "");

            msg = (msgVal as any)(ctxTarget, ctx1, ctx2, ctx3);
          } else {
            msg = msgVal;
          }

          if (LINT_CODES[lintId.toString()] !== undefined) {
            codeStr = LINT_CODES[lintId.toString()];
          }
        } else if (rawLintId < 1000 && this.syntaxNames && rawLintId < this.syntaxNames.length) {
          let name = this.syntaxNames[rawLintId];
          if (name && name.startsWith('"') && name.endsWith('"')) {
            name = name.slice(1, -1);
          }
          msg = `Expected '${name}'`;
          severity = 1; // Syntax parse error (Expected Token) is Error = 1 (Red Squiggle)
          codeStr = undefined;
        }
      }

      if (typeof msg === "string") {
        // Range shifting and clamping removed to preserve WASM output
      }

      if (endByte <= startByte) {
        endByte = startByte + (this.getInputEncoding() === 1 ? 2 : 1);
      }

      let startPos = this.offsetToPos(startByte, lineStarts);
      let endPos = this.offsetToPos(endByte, lineStarts);

      const encoding = this.getInputEncoding();
      const charDiv = encoding === 1 ? 2 : 1;

      // Prevent diagnostic bleed: if a diagnostic ends exactly at the start of the next line,
      // clamp it to the end of the previous line so VS Code doesn't render it under the next token.
      if (endPos.line > startPos.line && endPos.character === 0) {
        endPos = { line: endPos.line - 1, character: startPos.character + 1 };
      }

      const range = {
        start: startPos,
        end: endPos,
      };
      diags.push({
        range,
        message: msg,
        severity: severity,
        code: codeStr,
        startCharOffset: Math.floor(startByte / charDiv),
        endCharOffset: Math.floor(endByte / charDiv),
      });
    }
    // Cache the raw binary length so getAstSExpr/getAstHtml can read without re-calling
    this._lastDiagBinaryLength = numElements * 7;

    const uniqueDiags: Diagnostic[] = [];
    const seenDiags = new Set<string>();

    for (const d of diags) {
      const key = `${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}:${d.code || d.message}`;
      if (!seenDiags.has(key)) {
        seenDiags.add(key);
        uniqueDiags.push(d);
      }
    }

    uniqueDiags.sort((a, b) => {
      if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
      return a.range.start.character - b.range.start.character;
    });

    const mergedDiags: Diagnostic[] = [];
    for (const d of uniqueDiags) {
      if (mergedDiags.length > 0) {
        const prev = mergedDiags[mergedDiags.length - 1];
        const isStartSameLine = prev.range.start.line === d.range.start.line;
        const isOverlapping =
          (prev.endCharOffset !== undefined &&
            d.startCharOffset !== undefined &&
            (d.startCharOffset <= prev.endCharOffset ||
              (isStartSameLine && d.startCharOffset <= prev.endCharOffset + 1))) ||
          (isStartSameLine && prev.range.end.character + 1 >= d.range.start.character) ||
          (prev.range.start.line <= d.range.start.line && prev.range.end.line >= d.range.start.line);

        if (isOverlapping && prev.code === undefined && d.code === undefined) {
          const prevIsSpecific =
            prev.message.startsWith("Expected ") || prev.message.startsWith("Syntax Error: Missing ");
          const dIsSpecific = d.message.startsWith("Expected ") || d.message.startsWith("Syntax Error: Missing ");
          const prevIsGeneric = prev.message === "Syntax Error";
          const dIsGeneric = d.message === "Syntax Error";

          if (prevIsGeneric && dIsSpecific) {
            // Replace generic error with more specific error
            mergedDiags[mergedDiags.length - 1] = d;
            continue;
          } else if (prevIsSpecific && dIsGeneric) {
            // Keep specific error, skip generic
            continue;
          } else if (prevIsGeneric && dIsGeneric) {
            // Merge two adjacent generic syntax errors
            if (d.range.end.character > prev.range.end.character) {
              prev.range.end = d.range.end;
            }
            if (prev.endCharOffset !== undefined && d.endCharOffset !== undefined) {
              prev.endCharOffset = Math.max(prev.endCharOffset, d.endCharOffset);
            }
            continue;
          }
        }
      }
      mergedDiags.push(d);
    }

    return mergedDiags;
  }

  /**
   * Retrieves semantic tokens for syntax highlighting.
   * Returns a raw `Uint32Array` mapped directly from WASM memory for speed.
   * Array layout is: [lineDelta, charDelta, length, typeId] repeating.
   */
  getSemanticTokens(astRoot: number): Uint32Array {
    if (!this.exports.lsp_semanticTokens_full || !this.exports.lsp_getBinaryBuffer) return new Uint32Array();
    const numElements = this.exports.lsp_semanticTokens_full(astRoot);
    if (numElements === 0) return new Uint32Array();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const result = new Uint32Array(numElements * 4);
    result.set(mem32.subarray(dirPtr >>> 2, (dirPtr >>> 2) + numElements * 4));
    return result;
  }

  /** Retrieves a list of collapsable folding ranges from the parsed syntax tree. */
  getFoldingRanges(astRoot: number): { start: Position; end: Position }[] {
    if (!this.exports.lsp_getFoldingRanges || !this.exports.lsp_getBinaryBuffer) return [];
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getFoldingRanges(astRoot);
    const ranges: { start: Position; end: Position }[] = [];
    if (numElements === 0) return ranges;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 2; i += 2) {
      ranges.push({
        start: this.offsetToPos(mem32[(dirPtr >> 2) + i], lineStarts),
        end: this.offsetToPos(mem32[(dirPtr >> 2) + i + 1], lineStarts),
      });
    }
    return ranges;
  }

  /** Extracts document symbols (e.g. classes, functions) for the document outline view. */
  getDocumentSymbols(astRoot: number): { start: Position; end: Position; typeId: number; nodePtr: number }[] {
    if (!this.exports.lsp_getDocumentSymbols || !this.exports.lsp_getBinaryBuffer) return [];
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getDocumentSymbols(astRoot);
    const symbols: { start: Position; end: Position; typeId: number; nodePtr: number }[] = [];
    if (numElements === 0) return symbols;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 4; i += 4) {
      symbols.push({
        start: this.offsetToPos(mem32[(dirPtr >>> 2) + i], lineStarts),
        end: this.offsetToPos(mem32[(dirPtr >>> 2) + i + 1], lineStarts),
        typeId: mem32[(dirPtr >>> 2) + i + 2],
        nodePtr: mem32[(dirPtr >>> 2) + i + 3],
      });
    }
    return symbols;
  }

  /** Locates the definition of the symbol at the given byte offset. */
  getDefinition(astRoot: number, targetOffset: number): { fileId: number; start: number; end: number } | null {
    if (!this.exports.lsp_getDefinition || !this.exports.lsp_getBinaryBuffer) return null;
    const numElements = this.exports.lsp_getDefinition(astRoot, targetOffset);
    if (numElements < 2) return null;

    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();

    if (numElements >= 3) {
      return {
        fileId: mem32[(dirPtr >>> 2) + 0],
        start: mem32[(dirPtr >>> 2) + 1],
        end: mem32[(dirPtr >>> 2) + 2],
      };
    }
    return {
      fileId: 0,
      start: mem32[(dirPtr >>> 2) + 0],
      end: mem32[(dirPtr >>> 2) + 1],
    };
  }

  /** Locates all references to the symbol at the given byte offset across registered workspace files. */
  getReferences(astRoot: number, targetOffset: number): { fileId: number; start: number; end: number }[] {
    if (!this.exports.lsp_getReferences || !this.exports.lsp_getBinaryBuffer) return [];
    const numElements = this.exports.lsp_getReferences(astRoot, targetOffset);
    const references: { fileId: number; start: number; end: number }[] = [];
    if (numElements === 0) return references;

    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 3; i += 3) {
      references.push({
        fileId: mem32[(dirPtr >>> 2) + i],
        start: mem32[(dirPtr >>> 2) + i + 1],
        end: mem32[(dirPtr >>> 2) + i + 2],
      });
    }
    return references;
  }

  /** Extracts 2D diagram nodes, ports, spatial positions, and edges for visual modeling. */
  getDiagramData(astRoot: number, projectionId: number = 0): { nodes: any[]; edges: any[] } {
    const nodes: any[] = [];
    const edges: any[] = [];
    if (!this.exports.lsp_getDiagramData || !this.exports.lsp_getBinaryBuffer) {
      return { nodes, edges };
    }

    const numRecords = this.exports.lsp_getDiagramData(astRoot);
    if (numRecords === 0) return { nodes, edges };

    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const lineStarts = this.getLineStarts();

    const inputBufPtr = this.exports.getInputBuffer
      ? this.exports.getInputBuffer()
      : this.exports.lsp_getInputBuffer
        ? this.exports.lsp_getInputBuffer()
        : 0;
    const lenBytes = this.exports.inputLength
      ? typeof this.exports.inputLength.value === "number"
        ? this.exports.inputLength.value
        : Number(this.exports.inputLength) || 0
      : 0;
    const textBuffer =
      inputBufPtr > 0 && lenBytes > 0 ? new Uint8Array(this.wasmMemory.buffer, inputBufPtr, lenBytes) : null;
    const isUtf16 = this.getInputEncoding ? this.getInputEncoding() === 1 : false;
    const decoder = isUtf16 ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");

    let offset = dirPtr >>> 2;
    for (let i = 0; i < numRecords; i++) {
      const kind = mem32[offset];
      if (kind === 1) {
        // RECORD_NODE
        const nodePtr = mem32[offset + 1];
        const typeId = mem32[offset + 2];
        const startByte = mem32[offset + 3];
        const endByte = mem32[offset + 4];
        const x = mem32[offset + 5] | 0;
        const y = mem32[offset + 6] | 0;
        const width = mem32[offset + 7];
        const height = mem32[offset + 8];
        const rotation = mem32[offset + 9] | 0;
        const flags = mem32[offset + 12];

        let nodeText = "";
        if (inputBufPtr > 0 && lenBytes > 0 && startByte < lenBytes && endByte <= lenBytes && startByte <= endByte) {
          try {
            const sliceLen = endByte - startByte;
            const slice = new Uint8Array(sliceLen);
            slice.set(new Uint8Array(this.wasmMemory.buffer, inputBufPtr + startByte, sliceLen));
            nodeText = decoder.decode(slice);
          } catch (e) {}
        }

        nodes.push({
          id: `node_${nodePtr}`,
          nodePtr,
          typeId,
          startByte,
          endByte,
          start: this.offsetToPos(startByte, lineStarts),
          end: this.offsetToPos(endByte, lineStarts),
          x,
          y,
          width,
          height,
          rotation,
          flags,
          text: nodeText,
        });
        offset += 13;
      } else if (kind === 2) {
        // RECORD_EDGE
        const edgePtr = mem32[offset + 1];
        const typeId = mem32[offset + 2];
        const srcNodePtr = mem32[offset + 3];
        const tgtNodePtr = mem32[offset + 4];
        edges.push({
          id: `edge_${edgePtr}`,
          edgePtr,
          typeId,
          source: `node_${srcNodePtr}`,
          target: `node_${tgtNodePtr}`,
        });
        offset += 10;
      } else {
        offset += 4;
      }
    }

    return { nodes, edges };
  }

  /** Applies visual diagram actions directly to the Arena AST and returns updated document text. */
  applyDiagramEdits(actions: any[]): { text: string; edits: any[] } {
    if (!this.exports.lsp_applyDiagramEdits || actions.length === 0) {
      return { text: "", edits: [] };
    }

    const actionBufferBytes = actions.length * 32;
    const actionPtr = this.allocMem(actionBufferBytes);
    if (actionPtr === 0) return { text: "", edits: [] };

    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = actionPtr >>> 2;

    for (const action of actions) {
      if (action.type === "move" || action.type === "resize") {
        mem32[offset + 0] = action.type === "move" ? 1 : 2;
        mem32[offset + 1] = action.nodePtr || 0;
        mem32[offset + 2] = (action.x || 0) | 0;
        mem32[offset + 3] = (action.y || 0) | 0;
        mem32[offset + 4] = (action.width || 100) >>> 0;
        mem32[offset + 5] = (action.height || 60) >>> 0;
        mem32[offset + 6] = (action.rotation || 0) | 0;
        offset += 7;
      } else if (action.type === "delete") {
        mem32[offset + 0] = 3;
        mem32[offset + 1] = action.nodePtr || 0;
        offset += 2;
      } else if (action.type === "connect") {
        mem32[offset + 0] = 4;
        mem32[offset + 1] = action.srcNodePtr || 0;
        mem32[offset + 2] = action.tgtNodePtr || 0;
        offset += 7;
      }
    }

    const updatedLen = this.exports.lsp_applyDiagramEdits(actionPtr, actions.length);
    let updatedText = "";
    if (updatedLen > 0 && this.exports.lsp_getBinaryBuffer) {
      const dirPtr = this.exports.lsp_getBinaryBuffer();
      const mem8 = new Uint8Array(updatedLen);
      mem8.set(new Uint8Array(this.wasmMemory.buffer, dirPtr, updatedLen));
      const isUtf16 = this.getInputEncoding ? this.getInputEncoding() === 1 : false;
      const decoder = isUtf16 ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");
      updatedText = decoder.decode(mem8);
    }

    return { text: updatedText, edits: [] };
  }

  /** Returns current allocated heap bytes in the WASM linear memory arena. */
  getMemoryUsage(): number {
    return this.exports.arena_getMemoryUsage ? this.exports.arena_getMemoryUsage() : 0;
  }

  /** Registers a document AST root for multi-file workspace LSP operations. */
  registerDocument(fileId: number, astRoot: number): void {
    if (this.exports.lsp_registerDocument) {
      this.exports.lsp_registerDocument(fileId, astRoot);
    }
  }

  /** Unregisters a document AST root. */
  unregisterDocument(fileId: number): void {
    if (this.exports.lsp_unregisterDocument) {
      this.exports.lsp_unregisterDocument(fileId);
    }
  }

  /** Clears all registered multi-file document AST roots. */
  clearDocuments(): void {
    if (this.exports.lsp_clearDocuments) {
      this.exports.lsp_clearDocuments();
    }
  }

  /** Evicts a document's full AST from the Tier 2 arena while preserving Tier 1 stubs. */
  evictDocumentAst(fileId: number): void {
    if (this.exports.lsp_evictDocumentAst) {
      this.exports.lsp_evictDocumentAst(fileId);
    }
  }

  /** Hashes a string using FNV-1a algorithm matching WASM string hash. */
  hashString(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; ) {
      const cp = str.codePointAt(i)!;
      h = Math.imul(h ^ cp, 16777619) >>> 0;
      i += cp > 0xffff ? 2 : 1;
    }
    return h;
  }

  allocMem(bytes: number): number {
    const fn = this.exports.arena_alloc || this.exports.atomicChunkAlloc;
    return fn ? fn(bytes) : 0;
  }

  allocStringInArena(str: string): number {
    if (!str || !this.exports.arena_allocStringBytes) return 0;
    const lenBytes = str.length * 2;
    const ptr = this.allocMem(lenBytes);
    if (ptr === 0) return 0;
    const memBuffer = this.wasmMemory
      ? this.wasmMemory.buffer
      : this.exports.memory
        ? this.exports.memory.buffer
        : null;
    if (!memBuffer) return 0;
    const mem16 = new Uint16Array(memBuffer);
    const startIdx = ptr >>> 1;
    for (let i = 0; i < str.length; i++) {
      mem16[startIdx + i] = str.charCodeAt(i);
    }
    return this.exports.arena_allocStringBytes(ptr, lenBytes);
  }

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
    merkleLow: number = 0,
    merkleHigh: number = 0,
    parentFqn: string = "",
  ): number {
    if (!this.exports.stub_registerSymbol) return 0;
    const nameHash = this.hashString(name);
    const nameHandle = this.allocStringInArena(name);
    const parentFqnHash = parentFqn ? this.hashString(parentFqn) : 0;
    return this.exports.stub_registerSymbol(
      fileId,
      symbolId,
      parentSymbolId,
      kind,
      flags,
      nameHash,
      nameHandle,
      startByte,
      endByte,
      merkleLow,
      merkleHigh,
      parentFqnHash,
    );
  }

  /** Registers an enclosing parent FQN for a given fileId. */
  registerFileParentFQN(fileId: number, parentFQN: string): void {
    if (!this.exports.stub_registerFileWithParentFQN) return;
    const parentFqnHash = this.hashString(parentFQN);
    this.exports.stub_registerFileWithParentFQN(fileId, parentFqnHash);
  }

  /** Binds an FQN string to a specific stub ID. */
  bindFqnStub(fqn: string, stubId: number): void {
    if (!this.exports.stub_bindFqnStub) return;
    const fqnHash = this.hashString(fqn);
    this.exports.stub_bindFqnStub(fqnHash, stubId);
  }

  /** Stitches a child stub to its parent package using the parent FQN string. */
  stitchParentFQN(childStubId: number, parentFQN: string): number {
    if (!this.exports.stub_stitchParentFQN) return 0;
    const parentFqnHash = this.hashString(parentFQN);
    return this.exports.stub_stitchParentFQN(childStubId, parentFqnHash);
  }

  /** Clears all Tier 1 stubs for a specific fileId or all files if fileId === 0. */
  clearFileStubs(fileId: number = 0): void {
    if (fileId === 0 && this.exports.stub_clearAll) {
      this.exports.stub_clearAll();
    } else if (this.exports.stub_clearFile) {
      this.exports.stub_clearFile(fileId);
    }
  }

  /** Alias for clearFileStubs. */
  clearStubs(fileId: number = 0): void {
    this.clearFileStubs(fileId);
  }

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
  }[] {
    if (!this.exports.stub_findByName || !this.exports.stub_getBinaryBuffer) return [];
    const hash = this.hashString(name);
    const numStubs = this.exports.stub_findByName(hash);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results;
  }

  /** Finds all stub symbols matching a name string using WASM SIMD 128-bit vector search. */
  findStubsByNameSIMD(
    name: string,
    preferredFileId: number = 0,
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
  }[] {
    if (!this.exports.stub_findByNameHashSIMD || !this.exports.stub_getBinaryBuffer) return [];
    const hash = this.hashString(name);
    const numStubs = this.exports.stub_findByNameHashSIMD(hash, preferredFileId);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results;
  }

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
  }[] {
    if (!this.exports.stub_getFileSymbols || !this.exports.stub_getBinaryBuffer) return [];
    const numStubs = this.exports.stub_getFileSymbols(fileId);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results.reverse();
  }

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
  }[] {
    if (!this.exports.stub_getChildren || !this.exports.stub_getBinaryBuffer) return [];
    const numStubs = this.exports.stub_getChildren(parentSymbolId);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results;
  }

  /** Returns total number of registered stub symbols. */
  getStubCount(): number {
    return this.exports.stub_count ? this.exports.stub_count() : 0;
  }

  /** Exports Tier 1 stub store and string arena to a Uint8Array binary snapshot. */
  exportStubBinary(): Uint8Array {
    if (!this.exports.stub_exportBinary) return new Uint8Array(0);
    const requiredSize = this.exports.stub_exportBinary(0, 0);
    if (requiredSize === 0) return new Uint8Array(0);
    const ptr = this.allocMem(requiredSize);
    if (ptr === 0) return new Uint8Array(0);
    this.exports.stub_exportBinary(ptr, requiredSize);
    const mem8 = new Uint8Array(this.wasmMemory.buffer);
    return new Uint8Array(mem8.subarray(ptr, ptr + requiredSize));
  }

  /** Imports Tier 1 stub store and string arena from a binary snapshot. */
  importStubBinary(buffer: Uint8Array): boolean {
    if (!this.exports.stub_importBinary || buffer.byteLength === 0) return false;
    const ptr = this.allocMem(buffer.byteLength);
    if (ptr === 0) return false;
    const mem8 = new Uint8Array(this.wasmMemory.buffer);
    mem8.set(buffer, ptr);
    const ok = this.exports.stub_importBinary(ptr, buffer.byteLength);
    return ok === 1;
  }

  /** Restores Tier 1 stub store from a binary snapshot and returns the restored stub count. */
  restoreStubBinary(buffer: Uint8Array): number {
    const ok = this.importStubBinary(buffer);
    return ok ? this.getStubCount() : 0;
  }

  /** Bulk registers raw uint32 stub records from worker threads. */
  bulkRegisterStubs(payload: Uint32Array): number {
    if (!this.exports.stub_bulkRegister || payload.byteLength === 0) return 0;
    const ptr = this.allocMem(payload.byteLength);
    if (ptr === 0) return 0;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    mem32.set(payload, ptr >>> 2);
    return this.exports.stub_bulkRegister(ptr, payload.length);
  }

  /** Indexes all stubs into the Dex-style trigram inverted search map. */
  indexTrigrams(): number {
    return this.exports.trigram_indexAllStubs ? this.exports.trigram_indexAllStubs() : 0;
  }

  /** Dex-style Sub-Millisecond Fuzzy Symbol Search across all indexed stubs in the workspace. */
  fuzzyFindSymbols(
    query: string,
    maxResults: number = 50,
  ): {
    stubId: number;
    fileId: number;
    kind: number;
    flags: number;
    nameHash: number;
    startByte: number;
    endByte: number;
    score: number;
  }[] {
    if (!this.exports.trigram_fuzzyFind || !this.exports.stub_getBinaryBuffer) {
      return [];
    }
    const queryHandle = this.allocStringInArena(query);
    const count = this.exports.trigram_fuzzyFind(queryHandle, maxResults);
    const dirPtr = this.exports.stub_getBinaryBuffer ? this.exports.stub_getBinaryBuffer() : 0;
    const memBuffer = this.wasmMemory
      ? this.wasmMemory.buffer
      : this.exports.memory
        ? this.exports.memory.buffer
        : null;
    if (!memBuffer) return [];
    const mem32 = new Uint32Array(memBuffer);
    const results = [];
    for (let i = 0; i < count * 7; i += 7) {
      const kf = mem32[(dirPtr >>> 2) + i + 2];
      results.push({
        stubId: mem32[(dirPtr >>> 2) + i + 0],
        fileId: mem32[(dirPtr >>> 2) + i + 1],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 3],
        startByte: mem32[(dirPtr >>> 2) + i + 4],
        endByte: mem32[(dirPtr >>> 2) + i + 5],
        score: mem32[(dirPtr >>> 2) + i + 6],
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /** Shifts byte offsets in-place across all stubs in a file after an interior edit. */
  shiftStubByteOffsets(fileId: number, fromByte: number, deltaBytes: number): number {
    if (!this.exports.stub_shiftByteOffsets) return 0;
    return this.exports.stub_shiftByteOffsets(fileId, fromByte, deltaBytes);
  }

  /** Gets or looks up an incremental Salsa 3.0 query node. */
  queryGetNode(queryType: number, arg1: number, arg2: number = 0, arg3: number = 0, arg4: number = 0): number {
    if (!this.exports.query_getNode) return 0;
    return this.exports.query_getNode(queryType, arg1, arg2, arg3, arg4);
  }

  /** Allocates a new incremental Salsa 3.0 query node. */
  queryAllocNode(queryType: number, arg1: number, arg2: number = 0, arg3: number = 0, arg4: number = 0): number {
    if (!this.exports.query_allocNode) return 0;
    return this.exports.query_allocNode(queryType, arg1, arg2, arg3, arg4);
  }

  /** Invalidates a query node and cascades dirtying to all subscribers. */
  queryInvalidate(queryNodePtr: number): void {
    if (this.exports.query_invalidate) {
      this.exports.query_invalidate(queryNodePtr);
    }
  }

  /** Gets the cached result value of a query node. */
  queryGetValue(queryNodePtr: number): number {
    return this.exports.query_getValue ? this.exports.query_getValue(queryNodePtr) : 0;
  }

  /** Sets the cached result value of a query node. */
  querySetValue(queryNodePtr: number, val: number): void {
    if (this.exports.query_setValue) {
      this.exports.query_setValue(queryNodePtr, val);
    }
  }

  /** Gets the cached revision of a query node. */
  queryGetRevision(queryNodePtr: number): number {
    return this.exports.query_getRevision ? this.exports.query_getRevision(queryNodePtr) : 0;
  }

  /** Sets the cached revision of a query node. */
  querySetRevision(queryNodePtr: number, rev: number): void {
    if (this.exports.query_setRevision) {
      this.exports.query_setRevision(queryNodePtr, rev);
    }
  }

  /** Gets the cached result Merkle low 32-bits. */
  queryGetMerkleLow(queryNodePtr: number): number {
    return this.exports.query_getMerkleLow ? this.exports.query_getMerkleLow(queryNodePtr) >>> 0 : 0;
  }

  /** Gets the cached result Merkle high 32-bits. */
  queryGetMerkleHigh(queryNodePtr: number): number {
    return this.exports.query_getMerkleHigh ? this.exports.query_getMerkleHigh(queryNodePtr) >>> 0 : 0;
  }

  /** Sets the cached result Merkle 64-bit hash. */
  querySetMerkle(queryNodePtr: number, low: number, high: number): void {
    if (this.exports.query_setMerkle) {
      this.exports.query_setMerkle(queryNodePtr, low, high);
    }
  }

  /** Establishes a directed dependency edge from parent to target query. */
  queryAddDependency(parentPtr: number, targetPtr: number): void {
    if (this.exports.query_addDependency) {
      this.exports.query_addDependency(parentPtr, targetPtr);
    }
  }

  /** Gets the global database revision counter. */
  queryGetGlobalRevision(): number {
    return this.exports.query_getGlobalRevision ? this.exports.query_getGlobalRevision() : 0;
  }

  /** Increments the global database revision counter. */
  queryIncrementRevision(): void {
    if (this.exports.query_incrementRevision) {
      this.exports.query_incrementRevision();
    }
  }

  /** Registers a negative dependency: records that a query failed because a symbol name was missing. */
  salsaRegisterNegativeDependency(queryPtr: number, name: string): void {
    if (!this.exports.salsa_registerNegativeDependency) return;
    const nameHash = this.hashString(name);
    this.exports.salsa_registerNegativeDependency(queryPtr, nameHash);
  }

  /** Invalidates queries waiting for a symbol name when that symbol is introduced. */
  salsaInvalidateNegativeDependencies(name: string): number {
    if (!this.exports.salsa_invalidateNegativeDependencies) return 0;
    const nameHash = this.hashString(name);
    return this.exports.salsa_invalidateNegativeDependencies(nameHash);
  }

  /** Performs O(1) Merkle backdating on a query result. Returns true if semantically identical. */
  salsaBackdateQuery(nodePtr: number, newMerkleLow: number, newMerkleHigh: number): boolean {
    if (!this.exports.salsa_backdateQuery) return false;
    return this.exports.salsa_backdateQuery(nodePtr, newMerkleLow, newMerkleHigh) === 1;
  }

  /** Gets the version counter for a language in the polyglot arena. */
  polyglotGetLangVersion(arenaPtr: number, langId: number): number {
    return this.exports.polyglot_getLangVersion ? this.exports.polyglot_getLangVersion(arenaPtr, langId) : 0;
  }

  /** Increments the version counter for a language in the polyglot arena. */
  polyglotIncrementLangVersion(arenaPtr: number, langId: number): number {
    return this.exports.polyglot_incrementLangVersion
      ? this.exports.polyglot_incrementLangVersion(arenaPtr, langId)
      : 0;
  }

  /** Checks if a language version has changed since snapshotVersion. */
  polyglotHasLangChanged(arenaPtr: number, langId: number, snapshotVersion: number): boolean {
    if (!this.exports.polyglot_hasLangChanged) return true;
    return this.exports.polyglot_hasLangChanged(arenaPtr, langId, snapshotVersion) === 1;
  }

  /** Adds an OWL 2 axiom to the indexed WASM ontology store. */
  addOntologyAxiom(
    axiomType: number,
    sourceLangId: number,
    subject: string,
    predicate: string = "",
    object: string = "",
    flags: number = 0,
  ): number {
    if (!this.exports.ontology_addAxiom) return 0;
    const sHash = subject ? this.hashString(subject) : 0;
    const pHash = predicate ? this.hashString(predicate) : 0;
    const oHash = object ? this.hashString(object) : 0;
    return this.exports.ontology_addAxiom(axiomType, sourceLangId, sHash, pHash, oHash, flags);
  }

  /** Evaluates transitive SubClassOf subsumption directly in WASM memory. */
  isSubClassOf(subClass: string, superClass: string): boolean {
    if (!this.exports.ontology_isSubClassOf) return false;
    const subHash = this.hashString(subClass);
    const superHash = this.hashString(superClass);
    return this.exports.ontology_isSubClassOf(subHash, superHash) === 1;
  }

  /** Evaluates if two classes are disjoint (directly or through superclasses). */
  areDisjoint(class1: string, class2: string): boolean {
    if (!this.exports.ontology_areDisjoint) return false;
    const c1Hash = this.hashString(class1);
    const c2Hash = this.hashString(class2);
    return this.exports.ontology_areDisjoint(c1Hash, c2Hash) === 1;
  }

  /** Evaluates if an individual is an instance of a class (directly or through subclass inference). */
  isInstanceOf(individual: string, className: string): boolean {
    if (!this.exports.ontology_isInstanceOf) return false;
    const indHash = this.hashString(individual);
    const clsHash = this.hashString(className);
    return this.exports.ontology_isInstanceOf(indHash, clsHash) === 1;
  }

  /** Computes the transitive closure of reachable nodes along a property from a source individual. */
  getTransitiveClosure(property: string, source: string): number[] {
    if (!this.exports.ontology_getTransitiveClosure || !this.exports.ontology_getQueryBuffer) return [];
    const pHash = property ? this.hashString(property) : 0xffffffff;
    const sHash = this.hashString(source);
    const count = this.exports.ontology_getTransitiveClosure(pHash, sHash);
    if (count === 0) return [];

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const results: number[] = [];
    for (let i = 0; i < count; i++) {
      results.push(mem32[(dirPtr >>> 2) + i]);
    }
    return results;
  }

  /** Computes the transitive closure with traversal path edges. */
  getTransitiveClosureWithPath(
    property: string,
    source: string,
  ): { reachable: number[]; path: { subject: number; object: number }[] } {
    if (!this.exports.ontology_getTransitiveClosureWithPath || !this.exports.ontology_getQueryBuffer) {
      return { reachable: [], path: [] };
    }
    const pHash = property ? this.hashString(property) : 0xffffffff;
    const sHash = this.hashString(source);
    const count = this.exports.ontology_getTransitiveClosureWithPath(pHash, sHash);
    if (count === 0) return { reachable: [], path: [] };

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = dirPtr >>> 2;

    const reachableCount = mem32[offset++];
    const reachable: number[] = [];
    for (let i = 0; i < reachableCount; i++) {
      reachable.push(mem32[offset++]);
    }

    const edgeCount = mem32[offset++];
    const path: { subject: number; object: number }[] = [];
    for (let i = 0; i < edgeCount; i++) {
      const s = mem32[offset++];
      const o = mem32[offset++];
      path.push({ subject: s, object: o });
    }

    return { reachable, path };
  }

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
  }[] {
    if (!this.exports.ontology_explainSubsumption || !this.exports.ontology_getQueryBuffer) return [];
    const subHash = this.hashString(subClass);
    const superHash = this.hashString(superClass);
    const count = this.exports.ontology_explainSubsumption(subHash, superHash);
    if (count === 0) return [];

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const results = [];

    for (let i = 0; i < count * stride; i += stride) {
      const typeAndLang = mem32[(dirPtr >>> 2) + i + 0];
      results.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[(dirPtr >>> 2) + i + 1],
        predicateHash: mem32[(dirPtr >>> 2) + i + 2],
        objectHash: mem32[(dirPtr >>> 2) + i + 3],
        flags: mem32[(dirPtr >>> 2) + i + 4],
      });
    }

    return results;
  }

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
  } {
    if (!this.exports.ontology_checkConsistency || !this.exports.ontology_getQueryBuffer) {
      return { isConsistent: true, conflictingAxioms: [] };
    }
    const count = this.exports.ontology_checkConsistency();
    if (count === 0) return { isConsistent: true, conflictingAxioms: [] };

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const conflictingAxioms = [];

    for (let i = 0; i < count * stride; i += stride) {
      const typeAndLang = mem32[(dirPtr >>> 2) + i + 0];
      conflictingAxioms.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[(dirPtr >>> 2) + i + 1],
        predicateHash: mem32[(dirPtr >>> 2) + i + 2],
        objectHash: mem32[(dirPtr >>> 2) + i + 3],
        flags: mem32[(dirPtr >>> 2) + i + 4],
      });
    }

    return {
      isConsistent: false,
      conflictingAxioms,
      explanation: `Found ${conflictingAxioms.length} disjointness violation(s) in the ontology.`,
    };
  }

  /** Classifies an individual, returning direct types and all transitive types. */
  classifyIndividual(individual: string): { directTypes: number[]; allTypes: number[] } {
    if (!this.exports.ontology_classifyIndividual || !this.exports.ontology_getQueryBuffer) {
      return { directTypes: [], allTypes: [] };
    }
    const indHash = this.hashString(individual);
    const wordCount = this.exports.ontology_classifyIndividual(indHash);
    if (wordCount === 0) return { directTypes: [], allTypes: [] };

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = dirPtr >>> 2;

    const directCount = mem32[offset++];
    const directTypes: number[] = [];
    for (let i = 0; i < directCount; i++) {
      directTypes.push(mem32[offset++]);
    }

    const allCount = mem32[offset++];
    const allTypes: number[] = [];
    for (let i = 0; i < allCount; i++) {
      allTypes.push(mem32[offset++]);
    }

    return { directTypes, allTypes };
  }

  /** Returns all taxonomy nodes from the ontology. */
  getTaxonomy(): {
    classHash: number;
    directSuperClasses: number[];
    directSubClasses: number[];
    equivalentClasses: number[];
  }[] {
    if (!this.exports.ontology_getTaxonomy || !this.exports.ontology_getQueryBuffer) return [];
    const classCount = this.exports.ontology_getTaxonomy();
    if (classCount === 0) return [];

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = dirPtr >>> 2;

    const totalClasses = mem32[offset++];
    const nodes = [];

    for (let c = 0; c < totalClasses; c++) {
      const classHash = mem32[offset++];

      const superCount = mem32[offset++];
      const directSuperClasses: number[] = [];
      for (let s = 0; s < superCount; s++) directSuperClasses.push(mem32[offset++]);

      const subCount = mem32[offset++];
      const directSubClasses: number[] = [];
      for (let s = 0; s < subCount; s++) directSubClasses.push(mem32[offset++]);

      const equivCount = mem32[offset++];
      const equivalentClasses: number[] = [];
      for (let e = 0; e < equivCount; e++) equivalentClasses.push(mem32[offset++]);

      nodes.push({
        classHash,
        directSuperClasses,
        directSubClasses,
        equivalentClasses,
      });
    }

    return nodes;
  }

  computeOntologyIntervalIndex(): void {
    if (this.exports.ontology_computeIntervalIndex) {
      this.exports.ontology_computeIntervalIndex();
    }
  }

  evaluateOntologyPropertyPath(
    propertyName: string,
    pathOp: number,
    stepPropertyName2: string,
    sourceName: string,
  ): number[] {
    if (!this.exports.ontology_evaluatePropertyPath || !this.exports.ontology_getQueryBuffer) return [];
    const pHash = propertyName ? this.hashString(propertyName) : 0;
    const p2Hash = stepPropertyName2 ? this.hashString(stepPropertyName2) : 0;
    const sHash = sourceName ? this.hashString(sourceName) : 0;

    const count = this.exports.ontology_evaluatePropertyPath(pHash, pathOp, p2Hash, sHash);
    if (count === 0) return [];

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const offset = dirPtr >>> 2;
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(mem32[offset + i]);
    }
    return result;
  }

  saturateOntologyELRules(): number {
    if (this.exports.ontology_saturateELRules) {
      return this.exports.ontology_saturateELRules();
    }
    return 0;
  }

  /** Queries indexed triples via SPO / POS / OSP pattern matching in WASM memory. */
  queryOntologyTriples(
    subjectPattern: string = "",
    predicatePattern: string = "",
    objectPattern: string = "",
  ): {
    axiomType: number;
    sourceLangId: number;
    subjectHash: number;
    predicateHash: number;
    objectHash: number;
    flags: number;
  }[] {
    if (!this.exports.ontology_queryTriples || !this.exports.ontology_getQueryBuffer) return [];
    const sPat = subjectPattern ? this.hashString(subjectPattern) : 0xffffffff;
    const pPat = predicatePattern ? this.hashString(predicatePattern) : 0xffffffff;
    const oPat = objectPattern ? this.hashString(objectPattern) : 0xffffffff;

    const count = this.exports.ontology_queryTriples(sPat, pPat, oPat);
    if (count === 0) return [];

    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const results = [];

    for (let i = 0; i < count * stride; i += stride) {
      const typeAndLang = mem32[(dirPtr >>> 2) + i + 0];
      results.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[(dirPtr >>> 2) + i + 1],
        predicateHash: mem32[(dirPtr >>> 2) + i + 2],
        objectHash: mem32[(dirPtr >>> 2) + i + 3],
        flags: mem32[(dirPtr >>> 2) + i + 4],
      });
    }

    return results;
  }

  /** Returns total asserted OWL 2 axioms in the store. */
  getOntologyAxiomCount(): number {
    return this.exports.ontology_getAxiomCount ? this.exports.ontology_getAxiomCount() : 0;
  }

  /** Clears the WASM ontology store and inverted indices. */
  clearOntology(): void {
    if (this.exports.ontology_clear) {
      this.exports.ontology_clear();
    }
  }

  /** Projects all indexed declaration stubs into OWL 2 axioms. */
  projectStubsToOntology(sourceLangId: number): number {
    return this.exports.projection_projectAllStubs ? this.exports.projection_projectAllStubs(sourceLangId) : 0;
  }

  /** Projects synthetic symbol with conflict deduplication against real declarations. */
  projectSyntheticSymbol(
    fileId: number,
    symbolId: number,
    parentSymbolId: number,
    kind: number,
    name: string,
    parentFqn: string = "",
  ): number {
    if (!this.exports.stub_projectSyntheticSymbol) return 0;
    const nameHash = this.hashString(name);
    const nameHandle = this.allocStringInArena(name);
    const parentFqnHash = parentFqn ? this.hashString(parentFqn) : 0;
    return this.exports.stub_projectSyntheticSymbol(
      fileId,
      symbolId,
      parentSymbolId,
      kind,
      nameHash,
      nameHandle,
      parentFqnHash,
    );
  }

  /** Creates an arena-native flattener attached to a DaeBuilder. */
  createFlattener(daePtr: number): number {
    return this.exports.flattener_create ? this.exports.flattener_create(daePtr) : 0;
  }

  /** Flattens an AST class definition into DAE variables and equations. */
  flattenerFlattenClass(flattenerPtr: number, classNodePtr: number): number {
    return this.exports.flattener_flattenClass ? this.exports.flattener_flattenClass(flattenerPtr, classNodePtr) : 0;
  }

  /** Adds a connector connection equation to the flattener. */
  flattenerAddConnection(
    flattenerPtr: number,
    p1VarId: number,
    p2VarId: number,
    isFlow: boolean,
    isBoundary: boolean = false,
  ): number {
    return this.exports.flattener_addConnection
      ? this.exports.flattener_addConnection(flattenerPtr, p1VarId, p2VarId, isFlow ? 1 : 0, isBoundary ? 1 : 0)
      : 0;
  }

  /** Finalizes connection graphs and synthesizes zero-sum flow equations. */
  flattenerFinalizeConnections(flattenerPtr: number): number {
    return this.exports.flattener_finalizeConnections ? this.exports.flattener_finalizeConnections(flattenerPtr) : 0;
  }

  /** Creates a modification environment in WASM linear memory. */
  flattenerCreateEnv(parentPtr: number = 0): number {
    return this.exports.flattener_createEnv ? this.exports.flattener_createEnv(parentPtr) : 0;
  }

  /** Binds a parameter override into the modification environment. */
  flattenerEnvBind(
    envPtr: number,
    keyHash: number,
    valExprId: number,
    isFinal: boolean = false,
    isEach: boolean = false,
  ): void {
    if (this.exports.flattener_envBind) {
      this.exports.flattener_envBind(envPtr, keyHash, valExprId, isFinal ? 1 : 0, isEach ? 1 : 0);
    }
  }

  /** Looks up a parameter override in the modification environment. */
  flattenerEnvLookup(envPtr: number, keyHash: number): number {
    return this.exports.flattener_envLookup ? this.exports.flattener_envLookup(envPtr, keyHash) >>> 0 : 0xffffffff;
  }

  /** Executes a named in-DSL compilation pipeline (e.g. 'flatten') in WebAssembly. */
  runPipeline(pipelineName: string, rootNode: number = 0): number {
    const fnName = `runPipeline_${pipelineName}`;
    if (this.exports[fnName]) {
      return this.exports[fnName](rootNode);
    }
    return 0;
  }

  /** Evaluates built-in trigonometric and elementary functions in WASM. */
  mathSin(x: number): number {
    return this.exports.math_sin ? this.exports.math_sin(x) : Math.sin(x);
  }
  mathCos(x: number): number {
    return this.exports.math_cos ? this.exports.math_cos(x) : Math.cos(x);
  }
  mathTan(x: number): number {
    return this.exports.math_tan ? this.exports.math_tan(x) : Math.tan(x);
  }
  mathSqrt(x: number): number {
    return this.exports.math_sqrt ? this.exports.math_sqrt(x) : Math.sqrt(x);
  }
  mathExp(x: number): number {
    return this.exports.math_exp ? this.exports.math_exp(x) : Math.exp(x);
  }
  mathLog(x: number): number {
    return this.exports.math_log ? this.exports.math_log(x) : Math.log(x);
  }

  /** Evaluates CSG sphere Signed Distance Function in WASM. */
  csgSdfSphere(px: number, py: number, pz: number, r: number): number {
    return this.exports.csg_sdf_sphere ? this.exports.csg_sdf_sphere(px, py, pz, r) : 0;
  }

  /** Evaluates CSG box Signed Distance Function in WASM. */
  csgSdfBox(px: number, py: number, pz: number, hx: number, hy: number, hz: number): number {
    return this.exports.csg_sdf_box ? this.exports.csg_sdf_box(px, py, pz, hx, hy, hz) : 0;
  }

  /** CSG Boolean Operations. */
  csgOpUnion(d1: number, d2: number): number {
    return this.exports.csg_op_union ? this.exports.csg_op_union(d1, d2) : Math.min(d1, d2);
  }
  csgOpIntersect(d1: number, d2: number): number {
    return this.exports.csg_op_intersect ? this.exports.csg_op_intersect(d1, d2) : Math.max(d1, d2);
  }
  csgOpDifference(d1: number, d2: number): number {
    return this.exports.csg_op_difference ? this.exports.csg_op_difference(d1, d2) : Math.max(d1, -d2);
  }

  /** Simplifies an algebraic expression using CAS rewrite rules and constant folding in WASM. */
  casSimplify(daePtr: number, exprId: number): number {
    return this.exports.cas_export_simplify ? this.exports.cas_export_simplify(daePtr, exprId) : exprId;
  }

  /** Computes the exact symbolic derivative d(expr) / d(varId) in WASM. */
  casDifferentiate(daePtr: number, exprId: number, targetVarId: number): number {
    return this.exports.cas_export_differentiate
      ? this.exports.cas_export_differentiate(daePtr, exprId, targetVarId)
      : 0;
  }

  /** Creates an Automatic Differentiation Tape instance in WASM. */
  createAdTape(): number {
    return this.exports.tape_create ? this.exports.tape_create() : 0;
  }

  /** Pushes an elementary operation node to the AD tape. */
  tapePushOp(tapePtr: number, op: number, left: number, right: number, val: number): number {
    return this.exports.tape_pushOp ? this.exports.tape_pushOp(tapePtr, op, left, right, val) : 0;
  }

  /** Runs the reverse-mode AD pass backwards from rootNode. */
  tapeBackward(tapePtr: number, rootNode: number): void {
    if (this.exports.tape_backward) {
      this.exports.tape_backward(tapePtr, rootNode);
    }
  }

  /** Retrieves the accumulated gradient for a node on the AD tape. */
  tapeGetGrad(tapePtr: number, nodeIdx: number): number {
    return this.exports.tape_getGrad ? this.exports.tape_getGrad(tapePtr, nodeIdx) : 0;
  }

  /** Resets the AD tape for the next evaluation pass. */
  tapeReset(tapePtr: number): void {
    if (this.exports.tape_reset) {
      this.exports.tape_reset(tapePtr);
    }
  }

  /** Creates a fast snapshot checkpoint of the arena allocation state. */
  createArenaSnapshot(): number {
    return this.exports.arena_createSnapshot ? this.exports.arena_createSnapshot() : 0;
  }

  /** Restores the arena allocation state to a previous snapshot checkpoint. */
  restoreArenaSnapshot(snapshotPtr: number): void {
    if (this.exports.arena_restoreSnapshot) {
      this.exports.arena_restoreSnapshot(snapshotPtr);
    }
  }

  /** Formats/unparses the document AST using zero-GC AssemblyScript formatting rules. */
  formatDocument(astRoot: number, preserveFormatting: boolean = false): string {
    if (!this.exports.lsp_formatDocument || !this.exports.lsp_getBinaryBuffer) return "";
    const numBytes = this.exports.lsp_formatDocument(astRoot, preserveFormatting ? 1 : 0);
    if (numBytes === 0) return "";

    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const bytes = new Uint8Array(numBytes);
    bytes.set(new Uint8Array(this.wasmMemory.buffer, dirPtr, numBytes));
    const encoding = this.getInputEncoding();
    if (encoding === 1) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  /** Reads a WASM-allocated length-prefixed UTF-16 string into a JavaScript string. */
  readWasmString(ptr: number): string {
    if (ptr === 0) return "";
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const lenBytes = mem32[(ptr - 4) >>> 2] || 0;
    const lenChars = lenBytes >>> 1;
    if (lenChars <= 0) return "";
    const u8 = new Uint8Array(lenBytes);
    u8.set(new Uint8Array(this.wasmMemory.buffer, ptr, lenBytes));
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-16le").decode(u8);
    }
    const u16 = new Uint16Array(u8.buffer);
    return String.fromCharCode.apply(null, Array.from(u16));
  }

  /** Retrieves available compiler pipelines that can be executed. */
  getPipelines(): { id: string; label: string; target: string }[] {
    if (!this.exports.lsp_getPipelinesInfo || !this.exports.lsp_getBinaryBuffer) return [];
    const numElements = this.exports.lsp_getPipelinesInfo();
    if (numElements === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const pipelines: { id: string; label: string; target: string }[] = [];
    for (let i = 0; i < numElements * 3; i += 3) {
      const idPtr = mem32[(dirPtr >> 2) + i];
      const labelPtr = mem32[(dirPtr >> 2) + i + 1];
      const targetPtr = mem32[(dirPtr >> 2) + i + 2];
      pipelines.push({
        id: this.readWasmString(idPtr),
        label: this.readWasmString(labelPtr),
        target: this.readWasmString(targetPtr),
      });
    }
    return pipelines;
  }

  /** Executes a specific compiler pipeline by its ID. */
  executePipeline(astRoot: number, pipelineId: string): { success: boolean; data: any } {
    if (!this.exports.lsp_executePipeline || !this.exports.lsp_getBinaryBuffer) {
      return { success: false, data: null };
    }
    let hash: number = 5381;
    for (let i = 0; i < pipelineId.length; i++) {
      hash = (hash << 5) + hash + pipelineId.charCodeAt(i);
    }
    const resultPtr = this.exports.lsp_executePipeline(astRoot, hash >>> 0);
    if (resultPtr === 0) return { success: false, data: null };
    return { success: true, data: { resultPtr } };
  }

  private _lastDiagBinaryLength: number = 0;

  /**
   * Read error ranges from the already-populated binary buffer without
   * calling lsp_getDiagnostics again. Only valid after getDiagnostics().
   */
  private readCachedErrorRanges(): { start: number; end: number }[] {
    const errorRanges: { start: number; end: number }[] = [];
    if (!this.exports.lsp_getBinaryBuffer || this._lastDiagBinaryLength === 0) return errorRanges;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < this._lastDiagBinaryLength; i += 7) {
      errorRanges.push({
        start: mem32[(dirPtr >> 2) + i],
        end: mem32[(dirPtr >> 2) + i + 1],
      });
    }
    return errorRanges;
  }

  /**
   * Traverses the AST and returns a string representation in Lisp-like S-Expressions.
   * Useful for debugging syntax trees and writing test expectations.
   */
  getAstSExpr(astRoot: number, verbose: boolean = false): string {
    if (!astRoot) return "";
    const lineStarts = this.getLineStarts();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);

    // Reuse cached error ranges from the last getDiagnostics() call
    // instead of calling lsp_getDiagnostics again (avoids triple traversal)
    const errorRanges = this.readCachedErrorRanges();

    const printedErrors = new Set<string>();

    const toSExpr = (ptr: number, currentOffset: number, depth: number): { strs: string[]; nextOffset: number } => {
      if (depth > 100) return { strs: ["(...)"], nextOffset: currentOffset };
      if (!ptr) return { strs: [], nextOffset: currentOffset };

      const typeFlags = mem32[ptr / 4];
      const typeId = typeFlags & 0x03ff;
      let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const envHashPadding = mem32[(ptr + 4) / 4];
      const rawPad = typeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]`;
      const indent = "  ".repeat(depth);
      const isInvisible = (typeFlags & (1 << 14)) !== 0;
      const shouldPrint =
        verbose ||
        (!typeName.startsWith("_") && !typeName.startsWith('"') && !typeName.startsWith("node_") && !isInvisible);

      let childStrs: string[] = [];

      let childOffset = startOffset;
      let childPtr = mem32[(ptr + 12) / 4];
      let slowPtr = childPtr;
      let step = 0;

      while (childPtr) {
        if (step !== 0 && childPtr === slowPtr) {
          childStrs.push("(CYCLE)");
          break;
        }

        const childResult = toSExpr(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        for (const s of childResult.strs) {
          if (s) childStrs.push(s);
        }
        childOffset = childResult.nextOffset;

        childPtr = mem32[(childPtr + 16) / 4];
        if (step % 2 === 1) slowPtr = mem32[(slowPtr + 16) / 4];
        step++;
      }

      if (!shouldPrint) {
        return { strs: childStrs, nextOffset: endOffset };
      }

      let flags = (typeFlags >> 10) & 0x0fff;
      let flagStr = "";
      if (flags & 256) flagStr += " (I)";
      if (flags & 128) flagStr += " (E)";
      if (flags & 16) flagStr += " (T)";
      let str = `(${typeName}${flagStr} ${posStr}`;
      if (childStrs.length > 0) {
        for (const cs of childStrs) {
          str += "\n" + indent + "  " + cs;
        }
      }
      return { strs: [str + ")"], nextOffset: endOffset };
    };

    const rootResult = toSExpr(astRoot, 0, 0);
    let str = rootResult.strs[0] || "";

    return str;
  }

  /**
   * Traverses the AST and returns an array of HTML strings representing the tree structure.
   * Used for the visual AST inspector.
   */
  getAstHtml(astRoot: number): string[] {
    if (!astRoot) return [];
    const lineStarts = this.getLineStarts();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);

    // Reuse cached error ranges from the last getDiagnostics() call
    const errorRanges = this.readCachedErrorRanges();

    const printedErrors = new Set<string>();
    const lines: string[] = [];

    lines.push(
      `<style>.ast-node, .ast-error { cursor: pointer; margin-top: 4px; display: block; width: fit-content; } .ast-node { color: #0969da; } .ast-error { color: #cf222e; } .ast-node:hover > .hoverable-text, .ast-error:hover > .hoverable-text { text-decoration: underline; }</style>`,
    );

    const toHtml = (ptr: number, currentOffset: number, depth: number): number => {
      if (lines.length > 5000) {
        if (
          lines[lines.length - 1] !==
          "<div style='margin-left: 15px; color: #cf222e;'>... AST Truncated (exceeded 5000 elements) ...</div>"
        ) {
          lines.push(
            "<div style='margin-left: 15px; color: #cf222e;'>... AST Truncated (exceeded 5000 elements) ...</div>",
          );
        }
        return currentOffset;
      }
      if (depth > 100) {
        lines.push("<div style='margin-left: 15px'>...</div>");
        return currentOffset;
      }
      if (!ptr) return currentOffset;

      const typeFlags = mem32[ptr / 4];
      const typeId = typeFlags & 0x03ff;
      let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const envHashPadding = mem32[(ptr + 4) / 4];
      const rawPad = typeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `<span style="color: #6e7781;">[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]</span>`;

      const isInvisible = (typeFlags & (1 << 14)) !== 0;
      const shouldPrint = true; // Debug: print all nodes

      let renderedChildren = 0;

      let childOffset = startOffset;
      let childPtr = mem32[(ptr + 12) / 4];
      let slowPtr = childPtr;
      let step = 0;

      let nodeIndex = -1;
      if (shouldPrint) {
        const isGhost = len === 0 && typeName !== "ERROR";
        const nodeClass = isGhost ? "ast-node ghost-node" : "ast-node";
        nodeIndex = lines.length;
        lines.push(
          `<div class="${nodeClass}" style="margin-left: ${depth * 20}px;" onclick="window.highlightNode(${startPos.line}, ${startPos.character}, ${endPos.line}, ${endPos.character})"><span class="hoverable-text">${typeName} (pad=${pad}, len=${len}, childOffset=${childOffset}, ptr=${ptr})</span> ${posStr}</div>`,
        );
      }

      while (childPtr) {
        if (step !== 0 && childPtr === slowPtr) {
          if (shouldPrint) {
            lines.push(`<div style="margin-left: ${(depth + 1) * 20}px; color: #8c959f; margin-top: 4px;">CYCLE</div>`);
          }
          break;
        }
        childOffset = toHtml(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        renderedChildren++;
        childPtr = mem32[(childPtr + 16) / 4];
        if (step % 2 === 1) slowPtr = mem32[(slowPtr + 16) / 4];
        step++;
      }

      if (shouldPrint && nodeIndex !== -1 && len === 0 && renderedChildren === 0 && typeName !== "ERROR") {
        // Retrospectively add ghost-node class if it ended up having no children
        lines[nodeIndex] = lines[nodeIndex].replace('"ast-node"', '"ast-node ghost-node"');
      }

      return endOffset;
    };

    toHtml(astRoot, 0, 0);
    return lines;
  }

  private astListeners: AstChangeListener[] = [];

  addAstChangeListener(listener: AstChangeListener): void {
    this.astListeners.push(listener);
  }

  /**
   * Appends a child to a parent node in O(1) using a JS-side tail pointer cache.
   * Falls back to the WASM ast_appendChild if the cache misses or the export is unavailable.
   */
  appendChild(parentPtr: number, childPtr: number): void {
    if (!parentPtr || !childPtr) return;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const lastChild = this._childTailCache.get(parentPtr);
    if (lastChild !== undefined) {
      // Wire nextSibling of the cached tail → new child
      mem32[(lastChild + 16) / 4] = childPtr;
    } else {
      // Check if parent already has a firstChild
      const firstChild = mem32[(parentPtr + 12) / 4];
      if (firstChild === 0) {
        mem32[(parentPtr + 12) / 4] = childPtr;
      } else if (this.exports.ast_appendChild) {
        // Fallback: let WASM walk the chain (cold path)
        this.exports.ast_appendChild(parentPtr, childPtr);
        this._childTailCache.set(parentPtr, childPtr);
        return;
      }
    }
    this._childTailCache.set(parentPtr, childPtr);
  }

  /**
   * Performs a full non-incremental parse of the given text buffer.
   * Used as a fallback or for initial parsing.
   */
  parse(text: string, editStart: number = 0, editOldEnd: number = 0, editNewEnd: number = 0, uri?: string): number {
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    if (!this.exports.parse || !getInputBuf) return 0;
    this._cachedLineStarts = null; // Invalidate cached line starts on edit
    this._childTailCache.clear(); // Invalidate tail pointers on edit

    if (this.exports.abortSuspend) this.exports.abortSuspend();
    const lenBytes = text.length * 2;
    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytes) : getInputBuf();

    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, text.length);
    for (let i = 0; i < text.length; i++) {
      memArray16[i] = text.charCodeAt(i);
    }

    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    this.currentInputLength = text.length;
    const prevAstRoot = this.getDocumentRoot(uri);

    let baseRoot = prevAstRoot;
    if (editStart === 0 && editOldEnd === 0 && editNewEnd === 0) {
      editNewEnd = lenBytes;
      baseRoot = 0;
    }

    const newAstRoot = this.exports.parse(baseRoot, editStart, editOldEnd, editNewEnd);

    if (this.astListeners.length > 0) {
      if (prevAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(prevAstRoot, newAstRoot, listener);
        }
      } else if (newAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(0, newAstRoot, listener);
        }
      }
    }

    this.lastAstRoot = newAstRoot;
    if (uri) this.setDocumentRoot(uri, newAstRoot);

    this.checkMemoryQuota();
    this.scheduleCompaction(false);

    return newAstRoot;
  }

  /**
   * Compares two ASTs generated before and after an edit, and emits
   * a minimal sequence of insertion, deletion, and update events.
   *
   * This bridges the gap between tree-sitter's internal incremental parsing state
   * and higher-level tooling (like the LSP reasoner) that needs to know exactly
   * what semantic nodes changed.
   */
  walkAstDiff(oldRoot: number, newRoot: number, listener: AstChangeListener): void {
    console.log(`[Bindings] walkAstDiff START: oldRoot=${oldRoot}, newRoot=${newRoot}`);
    let mem32 = new Uint32Array(this.wasmMemory.buffer);
    const getMem32 = () => {
      if (mem32.buffer !== this.wasmMemory.buffer || mem32.byteLength === 0) {
        mem32 = new Uint32Array(this.wasmMemory.buffer);
      }
      return mem32;
    };
    let opsCount = 0;
    const MAX_DIFF_OPS = 50000;

    const fieldIdToName: string[] = [];
    for (const [name, id] of Object.entries(FIELD_NAMES)) {
      fieldIdToName[id as number] = name;
    }

    const getChildren = (ptr: number): { ptr: number; field: string | null }[] => {
      const mem32 = getMem32();
      const children: { ptr: number; field: string | null }[] = [];
      const firstChild = mem32[(ptr + 12) / 4];
      let curr = firstChild;
      const typeFlags = mem32[ptr / 4];
      const parentTypeId = typeFlags & 0x03ff;
      let childIndex = 0;

      let slow = curr;
      let step = 0;
      while (curr !== 0 && childIndex < 5000) {
        if (opsCount >= MAX_DIFF_OPS) break;
        opsCount++;
        let fieldId = -1;
        if (this.exports.getFieldIdForChild) {
          try {
            const currType = mem32[curr / 4] & 0x03ff;
            fieldId = this.exports.getFieldIdForChild(parentTypeId, childIndex, currType);
          } catch {
            fieldId = -1;
          }
        }
        const field = fieldId >= 0 ? fieldIdToName[fieldId] : null;
        children.push({ ptr: curr, field });
        curr = getMem32()[(curr + 16) / 4];
        if (step % 2 === 1) slow = getMem32()[(slow + 16) / 4];
        if (step > 0 && slow === curr) break;
        step++;
        childIndex++;
      }
      return children;
    };

    const getFlattenedChildren = (startPtr: number): any[] => {
      if (!startPtr) return [];
      const children: any[] = [];
      let currentAccumulatedPad = 0;

      const stack: {
        nodePtr: number;
        parentField: string | null;
        childPtr: number;
        childIndex: number;
        step: number;
        slowPtr: number;
      }[] = [];

      let nodePtr = startPtr;
      let parentField: string | null = null;
      let childPtr = getMem32()[(nodePtr + 12) / 4];
      let childIndex = 0;
      let step = 0;
      let slowPtr = childPtr;

      while (true) {
        if (childPtr !== 0) {
          if (step > 0 && slowPtr === childPtr) {
            childPtr = 0;
            continue;
          }

          const mem32 = getMem32();
          const cTypeFlags = mem32[childPtr / 4];
          const typeId = cTypeFlags & 0x03ff;
          let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
          const isInvisible = (cTypeFlags & (1 << 14)) !== 0 || typeName.startsWith("_");

          const parentTypeId = mem32[nodePtr / 4] & 0x03ff;
          let fieldId = -1;
          if (this.exports.getFieldIdForChild) {
            try {
              fieldId = this.exports.getFieldIdForChild(parentTypeId, childIndex, typeId);
            } catch {
              fieldId = -1;
            }
          }
          const field = fieldId >= 0 ? fieldIdToName[fieldId] : isInvisible ? parentField : null;

          const childEnvHashPadding = mem32[(childPtr + 4) / 4];
          const childRawPad = cTypeFlags >>> 22;
          const childIsFat = (childEnvHashPadding >>> 23) & 1;
          const childPad =
            childIsFat && this.exports.getFatPaddingPtr
              ? mem32[this.exports.getFatPaddingPtr(childRawPad) / 4]
              : childRawPad;

          const childLen = childEnvHashPadding & 0x007fffff;
          const hasChildren = mem32[(childPtr + 12) / 4] !== 0;

          if (isInvisible) {
            if (hasChildren) {
              currentAccumulatedPad += childPad;
              stack.push({
                nodePtr,
                parentField,
                childPtr: mem32[(childPtr + 16) / 4],
                childIndex: childIndex + 1,
                step: step + 1,
                slowPtr: step % 2 === 1 ? mem32[(slowPtr + 16) / 4] : slowPtr,
              });

              nodePtr = childPtr;
              parentField = field;
              childPtr = mem32[(nodePtr + 12) / 4];
              childIndex = 0;
              step = 0;
              slowPtr = childPtr;
              continue;
            } else {
              currentAccumulatedPad += childPad + childLen;
            }
          } else {
            children.push({ ptr: childPtr, field, fieldId, invisiblePad: currentAccumulatedPad });
            currentAccumulatedPad = 0;
          }

          childPtr = mem32[(childPtr + 16) / 4];
          if (step % 2 === 1) slowPtr = mem32[(slowPtr + 16) / 4];
          step++;
          childIndex++;
        } else {
          if (stack.length === 0) break;
          const state = stack.pop()!;
          nodePtr = state.nodePtr;
          parentField = state.parentField;
          childPtr = state.childPtr;
          childIndex = state.childIndex;
          step = state.step;
          slowPtr = state.slowPtr;
        }
      }

      return children;
    };

    const buildInsertions = (startPtr: number, initialInvisiblePad: number = 0): void => {
      if (!startPtr) return;
      const stack: { ptr: number; invisiblePad: number }[] = [{ ptr: startPtr, invisiblePad: initialInvisiblePad }];
      while (stack.length > 0) {
        if (opsCount >= MAX_DIFF_OPS) throw new Error("MAX_DIFF_OPS");
        opsCount++;
        const item = stack.pop()!;
        const ptr = item.ptr;
        if (!ptr) continue;
        const mem32 = getMem32();
        const typeFlags = mem32[ptr / 4];
        const typeId = typeFlags & 0x03ff;
        let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
        if (typeName.startsWith("T_")) typeName = typeName.substring(2);
        const envHashPadding = mem32[(ptr + 4) / 4];
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        let pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
        const len = envHashPadding & 0x007fffff;

        const children = getFlattenedChildren(ptr);

        pad += item.invisiblePad;
        const flags = (typeFlags >> 10) & 0x0fff;
        listener.onNodeInserted(ptr, typeId, typeName, pad, len, flags, children);

        // Push children in reverse so they are processed in forward order
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ ptr: children[i].ptr, invisiblePad: children[i].invisiblePad });
        }
      }
    };

    const buildDeletions = (startPtr: number): void => {
      if (!startPtr) return;
      const stack: number[] = [startPtr];
      while (stack.length > 0) {
        if (opsCount >= MAX_DIFF_OPS) throw new Error("MAX_DIFF_OPS");
        opsCount++;
        const ptr = stack.pop()!;
        if (!ptr) continue;
        listener.onNodeDeleted(ptr);
        const children = getChildren(ptr);
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i].ptr);
        }
      }
    };

    const diffNodes = (
      oldPtr: number,
      newPtr: number,
      oldInvisiblePad: number = 0,
      newInvisiblePad: number = 0,
    ): void => {
      if (opsCount >= MAX_DIFF_OPS) throw new Error("MAX_DIFF_OPS");
      if (oldPtr === newPtr && oldInvisiblePad === newInvisiblePad) {
        if (oldPtr !== oldRoot) {
          const mem32r = getMem32();
          const retFlags = (mem32r[newPtr / 4] >> 10) & 0x0fff;
          listener.onNodeRetained(newPtr, retFlags);
          return;
        }
      }
      if (oldPtr === newPtr && oldInvisiblePad !== newInvisiblePad) {
        const mem32 = getMem32();
        const newTypeFlags = mem32[newPtr / 4];
        const newTypeId = newTypeFlags & 0x03ff;
        let typeName = (this.syntaxNames && this.syntaxNames[newTypeId]) || `node_${newTypeId}`;
        if (typeName.startsWith("T_")) typeName = typeName.substring(2);
        const envHashPadding = mem32[(newPtr + 4) / 4];
        const rawPad = newTypeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        let pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
        const len = envHashPadding & 0x007fffff;
        const flags = (newTypeFlags >> 10) & 0x0fff;
        const newCh = getFlattenedChildren(newPtr);
        pad += newInvisiblePad;

        listener.onNodeUpdated(newPtr, oldPtr, newTypeId, typeName, pad, len, flags, newCh);
        opsCount++;
        return;
      }
      if (!oldPtr) {
        buildInsertions(newPtr, newInvisiblePad);
        return;
      }
      if (!newPtr) {
        buildDeletions(oldPtr);
        return;
      }

      const mem32 = getMem32();
      const oldTypeId = mem32[oldPtr / 4] & 0x03ff;
      const newTypeId = mem32[newPtr / 4] & 0x03ff;

      if (oldTypeId !== newTypeId) {
        buildDeletions(oldPtr);
        buildInsertions(newPtr, newInvisiblePad);
        return;
      }

      const newTypeFlags = mem32[newPtr / 4];
      let typeName = (this.syntaxNames && this.syntaxNames[newTypeId]) || `node_${newTypeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);
      const envHashPadding = mem32[(newPtr + 4) / 4];
      const rawPad = newTypeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      let pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const oldCh = getFlattenedChildren(oldPtr);
      const newCh = getFlattenedChildren(newPtr);

      pad += newInvisiblePad;
      const flags = (newTypeFlags >> 10) & 0x0fff;
      listener.onNodeUpdated(newPtr, oldPtr, newTypeId, typeName, pad, len, flags, newCh);
      opsCount++;

      let start = 0;
      while (start < oldCh.length && start < newCh.length && oldCh[start].ptr === newCh[start].ptr) {
        if (oldCh[start].invisiblePad !== newCh[start].invisiblePad) break;
        const mem32s = getMem32();
        const sFlags = (mem32s[newCh[start].ptr / 4] >> 10) & 0x0fff;
        listener.onNodeRetained(newCh[start].ptr, sFlags);
        start++;
      }

      let oldEnd = oldCh.length - 1;
      let newEnd = newCh.length - 1;
      while (oldEnd >= start && newEnd >= start && oldCh[oldEnd].ptr === newCh[newEnd].ptr) {
        if (oldCh[oldEnd].invisiblePad !== newCh[newEnd].invisiblePad) break;
        oldEnd--;
        newEnd--;
      }

      const maxMiddle = Math.max(oldEnd - start + 1, newEnd - start + 1);
      if (maxMiddle === 1 && oldEnd - start + 1 === 1 && newEnd - start + 1 === 1) {
        const oPtr = oldCh[start].ptr;
        const nPtr = newCh[start].ptr;
        const oPad = oldCh[start].invisiblePad;
        const nPad = newCh[start].invisiblePad;
        if (oPtr && nPtr) diffNodes(oPtr, nPtr, oPad, nPad);
        else if (nPtr) buildInsertions(nPtr, nPad);
        else if (oPtr) buildDeletions(oPtr);
      } else {
        for (let i = start; i <= oldEnd; i++) {
          if (oldCh[i].ptr) buildDeletions(oldCh[i].ptr);
        }
        for (let i = start; i <= newEnd; i++) {
          if (newCh[i].ptr) buildInsertions(newCh[i].ptr, newCh[i].invisiblePad);
        }
      }

      for (let i = newEnd + 1; i < newCh.length; i++) {
        const mem32e = getMem32();
        const eFlags = (mem32e[newCh[i].ptr / 4] >> 10) & 0x0fff;
        listener.onNodeRetained(newCh[i].ptr, eFlags);
      }
    };

    if (!oldRoot && listener.onFullReset) {
      listener.onFullReset(newRoot);
    }

    try {
      if (oldRoot) {
        diffNodes(oldRoot, newRoot);
      } else {
        buildInsertions(newRoot);
      }
    } catch (e: any) {
      console.warn("AST diff fallback due to:", e?.message || e);
      if (listener.onFullReset) {
        listener.onFullReset(newRoot);
      } else if (oldRoot) {
        listener.onNodeDeleted(oldRoot);
      }
      if (newRoot) {
        opsCount = 0;
        try {
          buildInsertions(newRoot);
        } catch {
          // Suppress fallback bounds
        }
      }
    }
    console.log(`[Bindings] walkAstDiff COMPLETE: oldRoot=${oldRoot}, newRoot=${newRoot}, total opsCount=${opsCount}`);
  }
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
export class SyntaxNode {
  constructor(
    public readonly tree: Tree,
    public readonly ptr: number,
    public readonly _startOffset: number,
    public readonly parent: SyntaxNode | null,
    public readonly _cachedPad: number,
    public readonly _cachedLen: number,
    public readonly _cachedTypeId: number,
  ) {}

  /** Unique integer ID for this node (pointer address). */
  get id(): number {
    return this.ptr;
  }

  /** Gets the semantic type name of this node (e.g., 'ModelicaClassDefinition'). */
  get type(): string {
    if (this._cachedTypeId === 0) return "ERROR";
    let name =
      (this.tree.facade?.syntaxNames && this.tree.facade.syntaxNames[this._cachedTypeId]) ||
      (SYNTAX_NAMES && SYNTAX_NAMES[this._cachedTypeId]) ||
      `node_${this._cachedTypeId}`;
    if (name.startsWith("T_")) name = name.substring(2);
    return name;
  }

  /** Numeric type identifier for this node. */
  get typeId(): number {
    return this._cachedTypeId;
  }

  /** Grammar type identifier matching typeId. */
  get grammarId(): number {
    return this._cachedTypeId;
  }

  /** Semantic grammar type name. */
  get grammarType(): string {
    return this.type;
  }

  /** Extracts the substring from the original source code corresponding to this node. */
  get text(): string {
    if (!this.tree.sourceCode) return "";
    return this.tree.sourceCode.substring(this.startIndex, this.endIndex);
  }

  /** The start character index of the node (UTF-16). */
  get startIndex(): number {
    return (this._startOffset + this._cachedPad) / 2;
  }

  /** The end character index of the node (UTF-16). */
  get endIndex(): number {
    return (this._startOffset + this._cachedPad + this._cachedLen) / 2;
  }

  /** The start byte index of the node in UTF-16 memory. */
  get startByte(): number {
    return this._startOffset + this._cachedPad;
  }

  /** The end byte index of the node in UTF-16 memory. */
  get endByte(): number {
    return this._startOffset + this._cachedPad + this._cachedLen;
  }

  /**
   * Returns true if this node was inserted by the parser to recover from a syntax error.
   */
  isMissing(): boolean {
    if (this.ptr === 0) return false;
    const typeFlags = this.tree.mem32[this.ptr / 4];
    const flags = (typeFlags >>> 10) & 0x0fff;
    return (flags & 256) !== 0;
  }

  /** Returns true if this node is an extra token (comment/whitespace). */
  isExtra(): boolean {
    return false;
  }

  /** Returns true if this node has been edited. */
  hasChanges(): boolean {
    return false;
  }

  /** The line and column where this node starts. */
  get startPosition(): Point {
    return this.tree.offsetToPoint(this.startIndex * 2);
  }

  /** The line and column where this node ends. */
  get endPosition(): Point {
    return this.tree.offsetToPoint(this.endIndex * 2);
  }

  /**
   * Returns a list of all visible child nodes by walking the WASM sibling linked list.
   * Recursively flattens invisible nodes (e.g., anonymous sequences) into their parents.
   */
  get children(): SyntaxNode[] {
    const mem32 = this.tree.mem32;
    const kids: SyntaxNode[] = [];
    const stack: { nextChildPtr: number; nextOffset: number }[] = [];

    let currentChildPtr = mem32[(this.ptr + 12) / 4];
    let currentOffset = this._startOffset + this._cachedPad;

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr / 4];
        const typeId = typeFlags & 0x03ff;
        const name =
          (this.tree.facade?.syntaxNames && this.tree.facade.syntaxNames[typeId]) ||
          (SYNTAX_NAMES && SYNTAX_NAMES[typeId]) ||
          `node_${typeId}`;
        const envHashPadding = mem32[(currentChildPtr + 4) / 4];
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad =
          isFat && this.tree.facade.exports.getFatPaddingPtr
            ? mem32[this.tree.facade.exports.getFatPaddingPtr(rawPad) / 4]
            : rawPad;
        const len = envHashPadding & 0x007fffff;
        const isInvisible = (typeFlags & (1 << 14)) !== 0;

        const nextChildPtr = mem32[(currentChildPtr + 16) / 4];
        const nextOffset = currentOffset + pad + len;

        if (name.startsWith("_") || isInvisible) {
          stack.push({ nextChildPtr, nextOffset });
          currentChildPtr = mem32[(currentChildPtr + 12) / 4];
          currentOffset = currentOffset + pad;
          continue;
        } else {
          kids.push(new SyntaxNode(this.tree, currentChildPtr, currentOffset, this, pad, len, typeId));
        }

        currentOffset = nextOffset;
        currentChildPtr = nextChildPtr;
      } else {
        if (stack.length === 0) break;
        const state = stack.pop()!;
        currentChildPtr = state.nextChildPtr;
        currentOffset = state.nextOffset;
      }
    }
    return kids;
  }

  /** Gets all named children (excluding anonymous tokens and punctuation). */
  get namedChildren(): SyntaxNode[] {
    return this.children.filter((k) => k.isNamed());
  }

  /** Gets the number of children the node has. */
  get childCount(): number {
    return this.children.length;
  }

  /** Gets the number of named children the node has. */
  get namedChildCount(): number {
    return this.namedChildren.length;
  }

  /** Gets the first child of the node. */
  get firstChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[0] : null;
  }

  /** Gets the last child of the node. */
  get lastChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[kids.length - 1] : null;
  }

  /** Gets the first named child of the node. */
  get firstNamedChild(): SyntaxNode | null {
    const named = this.namedChildren;
    return named.length > 0 ? named[0] : null;
  }

  /** Gets the last named child of the node. */
  get lastNamedChild(): SyntaxNode | null {
    const named = this.namedChildren;
    return named.length > 0 ? named[named.length - 1] : null;
  }

  /** Gets the next sibling of the node. */
  get nextSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }

  /** Gets the previous sibling of the node. */
  get previousSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }

  /** Gets the next named sibling of the node. */
  get nextNamedSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.namedChildren;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }

  /** Gets the previous named sibling of the node. */
  get previousNamedSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.namedChildren;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }

  /** Gets the child at the specified index. */
  child(index: number): SyntaxNode | null {
    const kids = this.children;
    if (index >= 0 && index < kids.length) return kids[index];
    return null;
  }

  /** Gets the named child at the specified index. */
  namedChild(index: number): SyntaxNode | null {
    const named = this.namedChildren;
    if (index >= 0 && index < named.length) return named[index];
    return null;
  }

  /**
   * Helper that tests if this node or its WASM subtree contains targetPtr.
   */
  containsPtr(targetPtr: number): boolean {
    if (this.ptr === targetPtr) return true;
    if (this.ptr === 0 || targetPtr === 0) return false;
    const mem32 = this.tree.mem32;
    const stack: number[] = [mem32[(this.ptr + 12) / 4]];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (p === 0) continue;
      if (p === targetPtr) return true;
      const sib = mem32[(p + 16) / 4];
      if (sib !== 0) stack.push(sib);
      const ch = mem32[(p + 12) / 4];
      if (ch !== 0) stack.push(ch);
    }
    return false;
  }

  /**
   * Looks up a child node by numeric field ID.
   */
  childForFieldId(fieldId: number): SyntaxNode | null {
    if (!this.tree.facade.exports.getChildByFieldId || !this.ptr) return null;
    const childPtr = this.tree.facade.exports.getChildByFieldId(this.ptr, fieldId);
    if (!childPtr) return null;

    const kids = this.children;
    for (const kid of kids) {
      if (kid.ptr === childPtr || kid.containsPtr(childPtr)) return kid;
    }
    return null;
  }

  /**
   * Looks up a named field on this node and returns the corresponding child syntax node.
   */
  childForFieldName(name: string): SyntaxNode | null {
    const fieldId = FIELD_NAMES[name];
    if (fieldId === undefined) {
      return null;
    }
    return this.childForFieldId(fieldId);
  }

  /**
   * Returns all child nodes matching the given numeric field ID (e.g. for repeated fields).
   */
  childrenForFieldId(fieldId: number): SyntaxNode[] {
    const single = this.childForFieldId(fieldId);
    if (!single) return [];
    return [single];
  }

  /**
   * Returns all child nodes matching the given field name.
   */
  childrenForFieldName(name: string): SyntaxNode[] {
    const fieldId = FIELD_NAMES[name];
    if (fieldId === undefined) return [];
    return this.childrenForFieldId(fieldId);
  }

  /**
   * Returns the field name associated with a child at childIndex.
   */
  fieldNameForChild(childIndex: number): string | null {
    if (childIndex < 0 || childIndex >= this.children.length) return null;
    const typeId = this._cachedTypeId;
    if (!typeId || typeId <= 0) return null;
    if (!this.tree.facade.exports.getFieldIdForChild) return null;
    try {
      const fieldId = this.tree.facade.exports.getFieldIdForChild(typeId, childIndex);
      if (fieldId <= 0) return null;
      for (const [name, id] of Object.entries(FIELD_NAMES)) {
        if (id === fieldId) return name;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Returns the field name associated with a named child at namedChildIndex.
   */
  fieldNameForNamedChild(namedChildIndex: number): string | null {
    if (namedChildIndex < 0 || namedChildIndex >= this.namedChildren.length) return null;
    const target = this.namedChildren[namedChildIndex];
    const rawIndex = this.children.indexOf(target);
    return rawIndex >= 0 ? this.fieldNameForChild(rawIndex) : null;
  }

  /** Extracts the source code text for a specific child field. */
  childText(name: string): string {
    const child = this.childForFieldName(name);
    return child ? child.text : "";
  }

  /** Returns true if the node is a named (non-anonymous) node. */
  isNamed(): boolean {
    if (this._cachedTypeId === 0) return true; // ERROR nodes are named in Tree-sitter
    const t = this.type;
    return !t.startsWith('"') && !t.startsWith("/") && !t.startsWith("_");
  }

  /** Returns true if the node or any of its descendants represents a syntax error. */
  hasError(): boolean {
    if (this._cachedTypeId === 0) return true;
    if (this.ptr !== 0) {
      const typeFlags = this.tree.mem32[this.ptr / 4];
      const flags = (typeFlags >>> 10) & 0x0fff;
      if ((flags & 128) !== 0) return true; // FLAG_HAS_ERROR
    }
    for (const kid of this.children) {
      if (kid.hasError()) return true;
    }
    return false;
  }

  /** Finds the smallest syntax node covering the character range [start, end]. */
  descendantForIndex(start: number, end: number = start): SyntaxNode | null {
    if (start < this.startIndex || end > this.endIndex) return null;
    for (const kid of this.children) {
      if (start >= kid.startIndex && end <= kid.endIndex) {
        return kid.descendantForIndex(start, end);
      }
    }
    return this;
  }

  /** Finds the smallest named syntax node covering the character range [start, end]. */
  namedDescendantForIndex(start: number, end: number = start): SyntaxNode | null {
    const node = this.descendantForIndex(start, end);
    let curr: SyntaxNode | null = node;
    while (curr && !curr.isNamed()) {
      curr = curr.parent;
    }
    return curr;
  }

  /** Finds the smallest syntax node covering the given Point range. */
  descendantForPosition(start: Point, end: Point = start): SyntaxNode | null {
    const startOffset = this.tree.pointToOffset(start);
    const endOffset = this.tree.pointToOffset(end);
    return this.descendantForIndex(startOffset, endOffset);
  }

  /** Finds the smallest named syntax node covering the given Point range. */
  namedDescendantForPosition(start: Point, end: Point = start): SyntaxNode | null {
    const node = this.descendantForPosition(start, end);
    let curr: SyntaxNode | null = node;
    while (curr && !curr.isNamed()) {
      curr = curr.parent;
    }
    return curr;
  }

  /** Finds all descendants of the given type name(s). */
  descendantsOfType(types: string | string[], start?: Point, end?: Point): SyntaxNode[] {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const results: SyntaxNode[] = [];
    const visit = (node: SyntaxNode) => {
      if (
        start &&
        (node.endPosition.row < start.row ||
          (node.endPosition.row === start.row && node.endPosition.column < start.column))
      ) {
        return;
      }
      if (
        end &&
        (node.startPosition.row > end.row ||
          (node.startPosition.row === end.row && node.startPosition.column > end.column))
      ) {
        return;
      }
      if (typeSet.has(node.type)) {
        results.push(node);
      }
      for (const kid of node.children) {
        visit(kid);
      }
    };
    visit(this);
    return results;
  }

  /** Finds the closest ancestor node (or self) matching the given type(s). */
  closest(types: string | string[]): SyntaxNode | null {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    if (typeSet.has(this.type)) return this;
    return this.parent ? this.parent.closest(types) : null;
  }

  /** Generates the canonical S-expression string representation for this node. */
  toString(): string {
    if (this.isMissing()) {
      return `(MISSING ${this.type})`;
    }
    if (!this.isNamed() && this.children.length === 0) {
      return `"${this.text}"`;
    }
    if (this.children.length === 0) {
      return `(${this.type})`;
    }
    const childStrs: string[] = [];
    for (let i = 0; i < this.children.length; i++) {
      const c = this.children[i];
      const field = this.fieldNameForChild(i);
      const str = c.toString();
      childStrs.push(field ? `${field}: ${str}` : str);
    }
    return `(${this.type} ${childStrs.join(" ")})`;
  }

  /** Returns true if this node is equal to other. */
  equals(other: SyntaxNode | null | undefined): boolean {
    if (!other) return false;
    return this.ptr === other.ptr && this.startIndex === other.startIndex && this.endIndex === other.endIndex;
  }

  /** Creates a stateful TreeCursor for traversing the tree starting at this node. */
  walk(): TreeCursor {
    return new TreeCursor(this);
  }
}

/**
 * A Tree-sitter compatible stateful cursor for efficiently walking the syntax tree.
 */
export class TreeCursor {
  private stack: { node: SyntaxNode; childIndex: number }[] = [];
  private current: SyntaxNode;

  constructor(node: SyntaxNode) {
    this.current = node;
  }

  get nodeType(): string {
    return this.current.type;
  }

  get nodeTypeId(): number {
    return this.current.typeId;
  }

  get nodeIsNamed(): boolean {
    return this.current.isNamed();
  }

  get nodeIsMissing(): boolean {
    return this.current.isMissing();
  }

  get nodeText(): string {
    return this.current.text;
  }

  get currentNode(): SyntaxNode {
    return this.current;
  }

  get startIndex(): number {
    return this.current.startIndex;
  }

  get endIndex(): number {
    return this.current.endIndex;
  }

  get startPosition(): Point {
    return this.current.startPosition;
  }

  get endPosition(): Point {
    return this.current.endPosition;
  }

  get currentFieldName(): string | null {
    if (this.stack.length === 0) return null;
    const parentFrame = this.stack[this.stack.length - 1];
    return parentFrame.node.fieldNameForChild(parentFrame.childIndex);
  }

  get currentFieldId(): number {
    const name = this.currentFieldName;
    return name && FIELD_NAMES[name] !== undefined ? FIELD_NAMES[name] : 0;
  }

  get currentDepth(): number {
    return this.stack.length;
  }

  isMissing(): boolean {
    return this.current.isMissing();
  }

  gotoFirstChild(): boolean {
    const kids = this.current.children;
    if (kids.length === 0) return false;

    this.stack.push({ node: this.current, childIndex: 0 });
    this.current = kids[0];
    return true;
  }

  gotoFirstChildForIndex(index: number): boolean {
    const kids = this.current.children;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].startIndex <= index && index < kids[i].endIndex) {
        this.stack.push({ node: this.current, childIndex: i });
        this.current = kids[i];
        return true;
      }
    }
    return false;
  }

  gotoFirstChildForPosition(position: Point): boolean {
    const offset = this.current.tree.pointToOffset(position);
    return this.gotoFirstChildForIndex(offset);
  }

  gotoNextSibling(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack[this.stack.length - 1];
    const siblings = parentFrame.node.children;

    if (parentFrame.childIndex + 1 < siblings.length) {
      parentFrame.childIndex++;
      this.current = siblings[parentFrame.childIndex];
      return true;
    }
    return false;
  }

  gotoPreviousSibling(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack[this.stack.length - 1];
    const siblings = parentFrame.node.children;

    if (parentFrame.childIndex > 0) {
      parentFrame.childIndex--;
      this.current = siblings[parentFrame.childIndex];
      return true;
    }
    return false;
  }

  gotoParent(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack.pop()!;
    this.current = parentFrame.node;
    return true;
  }

  reset(node: SyntaxNode): void {
    this.current = node;
    this.stack = [];
  }
}

/**
 * Represents the root of a parsed syntax tree.
 */
export class Tree {
  public lineStarts: number[];
  public mem32: Uint32Array;

  constructor(
    public readonly facade: LspFacade,
    public readonly rootPtr: number,
    public readonly sourceCode: string,
  ) {
    // Build lineStarts in byte offsets (UTF-16: 2 bytes per character)
    this.lineStarts = [0];
    for (let i = 0; i < sourceCode.length; i++) {
      if (sourceCode[i] === "\n") this.lineStarts.push((i + 1) * 2);
    }
    this.mem32 = new Uint32Array((facade as any).wasmMemory.buffer);
  }

  /** Gets the root node of the syntax tree. */
  get rootNode(): SyntaxNode {
    if (!this.rootPtr) throw new Error("Null root pointer");

    const typeFlags = this.mem32[this.rootPtr / 4];
    const typeId = typeFlags & 0x03ff;
    const envHashPadding = this.mem32[(this.rootPtr + 4) / 4];
    const rawPad = typeFlags >>> 22;
    const isFat = (envHashPadding >>> 23) & 1;
    const pad =
      isFat && this.facade.exports.getFatPaddingPtr
        ? this.mem32[this.facade.exports.getFatPaddingPtr(rawPad) / 4]
        : rawPad;
    const len = envHashPadding & 0x007fffff;

    return new SyntaxNode(this, this.rootPtr, 0, null, pad, len, typeId);
  }

  /** Creates a stateful TreeCursor for traversing the tree starting at the root. */
  walk(): TreeCursor {
    return this.rootNode.walk();
  }

  /** Converts a linear byte offset into a row and column Point. */
  offsetToPoint(offset: number): Point {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.lineStarts[mid] <= offset) {
        if (mid === this.lineStarts.length - 1 || this.lineStarts[mid + 1] > offset) {
          return { row: mid, column: (offset - this.lineStarts[mid]) / 2 };
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return { row: 0, column: offset / 2 };
  }

  /** Converts a row and column Point into a linear character offset. */
  pointToOffset(point: Point): number {
    if (point.row < 0) return 0;
    if (point.row >= this.lineStarts.length) return this.sourceCode.length;
    const lineStart = this.lineStarts[point.row] / 2;
    return Math.min(this.sourceCode.length, lineStart + point.column);
  }
}

/**
 * Tree-sitter standard Parser class interface.
 */
export class TreeSitterParser {
  private languageBinding: any = null;

  setLanguage(language: any): void {
    this.languageBinding = language;
  }

  getLanguage(): any {
    return this.languageBinding;
  }

  parse(source: string | Uint8Array, oldTree: Tree | null = null): Tree | null {
    if (!this.languageBinding) {
      throw new Error("Language not set on Parser. Call setLanguage() first.");
    }
    let facade: any;
    if (typeof this.languageBinding === "function") {
      try {
        facade = new this.languageBinding();
      } catch {
        facade = this.languageBinding();
      }
    } else {
      facade = this.languageBinding;
    }
    const code = typeof source === "string" ? source : new TextDecoder().decode(source);
    const astRoot = facade.parse(code);
    if (!astRoot) return null;
    return new Tree(facade, astRoot, code);
  }

  reset(): void {}
}

export const WasmLanguageBinding = LspFacade;

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
export class LruAstCache {
  private activeRoots = new Map<number, { astRoot: number; lastAccessed: number; isDirty: boolean }>();
  public maxActiveAsts: number;
  public maxAstMemoryBytes: number;

  constructor(
    public readonly facade: LspFacade,
    options?: LruAstCacheOptions,
  ) {
    this.maxActiveAsts = options?.maxActiveAsts ?? 100;
    this.maxAstMemoryBytes = options?.maxAstMemoryBytes ?? 128 * 1024 * 1024;
  }

  get activeCount(): number {
    return this.activeRoots.size;
  }

  has(fileId: number): boolean {
    return this.activeRoots.has(fileId);
  }

  get(fileId: number): number | undefined {
    const entry = this.activeRoots.get(fileId);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.astRoot;
    }
    return undefined;
  }

  set(fileId: number, astRoot: number, isDirty: boolean = false): void {
    this.activeRoots.set(fileId, { astRoot, lastAccessed: Date.now(), isDirty });
    this.facade.registerDocument(fileId, astRoot);
    this.evictIfNecessary();
  }

  markDirty(fileId: number, isDirty: boolean): void {
    const entry = this.activeRoots.get(fileId);
    if (entry) entry.isDirty = isDirty;
  }

  evict(fileId: number): boolean {
    const entry = this.activeRoots.get(fileId);
    if (!entry) return false;
    if (entry.isDirty) return false;

    this.facade.evictDocumentAst(fileId);
    this.activeRoots.delete(fileId);
    return true;
  }

  evictIfNecessary(): void {
    const memUsage = this.facade.getMemoryUsage();
    const exceedsCount = this.activeRoots.size > this.maxActiveAsts;
    const exceedsMem = memUsage > this.maxAstMemoryBytes;

    if (!exceedsCount && !exceedsMem) return;

    const entries = Array.from(this.activeRoots.entries())
      .filter(([_, v]) => !v.isDirty)
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    for (const [fId] of entries) {
      if (this.activeRoots.size <= this.maxActiveAsts && this.facade.getMemoryUsage() <= this.maxAstMemoryBytes) {
        break;
      }
      this.evict(fId);
    }
  }

  clear(): void {
    for (const [fileId] of this.activeRoots) {
      this.facade.evictDocumentAst(fileId);
    }
    this.activeRoots.clear();
  }
}

/**
 * Manages workspace-wide multi-file symbol indexing and Two-Tier storage.
 */
export class LspWorkspaceManager {
  public readonly astCache: LruAstCache;
  private uriToFileId = new Map<string, number>();
  private fileIdToUri = new Map<number, string>();
  private nextFileId = 1;

  constructor(
    public readonly facade: LspFacade,
    options?: LruAstCacheOptions,
  ) {
    this.astCache = new LruAstCache(facade, options);
  }

  getFileId(uri: string): number {
    let id = this.uriToFileId.get(uri);
    if (id === undefined) {
      id = this.nextFileId++;
      this.uriToFileId.set(uri, id);
      this.fileIdToUri.set(id, uri);
    }
    return id;
  }

  getUri(fileId: number): string | undefined {
    return this.fileIdToUri.get(fileId);
  }

  indexFile(uri: string, content: string, keepAst: boolean = false): number {
    const fileId = this.getFileId(uri);
    this.facade.clearFileStubs(fileId);
    const astRoot = this.facade.parse(content);

    const symbols = this.facade.getDocumentSymbols(astRoot);
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      this.facade.registerStub(fileId, i + 1, 0, s.typeId, 0, `symbol_${s.typeId}_${i}`, s.start.line, s.end.line);
    }

    if (keepAst) {
      this.astCache.set(fileId, astRoot);
    } else {
      this.facade.evictDocumentAst(fileId);
    }
    return fileId;
  }

  getDefinition(uri: string, offset: number): { uri: string; start: number; end: number } | null {
    const fileId = this.getFileId(uri);
    let astRoot = this.astCache.get(fileId);
    if (!astRoot) return null;
    const def = this.facade.getDefinition(astRoot, offset);
    if (!def) return null;
    const targetUri = def.fileId === 0 ? uri : this.getUri(def.fileId) || uri;
    return {
      uri: targetUri,
      start: def.start,
      end: def.end,
    };
  }

  findSymbolsFuzzy(
    query: string,
    maxResults: number = 50,
  ): {
    uri: string;
    stubId: number;
    kind: number;
    startByte: number;
    endByte: number;
    score: number;
  }[] {
    const results = this.facade.fuzzyFindSymbols(query, maxResults);
    return results.map((r) => ({
      uri: this.getUri(r.fileId) || "",
      stubId: r.stubId,
      kind: r.kind,
      startByte: r.startByte,
      endByte: r.endByte,
      score: r.score,
    }));
  }
}
