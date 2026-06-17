// @ts-nocheck
// Auto-generated TypeScript Wrapper for __LANG_NAME__

export enum InputEncoding {
  UTF8 = 0,
  UTF16LE = 1,
  UTF16BE = 2,
  UTF32LE = 3,
  UTF32BE = 4,
}

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

export class ASTNode {
  constructor(
    private runtime: RuntimeAdapter,
    private ptr: number,
  ) {}

  getPtr(): number {
    return this.ptr;
  }
  getTypeId(): number {
    return this.runtime.getNodeType ? this.runtime.getNodeType(this.ptr) : this.runtime.readU32(this.ptr) & 0x03ff;
  }

  getFirstChild(): ASTNode | null {
    const childPtr = this.runtime.getNodeFirstChild(this.ptr);
    return childPtr === 0 ? null : new ASTNode(this.runtime, childPtr);
  }

  getNextSibling(): ASTNode | null {
    const siblingPtr = this.runtime.getNodeNextSibling(this.ptr);
    return siblingPtr === 0 ? null : new ASTNode(this.runtime, siblingPtr);
  }
}

export class Parser {
  constructor(private runtime: RuntimeAdapter) {}

  setEncoding(encoding: InputEncoding): void {
    if (this.runtime.setInputEncoding) {
      this.runtime.setInputEncoding(encoding);
    }
  }

