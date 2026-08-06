import {
  boolOption,
  defineConfigSchema,
  enumOption,
  floatOption,
  generateConfigDomain,
  intOption,
  RuntimeConfigClient,
} from "../src/index";

describe("Unified Compile-Time & Runtime Configuration System", () => {
  // 1. Define a generic, multi-phase DSL configuration schema
  const ModelicaConfigSchema = defineConfigSchema({
    indexing: {
      matchingAlgo: enumOption({
        choices: ["HopcroftKarp", "DFS_AugmentingPath"],
        default: "HopcroftKarp",
        description: "Bipartite matching strategy",
      }),
    },
    tearing: {
      heuristic: enumOption({
        choices: ["CellierMinimumDegree", "TarjanDegree", "WeightedIncidence"],
        default: "CellierMinimumDegree",
      }),
      maxLoopSize: intOption({
        default: 100,
        min: 1,
        max: 1000,
      }),
    },
    differentiation: {
      method: enumOption({
        choices: ["SymbolicExact", "ForwardAD", "FiniteDifference"],
        default: "SymbolicExact",
      }),
      finiteDiffEps: floatOption({
        default: 1e-7,
        min: 1e-15,
        max: 1e-2,
      }),
    },
    nonlinearSolver: {
      algorithm: enumOption({
        choices: ["NewtonRaphson", "PowellHybrid", "FixedPoint"],
        default: "NewtonRaphson",
      }),
      lineSearch: enumOption({
        choices: ["ArmijoBacktracking", "WolfeConditions", "None"],
        default: "ArmijoBacktracking",
      }),
      tolerance: floatOption({
        default: 1e-10,
        min: 1e-16,
        max: 1e-3,
      }),
      maxIterations: intOption({
        default: 25,
        min: 1,
        max: 500,
      }),
    },
    integrator: {
      solver: enumOption({
        choices: ["ExplicitEuler", "RK4", "ImplicitBackwardEuler"],
        default: "RK4",
      }),
      adaptiveStep: boolOption({
        default: false,
      }),
    },
  });

  test("1. Memory Layout Packing & Alignment Calculation", () => {
    const layout = generateConfigDomain(ModelicaConfigSchema, "dynamicRuntime");

    expect(layout.totalSize).toBeGreaterThan(0);
    expect(layout.totalSize % 8).toBe(0); // Aligned to 8-byte boundary

    // 8-byte floats (finiteDiffEps, tolerance) must be aligned on 8-byte offsets
    const epsEntry = layout.entries.get("differentiation.finiteDiffEps");
    const tolEntry = layout.entries.get("nonlinearSolver.tolerance");
    expect(epsEntry).toBeDefined();
    expect(tolEntry).toBeDefined();
    expect((epsEntry?.offset ?? 0) % 8).toBe(0);
    expect((tolEntry?.offset ?? 0) % 8).toBe(0);

    // 4-byte ints (maxLoopSize, maxIterations) must be aligned on 4-byte offsets
    const loopEntry = layout.entries.get("tearing.maxLoopSize");
    const iterEntry = layout.entries.get("nonlinearSolver.maxIterations");
    expect(loopEntry).toBeDefined();
    expect(iterEntry).toBeDefined();
    expect((loopEntry?.offset ?? 0) % 4).toBe(0);
    expect((iterEntry?.offset ?? 0) % 4).toBe(0);
  });

  test("2. AssemblyScript Codegen (Dynamic Runtime vs Compile-Time Locked)", () => {
    const dynamicLayout = generateConfigDomain(ModelicaConfigSchema, "dynamicRuntime");
    expect(dynamicLayout.assemblyScriptCode).toContain("export function config_set_nonlinearSolver_algorithm");
    expect(dynamicLayout.assemblyScriptCode).toContain("load<f64>");

    const lockedLayout = generateConfigDomain(ModelicaConfigSchema, "compileTimeLocked", {
      "nonlinearSolver.algorithm": "PowellHybrid",
      "integrator.solver": "ImplicitBackwardEuler",
    });

    expect(lockedLayout.assemblyScriptCode).toContain("config_get_nonlinearSolver_algorithm(): u8 { return 1; }");
    expect(lockedLayout.assemblyScriptCode).not.toContain("config_set_nonlinearSolver_algorithm"); // Locked mode omits setters
  });

  test("3. RuntimeConfigClient Zero-GC Linear Memory Interaction", () => {
    const layout = generateConfigDomain(ModelicaConfigSchema, "dynamicRuntime");
    const memory = new WebAssembly.Memory({ initial: 2 });

    // Initialize layout defaults manually in test memory buffer
    const view = new DataView(memory.buffer);
    for (const entry of layout.entries.values()) {
      if (entry.type === "float") {
        view.setFloat64(entry.offset, entry.defaultValue, true);
      } else if (entry.type === "int") {
        view.setInt32(entry.offset, entry.defaultValue, true);
      } else if (entry.type === "bool") {
        view.setUint8(entry.offset, entry.defaultValue ? 1 : 0);
      } else if (entry.type === "enum") {
        const idx = entry.choices ? entry.choices.indexOf(entry.defaultValue) : 0;
        view.setUint8(entry.offset, idx);
      }
    }

    const client = new RuntimeConfigClient(memory, layout);

    // Verify initial values
    expect(client.get("indexing.matchingAlgo")).toBe("HopcroftKarp");
    expect(client.get("tearing.maxLoopSize")).toBe(100);
    expect(client.get("nonlinearSolver.tolerance")).toBe(1e-10);
    expect(client.get("integrator.solver")).toBe("RK4");
    expect(client.get("integrator.adaptiveStep")).toBe(false);

    // Mutate options directly in WebAssembly linear memory
    client.set("nonlinearSolver.algorithm", "PowellHybrid");
    expect(client.get("nonlinearSolver.algorithm")).toBe("PowellHybrid");

    client.set("nonlinearSolver.tolerance", 1e-12);
    expect(client.get("nonlinearSolver.tolerance")).toBe(1e-12);

    client.set("integrator.solver", "ImplicitBackwardEuler");
    expect(client.get("integrator.solver")).toBe("ImplicitBackwardEuler");

    client.set("integrator.adaptiveStep", true);
    expect(client.get("integrator.adaptiveStep")).toBe(true);

    // Verify bounds and type safety checks
    expect(() => client.set("tearing.maxLoopSize", 5000)).toThrow(); // exceeds max 1000
    expect(() => client.set("nonlinearSolver.algorithm", "InvalidAlgo")).toThrow(); // invalid enum choice
  });
});
