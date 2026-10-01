// SPDX-License-Identifier: AGPL-3.0-or-later

import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

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
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "ignore" }));
    build.onLoad({ filter: /.*/, namespace: "ignore" }, (args) => {
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
    const g = (...args) => { this.removeListener(type, g); listener.apply(this, args); };
    g.listener = listener;
    return this.on(type, g);
  }
  prependOnceListener(type, listener) { return this.once(type, listener); }
  removeListener(type, listener) {
    if (!this._events || !this._events[type]) return this;
    const list = this._events[type];
    if (list === listener || (list.listener && list.listener === listener)) {
      if (--this._eventsCount === 0) this._events = Object.create(null);
      else delete this._events[type];
    } else if (Array.isArray(list)) {
      const idx = list.findIndex(l => l === listener || (l.listener && l.listener === listener));
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 1) this._events[type] = list[0];
      }
    }
    return this;
  }
  off(type, listener) { return this.removeListener(type, listener); }
  removeAllListeners(type) {
    if (!this._events) return this;
    if (!type) { this._events = Object.create(null); this._eventsCount = 0; return this; }
    if (this._events[type]) {
      if (--this._eventsCount === 0) this._events = Object.create(null);
      else delete this._events[type];
    }
    return this;
  }
  listeners(type) {
    const ev = this._events && this._events[type];
    if (!ev) return [];
    return typeof ev === "function" ? [ev] : ev.slice();
  }
  rawListeners(type) { return this.listeners(type); }
  listenerCount(type) {
    const ev = this._events && this._events[type];
    if (!ev) return 0;
    return typeof ev === "function" ? 1 : ev.length;
  }
}
EventEmitter.EventEmitter = EventEmitter;
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
    const parts = (p || '').replace(/\\/+/g, '/').replace(/\\/+$/, '').split('/');
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
      if (mod === "util") {
        return {
          contents: `
module.exports = {
  inherits: function(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor;
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
    }
  },
  promisify: function(fn) {
    return function(...args) {
      return new Promise((resolve, reject) => {
        fn(...args, (err, res) => err ? reject(err) : resolve(res));
      });
    };
  },
  format: function(...args) { return args.join(' '); },
  types: {},
};
`,
          loader: "js",
        };
      }
      if (mod === "url") {
        return {
          contents: `
function fileURLToPath(u) {
  if (!u) return '';
  const str = typeof u === 'string' ? u : (u.href || u.toString());
  return str.replace(/^file:\\/\\//, '');
}
function pathToFileURL(filepath) {
  return new URL('file://' + filepath);
}
module.exports = {
  fileURLToPath,
  pathToFileURL,
  URL: typeof URL !== 'undefined' ? URL : class {},
  URLSearchParams: typeof URLSearchParams !== 'undefined' ? URLSearchParams : class {},
};
module.exports.fileURLToPath = fileURLToPath;
module.exports.pathToFileURL = pathToFileURL;
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "fs" || mod === "fs/promises") {
        return {
          contents: `
const noop = () => {};
const asyncNoop = async () => {};
const statObj = { isFile: () => false, isDirectory: () => false, size: 0, mtime: new Date() };
const promises = {
  readFile: async () => '',
  writeFile: asyncNoop,
  mkdir: asyncNoop,
  readdir: async () => [],
  stat: async () => statObj,
  lstat: async () => statObj,
  unlink: asyncNoop,
  rm: asyncNoop,
  access: asyncNoop,
};
module.exports = {
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: noop,
  mkdirSync: noop,
  readdirSync: () => [],
  rmSync: noop,
  unlinkSync: noop,
  statSync: () => statObj,
  lstatSync: () => statObj,
  accessSync: noop,
  promises,
  ...promises,
};
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "os") {
        return {
          contents: `
module.exports = {
  tmpdir: () => '/tmp',
  homedir: () => '/home',
  platform: () => 'browser',
  arch: () => 'wasm',
  release: () => '1.0.0',
  type: () => 'Browser',
  cpus: () => [],
  totalmem: () => 1024 * 1024 * 1024,
  freemem: () => 1024 * 1024 * 1024,
  EOL: '\\n',
};
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "child_process") {
        return {
          contents: `
module.exports = {
  spawn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, kill: () => {} }),
  exec: (cmd, cb) => cb && cb(new Error("Not supported in browser")),
  execSync: () => '',
};
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "net") {
        return {
          contents: `
module.exports = {
  createConnection: () => ({ on: () => {}, write: () => {}, end: () => {}, destroy: () => {} }),
  connect: () => ({ on: () => {}, write: () => {}, end: () => {}, destroy: () => {} }),
  createServer: () => ({ listen: () => {}, on: () => {}, close: () => {} }),
};
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "readline") {
        return {
          contents: `
module.exports = {
  createInterface: () => ({ on: () => {}, close: () => {} }),
};
module.exports.default = module.exports;
`,
          loader: "js",
        };
      }
      if (mod === "zlib") {
        return {
          contents: `
module.exports = {
  inflateRawSync: (b) => b,
  deflateRawSync: (b) => b,
  gzipSync: (b) => b,
  gunzipSync: (b) => b,
};
module.exports.default = module.exports;
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

async function run() {
  console.log("Bundling browserServerMain.ts and indexer.worker.ts with esbuild...");
  await esbuild.build({
    entryPoints: [
      path.resolve(pkgDir, "src/browserServerMain.ts"),
      path.resolve(pkgDir, "src/workers/indexer.worker.ts"),
    ],
    outdir: path.join(pkgDir, "dist"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: false,
    keepNames: true,
    sourcemap: "inline",
    define: {
      "process.env": "{}",
      "process.browser": "true",
      "import.meta.url": "''",
    },
    plugins: [ignorePlugin],
  });
  console.log("Bundle completed successfully!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