  parse(
    source: string | Uint8Array,
    oldTree: ASTNode | null = null,
    editStart: number = 0,
    editOldEnd: number = 0,
  ): ASTNode | null {
    let view: Uint8Array;
    if (typeof source === "string") {
      const encoder = new TextEncoder();
      view = encoder.encode(source);
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

  readString(ptr: number): string {
    if (ptr === 0) return "";
    const lenBytes = this.runtime.readU32(ptr - 4);
    const lenChars = lenBytes / 2;
    let str = "";
    for (let i = 0; i < lenChars; i++) {
      str += String.fromCharCode(this.runtime.readU16(ptr + i * 2));
    }
    return str;
  }
}

export class WasmRuntime implements RuntimeAdapter {
  private mem32: Uint32Array;
  private mem16: Uint16Array;
  private mem8: Uint8Array;

  constructor(
    private wasmExports: any,
    memory: WebAssembly.Memory,
  ) {
    this.mem32 = new Uint32Array(memory.buffer);
    this.mem16 = new Uint16Array(memory.buffer);
    this.mem8 = new Uint8Array(memory.buffer);
  }

  readU32(ptr: number): number {
    return this.mem32[ptr / 4];
  }
  readU16(ptr: number): number {
    return this.mem16[ptr / 2];
  }
  writeU8Array(ptr: number, data: Uint8Array): void {
    this.mem8.set(data, ptr);
  }

  getInputBuffer(): number {
    return this.wasmExports.getInputBuffer();
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
    return this.mem32[(ptr + 8) / 4];
  }
  getNodeNextSibling(ptr: number): number {
    return this.mem32[(ptr + 12) / 4];
  }
  getNodeType(ptr: number): number {
    return this.mem32[ptr / 4] & 0x03ff;
  }

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
}

declare const __SYNTAX_NAMES_LITERAL__: string[];
export const SYNTAX_NAMES: string[] = typeof __SYNTAX_NAMES_LITERAL__ !== "undefined" ? __SYNTAX_NAMES_LITERAL__ : [];

export interface AstChangeListener {
  onNodeRetained(ptr: number): void;
  onNodeInserted(ptr: number, typeId: number, typeName: string, pad: number, len: number, children: number[]): void;
  onNodeDeleted(ptr: number): void;
  onNodeUpdated(
    newPtr: number,
    oldPtr: number,
    typeId: number,
    typeName: string,
    pad: number,
    len: number,
    children: number[],
  ): void;
}

export class LspFacade {
  private syntaxNames: string[] = SYNTAX_NAMES;
  private wasmMemory: WebAssembly.Memory;
  public exports: any;
  private lastAstRoot: number = 0;
  private _cachedLineStarts: number[] | null = null;

  constructor(wasmMemoryOrInstance: any, exports?: any) {
    if (wasmMemoryOrInstance && wasmMemoryOrInstance.exports) {
      this.wasmMemory = wasmMemoryOrInstance.exports.memory;
      this.exports = wasmMemoryOrInstance.exports;
    } else {
      this.wasmMemory = wasmMemoryOrInstance;
      this.exports = exports;
    }

    if (this.exports.initCompiler) {
      this.exports.initCompiler();
    }
  }

  resetParser(): void {
    if (this.exports.resetParser) {
      this.exports.resetParser();
    }
    this.lastAstRoot = 0;
    this._cachedLineStarts = null;
  }

  parseIncremental(changeText: string, rangeOffset: number, rangeLength: number, newTotalLength: number): number {
    if (!this.exports.parse || !this.exports.getInputBuffer) return 0;
    this._cachedLineStarts = null; // Invalidate cached line starts on edit

    const lenBytes = newTotalLength * 2;

    // Fast path for empty input (e.g., clearing the editor)
    if (newTotalLength <= 0) {
      if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
      if (this.exports.setInputLength) this.exports.setInputLength(0);
      const newAstRoot = this.exports.parse(0, 0, 0, 0);
      this.lastAstRoot = newAstRoot;
      if (this.exports.clearAstMarks) this.exports.clearAstMarks(this.lastAstRoot);
      return this.lastAstRoot;
    }

    const oldTotalLength = newTotalLength + rangeLength - changeText.length;

    const oldTextPtr = this.exports.getInputBuffer();

    // Snapshot old buffer contents BEFORE ensureInputBuffer which may grow memory
    // and detach existing typed array views
    let oldSnapshot: Uint16Array | null = null;
    if (oldTotalLength > 0) {
      const oldView = new Uint16Array(this.wasmMemory.buffer, oldTextPtr, oldTotalLength);
      oldSnapshot = new Uint16Array(oldTotalLength);
      oldSnapshot.set(oldView);
    }

    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytes) : oldTextPtr;

    // Create new view AFTER potential memory growth
    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, newTotalLength);

    // If the buffer was reallocated, copy the snapshot into the new buffer
    if (oldTextPtr !== textPtr && oldSnapshot) {
      memArray16.set(oldSnapshot);
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

    if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    let editStart = rangeOffset * 2;
    let editOldEnd = (rangeOffset + rangeLength) * 2;
    let editNewEnd = (rangeOffset + changeText.length) * 2;

    if (editStart === 0 && editOldEnd === 0 && editNewEnd === 0) {
      editNewEnd = lenBytes;
      this.lastAstRoot = 0; // Force full reparse internally if offsets are zeroed
    }

    const newAstRoot = this.exports.parse(this.lastAstRoot, editStart, editOldEnd, editNewEnd);

    if (this.astListeners && this.astListeners.length > 0) {
      if (this.lastAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(this.lastAstRoot, newAstRoot, listener);
        }
      } else if (newAstRoot !== 0) {
        // First parse: no old tree to diff against, so emit full insertion
        for (const listener of this.astListeners) {
          this.walkAstDiff(0, newAstRoot, listener);
        }
      }
    }

    this.lastAstRoot = newAstRoot;

    if (this.exports.clearAstMarks) {
      this.exports.clearAstMarks(this.lastAstRoot);
    }

    return this.lastAstRoot;
  }

  public getLineStarts(): number[] {
    if (this._cachedLineStarts) return this._cachedLineStarts;
    const lenBytes = this.exports.inputLength?.value ?? this.exports.inputLength;
    const lenChars = lenBytes / 2;
    const textBuffer = new Uint16Array(this.wasmMemory.buffer, this.exports.getInputBuffer(), lenChars);
    const lineStarts = [0];
    for (let i = 0; i < lenChars; i++) {
      if (textBuffer[i] === 10) {
        lineStarts.push((i + 1) * 2);
      }
    }
    this._cachedLineStarts = lineStarts;
    return lineStarts;
  }

  private offsetToPos(offset: number, lineStarts: number[]): Position {
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

    let lineStartByte = lineStarts[line];
    const charOffset = (offset - lineStarts[line]) / 2;
    return { line: line, character: charOffset };
  }

