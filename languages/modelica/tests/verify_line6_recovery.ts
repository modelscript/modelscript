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

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]) {
    const errTokens = Array(n).fill("error").join(" ");
    const source = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 9;
  parameter Real L = 0.001;
  Real v, i;
equation
  v = p.v - n.v;
  0 = p.i + n.i;
  i = p.i;
  ${errTokens}
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
    let firstClassOk = false;
    let secondClassOk = false;
    let storedDef = tree.rootNode.firstChild;
    if (storedDef && storedDef.type === "stored_definition") {
      let class1 = storedDef.firstChild;
      let semi1 = class1 ? class1.nextSibling : null;
      let class2 = semi1 ? semi1.nextSibling : null;
      if (class1 && class1.type === "class_definition") {
        firstClassOk = true;
      }
      if (class2 && class2.type === "class_definition" && !class2.hasError()) {
        secondClassOk = true;
      }
    }

    console.log(
      `[N=${n}] firstClassOk=${firstClassOk} secondClassOk(ChuaCircuit, noError)=${secondClassOk} rootHasError=${tree.rootNode.hasError()}`,
    );
    if (!firstClassOk || !secondClassOk) {
      throw new Error(`Recovery failed for N=${n}`);
    }
  }
  console.log("\nAll error recovery tests (N=1..20) passed successfully!");
}

run().catch(console.error);
