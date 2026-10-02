// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WasmEmitter } from "./wasm-emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(__dirname, "../../native/vendor");

export interface NativeCompileOptions {
  outPath: string;
  entryFn?: string;
  cc?: string;
  cflags?: string[];
}

export class NativeEmitter {
  private wasmEmitter = new WasmEmitter();

  async compileToNative(rootNode: any, options: NativeCompileOptions): Promise<string> {
    const outBin = path.resolve(process.cwd(), options.outPath);
    const outDir = path.dirname(outBin);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const baseName = path.basename(outBin, path.extname(outBin));
    const buildDir = path.join(outDir, `.build_${baseName}`);
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }

    const wasmFile = path.join(buildDir, "module.wasm");
    const cFile = path.join(buildDir, "module.c");
    const hFile = path.join(buildDir, "module.h");
    const harnessFile = path.join(buildDir, "harness.c");

    // 1. Emit WASM bytecode
    const wasmBytes = await this.wasmEmitter.compile(rootNode);
    fs.writeFileSync(wasmFile, wasmBytes);

    // 2. Generate C source code via wasm2c
    execFileSync("wasm2c", [wasmFile, "-o", cFile], { stdio: "pipe" });

    // 3. Generate native C harness
    const entryFn = options.entryFn || "main";
    const harness = `
#include <stdio.h>
#include <stdlib.h>
#include "wasm-rt.h"
#include "module.h"

int main(int argc, char** argv) {
    wasm_rt_init();
    w2c_module instance;
    wasm2c_module_instantiate(&instance);
    
    // Call exported entry function
    #if defined(w2c_module_${entryFn}) || 1
    u32 result = w2c_module_${entryFn}(&instance);
    printf("Result: %u\\n", result);
    #endif

    wasm2c_module_free(&instance);
    wasm_rt_free();
    return 0;
}
`;
    fs.writeFileSync(harnessFile, harness);

    // 4. Compile with host clang / gcc
    const cc = options.cc || process.env.CC || "clang";
    const cflags = options.cflags || ["-O2"];

    const compileArgs = [
      ...cflags,
      harnessFile,
      cFile,
      path.join(vendorDir, "wasm-rt-impl.c"),
      path.join(vendorDir, "wasm-rt-mem-impl.c"),
      path.join(vendorDir, "wasm-rt-exceptions-impl.c"),
      `-I${buildDir}`,
      `-I${vendorDir}`,
      "-lm",
      "-o",
      outBin,
    ];

    execFileSync(cc, compileArgs, { stdio: "pipe" });

    // 5. Cleanup temporary build files
    try {
      fs.rmSync(buildDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    return outBin;
  }
}
