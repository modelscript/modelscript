import path from "node:path";
import { fileURLToPath } from "node:url";
import { LspFacade, TreeSitterParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function main() {
  const bytes = (await import("node:fs")).readFileSync(wasmPath);
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

  const incompleteSource = `model IncompleteModel
  Real x;
  parameter Real p = 1.0;
equation
  x = p * 2;
`;

  console.log("Parsing unclosed model at EOF...");
  const tree = parser.parse(incompleteSource);

  console.log("Root node type:", tree.rootNode.type);
  console.log("Root has error:", tree.rootNode.hasError());
  console.log("Root child count:", tree.rootNode.childCount);

  for (let i = 0; i < tree.rootNode.childCount; i++) {
    const child = tree.rootNode.child(i);
    if (child) {
      console.log(
        `  Child ${i}: ${child.type} [${child.startPosition.row}:${child.startPosition.column} - ${child.endPosition.row}:${child.endPosition.column}] hasError=${child.hasError()}`,
      );
    }
  }

  const diags = facade.getDiagnostics();
  console.log(`Diagnostics count: ${diags.length}`);
  for (const d of diags) {
    console.log(`  Diagnostic: range=[${d.start}-${d.end}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
