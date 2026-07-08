// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandModule } from "yargs";

declare const WebAssembly: any;

interface ParseArgs {
  file: string;
  encoding?: string;
}

export const Parse: CommandModule<{}, ParseArgs> = {
  command: "parse <file>",
  describe: "Parse a file using the language parser in the current directory",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "path of file to parse",
        type: "string",
      })
      .option("encoding", {
        description: "Input encoding to use",
        type: "string",
        choices: ["utf8", "utf16le", "utf16be", "utf32le", "utf32be"],
        default: "utf8",
      });
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const wrapperPath = join(cwd, "build", "src-gen", "index.js");

    if (!existsSync(wrapperPath)) {
      console.error(`Could not find parser wrapper at ${wrapperPath}. Did you run 'msc build'?`);
      process.exit(1);
    }

    // Find the .wasm file in dist/
    const distDir = join(cwd, "dist");
    let wasmFile = "";
    if (existsSync(distDir)) {
      const fs = await import("node:fs/promises");
      const files = await fs.readdir(distDir);
      wasmFile = files.find((f) => f.endsWith(".wasm")) || "";
    }

    if (!wasmFile) {
      console.error(`Could not find .wasm file in ${distDir}.`);
      process.exit(1);
    }

    const wrapperUrl = "file://" + wrapperPath.replace(/\\/g, "/");
    const { Parser, WasmRuntime, InputEncoding } = await import(wrapperUrl);

    const wasmBuffer = readFileSync(join(distDir, wasmFile));
    const sharedMemory = new WebAssembly.Memory({ initial: 4000, maximum: 16000, shared: true });
    let exportedMemory: any = sharedMemory;
    const wasmModule = new WebAssembly.Module(wasmBuffer);
    const wasmInstance = new WebAssembly.Instance(wasmModule, {
      env: {
        memory: sharedMemory,
        emitTextEdit: (op: number, len: number, start: number, end: number) => {
          console.log("DEBUG:", op, len, start, end);
        },
        abort: (msgPtr: number, filePtr: number, line: number, column: number) => {
          let msg = "WASM aborted";
          if (msgPtr && exportedMemory) {
            try {
              const mem = new Uint32Array(exportedMemory.buffer);
              const len = mem[(msgPtr - 4) >>> 2] || 0;
              const utf16 = new Uint16Array(exportedMemory.buffer, msgPtr, len >>> 1);
              msg = String.fromCharCode.apply(null, Array.from(utf16));
              const fileLen = mem[(filePtr - 4) >>> 2] || 0;
              const fileUtf16 = new Uint16Array(exportedMemory.buffer, filePtr, fileLen >>> 1);
              const fileName = String.fromCharCode.apply(null, Array.from(fileUtf16));
              msg += " at " + fileName + ":" + line + ":" + column;
            } catch (e) {}
          }
          console.error(msg);
          process.exit(1);
        },
        trace: (code: number, a: number, b: number, c: number) => {
          if (code >= 60000) {
            console.log(`[TRACE] code=${code}, a=${a}, b=${b}, c=${c}`);
          }
        },
      },
      parser: {
        logInt: (val: any) => console.log("DEBUG_INT:", val),
      },
      engine: {
        debugLog: (cat: number, val1: number, val2: number, val3: number) => {
          if (cat >= 60000) console.log(`[DEBUG] ${cat}, ${val1}, ${val2}, ${val3}`);
        },
      },
      host: {
        runHostQuery: () => 0,
      },
    });

    const runtime = new WasmRuntime(wasmInstance.exports, exportedMemory);
    const parser = new Parser(runtime);
    const encStr = args.encoding?.toLowerCase() || "utf8";
    let encEnum = InputEncoding.UTF8;
    if (encStr === "utf16le") encEnum = InputEncoding.UTF16LE;
    if (encStr === "utf16be") encEnum = InputEncoding.UTF16BE;
    if (encStr === "utf32le") encEnum = InputEncoding.UTF32LE;
    if (encStr === "utf32be") encEnum = InputEncoding.UTF32BE;
    parser.setEncoding(encEnum);

    const textBytes = readFileSync(args.file);
    const text = textBytes.toString("utf8"); // We keep the string for printing
    let parseInput: Uint8Array | string = text;

    if (encEnum === InputEncoding.UTF16LE) {
      parseInput = new Uint8Array(text.length * 2);
      const view16 = new Uint16Array(parseInput.buffer);
      for (let i = 0; i < text.length; i++) view16[i] = text.charCodeAt(i);
    } else if (encEnum === InputEncoding.UTF16BE) {
      parseInput = new Uint8Array(text.length * 2);
      const view16 = new Uint16Array(parseInput.buffer);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        view16[i] = ((c & 0xff) << 8) | ((c >> 8) & 0xff);
      }
    } else if (encEnum === InputEncoding.UTF32LE || encEnum === InputEncoding.UTF32BE) {
      // Simplified UTF-32 creation for tests
      parseInput = new Uint8Array(text.length * 4);
      const view32 = new Uint32Array(parseInput.buffer);
      for (let i = 0; i < text.length; i++) {
        let c = text.codePointAt(i) || 0;
        if (c > 0xffff) i++; // skip surrogate pair half
        if (encEnum === InputEncoding.UTF32BE) {
          c = ((c & 0xff) << 24) | (((c >> 8) & 0xff) << 16) | (((c >> 16) & 0xff) << 8) | ((c >> 24) & 0xff);
        }
        view32[i] = c;
      }
    }

    const tree = parser.parse(parseInput);

    if (!tree) {
      console.error("Parse failed. No tree returned.");
      process.exit(1);
    }

    const parserJsonPath = join(cwd, "build", "src-gen", "parser.json");
    let nodeNames: string[] = ["ERROR"];
    if (existsSync(parserJsonPath)) {
      const pData = JSON.parse(readFileSync(parserJsonPath, "utf8"));
      if (pData.terminals) {
        for (const t of pData.terminals) nodeNames.push(t);
      }
      if (pData.nonTerminals) {
        for (const nt of pData.nonTerminals) nodeNames.push(nt);
      }
    }

    function getPosition(offset: number): [number, number] {
      let row = 0;
      let col = 0;
      for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") {
          row++;
          col = 0;
        } else {
          col++;
        }
      }
      return [row, col];
    }

    function toSExpr(node: any, currentOffset: number, depth = 0): { strs: string[]; nextOffset: number } {
      if (depth > 100) return { strs: ["(...)"], nextOffset: currentOffset };

      const typeId = node.getTypeId();
      let typeName = nodeNames[typeId] || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);

      const typeFlags = runtime.readU32(node.getPtr());
      const envHashPadding = runtime.readU32(node.getPtr() + 4);
      const rawPad = typeFlags >>> 19;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad =
        isFat && wasmInstance.exports.getFatPaddingPtr
          ? runtime.readU32((wasmInstance.exports as any).getFatPaddingPtr(rawPad))
          : rawPad;
      const len = envHashPadding & 0x007fffff;
      typeName = typeName + ":" + typeId;

      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;

      const startPos = getPosition(startOffset);
      const endPos = getPosition(endOffset);

      const posStr = `[${startPos[0]}, ${startPos[1]}] - [${endPos[0]}, ${endPos[1]}]`;
      const indent = "  ".repeat(depth);

      const isInvisible = (typeFlags & (1 << 12)) !== 0;

      let child = node.getFirstChild();

      const shouldPrint = !typeName.startsWith("_") && !typeName.startsWith('"') && !isInvisible;

      let childStrs: string[] = [];
      let childOffset = startOffset;
      let visited = new Set<number>();

      while (child) {
        if (visited.has(child.getPtr())) {
          childStrs.push("\n" + indent + "  (CYCLE)");
          break;
        }
        visited.add(child.getPtr());

        const childResult = toSExpr(child, childOffset, shouldPrint ? depth + 1 : depth);
        for (const s of childResult.strs) {
          if (s) childStrs.push(s);
        }
        childOffset = childResult.nextOffset;

        child = child.getNextSibling();
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
    }

    if (tree) {
      console.log(toSExpr(tree, 0).strs[0]);
    }
  },
};
