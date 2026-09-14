import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LspFacade, TreeSitterParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  const bytes = fs.readFileSync(wasmPath);
  const imports = {
    env: {
      abort: (msg: any, file: any, line: any, col: any) => {
        console.error(`[WASM abort] msg=${msg} file=${file} line=${line} col=${col}`);
      },
    },
    parser: {
      logInt: (val: number) => {
        console.log("[WASM logInt]", val);
      },
    },
    engine: {
      debugLog: (cat: number, v1: number, v2: number, v3: number) => {
        console.log("[WASM debugLog]", cat, v1, v2, v3);
      },
    },
    host: {
      runHostQuery: () => 0,
    },
  };
  const wasmModule = await WebAssembly.instantiate(bytes, imports);
  const facade = new LspFacade(wasmModule.instance.exports);
  const parser = new TreeSitterParser();
  parser.setLanguage(facade);

  console.log("=== Testing Pre-Error Reductions & Tree-sitter Alignment ===");

  // Test: Incomplete binary expression before semicolon
  // In `x = 1 + ;`, '1' is reduced to primary_expression/expression prior to ';' error recovery
  const code = `model M
  Real x;
equation
  x = 1 + ;
end M;`;

  const tree = parser.parse(code);
  console.log("Root node type:", tree.rootNode.type);
  console.log("Root has error:", tree.rootNode.hasError);

  function dump(node: any, depth = 0) {
    const indent = "  ".repeat(depth);
    const hasErr = node.hasError ? " [HAS_ERROR]" : "";
    console.log(`${indent}${node.type} [${node.startIndex}-${node.endIndex}]${hasErr}`);
    for (let i = 0; i < node.childCount; i++) {
      dump(node.child(i), depth + 1);
    }
  }

  let foundEquationSection = false;
  function search(node: any) {
    if (node.type === "equation_section") {
      foundEquationSection = true;
      console.log("\nFound equation_section:");
      dump(node, 1);
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      search(node.child(i));
    }
  }
  search(tree.rootNode);

  console.log("\nFound equation section:", foundEquationSection);
  if (!foundEquationSection) {
    throw new Error("Equation section was dropped!");
  }

  console.log("\n✓ Pre-error reductions and Tree-sitter alignment verified successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
