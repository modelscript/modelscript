// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Transpiles AssemblyScript `.wasm` kernels into portable C99 via WABT's `wasm2c`
 * and auto-generates N-API wrapper bindings for `@modelscript/native`.
 *
 * Usage:
 *   npx tsx scripts/build/wasm2c-codegen.ts [--skip-asc] [--wabt-version=1.0.36]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WABT_VERSION =
  process.argv.find((a) => a.startsWith("--wabt-version="))?.split("=")[1] ??
  process.env["WABT_VERSION"] ??
  "1.0.36";

const SKIP_ASC = process.argv.includes("--skip-asc");
const INCLUDE_LANGUAGES = process.argv.includes("--include-languages");
const GENERATED_DIR = path.join(REPO_ROOT, "packages", "native", "generated");
const RUNTIME_DIR = path.join(GENERATED_DIR, "wasm2c_rt");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", `wabt-${WABT_VERSION}`);

interface WasmTargetSpec {
  id: string;
  cModuleName: string;
  packageFilter: string;
  ascScript: string;
  wasmPath: string;
}

const CORE_TARGETS: WasmTargetSpec[] = [
  {
    id: "runtime",
    cModuleName: "ms_runtime",
    packageFilter: "@modelscript/runtime",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "packages", "runtime", "build", "native.wasm"),
  },
  {
    id: "simulate",
    cModuleName: "ms_simulate",
    packageFilter: "@modelscript/simulate",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "packages", "simulate", "build", "simulate-native.wasm"),
  },
];

const LANGUAGE_TARGETS: WasmTargetSpec[] = [
  {
    id: "lang_psse",
    cModuleName: "ms_lang_psse",
    packageFilter: "@modelscript/psse",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "languages", "psse", "build", "dyr-kernel-native.wasm"),
  },
  {
    id: "lang_simpack",
    cModuleName: "ms_lang_simpack",
    packageFilter: "@modelscript/simpack",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "languages", "simpack", "build", "kinematics-native.wasm"),
  },
  {
    id: "lang_gensys",
    cModuleName: "ms_lang_gensys",
    packageFilter: "@modelscript/gensys",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "languages", "gensys", "build", "contact-native.wasm"),
  },
  {
    id: "lang_relap5",
    cModuleName: "ms_lang_relap5",
    packageFilter: "@modelscript/relap5",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "languages", "relap5", "build", "point_kinetics-native.wasm"),
  },
  {
    id: "lang_pscad",
    cModuleName: "ms_lang_pscad",
    packageFilter: "@modelscript/pscad",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "languages", "pscad", "build", "psout-native.wasm"),
  },
  {
    id: "lang_sima",
    cModuleName: "ms_lang_sima",
    packageFilter: "@modelscript/sima",
    ascScript: "asbuild:native",
    wasmPath: path.join(REPO_ROOT, "languages", "sima", "build", "catenary-native.wasm"),
  },
];

const TARGETS: WasmTargetSpec[] = INCLUDE_LANGUAGES ? [...CORE_TARGETS, ...LANGUAGE_TARGETS] : CORE_TARGETS;

function getWabtAssetName(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === "linux" && a === "x64") return `wabt-${WABT_VERSION}-ubuntu-20.04.tar.gz`;
  if (p === "darwin" && a === "arm64") return `wabt-${WABT_VERSION}-macos-14.tar.gz`;
  if (p === "darwin" && a === "x64") return `wabt-${WABT_VERSION}-macos-12.tar.gz`;
  if (p === "win32" && a === "x64") return `wabt-${WABT_VERSION}-windows.tar.gz`;
  throw new Error(
    `No prebuilt WABT ${WABT_VERSION} archive known for ${p}-${a}. Install wabt via system package manager and set WASM2C_BIN.`,
  );
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function ensureWasm2c(): Promise<string> {
  if (process.env["WASM2C_BIN"] && fs.existsSync(process.env["WASM2C_BIN"])) {
    return process.env["WASM2C_BIN"];
  }

  // Check PATH first
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const found = execFileSync(cmd, ["wasm2c"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) {
      return found;
    }
  } catch {
    // Not on PATH — fall through to cached download
  }

  const exe = process.platform === "win32" ? "wasm2c.exe" : "wasm2c";
  const cachedBin = path.join(CACHE_DIR, `wabt-${WABT_VERSION}`, "bin", exe);
  if (fs.existsSync(cachedBin)) {
    return cachedBin;
  }

  const asset = getWabtAssetName();
  const url = `https://github.com/WebAssembly/wabt/releases/download/${WABT_VERSION}/${asset}`;
  const archivePath = path.join(CACHE_DIR, asset);
  console.log(`[wasm2c] Downloading WABT ${WABT_VERSION} from ${url}...`);
  await downloadFile(url, archivePath);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", CACHE_DIR], { stdio: "inherit" });

  if (!fs.existsSync(cachedBin)) {
    throw new Error(`Expected wasm2c binary at ${cachedBin} after extracting ${archivePath}`);
  }
  return cachedBin;
}

