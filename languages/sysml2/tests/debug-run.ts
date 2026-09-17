import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const bindingsPath = path.resolve(__dirname, "../src-gen/bindings.js");

async function main() {
  const bindings = await import(bindingsPath);
  const syntaxNames = bindings.SYNTAX_NAMES || [];
  const bytes = fs.readFileSync(wasmPath);

  const imports = {
    env: {
      abort: (msg: any, file: any, line: any, col: any) => {
        console.error(`WASM abort: ${msg}:${file}:${line}:${col}`);
      },
    },
    parser: {
      logInt: (val: number) => {
        console.log("logInt:", val);
      },
    },
    engine: {
      debugLog: (cat: number, val1: number, val2: number, val3: number) => {
        console.log(`[DEBUG ${cat}] val1=${val1}, val2=${val2}, val3=${val3}`);
      },
    },
    host: {
      runHostQuery: () => 0,
    },
  };

  const wasmModule = await WebAssembly.instantiate(bytes, imports);
  const exports = wasmModule.instance.exports as any;
  const facade = new bindings.LspFacade(exports);
  if (syntaxNames.length > 0) facade.syntaxNames = syntaxNames;

  const parser = new bindings.TreeSitterParser();
  parser.setLanguage(facade);

  const testStr = "abstract attribute def Real;";
  console.log("Parsing:", testStr);
  const tree = parser.parse(testStr);
  console.log("Result:", tree.rootNode.toString());
}

main().catch(console.error);
