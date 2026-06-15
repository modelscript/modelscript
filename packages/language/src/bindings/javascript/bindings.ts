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

export class LspFacade {
  private syntaxNames: string[] = SYNTAX_NAMES;
  private wasmMemory: WebAssembly.Memory;
  public exports: any;
  private lastAstRoot: number = 0;

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

  parse(text: string, editStart: number = 0, editOldEnd: number = 0, editNewEnd: number = 0): number {
    if (!this.exports.parse || !this.exports.getInputBuffer) return 0;
    const textPtr = this.exports.getInputBuffer();
    const lenBytes = text.length * 2;

    const memArray16 = new Uint16Array(text.length);
    for (let i = 0; i < text.length; i++) {
      memArray16[i] = text.charCodeAt(i);
    }
    const memArray8 = new Uint8Array(this.wasmMemory.buffer);
    memArray8.set(new Uint8Array(memArray16.buffer), textPtr);

    if (this.exports.setInputEncoding) this.exports.setInputEncoding(1); // 1 = UTF-16LE
    if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);

    if (editStart === 0 && editOldEnd === 0 && editNewEnd === 0) {
      editNewEnd = lenBytes;
      this.lastAstRoot = 0; // Force full reparse internally if offsets are zeroed
    }

    this.lastAstRoot = this.exports.parse(this.lastAstRoot, editStart, editOldEnd, editNewEnd);

    if (this.exports.clearAstMarks) {
      this.exports.clearAstMarks(this.lastAstRoot);
    }