  getDiagnostics(astRoot: number): Diagnostic[] {
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getDiagnostics(astRoot);
    const diags: Diagnostic[] = [];

    if (numElements === 0 || !this.exports.lsp_getBinaryBuffer) return diags;

    const memory = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();

    for (let i = 0; i < numElements; i += 3) {
      const startByte = memory[(dirPtr >> 2) + i];
      const endByte = memory[(dirPtr >> 2) + i + 1];

      const lintId = memory[(dirPtr >> 2) + i + 2];

      let msg = "Syntax Error";
      if (lintId > 0 && lintId < this.syntaxNames.length) {
        let name = this.syntaxNames[lintId];
        if (name.startsWith('"') && name.endsWith('"')) {
          name = name.slice(1, -1);
        }
        msg = `Expected '${name}'`;
      }

      diags.push({
        range: {
          start: this.offsetToPos(startByte, lineStarts),
          end: this.offsetToPos(endByte, lineStarts),
        },
        message: msg,
        severity: 1, // Error
      });
    }
    // Cache the raw binary length so getAstSExpr/getAstHtml can read without re-calling
    this._lastDiagBinaryLength = numElements;
    return diags;
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
    for (let i = 0; i < this._lastDiagBinaryLength; i += 3) {
      errorRanges.push({
        start: mem32[(dirPtr >> 2) + i],
        end: mem32[(dirPtr >> 2) + i + 1],
      });
    }
    return errorRanges;
  }

