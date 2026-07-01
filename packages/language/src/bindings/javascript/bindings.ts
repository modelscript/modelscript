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
  code?: number | string;
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

declare const __FIELD_NAMES_LITERAL__: Record<string, number>;
export const FIELD_NAMES: Record<string, number> =
  typeof __FIELD_NAMES_LITERAL__ !== "undefined" ? __FIELD_NAMES_LITERAL__ : {};

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
  private _cachedLineStarts: Uint32Array | null = null;
  private _childTailCache = new Map<number, number>();

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
    this._childTailCache.clear();
  }

  parseIncremental(changeText: string, rangeOffset: number, rangeLength: number, newTotalLength: number): number {
    if (!this.exports.parse || !this.exports.getInputBuffer) return 0;

    // Incrementally patch lineStarts instead of invalidating.
    // For a 60K-line file, this avoids an O(N) full rescan on every keystroke.
    if (this._cachedLineStarts && rangeLength >= 0 && changeText !== undefined) {
      this._cachedLineStarts = this._updateLineStarts(this._cachedLineStarts, rangeOffset, rangeLength, changeText);
    } else {
      this._cachedLineStarts = null;
    }
    this._childTailCache.clear(); // Invalidate tail pointers on edit

    if (this.exports.abortSuspend) this.exports.abortSuspend();

    const lenBytes = newTotalLength * 2;

    // Fast path for empty input (e.g., clearing the editor)
    if (newTotalLength <= 0) {
      if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
      if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(0);
      const newAstRoot = this.exports.parse(0, 0, 0, 0);
      this.lastAstRoot = newAstRoot;
      if (this.exports.clearAstMarks) this.exports.clearAstMarks(this.lastAstRoot);
      this._cachedLineStarts = new Uint32Array([0]);
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

    // Create new view AFTER potential memory growth, using max length to allow copyWithin shifting
    const maxLen = Math.max(oldTotalLength, newTotalLength);
    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, maxLen);

    // If the buffer was reallocated, copy the snapshot into the new buffer
    if (oldTextPtr !== textPtr && oldSnapshot) {
      // Only copy up to the new bounds to avoid RangeError if new buffer is exactly newTotalLength
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

    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    let editStart = rangeOffset * 2;
    let editOldEnd = (rangeOffset + rangeLength) * 2;
    let editNewEnd = (rangeOffset + changeText.length) * 2;

    if (editStart === 0 && editOldEnd === 0 && editNewEnd === 0) {
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
      if (changeText.charCodeAt(i) === 10) {
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

  public getLineStarts(): Uint32Array {
    if (this._cachedLineStarts) return this._cachedLineStarts;
    const lenBytes = this.exports.inputLength?.value ?? this.exports.inputLength;
    const lenChars = lenBytes / 2;
    const textBuffer = new Uint16Array(this.wasmMemory.buffer, this.exports.getInputBuffer(), lenChars);

    const starts: number[] = [0];
    for (let i = 0; i < lenChars; i++) {
      if (textBuffer[i] === 10) {
        starts.push((i + 1) * 2);
      }
    }

    const lineStarts = new Uint32Array(starts);
    this._cachedLineStarts = lineStarts;
    return lineStarts;
  }

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

    for (let i = 0; i < numElements * 4; i += 4) {
      const startByte = memory[(dirPtr >> 2) + i];
      const endByte = memory[(dirPtr >> 2) + i + 1];
      const lintId = memory[(dirPtr >> 2) + i + 2];
      const nodePtr = memory[(dirPtr >> 2) + i + 3];

      let msg = "Syntax Error";
      let severity = 1; // Default to Error
      let codeStr: number | string | undefined = lintId > 0 ? lintId : undefined;

      if (lintId > 0) {
        if (lintId < this.syntaxNames.length) {
          let name = this.syntaxNames[lintId];
          if (name && name.startsWith('"') && name.endsWith('"')) {
            name = name.slice(1, -1);
          }
          msg = `Expected '${name}'`;
        } else if (LINT_MESSAGES[lintId.toString()]) {
          if (LINT_SEVERITIES[lintId.toString()]) {
            severity = LINT_SEVERITIES[lintId.toString()];
          }
          let msgVal = LINT_MESSAGES[lintId.toString()];
          if (typeof msgVal === "function") {
            const lenChars = this.exports.inputLength ? this.exports.inputLength.value / 2 : 0;
            const textBuffer = new Uint16Array(this.wasmMemory.buffer, this.exports.getInputBuffer(), lenChars);
            let chars = "";
            for (let j = startByte / 2; j < endByte / 2; j++) {
              if (j < lenChars) chars += String.fromCharCode(textBuffer[j]);
            }

            let syntaxNode: SyntaxNode | null = null;
            if (nodePtr > 0 && this.exports.getChildByFieldId) {
              const typeFlags = memory[nodePtr / 4];
              const typeId = typeFlags & 0x03ff;
              const pad = typeFlags >>> 18;
              const len = memory[(nodePtr + 4) / 4] & 0x007fffff;
              const dummyTree = {
                sourceCode: {
                  substring: (start: number, end: number) => {
                    let s = "";
                    for (let j = start; j < end; j++) {
                      if (j < lenChars) s += String.fromCharCode(textBuffer[j]);
                    }
                    return s;
                  },
                },
                mem32: memory,
                offsetToPoint: (o: number) => this.offsetToPos(o, lineStarts),
                facade: this,
              };
              syntaxNode = new SyntaxNode(dummyTree as any, nodePtr, startByte - pad, null, pad, len, typeId);
            }

            const fieldsProxy = new Proxy(
              {},
              {
                get: (target, prop: string) => {
                  if (prop === "text") return chars;
                  if (!syntaxNode) return "";
                  return syntaxNode.childText(prop);
                },
              },
            );

            msg = (msgVal as any)(fieldsProxy);
          } else {
            msg = msgVal;
          }

          if (LINT_CODES[lintId.toString()] !== undefined) {
            codeStr = LINT_CODES[lintId.toString()];
          }
        }
      }

      let startPos = this.offsetToPos(startByte, lineStarts);
      let endPos = this.offsetToPos(endByte, lineStarts);

      // Clamp diagnostic ranges to a max of 3 lines to prevent Monaco UI freezes
      // when dealing with unclosed blocks or runaway string literals spanning 100k lines.
      const MAX_LINES = 3;
      const MAX_COLS = 120;

      if (endPos.line > startPos.line + MAX_LINES) {
        endPos = { line: startPos.line + MAX_LINES, character: 0 };
      }

      if (endPos.line === startPos.line && endPos.character - startPos.character > MAX_COLS) {
        endPos = { line: startPos.line, character: startPos.character + MAX_COLS };
      } else if (endPos.character > MAX_COLS) {
        endPos = { line: endPos.line, character: MAX_COLS };
      }

      diags.push({
        range: {
          start: startPos,
          end: endPos,
        },
        message: msg,
        severity: severity,
        code: codeStr,
        _startByte: startByte,
        _endByte: endByte,
      } as any);
    }
    // Cache the raw binary length so getAstSExpr/getAstHtml can read without re-calling
    // Cache the raw binary length so getAstSExpr/getAstHtml can read without re-calling
    this._lastDiagBinaryLength = numElements * 4;
    diags.sort((a, b) => {
      if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
      return a.range.start.character - b.range.start.character;
    });

    const mergedDiags: Diagnostic[] = [];
    for (let i = 0; i < diags.length; i++) {
      const current = diags[i];
      if (current.message.startsWith("Expected '")) {
        let merged = false;
        for (let j = i + 1; j < Math.min(diags.length, i + 3); j++) {
          const next = diags[j];
          if (
            next.message === "Syntax Error" &&
            (next as any)._startByte >= (current as any)._startByte &&
            (next as any)._startByte - (current as any)._endByte <= 500
          ) {
            // Reconstruct the bad text if possible
            const lenChars = this.exports.inputLength ? this.exports.inputLength.value / 2 : 0;
            let gotText = "invalid syntax";

            if (lenChars > 0 && this.exports.getInputBuffer) {
              const textBuffer = new Uint16Array(this.wasmMemory.buffer, this.exports.getInputBuffer(), lenChars);
              const s = (next as any)._startByte / 2;
              const e = (next as any)._endByte / 2;
              if (e > s && s < lenChars) {
                let chars = "";
                for (let k = s; k < e && k < s + 10; k++) {
                  chars += String.fromCharCode(textBuffer[k]);
                }
                if (e - s > 10) chars += "...";
                if (chars.trim().length > 0) gotText = `'${chars.trim()}'`;
              }
            }

            mergedDiags.push({
              range: next.range, // Use the syntax error's range since it covers the bad token
              message: `${current.message} but got ${gotText}`,
              severity: Math.max(current.severity, next.severity),
              code: current.code,
              _startByte: next._startByte,
              _endByte: next._endByte,
            } as any);
            diags.splice(j, 1);
            merged = true;
            break;
          }
        }
        if (!merged) mergedDiags.push(current);
      } else {
        mergedDiags.push(current);
      }
    }

    for (let diag of mergedDiags) {
      delete (diag as any)._startByte;
      delete (diag as any)._endByte;
    }

    return mergedDiags;
  }

  getSemanticTokens(astRoot: number): Uint32Array {
    if (!this.exports.lsp_semanticTokens_full || !this.exports.lsp_getBinaryBuffer) return new Uint32Array();
    const numElements = this.exports.lsp_semanticTokens_full(astRoot);
    if (numElements === 0) return new Uint32Array();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const result = new Uint32Array(numElements * 4);
    result.set(mem32.subarray(dirPtr >> 2, (dirPtr >> 2) + numElements * 4));
    return result;
  }

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
        start: this.offsetToPos(mem32[(dirPtr >> 2) + i], lineStarts),
        end: this.offsetToPos(mem32[(dirPtr >> 2) + i + 1], lineStarts),
        typeId: mem32[(dirPtr >> 2) + i + 2],
        nodePtr: mem32[(dirPtr >> 2) + i + 3],
      });
    }
    return symbols;
  }

  getDefinition(astRoot: number, targetOffset: number): { start: number; end: number } | null {
    if (!this.exports.lsp_getDefinition || !this.exports.lsp_getBinaryBuffer) return null;
    const numElements = this.exports.lsp_getDefinition(astRoot, targetOffset);
    if (numElements < 2) return null;

    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    return {
      start: mem32[dirPtr >> 2],
      end: mem32[(dirPtr >> 2) + 1],
    };
  }

  getReferences(astRoot: number, targetOffset: number): { start: number; end: number }[] {
    if (!this.exports.lsp_getReferences || !this.exports.lsp_getBinaryBuffer) return [];
    console.log(`[getReferences] calling WASM with root=${astRoot}, targetOffset=${targetOffset}`);
    const numElements = this.exports.lsp_getReferences(astRoot, targetOffset);
    console.log(`[getReferences] WASM returned numElements=${numElements}`);
    const references: { start: number; end: number }[] = [];
    if (numElements === 0) return references;

    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 2; i += 2) {
      references.push({
        start: mem32[(dirPtr >> 2) + i],
        end: mem32[(dirPtr >> 2) + i + 1],
      });
    }
    console.log(`[getReferences] final refs:`, references);
    return references;
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
    for (let i = 0; i < this._lastDiagBinaryLength; i += 4) {
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
      const rawPad = typeFlags >>> 18;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]`;
      const indent = "  ".repeat(depth);
      const isInvisible = (typeFlags & (1 << 12)) !== 0;
      const shouldPrint = !typeName.startsWith("_") && !typeName.startsWith('"') && !isInvisible;

      let childStrs: string[] = [];

      let childOffset = currentOffset;
      let childPtr = mem32[(ptr + 8) / 4];
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

        childPtr = mem32[(childPtr + 12) / 4];
        if (step % 2 === 1) slowPtr = mem32[(slowPtr + 12) / 4];
        step++;
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
      const rawPad = typeFlags >>> 18;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `<span style="color: #6e7781;">[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]</span>`;

      const isInvisible = (typeFlags & (1 << 12)) !== 0;
      const shouldPrint = !typeName.startsWith("_") && !typeName.startsWith('"') && !isInvisible;

      let renderedChildren = 0;

      let childOffset = currentOffset;
      let childPtr = mem32[(ptr + 8) / 4];
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
        childPtr = mem32[(childPtr + 12) / 4];
        if (step % 2 === 1) slowPtr = mem32[(slowPtr + 12) / 4];
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
      mem32[(lastChild + 12) / 4] = childPtr;
    } else {
      // Check if parent already has a firstChild
      const firstChild = mem32[(parentPtr + 8) / 4];
      if (firstChild === 0) {
        mem32[(parentPtr + 8) / 4] = childPtr;
      } else if (this.exports.ast_appendChild) {
        // Fallback: let WASM walk the chain (cold path)
        this.exports.ast_appendChild(parentPtr, childPtr);
        this._childTailCache.set(parentPtr, childPtr);
        return;
      }
    }
    this._childTailCache.set(parentPtr, childPtr);
  }

  parse(text: string, editStart: number = 0, editOldEnd: number = 0, editNewEnd: number = 0): number {
    if (!this.exports.parse || !this.exports.getInputBuffer) return 0;
    this._cachedLineStarts = null; // Invalidate cached line starts on edit
    this._childTailCache.clear(); // Invalidate tail pointers on edit

    if (this.exports.abortSuspend) this.exports.abortSuspend();
    const lenBytes = text.length * 2;
    const textPtr = this.exports.ensureInputBuffer
      ? this.exports.ensureInputBuffer(lenBytes)
      : this.exports.getInputBuffer();

    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, text.length);
    for (let i = 0; i < text.length; i++) {
      memArray16[i] = text.charCodeAt(i);
    }

    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

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
    let opsCount = 0;
    const MAX_DIFF_OPS = 10000;

    const getChildren = (ptr: number): number[] => {
      const children: number[] = [];
      if (!ptr) return children;

      const collect = (p: number) => {
        let childPtr = mem32[(p + 8) / 4];
        let slowPtr = childPtr;
        let step = 0;

        while (childPtr) {
          if (step !== 0 && childPtr === slowPtr) break;

          const typeFlags = mem32[childPtr / 4];
          const typeId = typeFlags & 0x03ff;
          let typeName = SYNTAX_NAMES[typeId] || `node_${typeId}`;
          const isInvisible = (typeFlags & (1 << 12)) !== 0;

          if (typeName.startsWith("_") || isInvisible) {
            collect(childPtr);
          } else {
            children.push(childPtr);
          }
          childPtr = mem32[(childPtr + 12) / 4];
          if (step % 2 === 1) slowPtr = mem32[(slowPtr + 12) / 4];
          step++;
        }
      };

      collect(ptr);
      return children;
    };

    const buildInsertions = (startPtr: number): void => {
      if (!startPtr) return;
      const stack: number[] = [startPtr];
      while (stack.length > 0) {
        if (opsCount >= MAX_DIFF_OPS) return;
        opsCount++;
        const ptr = stack.pop()!;
        if (!ptr) continue;
        const typeFlags = mem32[ptr / 4];
        const typeId = typeFlags & 0x03ff;
        let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
        if (typeName.startsWith("T_")) typeName = typeName.substring(2);
        const envHashPadding = mem32[(ptr + 4) / 4];
        const rawPad = typeFlags >>> 18;
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
        if (opsCount >= MAX_DIFF_OPS) return;
        opsCount++;
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
      if (opsCount >= MAX_DIFF_OPS) {
        // Fallback: tree changed too much, just delete old and insert new
        if (oldPtr) listener.onNodeDeleted(oldPtr);
        if (newPtr) {
          const typeFlags = mem32[newPtr / 4];
          const typeId = typeFlags & 0x03ff;
          let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
          if (typeName.startsWith("T_")) typeName = typeName.substring(2);
          const envHashPadding = mem32[(newPtr + 4) / 4];
          const rawPad = typeFlags >>> 18;
          const isFat = (envHashPadding >>> 23) & 1;
          const pad =
            isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
          const len = envHashPadding & 0x007fffff;
          const children = getChildren(newPtr);
          listener.onNodeInserted(newPtr, typeId, typeName, pad, len, children);
        }
        opsCount++;
        return;
      }
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
      const rawPad = typeFlags >>> 18;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;

      const oldCh = getChildren(oldPtr);
      const newCh = getChildren(newPtr);

      listener.onNodeUpdated(newPtr, oldPtr, newTypeId, typeName, pad, len, newCh);
      opsCount++;

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

export interface Point {
  row: number;
  column: number;
}

/**
 * A Tree-sitter compatible facade for a ModelScript AST Node.
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

  get type(): string {
    if (this._cachedTypeId === 0) return "ERROR";
    let name = SYNTAX_NAMES[this._cachedTypeId] || `node_${this._cachedTypeId}`;
    if (name.startsWith("T_")) name = name.substring(2);
    return name;
  }

  get text(): string {
    if (!this.tree.sourceCode) return "";
    return this.tree.sourceCode.substring(this.startIndex, this.endIndex);
  }

  get startIndex(): number {
    return (this._startOffset + this._cachedPad) / 2;
  }

  get endIndex(): number {
    return (this._startOffset + this._cachedPad + this._cachedLen) / 2;
  }

  get startPosition(): Point {
    return this.tree.offsetToPoint(this.startIndex * 2);
  }

  get endPosition(): Point {
    return this.tree.offsetToPoint(this.endIndex * 2);
  }

  get children(): SyntaxNode[] {
    const mem32 = this.tree.mem32;
    const kids: SyntaxNode[] = [];

    const collect = (ptr: number, offset: number, parentNode: SyntaxNode) => {
      let childOffset = offset;
      let childPtr = mem32[(ptr + 8) / 4];
      while (childPtr !== 0) {
        const typeFlags = mem32[childPtr / 4];
        const typeId = typeFlags & 0x03ff;
        const name = SYNTAX_NAMES[typeId] || `node_${typeId}`;
        const envHashPadding = mem32[(childPtr + 4) / 4];
        const rawPad = typeFlags >>> 18;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad =
          isFat && this.tree.facade.exports.getFatPaddingPtr
            ? mem32[this.tree.facade.exports.getFatPaddingPtr(rawPad) / 4]
            : rawPad;
        const len = envHashPadding & 0x007fffff;
        const isInvisible = (typeFlags & (1 << 12)) !== 0;

        if (name.startsWith("_") || isInvisible) {
          collect(childPtr, childOffset, parentNode);
        } else {
          kids.push(new SyntaxNode(this.tree, childPtr, childOffset, parentNode, pad, len, typeId));
        }

        childOffset = childOffset + pad + len;
        childPtr = mem32[(childPtr + 12) / 4];
      }
    };

    collect(this.ptr, this._startOffset, this);
    return kids;
  }

  get firstChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[0] : null;
  }

  get lastChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[kids.length - 1] : null;
  }

  get nextSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }

  get previousSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }

  get childCount(): number {
    return this.children.length;
  }

  child(index: number): SyntaxNode | null {
    const kids = this.children;
    if (index >= 0 && index < kids.length) return kids[index];
    return null;
  }

  isMissing(): boolean {
    return this._cachedLen === 0 && this._cachedTypeId !== 0;
  }

  childForFieldName(name: string): SyntaxNode | null {
    const fieldId = FIELD_NAMES[name];
    if (fieldId === undefined) {
      console.log(`[DEBUG] fieldId for ${name} is undefined. FIELD_NAMES=`, FIELD_NAMES);
      return null;
    }
    if (!this.tree.facade.exports.getChildByFieldId) {
      console.log(`[DEBUG] getChildByFieldId is missing from exports!`);
      return null;
    }
    const childPtr = this.tree.facade.exports.getChildByFieldId(this.ptr, fieldId);
    if (!childPtr) {
      console.log(`[DEBUG] getChildByFieldId(${this.ptr}, ${fieldId}) returned 0`);
      return null;
    }
    const kids = this.children;
    for (const kid of kids) {
      if (kid.ptr === childPtr) return kid;
    }
    console.log(`[DEBUG] childPtr ${childPtr} not found in kids list of length ${kids.length}`);
    return null;
  }

  childText(name: string): string {
    const child = this.childForFieldName(name);
    return child ? child.text : "";
  }

  isNamed(): boolean {
    const t = this.type;
    return !t.startsWith('"') && !t.startsWith("_");
  }

  hasError(): boolean {
    if (this._cachedTypeId === 0) return true;
    for (const kid of this.children) {
      if (kid.hasError()) return true;
    }
    return false;
  }

  walk(): TreeCursor {
    return new TreeCursor(this);
  }
}

export class TreeCursor {
  private stack: { node: SyntaxNode; childIndex: number }[] = [];
  private current: SyntaxNode;

  constructor(node: SyntaxNode) {
    this.current = node;
  }

  get nodeType(): string {
    return this.current.type;
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

  gotoFirstChild(): boolean {
    const kids = this.current.children;
    if (kids.length === 0) return false;

    this.stack.push({ node: this.current, childIndex: 0 });
    this.current = kids[0];
    return true;
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

  gotoParent(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack.pop()!;
    this.current = parentFrame.node;
    return true;
  }
}

export class Tree {
  public lineStarts: number[];
  public mem32: Uint32Array;

  constructor(
    public readonly facade: LspFacade,
    public readonly rootPtr: number,
    public readonly sourceCode: string,
  ) {
    // Build lineStarts in byte offsets (UTF-16: 2 bytes per character)
    // to match the WASM arena's byte-offset convention for node positions
    this.lineStarts = [0];
    for (let i = 0; i < sourceCode.length; i++) {
      if (sourceCode[i] === "\n") this.lineStarts.push((i + 1) * 2);
    }
    this.mem32 = new Uint32Array((facade as any).wasmMemory.buffer);
  }

  get rootNode(): SyntaxNode {
    if (!this.rootPtr) throw new Error("Null root pointer");

    const typeFlags = this.mem32[this.rootPtr / 4];
    const typeId = typeFlags & 0x03ff;
    const envHashPadding = this.mem32[(this.rootPtr + 4) / 4];
    const rawPad = typeFlags >>> 18;
    const isFat = (envHashPadding >>> 23) & 1;
    const pad =
      isFat && this.facade.exports.getFatPaddingPtr
        ? this.mem32[this.facade.exports.getFatPaddingPtr(rawPad) / 4]
        : rawPad;
    const len = envHashPadding & 0x007fffff;

    return new SyntaxNode(this, this.rootPtr, 0, null, pad, len, typeId);
  }

  walk(): TreeCursor {
    return this.rootNode.walk();
  }

  offsetToPoint(offset: number): Point {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.lineStarts[mid] <= offset) {
        if (mid === this.lineStarts.length - 1 || this.lineStarts[mid + 1] > offset) {
          // Convert byte-based column to character column (UTF-16: 2 bytes per char)
          return { row: mid, column: (offset - this.lineStarts[mid]) / 2 };
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return { row: 0, column: offset / 2 };
  }
}