    return this.lastAstRoot;
  }

  private getLineStarts(): number[] {
    const lenBytes = this.exports.inputLength?.value ?? this.exports.inputLength;
    const lenChars = lenBytes / 2;
    const textBuffer = new Uint16Array(this.wasmMemory.buffer, this.exports.getInputBuffer(), lenChars);
    const lineStarts = [0];
    for (let i = 0; i < lenChars; i++) {
      if (textBuffer[i] === 10) {
        lineStarts.push((i + 1) * 2);
      }
    }
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
    let byteLen = offset - lineStartByte;
    if (byteLen <= 0) return { line, character: 0 };
    return { line, character: Math.floor(byteLen / 2) };
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

      let msg = "Syntax Error";

      diags.push({
        range: {
          start: this.offsetToPos(startByte, lineStarts),
          end: this.offsetToPos(endByte, lineStarts),
        },
        message: msg,
        severity: 1, // Error
      });
    }
    console.log(`[LSP] getDiagnostics returned:`, diags);
    return diags;
  }

  getAstSExpr(astRoot: number): string {
    if (!astRoot) return "";
    const lineStarts = this.getLineStarts();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);

    // Fetch precise error byte boundaries from the WASM diagnostic pipeline
    const errorRanges: { start: number; end: number }[] = [];
    if (this.exports.lsp_getDiagnostics && this.exports.lsp_getBinaryBuffer) {
      const numElements = this.exports.lsp_getDiagnostics(astRoot);
      const dirPtr = this.exports.lsp_getBinaryBuffer();
      for (let i = 0; i < numElements; i += 3) {
        errorRanges.push({
          start: mem32[(dirPtr >> 2) + i],
          end: mem32[(dirPtr >> 2) + i + 1],
        });
      }
    }

    const printedErrors = new Set<string>();

    const toSExpr = (ptr: number, currentOffset: number, depth: number): { strs: string[]; nextOffset: number } => {
      if (depth > 100) return { strs: ["(...)"], nextOffset: currentOffset };
      if (!ptr) return { strs: [], nextOffset: currentOffset };

      const typeFlags = mem32[ptr / 4];
      const typeId = typeFlags & 0x03ff;
      let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const envHashPadding = mem32[(ptr + 4) / 4];
      const pad = typeFlags >>> 16;
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

  getAstHtml(astRoot: number): string {
    if (!astRoot) return "";
    const lineStarts = this.getLineStarts();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);

    // Fetch precise error byte boundaries from the WASM diagnostic pipeline
    const errorRanges: { start: number; end: number }[] = [];
    if (this.exports.lsp_getDiagnostics && this.exports.lsp_getBinaryBuffer) {
      const numElements = this.exports.lsp_getDiagnostics(astRoot);
      const dirPtr = this.exports.lsp_getBinaryBuffer();
      for (let i = 0; i < numElements; i += 3) {
        errorRanges.push({
          start: mem32[(dirPtr >> 2) + i],
          end: mem32[(dirPtr >> 2) + i + 1],
        });
      }
    }

    const printedErrors = new Set<string>();

    const toHtml = (ptr: number, currentOffset: number, depth: number): { strs: string[]; nextOffset: number } => {
      if (depth > 100) return { strs: ["<div style='margin-left: 15px'>...</div>"], nextOffset: currentOffset };
      if (!ptr) return { strs: [], nextOffset: currentOffset };

      const typeFlags = mem32[ptr / 4];
      const typeId = typeFlags & 0x03ff;
      let typeName = this.syntaxNames[typeId] || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const envHashPadding = mem32[(ptr + 4) / 4];
      const pad = typeFlags >>> 16;
      const len = envHashPadding & 0x007fffff;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);

      const posStr = `<span style="color: #6e7781;">[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]</span>`;

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
              childStrs.push(
                `<div class="ast-error" style="margin-left: ${(depth + 1) * 20}px;" onclick="window.highlightNode(${eStart.line}, ${eStart.character}, ${eEnd.line}, ${eEnd.character})"><span class="hoverable-text">ERROR</span> <span style="color: #6e7781;">[${eStart.line}, ${eStart.character}] - [${eEnd.line}, ${eEnd.character}]</span></div>`,
              );
            }
          }
        }
      }

      let childOffset = currentOffset;
      let childPtr = mem32[(ptr + 8) / 4];
      let visited = new Set<number>();

      while (childPtr) {
        if (visited.has(childPtr)) {
          childStrs.push(
            `<div style="margin-left: ${(depth + 1) * 20}px; color: #8c959f; margin-top: 4px;">CYCLE</div>`,
          );
          break;
        }
        visited.add(childPtr);

        const childResult = toHtml(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        for (const s of childResult.strs) {
          if (s) childStrs.push(s);
        }
        childOffset = childResult.nextOffset;

        childPtr = mem32[(childPtr + 12) / 4];
      }

      if (!shouldPrint) {
        return { strs: childStrs, nextOffset: endOffset };
      }

      let str = `<div class="ast-node" style="margin-left: ${depth * 20}px;" onclick="window.highlightNode(${startPos.line}, ${startPos.character}, ${endPos.line}, ${endPos.character})"><span class="hoverable-text">${typeName}</span> ${posStr}</div>`;
      if (childStrs.length > 0) {
        for (const cs of childStrs) {
          str += cs;
        }
      }
      return { strs: [str], nextOffset: endOffset };
    };

    const rootResult = toHtml(astRoot, 0, 0);
    let str = rootResult.strs[0] || "";

    // Append trailing errors that occur after the root node
    for (const err of errorRanges) {
      if (err.start >= rootResult.nextOffset) {
        const key = `${err.start}-${err.end}`;
        if (!printedErrors.has(key)) {
          printedErrors.add(key);
          const eStart = this.offsetToPos(err.start, lineStarts);
          const eEnd = this.offsetToPos(err.end, lineStarts);
          str += `<div class="ast-error" onclick="window.highlightNode(${eStart.line}, ${eStart.character}, ${eEnd.line}, ${eEnd.character})"><span class="hoverable-text">ERROR</span> <span style="color: #6e7781;">[${eStart.line}, ${eStart.character}] - [${eEnd.line}, ${eEnd.character}]</span></div>`;
        }
      }
    }

    return `<style>.ast-node, .ast-error { cursor: pointer; margin-top: 4px; display: block; width: fit-content; } .ast-node { color: #0969da; } .ast-error { color: #cf222e; } .ast-node:hover > .hoverable-text, .ast-error:hover > .hoverable-text { text-decoration: underline; }</style><div style="font-size: 15px; font-family: monospace; padding: 10px; line-height: 1.2;">${str}</div>`;
  }

  garbageCollect(rootToKeep: number): void {
    if (this.exports.clearAstMarks) {
      this.exports.clearAstMarks(rootToKeep);
    }
  }
}