  getAstSExpr(astRoot: number): string {
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
      let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const envHashPadding = mem32[(ptr + 4) / 4];
      const rawPad = typeFlags >>> 16;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]`;
      const indent = "  ".repeat(depth);

      const shouldPrint = !typeName.startsWith("_") && !typeName.startsWith('"');

      let childStrs: string[] = [];

      if (shouldPrint && pad > 0) {
        for (const err of errorRanges) {
          if (err.start >= currentOffset && err.end <= startOffset) {
            const key = `${err.start}-${err.end}`;
            if (!printedErrors.has(key)) {
              printedErrors.add(key);
              const eStart = this.offsetToPos(err.start, lineStarts);
              const eEnd = this.offsetToPos(err.end, lineStarts);
              childStrs.push(`(ERROR [${eStart.line}, ${eStart.character}] - [${eEnd.line}, ${eEnd.character}])`);
            }
          }
        }
      }

      let childOffset = currentOffset;
      let childPtr = mem32[(ptr + 8) / 4];
      let visited = new Set<number>();

      while (childPtr) {
        if (visited.has(childPtr)) {
          childStrs.push("(CYCLE)");
          break;
        }
        visited.add(childPtr);

        const childResult = toSExpr(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        for (const s of childResult.strs) {
          if (s) childStrs.push(s);
        }
        childOffset = childResult.nextOffset;

        childPtr = mem32[(childPtr + 12) / 4];
      }

      if (!shouldPrint) {
        return { strs: childStrs, nextOffset: endOffset };
      }

      let str = `(${typeName} ${posStr}`;
      if (childStrs.length > 0) {
        for (const cs of childStrs) {
          str += "\n" + indent + "  " + cs;
        }
      }
      return { strs: [str + ")"], nextOffset: endOffset };
    };

    const rootResult = toSExpr(astRoot, 0, 0);
    let str = rootResult.strs[0] || "";

    // Append trailing errors that occur after the root node
    for (const err of errorRanges) {
      if (err.start >= rootResult.nextOffset) {
        const key = `${err.start}-${err.end}`;
        if (!printedErrors.has(key)) {
          printedErrors.add(key);
          const eStart = this.offsetToPos(err.start, lineStarts);
          const eEnd = this.offsetToPos(err.end, lineStarts);
          str += `\n(ERROR [${eStart.line}, ${eStart.character}] - [${eEnd.line}, ${eEnd.character}])`;
        }
      }
    }

    return str;
  }

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
      let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const envHashPadding = mem32[(ptr + 4) / 4];
      const rawPad = typeFlags >>> 16;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `<span style="color: #6e7781;">[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]</span>`;

      const shouldPrint = !typeName.startsWith("_") && !typeName.startsWith('"');

      let renderedChildren = 0;

      if (shouldPrint && pad > 0) {
        for (const err of errorRanges) {
          if (err.start > startOffset) break;
          if (err.start >= currentOffset && err.end <= startOffset) {
            const key = `${err.start}-${err.end}`;
            if (!printedErrors.has(key)) {
              printedErrors.add(key);
              const eStart = this.offsetToPos(err.start, lineStarts);
              const eEnd = this.offsetToPos(err.end, lineStarts);
              lines.push(
                `<div class="ast-error" style="margin-left: ${(depth + 1) * 20}px;" onclick="window.highlightNode(${eStart.line}, ${eStart.character}, ${eEnd.line}, ${eEnd.character})"><span class="hoverable-text">ERROR</span> <span style="color: #6e7781;">[${eStart.line}, ${eStart.character}] - [${eEnd.line}, ${eEnd.character}]</span></div>`,
              );
            }
          }
        }
      }

      let childOffset = currentOffset;
      let childPtr = mem32[(ptr + 8) / 4];
      let visited = new Set<number>();

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
        if (visited.has(childPtr)) {
          if (shouldPrint) {
            lines.push(`<div style="margin-left: ${(depth + 1) * 20}px; color: #8c959f; margin-top: 4px;">CYCLE</div>`);
          }
          break;
        }
        visited.add(childPtr);
        childOffset = toHtml(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        renderedChildren++;
        childPtr = mem32[(childPtr + 12) / 4];
      }

      if (shouldPrint && nodeIndex !== -1 && len === 0 && renderedChildren === 0 && typeName !== "ERROR") {
        // Retrospectively add ghost-node class if it ended up having no children
        lines[nodeIndex] = lines[nodeIndex].replace('"ast-node"', '"ast-node ghost-node"');
      }

      return endOffset;
    };

    const nextOffset = toHtml(astRoot, 0, 0);

    for (const err of errorRanges) {
      if (lines.length > 5000) break;
      if (err.start >= nextOffset) {
        const key = `${err.start}-${err.end}`;
        if (!printedErrors.has(key)) {
          printedErrors.add(key);
          const eStart = this.offsetToPos(err.start, lineStarts);
          const eEnd = this.offsetToPos(err.end, lineStarts);
          lines.push(
            `<div class="ast-error" onclick="window.highlightNode(${eStart.line}, ${eStart.character}, ${eEnd.line}, ${eEnd.character})"><span class="hoverable-text">ERROR</span> <span style="color: #6e7781;">[${eStart.line}, ${eStart.character}] - [${eEnd.line}, ${eEnd.character}]</span></div>`,
          );
        }
      }
    }
    return lines;
  }

  private astListeners: AstChangeListener[] = [];

  addAstChangeListener(listener: AstChangeListener): void {
    this.astListeners.push(listener);
  }

  parse(text: string, editStart: number = 0, editOldEnd: number = 0, editNewEnd: number = 0): number {
    if (!this.exports.parse || !this.exports.getInputBuffer) return 0;
    this._cachedLineStarts = null; // Invalidate cached line starts on edit
    const lenBytes = text.length * 2;
    const textPtr = this.exports.ensureInputBuffer
      ? this.exports.ensureInputBuffer(lenBytes)
      : this.exports.getInputBuffer();

    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, text.length);
    for (let i = 0; i < text.length; i++) {
      memArray16[i] = text.charCodeAt(i);
    }

    if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    if (editStart === 0 && editOldEnd === 0 && editNewEnd === 0) {
      editNewEnd = lenBytes;
      this.lastAstRoot = 0;
    }

    const newAstRoot = this.exports.parse(this.lastAstRoot, editStart, editOldEnd, editNewEnd);

    if (this.astListeners.length > 0) {
      if (this.lastAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(this.lastAstRoot, newAstRoot, listener);
        }
      } else if (newAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(0, newAstRoot, listener);
        }
      }
    }

    this.lastAstRoot = newAstRoot;

    if (this.exports.clearAstMarks) {
      this.exports.clearAstMarks(this.lastAstRoot);
    }

    return this.lastAstRoot;
  }

  walkAstDiff(oldRoot: number, newRoot: number, listener: AstChangeListener): void {
    const mem32 = new Uint32Array(this.wasmMemory.buffer);

    const getChildren = (ptr: number): number[] => {
      const children: number[] = [];
      if (!ptr) return children;
      let childPtr = mem32[(ptr + 8) / 4];
      let visited = new Set<number>();
      while (childPtr) {
        if (visited.has(childPtr)) break;
        visited.add(childPtr);
        children.push(childPtr);
        childPtr = mem32[(childPtr + 12) / 4];
      }
      return children;
    };

    const buildInsertions = (startPtr: number): void => {
      if (!startPtr) return;
      const stack: number[] = [startPtr];
      while (stack.length > 0) {
        const ptr = stack.pop()!;
        if (!ptr) continue;
        const typeFlags = mem32[ptr / 4];
        const typeId = typeFlags & 0x03ff;
        let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
        if (typeName.startsWith("T_")) typeName = typeName.substring(2);
        const envHashPadding = mem32[(ptr + 4) / 4];
        const rawPad = typeFlags >>> 16;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
        const len = envHashPadding & 0x007fffff;

        const children = getChildren(ptr);
        listener.onNodeInserted(ptr, typeId, typeName, pad, len, children);

        // Push children in reverse so they are processed in forward order
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]);
        }
      }
    };

    const buildDeletions = (startPtr: number): void => {
      if (!startPtr) return;
      const stack: number[] = [startPtr];
      while (stack.length > 0) {
        const ptr = stack.pop()!;
        if (!ptr) continue;
        listener.onNodeDeleted(ptr);
        const children = getChildren(ptr);
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]);
        }
      }
    };

    const diffNodes = (oldPtr: number, newPtr: number): void => {
      if (oldPtr === newPtr) {
        listener.onNodeRetained(newPtr);
        return;
      }
      if (!oldPtr) {
        buildInsertions(newPtr);
        return;
      }
      if (!newPtr) {
        buildDeletions(oldPtr);
        return;
      }

      const oldTypeId = mem32[oldPtr / 4] & 0x03ff;
      const newTypeId = mem32[newPtr / 4] & 0x03ff;

      if (oldTypeId !== newTypeId) {
        buildDeletions(oldPtr);
        buildInsertions(newPtr);
        return;
      }

      const typeFlags = mem32[newPtr / 4];
      let typeName = this.syntaxNames[newTypeId] || `node_${newTypeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);
      const envHashPadding = mem32[(newPtr + 4) / 4];
      const pad = typeFlags >>> 16;
      const len = envHashPadding & 0x007fffff;

      const oldCh = getChildren(oldPtr);
      const newCh = getChildren(newPtr);

      listener.onNodeUpdated(newPtr, oldPtr, newTypeId, typeName, pad, len, newCh);

      let start = 0;
      while (start < oldCh.length && start < newCh.length && oldCh[start] === newCh[start]) {
        listener.onNodeRetained(newCh[start]);
        start++;
      }

      let oldEnd = oldCh.length - 1;
      let newEnd = newCh.length - 1;
      while (oldEnd >= start && newEnd >= start && oldCh[oldEnd] === newCh[newEnd]) {
        oldEnd--;
        newEnd--;
      }

      const maxMiddle = Math.max(oldEnd - start + 1, newEnd - start + 1);
      for (let i = 0; i < maxMiddle; i++) {
        const oPtr = start + i <= oldEnd ? oldCh[start + i] : 0;
        const nPtr = start + i <= newEnd ? newCh[start + i] : 0;
        if (oPtr && nPtr) diffNodes(oPtr, nPtr);
        else if (nPtr) buildInsertions(nPtr);
        else if (oPtr) buildDeletions(oPtr);
      }

      for (let i = newEnd + 1; i < newCh.length; i++) {
        listener.onNodeRetained(newCh[i]);
      }
    };

    diffNodes(oldRoot, newRoot);
  }
}
