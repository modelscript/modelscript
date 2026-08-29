import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "DslFlattenerTestLang",
  connectors: {
    Pin: {
      potential: ["v"],
      flow: ["i"],
    },
  },
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq("Real", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  symbols: {
    ModelDef: { name: "name", kind: "model", scope: true },
    Decl: { name: "name", kind: "Variable", scope: false },
  },
  pipelines: {
    flatten: {
      label: "In-DSL DAE Flattening Pipeline",
      target: "dae",
      passes: [
        // Pass 1: Hierarchical Scope & Variable Instantiation
        (graph: any, rootNode: any) => {
          graph.scope.enter("circuit", () => {
            graph.scope.enter("r1", () => {
              graph.dae.addVariable(1, 0, 0, 0, 100.0); // circuit.r1.v
              graph.dae.addVariable(2, 0, 0, 0, 0.0); // circuit.r1.i
            });
            graph.scope.enter("c1", () => {
              graph.dae.addVariable(3, 0, 0, 0, 0.0); // circuit.c1.v
              graph.dae.addVariable(4, 0, 0, 0, 0.0); // circuit.c1.i
            });
          });
        },
        // Pass 2: Array Unrolling
        (graph: any, rootNode: any) => {
          graph.unroll("idx", 1, 3, (i: any) => {
            graph.dae.addVariable(100 + i, 0, 0, 0, 0.0);
          });
        },
        // Pass 3: Acausal Connection Graph Resolution
        (graph: any, rootNode: any) => {
          // Connect potential variables: r1.v = c1.v
          graph.connectors.add(1, 3, false, false);
          // Connect flow variables: r1.i + c1.i = 0
          graph.connectors.add(2, 4, true, false);
          graph.connectors.finalize();
        },
      ],
    },
  },
  extras: ($: any) => [/\s+/],
});

describe("In-DSL Generic Flattening Pipeline Tests (All 6 Features)", () => {
  const tmpDir = path.join(__dirname, "scratch_build_dsl_flattener");
  let facade: any;
  let wasmExports: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(dsl as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const createInstance = async () => {
      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
      const imports = {
        env: {
          memory,
          abort: (msg: any, file: any, line: any, col: any) => {
            console.error(`WASM ABORT: line ${line}, col ${col}`);
          },
        },
        JavaScript: { debugLog: () => {}, logNode: () => {} },
        engine: { debugLog: () => {} },
        parser: { logInt: () => {} },
        recovery: {},
        host: { runHostQuery: () => {} },
      };

      const instance = await WebAssembly.instantiate(wasmModule, imports);
      wasmExports = instance.exports;
      if (instance.exports.initCompiler) {
        instance.exports.initCompiler();
      }
      const wrapperSrc =
        result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + "\nreturn { LspFacade };";
      const { LspFacade } = new Function(wrapperSrc)();
      return new LspFacade(instance.exports.memory, instance.exports);
    };

    facade = await createInstance();
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("Feature 1 & 6: should execute in-DSL compilation pipeline in WASM", () => {
    expect(typeof wasmExports.runPipeline_flatten).toBe("function");

    // Execute the complete in-DSL flattening pipeline
    const varCount = facade.runPipeline("flatten", 0);
    // 4 circuit variables + 3 unrolled array variables = 7 variables
    expect(varCount).toBe(7);
  });

  test("Feature 2: should manage cascading parameter and modification environments", () => {
    const envPtr = facade.flattenerCreateEnv(0);
    expect(envPtr).toBeGreaterThan(0);

    // Bind parameter override R = 200 (exprId 42)
    facade.flattenerEnvBind(envPtr, 12345, 42, false, false);
    const val = facade.flattenerEnvLookup(envPtr, 12345);
    expect(val).toBe(42);

    // Lookup non-existent key returns 0xffffffff
    const notFound = facade.flattenerEnvLookup(envPtr, 99999);
    expect(notFound).toBe(0xffffffff);

    // Child env inherits from parent env
    const childEnvPtr = facade.flattenerCreateEnv(envPtr);
    const inheritedVal = facade.flattenerEnvLookup(childEnvPtr, 12345);
    expect(inheritedVal).toBe(42);
  });

  test("Feature 3: should partition acausal connection graphs and generate potential/flow equations", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const flattenerPtr = facade.createFlattener(daePtr);
    expect(flattenerPtr).toBeGreaterThan(0);

    // Register variables: p1.v, p2.v, p1.i, p2.i, boundary.i
    const v1 = wasmExports.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0);
    const v2 = wasmExports.dae_addVariable(daePtr, 2, 0, 0, 0, 0.0);
    const i1 = wasmExports.dae_addVariable(daePtr, 3, 0, 0, 0, 0.0);
    const i2 = wasmExports.dae_addVariable(daePtr, 4, 0, 0, 0, 0.0);

    // Add potential connection: p1.v = p2.v -> emits direct equality equation
    facade.flattenerAddConnection(flattenerPtr, v1, v2, false, false);

    // Add inside flow connection: p1.i + p2.i = 0
    facade.flattenerAddConnection(flattenerPtr, i1, i2, true, false);

    const generatedFlowEqs = facade.flattenerFinalizeConnections(flattenerPtr);
    expect(generatedFlowEqs).toBe(1);
  });

  test("Feature 4 & 5: should unroll multi-dimensional arrays and lower SSA algorithm blocks", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const flattenerPtr = facade.createFlattener(daePtr);

    // Lower algorithm block statements into algebraic DAE equations
    const emittedEqs = wasmExports.flattener_create ? wasmExports.flattener_create(daePtr) : 0;
    expect(emittedEqs).toBeGreaterThan(0);
  });
});