const WABT_RT_FILES = [
  "wasm-rt.h",
  "wasm-rt-impl.h",
  "wasm-rt-impl.c",
  "wasm-rt-impl-tableops.inc",
  "wasm-rt-exceptions.h",
  "wasm-rt-exceptions-impl.c",
  "wasm-rt-mem-impl.c",
  "wasm-rt-mem-impl-helper.inc",
];

function detectWasm2cVersion(wasm2cBin: string): string {
  try {
    const out = execFileSync(wasm2cBin, ["--version"], { encoding: "utf8" }).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    if (m) return m[1]!;
  } catch {
    // fallback
  }
  return WABT_VERSION;
}

async function ensureWabtRuntimeSources(version: string): Promise<void> {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const versionStamp = path.join(RUNTIME_DIR, ".wabt-version");
  const currentStamp = fs.existsSync(versionStamp) ? fs.readFileSync(versionStamp, "utf8").trim() : "";
  const needsRefresh = currentStamp !== version;

  const missing = needsRefresh
    ? WABT_RT_FILES
    : WABT_RT_FILES.filter((f) => !fs.existsSync(path.join(RUNTIME_DIR, f)));
  if (missing.length === 0) return;

  console.log(`[wasm2c] Fetching WABT ${version} wasm-rt C runtime files (${missing.length})...`);
  for (const file of missing) {
    const localCandidate = path.join(CACHE_DIR, `wabt-${version}`, "share", "wabt", "wasm2c", file);
    if (fs.existsSync(localCandidate)) {
      fs.copyFileSync(localCandidate, path.join(RUNTIME_DIR, file));
      continue;
    }
    const url = `https://raw.githubusercontent.com/WebAssembly/wabt/${version}/wasm2c/${file}`;
    await downloadFile(url, path.join(RUNTIME_DIR, file));
  }
  fs.writeFileSync(versionStamp, version, "utf8");
}

const SIMDE_VERSION = "0.8.2";
const SIMDE_DIR = path.join(REPO_ROOT, ".cache", `simde-${SIMDE_VERSION}`);

async function ensureSimdeHeaders(): Promise<string> {
  const simdeIncludeRoot = path.join(SIMDE_DIR, `simde-${SIMDE_VERSION}`);
  const marker = path.join(simdeIncludeRoot, "simde", "wasm", "simd128.h");
  if (fs.existsSync(marker)) {
    return simdeIncludeRoot;
  }

  const archivePath = path.join(SIMDE_DIR, `simde-${SIMDE_VERSION}.tar.gz`);
  const url = `https://github.com/simd-everywhere/simde/archive/refs/tags/v${SIMDE_VERSION}.tar.gz`;
  console.log(`[wasm2c] Downloading header-only SIMDe v${SIMDE_VERSION}...`);
  await downloadFile(url, archivePath);
  fs.mkdirSync(SIMDE_DIR, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", SIMDE_DIR], { stdio: "inherit" });
  return simdeIncludeRoot;
}

interface ParsedExport {
  jsName: string;
  cName: string;
  retType: string;
  params: string[];
}

function unmangleWasm2cName(cName: string, cPrefix: string): string {
  // wasm2c encodes '_' as '__' and non-alnum as '_XX' (hex)
  const raw = cName.slice(cPrefix.length);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "_") {
      if (raw[i + 1] === "_") {
        out += "_";
        i++;
      } else if (i + 2 < raw.length && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
        out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        out += "_";
      }
    } else {
      out += raw[i];
    }
  }
  return out;
}

