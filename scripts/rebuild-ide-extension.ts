// SPDX-License-Identifier: AGPL-3.0-or-later

import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(repoRoot, "apps/ide/dist/extension");
const ideDir = path.resolve(repoRoot, "packages/ide/src");

const builtins = [
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "diagnostics_channel",
  "events",
  "fs",
  "fs/promises",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
  "tty",
  "esbuild",
  "assemblyscript",
  "assemblyscript/asc",
  "assemblyscript/dist/asc.js",
  "binaryen",
];
const filter = new RegExp(`^(node:)?(?:${builtins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
const ignorePlugin = {
  name: "node-builtins-ignore",
  setup(build: any) {
    build.onResolve({ filter }, (args: any) => ({ path: args.path, namespace: "ignore" }));
    build.onLoad({ filter: /.*/, namespace: "ignore" }, (args: any) => {
      const mod = args.path.replace(/^node:/, "");
      if (mod === "events") {
        return {
          contents: `
class EventEmitter {
  constructor() { this._events = Object.create(null); this._eventsCount = 0; }
  static EventEmitter = EventEmitter;
  static defaultMaxListeners = 10;
  eventNames() { return Object.keys(this._events); }
  setMaxListeners(n) { this._maxListeners = n; return this; }
  getMaxListeners() { return this._maxListeners || EventEmitter.defaultMaxListeners; }
  emit(type, ...args) {
    const handler = this._events[type];
    if (!handler) return false;
    if (typeof handler === "function") { handler.apply(this, args); return true; }
    const listeners = handler.slice();
    for (let i = 0; i < listeners.length; ++i) listeners[i].apply(this, args);
    return true;
  }
  addListener(type, listener) { return this.on(type, listener); }
  on(type, listener) {
    if (typeof listener !== "function") return this;
    this._events = this._events || Object.create(null);
    if (!this._events[type]) { this._events[type] = listener; this._eventsCount++; }
    else if (typeof this._events[type] === "function") { this._events[type] = [this._events[type], listener]; }
    else { this._events[type].push(listener); }
    return this;
  }
  prependListener(type, listener) { return this.on(type, listener); }
  once(type, listener) {
    const fired = (...args) => { this.removeListener(type, fired); listener.apply(this, args); };
    return this.on(type, fired);
  }
  removeListener(type, listener) {
    const list = this._events[type];
    if (!list) return this;
    if (list === listener) { delete this._events[type]; this._eventsCount--; }
    else if (Array.isArray(list)) {
      const i = list.indexOf(listener);
      if (i !== -1) { list.splice(i, 1); if (list.length === 1) this._events[type] = list[0]; }
    }
    return this;
  }
  removeAllListeners(type) {
    if (type) delete this._events[type];
    else { this._events = Object.create(null); this._eventsCount = 0; }
    return this;
  }
  listenerCount(type) {
    const list = this._events[type];
    return !list ? 0 : typeof list === "function" ? 1 : list.length;
  }
  rawListeners(type) {
    const list = this._events[type];
    return !list ? [] : typeof list === "function" ? [list] : list.slice();
  }
  off(type, listener) { return this.removeListener(type, listener); }
}
module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;
module.exports.default = EventEmitter;
`,
          loader: "js",
        };
      }
      if (mod === "path") {
        return {
          contents: `
const path = {
  resolve(...args) { return path.normalize(path.join(...args)); },
  normalize(p) {
    const parts = (p || '').split('/').filter(Boolean);
    const res = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') res.pop();
      else res.push(part);
    }
    return (p.startsWith('/') ? '/' : '') + res.join('/') || (p.startsWith('/') ? '/' : '.');
  },
  isAbsolute(p) { return (p || '').startsWith('/'); },
  join(...args) { return path.normalize(args.filter(Boolean).join('/')); },
  relative(from, to) { return to; },
  dirname(p) {
    const parts = (p || '').replace(/\\\\+/g, '/').replace(/\\\\+$/, '').split('/');
    parts.pop();
    return parts.join('/') || (p.startsWith('/') ? '/' : '.');
  },
  basename(p, ext) {
    let f = (p || '').split('/').filter(Boolean).pop() || '';
    if (ext && f.endsWith(ext)) f = f.slice(0, -ext.length);
    return f;
  },
  extname(p) {
    const b = path.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
  },
  sep: '/',
  delimiter: ':',
};
path.posix = path;
path.win32 = path;
module.exports = path;
module.exports.default = path;
`,
          loader: "js",
        };
      }
      if (mod === "buffer") {
        return {
          contents: `
