import path from "node:path";
import { fileURLToPath } from "node:url";
import { LspFacade, TreeSitterParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");

async function run() {
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

  const source = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 9;
  parameter Real L = 0.001;
  Real v, i;
  error
equation
  v = p.v - n.v;
  0 = p.i + n.i;
  i = p.i;
  v = R * i;
end ElectricalCircuit;

model ChuaCircuit
  Pin p, n;
  Real vC1, vC2, iL;
  parameter Real C1 = 10.0;
  parameter Real C2 = 100.0;
  parameter Real L = 18.0;
  parameter Real G = 0.7;
end ChuaCircuit;
`;

  const tree = parser.parse(source);
  console.log("Parsed root:", tree.rootNode.type);
  console.log("Has error:", tree.rootNode.hasError());

  const diags = parser.languageBinding.getDiagnostics(tree.rootPtr);
  console.log("Diagnostics count:", diags.length);
  for (const d of diags) {
    const text = source.slice(d.startCharOffset, d.endCharOffset);
    console.log(`- [${d.startCharOffset}-${d.endCharOffset}] "${text.replace(/\n/g, "\\n")}": ${d.message}`);
  }

  console.log("\nTop children of root:");
  for (let c = tree.rootNode.firstChild; c; c = c.nextSibling) {
    console.log(`- ${c.type} (${c.startIndex}-${c.endIndex}) hasError=${c.hasError()}`);
    if (c.type === "stored_definition") {
      for (let sc = c.firstChild; sc; sc = sc.nextSibling) {
        console.log(`    - ${sc.type} (${sc.startIndex}-${sc.endIndex}) hasError=${sc.hasError()}`);
      }
    }
  }
}

run().catch(console.error);