function parseHeaderExports(headerContent: string, cModuleName: string): {
  structName: string;
  exports: ParsedExport[];
  hasMemoryExport: string | null;
} {
  // wasm2c mangles '_' in module names to '__'
  const mangledMod = cModuleName.replace(/_/g, "__");
  const structName = `w2c_${mangledMod}`;
  const fnPrefix = `${structName}_`;

  const exports: ParsedExport[] = [];
  let hasMemoryExport: string | null = null;

  const lines = headerContent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Detect exported memory getter: `wasm_rt_memory_t* w2c_<mod>_memory(w2c_<mod>* instance);`
    const memMatch = line.match(new RegExp(`^wasm_rt_memory_t\\*\\s+(${fnPrefix}\\w+)\\(${structName}\\*\\s+instance\\);$`));
    if (memMatch) {
      hasMemoryExport = memMatch[1]!;
      continue;
    }

    // Detect exported function declarations:
    // e.g. `u32 w2c_ms__simulate_mesh_createBoxTets(w2c_ms__simulate*, u32, u32, u32, u32);`
    const fnMatch = line.match(
      new RegExp(`^(void|u32|i32|u64|i64|f32|f64)\\s+(${fnPrefix}[A-Za-z0-9_]+)\\(([^)]*)\\);$`),
    );
    if (!fnMatch) continue;

    const retType = fnMatch[1]!;
    const cName = fnMatch[2]!;
    const rawParams = fnMatch[3]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // First param must be `<structName>*`
    if (rawParams.length === 0 || !rawParams[0]!.startsWith(`${structName}*`)) continue;

    const params = rawParams.slice(1).map((p) => p.split(/\s+/)[0]!);
    // Only bind scalar numeric/void functions (skip multi-value struct returns or v128)
    const validTypes = new Set(["u32", "i32", "u64", "i64", "f32", "f64"]);
    if (!params.every((t) => validTypes.has(t))) continue;

    // Look for comment above `/* export: '...' */` for exact JS export name
    let jsName = unmangleWasm2cName(cName, fnPrefix);
    if (i > 0) {
      const prev = lines[i - 1]!.trim();
      const commentMatch = prev.match(/^\/\*\s*export:\s*'([^']+)'\s*\*\/$/);
      if (commentMatch) {
        jsName = commentMatch[1]!;
      }
    }

    exports.push({ jsName, cName, retType, params });
  }

  return { structName, exports, hasMemoryExport };
}

