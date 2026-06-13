/* eslint-disable */
import { NormalizedGrammar } from "../grammar.js";

export function generateJavaScriptWrapper(grammarDef: any, normalized: NormalizedGrammar): { js: string; dts: string } {
  const lang = grammarDef.name;

  const js = `// Auto-generated JavaScript Wrapper for ${lang}

export const InputEncoding = {
    UTF8: 0,
    UTF16LE: 1,
    UTF16BE: 2,
    UTF32LE: 3,
    UTF32BE: 4
};

export class ASTNode {
    constructor(runtime, ptr) {
        this.runtime = runtime;
        this.ptr = ptr;
    }

    getPtr() { return this.ptr; }
    getTypeId() { return this.runtime.getNodeType(this.ptr); }

    getFirstChild() {
        const childPtr = this.runtime.getNodeFirstChild(this.ptr);
        return childPtr === 0 ? null : new ASTNode(this.runtime, childPtr);
    }

    getNextSibling() {
        const siblingPtr = this.runtime.getNodeNextSibling(this.ptr);
        return siblingPtr === 0 ? null : new ASTNode(this.runtime, siblingPtr);
    }
}

export class UnifiedIRInstr {
    constructor(runtime, ptr) {
        this.runtime = runtime;
        this.ptr = ptr;
    }

    get opcode() { return (this.runtime.readU32(this.ptr) & 0xFFFF); }
    get typeId() { return (this.runtime.readU32(this.ptr) >>> 16); }
    get operand1() { return this.runtime.readU32(this.ptr + 4); }
    get operand2() { return this.runtime.readU32(this.ptr + 8); }
    
    get nextInstr() {
        const nextPtr = this.runtime.readU32(this.ptr + 12);
        return nextPtr === 0 ? null : new UnifiedIRInstr(this.runtime, nextPtr);
    }
}

export class Parser {
    constructor(runtime) {
        this.runtime = runtime;
    }

    setEncoding(encoding) {
        this.runtime.setInputEncoding(encoding);
    }

    parse(source, oldTree = null, editStart = 0, editOldEnd = 0) {
        let view;
        if (typeof source === 'string') {
            const encoder = new TextEncoder();
            view = encoder.encode(source);
        } else {
            view = source;
        }
        
        const inputPtr = this.runtime.ensureInputBuffer ? this.runtime.ensureInputBuffer(view.length) : this.runtime.getInputBuffer();
        this.runtime.writeU8Array(inputPtr, view);
        
        const oldTreePtr = oldTree ? oldTree.getPtr() : 0;
        const astRoot = this.runtime.parse(oldTreePtr, editStart, editOldEnd, view.length);
        return astRoot === 0 ? null : new ASTNode(this.runtime, astRoot);
    }

    readString(ptr) {
        if (ptr === 0) return "";
        const lenBytes = this.runtime.readU32(ptr - 4);
        const lenChars = lenBytes / 2;
        let str = "";
        for (let i = 0; i < lenChars; i++) {
            str += String.fromCharCode(this.runtime.readU16(ptr + (i * 2)));
        }
        return str;
    }
}

export class WasmRuntime {
    constructor(wasmExports, memory) {
        this.wasmExports = wasmExports;
        this.mem32 = new Uint32Array(memory.buffer);
        this.mem16 = new Uint16Array(memory.buffer);
        this.mem8 = new Uint8Array(memory.buffer);
    }

    readU32(ptr) { return this.mem32[ptr / 4]; }
    readU16(ptr) { return this.mem16[ptr / 2]; }
    writeU8Array(ptr, data) { this.mem8.set(data, ptr); }

    getInputBuffer() { return this.wasmExports.getInputBuffer(); }
    ensureInputBuffer(size) { return this.wasmExports.ensureInputBuffer ? this.wasmExports.ensureInputBuffer(size) : this.getInputBuffer(); }
    setInputEncoding(enc) { if (this.wasmExports.setInputEncoding) this.wasmExports.setInputEncoding(enc); }
    parse(oldTreePtr, editStart, editOldEnd, editNewEnd) { return this.wasmExports.parse(oldTreePtr, editStart, editOldEnd, editNewEnd); }

    getNodeFirstChild(ptr) { return this.mem32[(ptr + 8) / 4]; }
    getNodeNextSibling(ptr) { return this.mem32[(ptr + 12) / 4]; }
    getNodeType(ptr) { return this.mem32[ptr / 4] & 0x03FF; }
    
    static getWasmImports(onTextEdit, getMemory) {
        return {
            env: {
                emitTextEdit: (startByte, endByte, newSourcePtr) => {
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
                }
            }
        };
    }
}

export class ParserThreadPool {
    constructor(wasmModule, sharedMemory, poolSize = 4) {
        this.wasmModule = wasmModule;
        this.sharedMemory = sharedMemory;
        this.workers = [];
        this.idleWorkers = [];
        this.queue = [];
        this.poolSize = poolSize;
        this.initPool();
    }

    initPool() {
        const workerCode = \`
            self.onmessage = async (e) => {
                const { type, wasmModule, sharedMemory, fileId, text } = e.data;
                if (type === 'init') {
                    self.sharedMemory = sharedMemory;
                    self.wasmInstance = new WebAssembly.Instance(wasmModule, {
                        env: {
                            memory: sharedMemory,
                            abort: (msgPtr, filePtr, line, column) => {
                                let msg = "WASM aborted in worker";
                                if (msgPtr && self.sharedMemory) {
                                    try {
                                        const mem = new Uint32Array(self.sharedMemory.buffer);
                                        const len = mem[(msgPtr - 4) >>> 2];
                                        const utf16 = new Uint16Array(self.sharedMemory.buffer, msgPtr, len >>> 1);
                                        msg = String.fromCharCode.apply(null, utf16);
                                        
                                        const fileLen = mem[(filePtr - 4) >>> 2];
                                        const fileUtf16 = new Uint16Array(self.sharedMemory.buffer, filePtr, fileLen >>> 1);
                                        const fileName = String.fromCharCode.apply(null, fileUtf16);
                                        
                                        msg += " at " + fileName + ":" + line + ":" + column;
                                    } catch (e) {
                                        msg += " (Failed to decode message)";
                                    }
                                }
                                console.error(msg);
                            }
                        },
                        engine: {}
                    });
                    self.postMessage({ type: 'ready' });
                } else if (type === 'parse') {
                    try {
                        const encoder = new TextEncoder();
                        const view = encoder.encode(text);
                        
                        const inputPtr = self.wasmInstance.exports.ensureInputBuffer ? 
                            self.wasmInstance.exports.ensureInputBuffer(view.length) : 
                            self.wasmInstance.exports.getInputBuffer();
                        const mem8 = new Uint8Array(self.sharedMemory.buffer);
                        mem8.set(view, inputPtr);
                        
                        const astRoot = self.wasmInstance.exports.parse(0, 0, 0, view.length);
                        
                        // We must call cacheNodeStrings to save literals before next parse
                        if (astRoot !== 0 && self.wasmInstance.exports.cacheNodeStrings) {
                            const padding = self.wasmInstance.exports.getNodePadding ? self.wasmInstance.exports.getNodePadding(astRoot) : 0;
                            self.wasmInstance.exports.cacheNodeStrings(astRoot, padding);
                        }

                        self.postMessage({ type: 'done', fileId, astRoot });
                    } catch (err) {
                        self.postMessage({ type: 'error', fileId, error: err.toString() });
                    }
                }
            };
        \`;
        
        let workerUrl;
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            workerUrl = URL.createObjectURL(blob);
        } else {
            workerUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(workerCode);
        }

        for (let i = 0; i < this.poolSize; i++) {
            const worker = typeof Worker !== 'undefined' ? new Worker(workerUrl) : null;
            if (worker) {
                worker.onmessage = (e) => this.handleMessage(worker, e.data);
                worker.postMessage({ type: 'init', wasmModule: this.wasmModule, sharedMemory: this.sharedMemory });
                this.workers.push(worker);
            }
        }
    }

    handleMessage(worker, data) {
        if (data.type === 'ready') {
            this.makeIdle(worker);
        } else if (data.type === 'done' || data.type === 'error') {
            // Find the pending job resolve callback
            const pendingIdx = this.queue.findIndex(j => j.fileId === data.fileId);
            if (pendingIdx !== -1) {
                const job = this.queue.splice(pendingIdx, 1)[0];
                if (data.type === 'error') {
                    job.reject(new Error(data.error));
                } else {
                    job.resolve(data.astRoot);
                }
            }
            this.makeIdle(worker);
        }
    }

    makeIdle(worker) {
        // Find next job waiting that hasn't been assigned
        const nextJob = this.queue.find(j => !j.assigned);
        if (nextJob) {
            nextJob.assigned = true;
            worker.postMessage({ type: 'parse', fileId: nextJob.fileId, text: nextJob.text });
        } else {
            this.idleWorkers.push(worker);
        }
    }

    async parseAsync(fileId, text) {
        return new Promise((resolve, reject) => {
            const job = { fileId, text, resolve, reject, assigned: false };
            this.queue.push(job);
            
            if (this.idleWorkers.length > 0) {
                const worker = this.idleWorkers.pop();
                this.makeIdle(worker); // Will instantly assign the job we just pushed
            }
        });
    }
}

export class NativeRuntime {
    constructor(nativeAddon) {
        this.nativeAddon = nativeAddon;
    }

    readU32(ptr) { return this.nativeAddon.readU32(ptr); }
    readU16(ptr) { return this.nativeAddon.readU16(ptr); }
    writeU8Array(ptr, data) { this.nativeAddon.writeU8Array(ptr, data); }

    getInputBuffer() { return this.nativeAddon.getInputBuffer(); }
    ensureInputBuffer(size) { return this.nativeAddon.ensureInputBuffer ? this.nativeAddon.ensureInputBuffer(size) : this.getInputBuffer(); }
    setInputEncoding(enc) { if (this.nativeAddon.setInputEncoding) this.nativeAddon.setInputEncoding(enc); }
    parse(oldTreePtr, editStart, editOldEnd, editNewEnd) { return this.nativeAddon.parse(oldTreePtr, editStart, editOldEnd, editNewEnd); }

    getNodeFirstChild(ptr) { return this.nativeAddon.getNodeFirstChild(ptr); }
    getNodeNextSibling(ptr) { return this.nativeAddon.getNodeNextSibling(ptr); }
    getNodeType(ptr) { return this.nativeAddon.getNodeType ? this.nativeAddon.getNodeType(ptr) : (this.readU32(ptr) & 0x03FF); }
}
`;

  const dts = `// Auto-generated TypeScript Declarations for ${lang}

export enum InputEncoding {
    UTF8 = 0,
    UTF16LE = 1,
    UTF16BE = 2,
    UTF32LE = 3,
    UTF32BE = 4
}

export interface RuntimeAdapter {
    readU32(ptr: number): number;
    readU16(ptr: number): number;
    writeU8Array(ptr: number, data: Uint8Array): void;
    
    getInputBuffer(): number;
    ensureInputBuffer?(size: number): number;
    setInputEncoding(enc: number): void;
    parse(oldTreePtr: number, editStart: number, editOldEnd: number, editNewEnd: number): number;
    
    getNodeFirstChild(ptr: number): number;
    getNodeNextSibling(ptr: number): number;
    getNodeType(ptr: number): number;
}

export class ASTNode {
    constructor(runtime: RuntimeAdapter, ptr: number);
    getPtr(): number;
    getTypeId(): number;
    getFirstChild(): ASTNode | null;
    getNextSibling(): ASTNode | null;
}

export class UnifiedIRInstr {
    constructor(runtime: RuntimeAdapter, ptr: number);
    get opcode(): number;
    get typeId(): number;
    get operand1(): number;
    get operand2(): number;
    get nextInstr(): UnifiedIRInstr | null;
}

export class Parser {
    constructor(runtime: RuntimeAdapter);
    setEncoding(encoding: InputEncoding): void;
    parse(source: string | Uint8Array, oldTree?: ASTNode | null, editStart?: number, editOldEnd?: number): ASTNode | null;
    readString(ptr: number): string;
}

export class WasmRuntime implements RuntimeAdapter {
    constructor(wasmExports: any, memory: WebAssembly.Memory);
    readU32(ptr: number): number;
    readU16(ptr: number): number;
    writeU8Array(ptr: number, data: Uint8Array): void;
    getInputBuffer(): number;
    setInputEncoding(enc: number): void;
    parse(len: number): number;
    getNodeFirstChild(ptr: number): number;
    getNodeNextSibling(ptr: number): number;
    
    static getWasmImports(onTextEdit: (start: number, end: number, text: string) => void, getMemory: () => WebAssembly.Memory): any;
}

export class NativeRuntime implements RuntimeAdapter {
    constructor(nativeAddon: any);
    readU32(ptr: number): number;
    readU16(ptr: number): number;
    writeU8Array(ptr: number, data: Uint8Array): void;
    getInputBuffer(): number;
    setInputEncoding(enc: number): void;
    parse(len: number): number;
    getNodeFirstChild(ptr: number): number;
    getNodeNextSibling(ptr: number): number;
}
`;

  return { js, dts };
}
