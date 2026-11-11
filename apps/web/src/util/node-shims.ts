// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser-compatible polyfill stubs for Node.js built-ins in the Vite web client bundle.
 * Prevents Vite's externalization proxy from throwing runtime errors when libraries
 * like @modelscript/olga or @modelscript/pscad are pulled into the client bundle.
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
export const statSync = (): { isFile: () => boolean; isDirectory: () => boolean; size: number } => ({
  isFile: () => true,
  isDirectory: () => false,
  size: 0,
});
export const lstatSync = statSync;
export const mkdirSync = (): void => {};
export const createReadStream = (): { pipe: () => void } => ({ pipe: () => {} });
export const createWriteStream = (): { write: () => void; end: () => void } => ({ write: () => {}, end: () => {} });
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export const promises = {
  readFile: async () => "",
  writeFile: async () => {},
  readdir: async () => [],
  stat: async () => statSync(),
  mkdir: async () => {},
  unlink: async () => {},
  rm: async () => {},
  mkdtemp: async (prefix: string) => `${prefix}mock`,
};

// --- child_process ---
export const execSync = (): string => "";
export const execFileSync = (): string => "";
export const spawnSync = (): { status: number; stdout: string; stderr: string } => ({
  status: 1,
  stdout: "",
  stderr: "",
});
export const spawn = (): {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  stdout: { on: () => void };
  stderr: { on: () => void };
  kill: () => void;
} => ({
  on: (event: string, cb: (...args: unknown[]) => void) => {
    if (event === "error") {
      setTimeout(() => cb(new Error("child_process is not supported in the browser")), 0);
    }
  },
  stdout: { on: () => {} },
  stderr: { on: () => {} },
  kill: () => {},
});
export const fork = (): { on: () => void } => ({ on: () => {} });

// --- os ---
export const tmpdir = (): string => "/tmp";
export const platform = (): string => "browser";
export const arch = (): string => "wasm";
export const homedir = (): string => "/home";
export const cpus = (): Array<{ model: string; speed: number }> => [{ model: "Browser Virtual Core", speed: 2000 }];
export const release = (): string => "1.0.0";
export const endianness = (): string => "LE";
export const EOL = "\n";

const defaultExport = {
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
  execSync,
  execFileSync,
  spawnSync,
  spawn,
  fork,
  tmpdir,
  platform,
  arch,
  homedir,
  cpus,
  release,
  endianness,
  EOL,
};

export default defaultExport;