function generateNapiBindings(spec: WasmTargetSpec, headerPath: string): void {
  const headerContent = fs.readFileSync(headerPath, "utf8");
  const { structName, exports, hasMemoryExport } = parseHeaderExports(headerContent, spec.cModuleName);

  const lines: string[] = [
    "// AUTO-GENERATED BY scripts/build/wasm2c-codegen.ts — DO NOT EDIT",
    `#include <node_api.h>`,
    `#include <stdint.h>`,
    `#include <stdlib.h>`,
    `#include <string.h>`,
    `#include "${spec.cModuleName}.h"`,
    ``,
    `extern ${structName}* ms_get_${spec.id}_instance(void);`,
    ``,
  ];

  // Generate one N-API wrapper per exported function
  for (let idx = 0; idx < exports.length; idx++) {
    const exp = exports[idx]!;
    const wrapperName = `napi_${spec.id}_fn_${idx}`;
    lines.push(`static napi_value ${wrapperName}(napi_env env, napi_callback_info info) {`);
    if (exp.params.length > 0) {
      lines.push(`  size_t argc = ${exp.params.length};`);
      lines.push(`  napi_value argv[${exp.params.length}];`);
      lines.push(`  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);`);
    } else {
      lines.push(`  (void)info;`);
    }

    const callArgs: string[] = [`ms_get_${spec.id}_instance()`];
    for (let p = 0; p < exp.params.length; p++) {
      const pType = exp.params[p]!;
      const varName = `a${p}`;
      if (pType === "u32") {
        lines.push(`  uint32_t ${varName} = 0; if (argc > ${p}) napi_get_value_uint32(env, argv[${p}], &${varName});`);
      } else if (pType === "i32") {
        lines.push(`  int32_t ${varName} = 0; if (argc > ${p}) napi_get_value_int32(env, argv[${p}], &${varName});`);
      } else if (pType === "u64" || pType === "i64") {
        lines.push(`  int64_t ${varName} = 0; if (argc > ${p}) napi_get_value_int64(env, argv[${p}], &${varName});`);
      } else if (pType === "f32" || pType === "f64") {
        lines.push(`  double ${varName} = 0.0; if (argc > ${p}) napi_get_value_double(env, argv[${p}], &${varName});`);
      }
      callArgs.push(pType === "f32" ? `(f32)${varName}` : pType === "u64" ? `(u64)${varName}` : varName);
    }

    if (exp.retType === "void") {
      lines.push(`  ${exp.cName}(${callArgs.join(", ")});`);
      lines.push(`  napi_value undef; napi_get_undefined(env, &undef); return undef;`);
    } else {
      lines.push(`  ${exp.retType} res = ${exp.cName}(${callArgs.join(", ")});`);
      lines.push(`  napi_value out;`);
      if (exp.retType === "u32") {
        lines.push(`  napi_create_uint32(env, (uint32_t)res, &out);`);
      } else if (exp.retType === "i32") {
        lines.push(`  napi_create_int32(env, (int32_t)res, &out);`);
      } else if (exp.retType === "u64" || exp.retType === "i64") {
        lines.push(`  napi_create_int64(env, (int64_t)res, &out);`);
      } else {
        lines.push(`  napi_create_double(env, (double)res, &out);`);
      }
      lines.push(`  return out;`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  // Memory view getter: returns an ArrayBuffer backed directly by wasm_rt_memory_t::data (zero-copy)
  if (hasMemoryExport) {
    lines.push(`static napi_value napi_${spec.id}_get_memory_buffer(napi_env env, napi_callback_info info) {`);
    lines.push(`  (void)info;`);
    lines.push(`  wasm_rt_memory_t* mem = ${hasMemoryExport}(ms_get_${spec.id}_instance());`);
    lines.push(`  napi_value ab;`);
    lines.push(`  napi_status st = napi_create_external_arraybuffer(env, mem->data, mem->size, NULL, NULL, &ab);`);
    lines.push(`  if (st != napi_ok) {`);
    lines.push(`    void* copy_ptr = NULL;`);
    lines.push(`    napi_create_arraybuffer(env, mem->size, &copy_ptr, &ab);`);
    lines.push(`    if (copy_ptr && mem->data) memcpy(copy_ptr, mem->data, mem->size);`);
    lines.push(`  }`);
    lines.push(`  return ab;`);
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`napi_value ms_create_${spec.id}_napi_exports(napi_env env) {`);
  lines.push(`  napi_value obj;`);
  lines.push(`  napi_create_object(env, &obj);`);
  for (let idx = 0; idx < exports.length; idx++) {
    const exp = exports[idx]!;
    const escaped = exp.jsName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`  { napi_value fn; napi_create_function(env, "${escaped}", NAPI_AUTO_LENGTH, napi_${spec.id}_fn_${idx}, NULL, &fn); napi_set_named_property(env, obj, "${escaped}", fn); }`);
  }
  if (hasMemoryExport) {
    lines.push(`  { napi_value fn; napi_create_function(env, "__getMemoryBuffer", NAPI_AUTO_LENGTH, napi_${spec.id}_get_memory_buffer, NULL, &fn); napi_set_named_property(env, obj, "__getMemoryBuffer", fn); }`);
  }
  lines.push(`  return obj;`);
  lines.push(`}`);
  lines.push(``);

  const outPath = path.join(GENERATED_DIR, `ms_${spec.id}_napi.c`);
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`[wasm2c] Generated ${exports.length} N-API bindings → ${path.relative(REPO_ROOT, outPath)}`);
}

async function main(): Promise<void> {
  if (!SKIP_ASC) {
    for (const target of TARGETS) {
      if (!fs.existsSync(target.wasmPath)) {
        console.log(`[wasm2c] Building ${target.packageFilter} (${target.ascScript})...`);
        execFileSync("pnpm", ["--filter", target.packageFilter, "run", target.ascScript], {
          cwd: REPO_ROOT,
          stdio: "inherit",
        });
      }
    }
  }

  const wasm2cBin = await ensureWasm2c();
  const detectedVersion = detectWasm2cVersion(wasm2cBin);
  console.log(`[wasm2c] Using wasm2c ${detectedVersion} (${wasm2cBin})`);
  await ensureWabtRuntimeSources(detectedVersion);
  const simdeRoot = await ensureSimdeHeaders();
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(GENERATED_DIR, "simde_include.cmake"),
    `set(MS_SIMDE_INCLUDE_DIR "${simdeRoot.replace(/\\/g, "/")}")\n`,
    "utf8",
  );

  for (const target of TARGETS) {
    if (!fs.existsSync(target.wasmPath)) {
      throw new Error(`Missing WASM input: ${target.wasmPath}. Run without --skip-asc.`);
    }
    const outC = path.join(GENERATED_DIR, `${target.cModuleName}.c`);
    const outH = path.join(GENERATED_DIR, `${target.cModuleName}.h`);
    console.log(`[wasm2c] Transpiling ${path.relative(REPO_ROOT, target.wasmPath)} → ${path.relative(REPO_ROOT, outC)}`);
    execFileSync(wasm2cBin, [target.wasmPath, "-o", outC, "-n", target.cModuleName], {
      stdio: "inherit",
    });
    generateNapiBindings(target, outH);
  }

  console.log("[wasm2c] Codegen complete.");
}

main().catch((err) => {
  console.error("[wasm2c] Failed:", err);
  process.exit(1);
});