class Buffer extends Uint8Array {
  static from(val) {
    if (typeof val === 'string') return new TextEncoder().encode(val);
    if (ArrayBuffer.isView(val)) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    if (val instanceof ArrayBuffer) return new Uint8Array(val);
    return new Uint8Array(val);
  }
  static alloc(size) { return new Uint8Array(size); }
  static isBuffer(val) { return val instanceof Uint8Array; }
  toString(enc) { return new TextDecoder().decode(this); }
}
module.exports = { Buffer };
module.exports.Buffer = Buffer;
module.exports.default = { Buffer };
`,
          loader: "js",
        };
      }
      if (mod === "crypto") {
        return {
          contents: `
const webCrypto = typeof crypto !== 'undefined' ? crypto : {};
module.exports = {
  randomUUID: () => (webCrypto.randomUUID ? webCrypto.randomUUID() : '00000000-0000-0000-0000-000000000000'),
  randomBytes: (n) => new Uint8Array(n),
  createHash: () => ({ update: () => {}, digest: () => '' }),
};
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "module") {
        return {
          contents: `
function createRequire() {
  return function() { return {}; };
}
module.exports = { createRequire };
module.exports.createRequire = createRequire;
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      return { contents: "", loader: "js" };
    });
  },
};

console.log("Rebuilding browserClientMain.js and webviews...");
const startTime = Date.now();

await esbuild.build({
  entryPoints: [path.join(ideDir, "browser-client-main.ts")],
  outfile: path.join(outDir, "dist", "browserClientMain.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["vscode"],
  define: {
    "process.env": JSON.stringify({}),
    "process.browser": "true",
  },
  banner: {
    js: `if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = class Buffer extends Uint8Array {
    static from(val) {
      if (typeof val === "string") return new TextEncoder().encode(val);
      if (ArrayBuffer.isView(val)) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
      if (val instanceof ArrayBuffer) return new Uint8Array(val);
      return new Uint8Array(val);
    }
    static alloc(size) { return new Uint8Array(size); }
    static isBuffer(val) { return val instanceof Uint8Array; }
    toString(enc) { return new TextDecoder().decode(this); }
  };
}
if (typeof globalThis.process === "undefined") {
  globalThis.process = {
    env: {},
    cwd: () => "/",
    platform: "browser",
    pid: 1,
    version: "v18.0.0",
    argv: ["node", "script"],
    nextTick: (cb) => setTimeout(cb, 0),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    hrtime: Object.assign((prev) => [0, 0], { bigint: () => BigInt(0) }),
  };
}
if (typeof self !== "undefined" && typeof self.process === "undefined") {
  self.process = globalThis.process;
}`,
  },
  plugins: [ignorePlugin],
  logOverride: {
    "duplicate-object-key": "silent",
    "empty-import-meta": "silent",
  },
  sourcemap: "linked",
});

await esbuild.build({
  entryPoints: [path.join(ideDir, "webview/diagram.ts")],
  outfile: path.join(outDir, "dist", "diagram.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  sourcemap: "linked",
  external: ["@kitware/vtk.js", "@kitware/vtk.js/*"],
  define: {
    "process.env": JSON.stringify({}),
    "process.browser": "true",
  },
  logOverride: {
    "duplicate-object-key": "silent",
    "empty-import-meta": "silent",
  },
});

console.log(`Rebuild completed in ${Date.now() - startTime}ms!`);
