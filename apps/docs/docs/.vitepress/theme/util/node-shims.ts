// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-compatible polyfill stubs for Node.js built-ins in VitePress client bundle.
 */

// --- path ---
export const sep = "/";
export const delimiter = ":";
export const basename = (p: string, ext?: string): string => {
  const seg =
    String(p ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "";
  if (ext && seg.endsWith(ext)) return seg.slice(0, -ext.length);
  return seg;
};
export const dirname = (p: string): string => {
  const parts = String(p ?? "")
    .replace(/\\/g, "/")
    .split("/");
  parts.pop();
  return parts.join("/") || ".";
};
export const extname = (p: string): string => {
  const b = basename(p);
  const idx = b.lastIndexOf(".");
  return idx > 0 ? b.slice(idx) : "";
};
export const isAbsolute = (p: string): boolean => String(p ?? "").startsWith("/");
export const join = (...args: string[]): string => args.filter(Boolean).join("/").replace(/\/+/g, "/");
export const normalize = (p: string): string => p;
export const relative = (_from: string, to: string): string => to;
export const resolve = (...args: string[]): string => {
  let res = "";
  for (const a of args) {
    if (!a) continue;
    if (a.startsWith("/")) res = a;
    else res = res ? `${res}/${a}` : a;
  }
  return res || "/";
};

export const posix = {
  sep,
  delimiter,
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
};

export const win32 = posix;

// --- url ---
export const fileURLToPath = (u: string | URL): string => {
  const s = typeof u === "string" ? u : (u?.href ?? "");
  return s.replace(/^file:\/\//, "");
};
export const pathToFileURL = (p: string): URL => new URL(`file://${p}`);

// --- fs ---
export const existsSync = (_path: unknown): boolean => false;
export const readFileSync = (_path: unknown, _enc?: unknown): string => "";
export const readdirSync = (_path: unknown): string[] => [];
export const writeFileSync = (): void => {};
export const appendFileSync = (): void => {};
export const unlinkSync = (): void => {};
export const rmdirSync = (): void => {};
export const rmSync = (): void => {};
export const copyFileSync = (): void => {};
export const renameSync = (): void => {};
export const accessSync = (): void => {};
export const chmodSync = (): void => {};
export const realpathSync = (p: string): string => p;
export const openSync = (): number => 0;
export const closeSync = (): void => {};
export const statSync = (): any => ({ isFile: () => true, isDirectory: () => false, size: 0 });
export const lstatSync = statSync;
export const mkdirSync = (): void => {};
export const createReadStream = (): any => ({ pipe: () => {} });
export const createWriteStream = (): any => ({ write: () => {}, end: () => {} });
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export const promises = {
  readFile: async () => "",
  writeFile: async () => {},
  readdir: async () => [],
  stat: async () => statSync(),
  mkdir: async () => {},
  unlink: async () => {},
};

// --- child_process ---
export const execSync = (): string => "";
export const execFileSync = (): string => "";
export const spawn = (): any => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } });
export const fork = (): any => ({ on: () => {} });

// --- os ---
export const tmpdir = (): string => "/tmp";
export const platform = (): string => "browser";
export const arch = (): string => "wasm";
export const homedir = (): string => "/home";
export const cpus = (): any[] => [{ model: "Browser Virtual Core", speed: 2000 }];
export const release = (): string => "1.0.0";
export const endianness = (): string => "LE";
export const EOL = "\n";

// --- crypto ---
export const randomUUID = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
};
export const randomBytes = (size: number): Uint8Array => {
  const arr = new Uint8Array(size);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(arr);
  }
  return arr;
};
export const createHash = (): any => {
  let _buf = "";
  return {
    update: (data: unknown) => {
      _buf += String(data);
      return this;
    },
    digest: (enc?: string) => (enc === "hex" ? "0".repeat(64) : new Uint8Array(32)),
  };
};
export const createHmac = createHash;

// --- http ---
export const createServer = (): any => ({ listen: () => {}, close: () => {} });
export const request = (): any => ({ on: () => {}, end: () => {} });
export const get = request;
export const Agent = class {};

// --- module ---
export const createRequire = (): any => () => ({});
export const builtinModules: string[] = [];

// --- worker_threads ---
export const isMainThread = true;
export const parentPort = null;
export class Worker {
  postMessage() {}
  on() {}
  terminate() {}
}

// --- tty ---
export const isatty = (): boolean => false;

const defaultExport = {
  // path
  sep,
  delimiter,
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  posix,
  win32,
  // url
  fileURLToPath,
  pathToFileURL,
  // fs
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  rmdirSync,
  rmSync,
  copyFileSync,
  renameSync,
  accessSync,
  chmodSync,
  realpathSync,
  openSync,
  closeSync,
  statSync,
  lstatSync,
  mkdirSync,
  createReadStream,
  createWriteStream,
  constants,
  promises,
  // child_process
  execSync,
  execFileSync,
  spawn,
  fork,
  // os
  tmpdir,
  platform,
  arch,
  homedir,
  cpus,
  release,
  endianness,
  EOL,
  // crypto
  randomUUID,
  randomBytes,
  createHash,
  createHmac,
  // http
  createServer,
  request,
  get,
  Agent,
  // module
  createRequire,
  builtinModules,
  // worker_threads
  isMainThread,
  parentPort,
  Worker,
  // tty
  isatty,
};

export default defaultExport;
