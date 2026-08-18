import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import modelicaGrammar from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Semantic Lint & Undefined Variable Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_modelica_lint");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
      if (file.filename === "graph.ts") {
        const idx1 = file.content.indexOf("function lint_duplicateModification");
        if (idx1 !== -1) {
          console.log("GENERATED lint_duplicateModification:\n" + file.content.slice(idx1, idx1 + 1200));
        }
        const idx2 = file.content.indexOf("function lint_extendsCycle");
        if (idx2 !== -1) {
          console.log("GENERATED lint_extendsCycle:\n" + file.content.slice(idx2, idx2 + 1200));
        }
      }
      if (file.filename === "parser.ts") {
        const idx3 = file.content.indexOf("export function executeLints");
        if (idx3 !== -1) {
          console.log("GENERATED executeLints:\n" + file.content.slice(idx3, idx3 + 800));
        }
      }
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (e: any) {
      console.error("ASC ERROR STDOUT:\n" + e.stdout?.toString());
      console.error("ASC ERROR STDERR:\n" + e.stderr?.toString());
      throw e;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade, Tree };`;
    const factory = new Function(wrapperSrc);
    const exportsObj = factory();
    const { LspFacade, Tree: TreeClass } = exportsObj;
    (globalThis as any).TestTree = TreeClass;

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory,
        abort: (...args: any[]) => console.log("ENV ABORT:", ...args),
        logNode: (...args: any[]) => console.log("ENV logNode:", ...args),
        debugLog: (...args: any[]) => console.log("ENV debugLog:", ...args),
      },
      JavaScript: {
        debugLog: (...args: any[]) => console.log("JS debugLog:", ...args),
        logNode: (...args: any[]) => console.log("JS logNode:", ...args),
      },
      engine: {
        debugLog: (...args: any[]) => console.log("ENGINE debugLog:", ...args),
      },
      parser: {
        logInt: (...args: any[]) => console.log("PARSER logInt:", ...args),
      },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  it("should lint undefined variable y in model Test", () => {
    const code = `model Test
  Real x;
equation
  y = 0.0;
end Test;`;

    const astRoot = activeFacade.parse(code);
    expect(astRoot).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(astRoot);
    const undefinedVarDiags = diags.filter((d: any) => d.message.includes("Reference to undefined name"));
    expect(undefinedVarDiags.length).toBeGreaterThan(0);
    expect(undefinedVarDiags[0].code).toBe(2001);
    expect(undefinedVarDiags[0].range.start.line).toBe(3); // Line 4 (0-indexed line 3)
    expect(undefinedVarDiags[0].range.start.character).toBe(2);
  });

  it("should NOT lint declared variable x or built-in time/der", () => {
    const code = `model Test
  Real x;
equation
  der(x) = -x + time;
end Test;`;

    const astRoot = activeFacade.parse(code);
    expect(astRoot).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(astRoot);
    const undefinedVarDiags = diags.filter((d: any) => d.message.includes("Reference to undefined name"));
    expect(undefinedVarDiags.length).toBe(0);
  });

  it("should lint unbalanced model when equation count != variable count", () => {
    const code = `model Unbalanced
  Real x;
  Real y;
equation
  x = 1.0;
end Unbalanced;`;

    const astRoot = activeFacade.parse(code);
    expect(astRoot).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(astRoot);
    const unbalancedDiags = diags.filter((d: any) => d.code === 4004);
    expect(unbalancedDiags.length).toBeGreaterThan(0);
  });

  function dumpNode(n: any, indent = 0): string {
    if (!n) return "";
    let s = " ".repeat(indent) + n.type + " (#" + n.typeId + ") [" + JSON.stringify(n.text) + "]\n";
    for (const c of n.children || []) {
      s += dumpNode(c, indent + 2);
    }
    return s;
  }

  it("should lint duplicate modification in class modification", () => {
    const code = `model DuplicateMod
  Resistor R1(R = 100, R = 200);
end DuplicateMod;`;

    const astRoot = activeFacade.parse(code);
    expect(astRoot).toBeGreaterThan(0);
    const TreeClass = (globalThis as any).TestTree;
    const tree = new TreeClass(activeFacade, astRoot, code);
    console.log("DuplicateMod AST:\n" + dumpNode(tree.rootNode));

    const numDiags = activeFacade.exports.lsp_getDiagnostics(astRoot);
    console.log("DuplicateMod raw numDiags:", numDiags);
    const bufPtr = activeFacade.exports.lsp_getBinaryBuffer();
    const mem32 = new Uint32Array(activeFacade.wasmMemory.buffer, bufPtr, numDiags * 7);
    console.log("DuplicateMod raw buffer:", Array.from(mem32));

    const diags = activeFacade.getDiagnostics(astRoot);
    console.log("DuplicateMod diags:", diags);
    const dupDiags = diags.filter((d: any) => d.code === 4002);
    expect(dupDiags.length).toBeGreaterThan(0);
  });

  it("should lint circular extends clause", () => {
    const code = `model LoopClass
  extends LoopClass;
end LoopClass;`;

    const astRoot = activeFacade.parse(code);
    expect(astRoot).toBeGreaterThan(0);
    const TreeClass = (globalThis as any).TestTree;
    const tree = new TreeClass(activeFacade, astRoot, code);
    console.log("LoopClass AST:\n" + dumpNode(tree.rootNode));

    const diags = activeFacade.getDiagnostics(astRoot);
    console.log("LoopClass diags:", diags);
    const cycleDiags = diags.filter((d: any) => d.code === 4001);
    expect(cycleDiags.length).toBeGreaterThan(0);
  });
});
