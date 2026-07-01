// SPDX-License-Identifier: AGPL-3.0-or-later

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface BuildArgs {
  entry: string;
  target: string;
}

export const Build: CommandModule<{}, BuildArgs> = {
  command: "build [entry]",
  describe: "Compile the generated parser AssemblyScript into WASM and native platform binaries",
  builder: (yargs) => {
    return yargs
      .positional("entry", {
        demandOption: false,
        description: "path to the generated parser.ts file (e.g. build/src-gen/parser.ts)",
        type: "string",
        default: "build/src-gen/parser.ts",
      })
      .option("target", {
        description: "Compilation target (wasm or native)",
        type: "string",
        choices: ["wasm", "native"],
        default: "native",
      });
  },
  handler: async (args) => {
    const entryPath = args.entry;
    const absoluteEntry = path.resolve(process.cwd(), entryPath);

    if (!fs.existsSync(absoluteEntry)) {
      console.log(`Entry file not found at ${absoluteEntry}. Running 'msc generate' automatically...`);
      try {
        execSync("npx msc generate", { stdio: "inherit" });
      } catch {
        console.error("Failed to run 'msc generate'. Please ensure the language definition is correct.");
        process.exit(1);
      }

      if (!fs.existsSync(absoluteEntry)) {
        console.error(`Error: Entry file still not found at ${absoluteEntry} after generation.`);
        process.exit(1);
      }
    }

    const outDir = path.dirname(absoluteEntry);
    const distDir = path.join(process.cwd(), "dist");

    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    const packageJsonPath = path.join(process.cwd(), "package.json");
    let langName = "parser";
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (pkg.name) {
          langName = pkg.name.split("/").pop() || "parser";
        }
      } catch {
        // ignore
      }
    }

    const wasmPath = path.join(distDir, `${langName}.wasm`);

    console.log(`Compiling AssemblyScript to WASM...`);
    try {
      execSync(
        `npx --no asc ${absoluteEntry} -o ${wasmPath} --exportRuntime --runtime stub --debug --importMemory --initialMemory 4000 --maximumMemory 16000 --sharedMemory --enable threads --disableWarning`,
        { stdio: "inherit" },
      );
    } catch {
      console.error("Failed to compile WASM.");
      process.exit(1);
    }

    if (args.target === "native") {
      // Attempt to generate wasm2c native C wrapper
      const nativeDir = path.join(outDir, "native");
      if (!fs.existsSync(nativeDir)) {
        fs.mkdirSync(nativeDir, { recursive: true });
      }

      const wasm2cOut = path.join(nativeDir, "parser_wasm2c.c");
      console.log(`Generating native C code via wasm2c...`);
      try {
        execSync(`npx --no wasm2c -- --enable-threads ${wasmPath} -o ${wasm2cOut}`, { stdio: "inherit" });
        console.log(`Successfully generated wasm2c output at ${wasm2cOut}`);

        // Patch wabt's generated memory_fill and memory_copy for shared memories
        let cFile = fs.readFileSync(wasm2cOut, "utf8");
        cFile = cFile.replace(
          /static inline void memory_fill\(wasm_rt_memory_t\*/g,
          "static inline void memory_fill(wasm_rt_shared_memory_t*",
        );
        cFile = cFile.replace(
          /static inline void memory_copy\(wasm_rt_memory_t\*/g,
          "static inline void memory_copy(wasm_rt_shared_memory_t*",
        );
        cFile = cFile.replace(/const wasm_rt_memory_t\*/g, "const wasm_rt_shared_memory_t*");
        cFile = cFile.replace(/static inline void load_data\(u8\* dest/g, "static inline void load_data(void* dest");
        cFile = cFile.replace(
          /#define MEM_ADDR\(mem, addr, n\) &\(\(mem\)->data\[addr\]\)/g,
          "#define MEM_ADDR(mem, addr, n) (void*)&((mem)->data[addr])",
        );
        fs.writeFileSync(wasm2cOut, cFile);

        // Fetch wasm-rt headers to fix compilation warning/errors
        const wabtBaseUrl = "https://raw.githubusercontent.com/WebAssembly/wabt/1.0.39/wasm2c/";
        const rtFiles = [
          "wasm-rt.h",
          "wasm-rt-impl.h",
          "wasm-rt-impl.c",
          "wasm-rt-exceptions-impl.c",
          "wasm-rt-impl-tableops.inc",
          "wasm-rt-exceptions.h",
        ];
        for (const file of rtFiles) {
          const filePath = path.join(nativeDir, file);
          if (!fs.existsSync(filePath)) {
            const res = await fetch(wabtBaseUrl + file);
            if (res.ok) {
              const text = await res.text();
              fs.writeFileSync(filePath, text);
            }
          }
        }

        const nativeSo = path.join(distDir, `${langName}.so`);
        const cc = process.env.CC || "cc";
        const cflags = process.env.CFLAGS || "-O3";
        const compileCmd = `${cc} ${cflags} -shared -fPIC ${wasm2cOut} ${path.join(nativeDir, "wasm-rt-impl.c")} ${path.join(nativeDir, "wasm-rt-exceptions-impl.c")} -I${nativeDir} -o ${nativeSo}`;

        console.log(`Compiling native C code to shared library...`);
        console.log(`> ${compileCmd}`);
        execSync(compileCmd, { stdio: "inherit" });
        console.log(`Successfully compiled native shared library at ${nativeSo}`);
      } catch {
        console.warn(
          "Failed to run native compilation (this is optional unless bindings are required, and requires cc/wasm-rt.h).",
        );
      }
    }

    console.log(`=== Build Complete ===`);
    console.log(`Target: ${args.target}`);
    console.log(`WASM written to: ${wasmPath}`);
  },
};
