// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly compiler wrapper.
 *
 * Invokes Emscripten (`emcc`) to compile generated C source code into a
 * WebAssembly module (.wasm + .js glue).  Node.js only — requires
 * `child_process`, `fs`, `os`, and `path`.
 *
 * Falls back gracefully when Emscripten is not installed: the C source
 * is still bundled in the FMU archive for manual compilation.
 */

/** Result of a WASM compilation attempt. */
export interface WasmCompileResult {
  /** The compiled .wasm binary (null if compilation failed). */
  wasm: Uint8Array | null;
  /** Emscripten JS glue code (null if compilation failed). */
  jsGlue: string | null;
  /** Whether compilation succeeded. */
  success: boolean;
  /** Error or informational message. */
  message: string;
}

/**
 * Compile a C source string to WebAssembly using Emscripten.
 *
 * @param cSource             The C source code to compile
 * @param modelIdentifier     Model name (used for output file naming)
 * @param exportedFunctions   List of C function names to export (with underscore prefix)
 * @param options             Optional compiler settings
 * @returns Compilation result with WASM bytes and JS glue
 */
export async function compileToWasm(
  cSource: string,
  modelIdentifier: string,
  exportedFunctions: string[],
  options?: {
    /** Emscripten optimization level (default: "-O2") */
    optimizationLevel?: string;
    /** Additional emcc flags */
    extraFlags?: string[];
  },
): Promise<WasmCompileResult> {
  // Dynamic imports — only available in Node.js
  const [fs, path, os, { execSync }] = await Promise.all([
    import("fs"),
    import("path"),
    import("os"),
    import("child_process"),
  ]);

  // Check if emcc is available
  try {
    execSync("emcc --version", { stdio: "pipe" });
  } catch {
    return {
      wasm: null,
      jsGlue: null,
      success: false,
      message:
        "Emscripten (emcc) is not installed or not in PATH. " +
        "Install it from https://emscripten.org/ to enable WASM compilation. " +
        "The C source has been included in the FMU for manual compilation.",
    };
  }

  const tmpPrefix = path.join(os.tmpdir(), `modelscript-wasm-${modelIdentifier}-`);
  const tmpDir = fs.mkdtempSync(tmpPrefix);

  try {
    const cFilePath = path.join(tmpDir, `${modelIdentifier}_wasm.c`);
    const outputJsPath = path.join(tmpDir, `${modelIdentifier}.js`);
    const outputWasmPath = path.join(tmpDir, `${modelIdentifier}.wasm`);

    fs.writeFileSync(cFilePath, cSource);

    const optLevel = options?.optimizationLevel ?? "-O2";
    const exportList = exportedFunctions.map((f) => `'${f}'`).join(",");

    const flags = [
      cFilePath,
      optLevel,
      "-sWASM=1",
      "-sMODULARIZE=1",
      `-sEXPORT_NAME="createWasmModel"`,
      `-sEXPORTED_FUNCTIONS="[${exportList}]"`,
      `-sEXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue']"`,
      "-sALLOW_MEMORY_GROWTH=1",
      "-lm",
      "-o",
      outputJsPath,
      ...(options?.extraFlags ?? []),
    ];

    const cmd = `emcc ${flags.join(" ")}`;

    try {
      execSync(cmd, {
        cwd: tmpDir,
        stdio: "pipe",
        timeout: 60000, // 60 second timeout
      });
    } catch (e: unknown) {
      const stderr =
        e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
      return {
        wasm: null,
        jsGlue: null,
        success: false,
        message: `Emscripten compilation failed:\n${stderr}`,
      };
    }

    // Read outputs
    if (!fs.existsSync(outputWasmPath) || !fs.existsSync(outputJsPath)) {
      return {
        wasm: null,
        jsGlue: null,
        success: false,
        message: "Emscripten did not produce expected output files.",
      };
    }

    const wasm = new Uint8Array(fs.readFileSync(outputWasmPath));
    const jsGlue = fs.readFileSync(outputJsPath, "utf-8");

    return {
      wasm,
      jsGlue,
      success: true,
      message: `Successfully compiled to WASM (${wasm.length} bytes)`,
    };
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check whether Emscripten is available on the system.
 * @returns true if `emcc --version` succeeds
 */
export async function isEmscriptenAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import("child_process");
    execSync("emcc --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
