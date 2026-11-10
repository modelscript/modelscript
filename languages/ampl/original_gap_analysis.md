# Comprehensive Gap Analysis: Commercial AMPL vs. ModelScript `@modelscript/ampl`

---

## 1. Executive Summary

| Dimension | **Commercial AMPL** (AMPL Optimization Inc.) | **ModelScript AMPL** (`@modelscript/ampl`) |
| :--- | :--- | :--- |
| **Primary Domain** | High-performance mathematical programming & operations research (OR). | Polyglot engineering compiler, dynamic co-simulation, and multi-domain optimization. |
| **Architecture** | Native C/C++ runtime; monolithic interpreter with ASL/MP solver library bridges. | Data-oriented TypeScript/WASM compiler; zero intermediate AST wrappers; linear memory DAE arena lowering. |
| **Execution Environment** | Desktop OS (Linux, Windows, macOS) with native binary executables and floating/node-locked licenses. | Universal runtime: WebAssembly in-browser, Node.js, CLI (`msx ampl`), edge workers, and headless cloud containers. |
| **Licensing** | Commercial proprietary (tiered by core count, solver bundles, educational/commercial). | Open-source (AGPL-3.0-or-later) with zero-cost bundled WASM solvers (CLP, CBC, Couenne). |
| **Interoperability** | Siloed to optimization: writes ASL `.nl` and reads `.sol`. | Interoperable with **68 engineering languages**, acausal Modelica projection, and physical DAE systems. |

---

## 2. Feature-by-Feature Parity Matrix

### Legend
- 🟢 **Full Parity**: Implemented and matches commercial standard.
- 🟡 **Partial / Subset Parity**: Core functionality supported; edge-case syntax or advanced attributes missing.
- 🔴 **Gap (Not Implemented)**: Supported in commercial AMPL, absent or planned in ModelScript.
- 🌟 **ModelScript Unique Advantage**: Feature not present in commercial AMPL.

---

### A. Modeling Language Syntax & Semantics

| Feature | Commercial AMPL | ModelScript AMPL | Status | Technical Details & Differences |
| :--- | :---: | :---: | :---: | :--- |
| **Sets (1D & 2D)** | Yes | Yes | 🟢 | Full support for 1D/2D sets, index bounds, and literal data assignments. |
| **Sets (n-Dimensional, $d > 2$)** | Yes | Planned | 🟡 | Commercial AMPL supports arbitrary tuple dimensionality (`dimen k`). ModelScript currently targets 1D and 2D sets. |
| **Ordered & Circular Sets** | Yes | No | 🔴 | `ordered`, `circular`, `first()`, `last()`, `next()`, `prev()` operators not yet implemented. |
| **Set Expressions & Algebra** | Yes | Yes | 🟢 | `union`, `inter`, `diff`, `cross` evaluated at instantiation time via [`SetEvaluator`](file:///home/omar/git3/modelscript/languages/ampl/src/instantiator/set-evaluator.ts#L20). |
| **Comprehension Filtering** | Yes | Yes | 🟡 | Simple predicates (`{i in I: cond}`) supported; nested multi-set filtering partially supported. |
| **Parameters (Scalar & Arrays)** | Yes | Yes | 🟢 | Full support for indexed parameters, default values, and arithmetic expressions. |
| **Check Constraints on Data** | Yes | Planned | 🟡 | Commercial AMPL validates `check: expr;` upon loading data. ModelScript enforces bounds via linter. |
| **Variables (Continuous, Integer, Binary)** | Yes | Yes | 🟢 | Continuous, `integer`, and `binary` variables parsed, typed, and bound in [`ModelInstantiator`](file:///home/omar/git3/modelscript/languages/ampl/src/instantiator/model-instantiator.ts#L88). |
| **Semicontinuous / Semi-integer** | Yes | No | 🔴 | `semicont`, `semiint` variable declarations not yet supported. |
| **Defined Variables** | Yes | No | 🔴 | `var y = 2*x + 1;` substitution variables automatically eliminated by presolve are not yet implemented. |
| **Variable / Constraint Suffixes** | Yes | No | 🔴 | Suffix attributes (`.val`, `.lb`, `.ub`, `.rc`, `.dual`, `.slack`, `.status`) are managed internally in results rather than exposed as syntax attributes. |
| **Objectives (Min / Max)** | Yes | Yes | 🟢 | Single primary objective (`minimize` / `maximize`) with linear, quadratic, and nonlinear expressions. |
| **Multiple Objectives** | Yes | Planned | 🟡 | Commercial AMPL allows declaring multiple objectives and toggling via `objective name;`. ModelScript selects the first objective. |
| **Constraints & Range Constraints** | Yes | Yes | 🟢 | Supports `<=`, `>=`, `=`, and double-sided range constraints (`lower <= expr <= upper`). |
| **Piecewise Linear Terms** | Yes | No | 🔴 | `<<b1, b2; s1, s2, s3>> x` syntax and its automatic SOS2/binary linearization are not supported. |
| **Complementarity Constraints (MPEC)** | Yes | No | 🔴 | `expr complements expr` for equilibrium and bilevel programming not supported. |
| **Logical / Disjunctive Constraints** | Yes | No | 🔴 | `alldiff`, `count`, `atleast`, `atmost`, `==>`, `or`, `and` with Big-M reformulations not supported. |

---

### B. Execution Model & Scripting

| Feature | Commercial AMPL | ModelScript AMPL | Status | Technical Details & Differences |
| :--- | :---: | :---: | :---: | :--- |
| **Declarative Compilation** | Yes | Yes | 🟢 | Parses `.mod` and `.dat` into structured semantic models and unrolled instances. |
| **Imperative Control Flow** | Yes | No | 🔴 | Commercial AMPL provides a Turing-complete command interpreter (`for`, `while`, `repeat`, `if-then-else`). In ModelScript, loops and algorithmic iteration are driven via TypeScript/JavaScript or CLI scripts. |
| **Dynamic Problem Modification** | Yes | No | 🔴 | `fix x;`, `unfix x;`, `let x := val;`, `drop con;`, `restore con;` during interactive sessions are not supported. |
| **Display & Formatting** | Yes | Yes | 🟡 | `display`, `print`, `printf` formatted output. ModelScript CLI outputs structured console tables or machine-readable JSON (`--format=json`). |
| **Interactive REPL** | Yes | Planned | 🟡 | ModelScript has CLI commands (`msx ampl solve`, `inspect`, `lint`), but lacks a stateful interactive REPL shell. |

---

### C. Data Ingestion & File Formats

| Feature | Commercial AMPL | ModelScript AMPL | Status | Technical Details & Differences |
| :--- | :---: | :---: | :---: | :--- |
| **`.mod` Model Files** | Yes | Yes | 🟢 | Standard AMPL model syntax parsing. |
| **`.dat` Data Files (1D Lists)** | Yes | Yes | 🟢 | Standard syntax (`set S := a b c;`, `param P := 1 2 3;`). |
| **`.dat` Data Files (2D Tabular/Matrix)** | Yes | Yes | 🟢 | Two-dimensional matrix grids and row/column coordinate tables parsed in [`AmplDatParser`](file:///home/omar/git3/modelscript/languages/ampl/src/parser/ampl-dat-parser.ts#L104). |
| **MPS Files (`.mps`)** | Yes | Yes | 🟢 | Full read/parse ([`parseMpsProblem`](file:///home/omar/git3/modelscript/languages/ampl/src/mps/mps-parser.ts#L40)) and write/export ([`writeMpsProblem`](file:///home/omar/git3/modelscript/languages/ampl/src/mps/mps-writer.ts#L30)) with MILP integer markers and range bounds. |
| **ASL `.nl` Export** | Yes | Yes | 🟢 | Emits standard ASCII ASL `.nl` files with headers, linear gradients, Jacobians, and bounds ([`writeNlProblem`](file:///home/omar/git3/modelscript/languages/ampl/src/nl/nl-writer.ts#L12)). |
| **ASL `.sol` Solution Ingestion** | Yes | Yes | 🟢 | Ingests primal solution vectors, dual multipliers, and status strings ([`readSolResult`](file:///home/omar/git3/modelscript/languages/ampl/src/nl/nl-reader.ts#L12)). |
| **Database & Spreadsheet Tables** | Yes | No | 🔴 | Commercial AMPL has `table` declarations for direct ODBC/SQL/Excel reading/writing. ModelScript delegates tabular data to `@modelscript/csv` or JSON pipes. |

---

### D. Presolve & Automatic Differentiation (AD)

| Feature | Commercial AMPL | ModelScript AMPL | Status | Technical Details & Differences |
| :--- | :---: | :---: | :---: | :--- |
| **Built-in Presolve Engine** | Yes | Partial | 🟡 | Commercial AMPL has a sophisticated presolver (Fourer & Gay) that eliminates singleton rows/cols, tightens bounds, and substitutes fixed variables before invoking the solver. ModelScript performs constant folding and affine simplification, relying on solver-internal presolve (e.g., CLP/CBC/CPLEX presolvers). |
| **Postsolve Dual/Slack Recovery** | Yes | Planned | 🟡 | Duals and slacks for eliminated constraints are reconstructed in commercial AMPL. ModelScript reports solver-level duals directly. |
| **Automatic Differentiation (AD)** | Yes | Partial | 🟡 | Commercial ASL computes exact sparse Jacobians and Hessians of the Lagrangian ($\nabla^2 L$). ModelScript evaluates linear Jacobians algebraically and passes nonlinear ASTs to WASM solvers or DAE solvers. |
| **Binary `.nl` Format** | Yes | No | 🔴 | Commercial AMPL supports binary `.nl` for high-throughput encoding of large NLP models. ModelScript generates text-mode (ASCII `g3`) `.nl`. |

---

### E. Solvers & Algorithms

| Category | Commercial AMPL | ModelScript AMPL | Status | Details |
| :--- | :---: | :---: | :---: | :--- |
| **Zero-Install In-WASM LP** | No | Yes | 🌟 | COIN-OR CLP compiled to native WebAssembly in browser/Node. Zero binary dependencies. |
| **Zero-Install In-WASM MILP** | No | Yes | 🌟 | COIN-OR CBC compiled to native WebAssembly in browser/Node. |
| **Zero-Install In-WASM MINLP** | No | Yes | 🌟 | COIN-OR Couenne compiled to native WebAssembly via `@modelscript/simulate`. |
| **CPLEX Integration** | Yes | Yes | 🟢 | Dispatches to `cplexamp` (ASL pipe) or `cplex` (MPS pipe) with graceful detection. |
| **HiGHS, SCIP, CBC, IPOPT** | Yes | Yes | 🟢 | External binary execution supported via [`solveWithExternalSolver`](file:///home/omar/git3/modelscript/languages/ampl/src/solvers/external-solver.ts#L56). |
| **Gurobi, Xpress, Mosek** | Yes | Planned | 🟡 | Can be targeted externally through standard generated `.mps` and `.nl` files; dedicated direct driver wrappers planned. |
| **Nonlinear Solvers (KNITRO, CONOPT, BARON)** | Yes | External | 🟡 | Supported via ASL `.nl` export (`msx ampl to-nl model.mod --out=model.nl` followed by solver execution). |
| **MP Reformulation Framework** | Yes | No | 🔴 | AMPL's new MP library reformulates nonlinear functions (abs, min, max, piecewise) into linear/quadratic forms automatically. |

---

### F. Systems Engineering & Multi-Domain Interoperability (ModelScript Superpowers)

| Feature | Commercial AMPL | ModelScript AMPL | Status | Details |
| :--- | :---: | :---: | :---: | :--- |
| **DAE Arena Lowering** | No | Yes | 🌟 | Lowers AMPL optimization problems directly into WebAssembly linear-memory DAE arena (`DAEBuilder`). |
| **Modelica Projection** | No | Yes | 🌟 | Transforms AMPL mathematical models directly into acausal Modelica models (`model ... optimization ... end`). |
| **Cross-Language Co-Simulation** | No | Yes | 🌟 | Native coupling with 67 other engineering languages (e.g., OpenDSS electrical grids, EPANET water networks, GTFS transit schedules). |
| **Native Language Server (LSP)** | Commercial IDE plugin | Native Built-in | 🌟 | Zero-configuration LSP support in `@modelscript/lsp` for VS Code Web, Monaco, and desktop editors. |
| **AI Agent Integration (MCP)** | No | Yes | 🌟 | Exposes AMPL linting, inspection, conversion, and solving tools directly to LLMs via Model Context Protocol (`@modelscript/mcp`). |

---

## 3. Deep-Dive: The 5 Primary Technical Gaps

### 1. Imperative Scripting Interpreter
- **The Gap**: Commercial AMPL allows writing scripts that iteratively modify problem data and re-solve without reloading the model (e.g., Benders decomposition, column generation, progressive hedging, rolling-horizon MPC):
  ```ampl
  param cost_threshold default 1000;
  for {k in 1..10} {
     let demand := base_demand * (1 + 0.05 * k);
     solve;
     if TotalCost > cost_threshold then {
        fix FacilityOpen['West'] := 1;
     }
  }
  ```
- **Current ModelScript Approach**: ModelScript is a modular compiler library. Iterative optimization workflows are executed in TypeScript/JavaScript or Python via the SDK, manipulating `InstantiatedProblem` parameters or re-solving programmatically.

### 2. Suffix Architecture (`.val`, `.dual`, `.rc`, `.slack`)
- **The Gap**: In commercial AMPL, every entity has first-class accessible attributes post-solve:
  - `x.val`: Primal value
  - `x.rc`: Reduced cost
  - `con.dual`: Shadow price / Lagrange multiplier
  - `con.slack`: Constraint slack
  - `x.status`: Basic / non-basic / super-basic status
- **Current ModelScript Approach**: Solution outputs are returned in an `AmplSolverResult` object containing `solution: Record<string, number>`, `duals: Record<string, number>`, and `slacks: Record<string, number>`. The AST itself does not carry mutable suffix properties.

### 3. Dedicated AMPL Presolve & Postsolve Reconstruction
- **The Gap**: Commercial AMPL's presolver performs extensive pre-optimization analysis before generating the `.nl` file, reducing problem dimensions by 30–80% on industrial instances and detecting infeasibilities symbolically.
- **Current ModelScript Approach**: ModelScript simplifies flat expressions (constant folding, algebraic term combination, zero-coefficient elimination), and then delegates full presolve to the underlying solver engine (CLP, CBC, HiGHS, or CPLEX).

### 4. Non-Linear ASL Opcode Expression Trees in `.nl`
- **The Gap**: Commercial AMPL serializes complex nonlinear expressions using postfix/prefix opcode trees (`o0` addition, `o2` multiplication, `o11` exponentiation, `o37` sin, etc.) into the `.nl` file, allowing gradient and Hessian computation by external solvers like Ipopt and KNITRO.
- **Current ModelScript Approach**: ModelScript emits the linear objective gradient (`G0`) and linear constraint Jacobian (`J<k>`), writing nonlinear expressions as flat expressions in memory. For nonlinear models, ModelScript solves them via in-WASM Couenne or lowers them to the DAE arena for numerical integration.

### 5. Advanced Mathematical Formulations (Piecewise Linear & MPEC)
- **The Gap**: Commercial AMPL provides dedicated syntax for:
  - Piecewise linear terms (`<<break1, break2; slope1, slope2, slope3>> x`)
  - Complementarity conditions (`F(x) >= 0 complements x >= 0`)
  - Logical constraints (`alldiff`, `count`, `atmost`, `==>`)
- **Current ModelScript Approach**: Users express linear and nonlinear constraints algebraically.

---

## 4. ModelScript's Distinct Advantages

```
+-----------------------------------------------------------------------------------+
|                        ModelScript Polyglot Digital Thread                        |
+-----------------------------------------------------------------------------------+
|  [AMPL Mathematical Model]                                                       |
|       |                                                                           |
|       +--> Modelica Optimization Projection (acausal system dynamics)             |
|       |                                                                           |
|       +--> DAE Arena Lowering (linear-memory struct-of-arrays in WASM)            |
|       |                                                                           |
|       +--> Cross-Domain Co-Simulation (OpenDSS Grids + EPANET Water + GTFS Fleet) |
|       |                                                                           |
|       +--> In-WASM Solvers (CLP / CBC / Couenne -- 100% Client-Side, No Installs) |
+-----------------------------------------------------------------------------------+
```

1. **Zero-Install Client-Side WebAssembly Runtime**:
   Commercial AMPL requires downloading, installing, and licensing native platform binaries. ModelScript compiles COIN-OR CLP, CBC, and Couenne into WebAssembly, allowing complete LP, MILP, and MINLP optimization inside a web browser, VS Code Web, or edge compute without root access or binary installations.
2. **First-Class Systems Engineering Integration**:
   Commercial AMPL cannot talk to physical dynamic models. ModelScript provides direct bridges:
   - Lowering to DAE arena (`lowerAmplToDae`).
   - Projecting to acausal Modelica models (`lowerAmplToModelica`).
   - Coupling optimization decision variables directly with power systems (`@modelscript/opendss`), hydraulic systems (`@modelscript/epanet`), and fleet operations (`@modelscript/gtfs`).
3. **No Commercial License Overhead**:
   Commercial AMPL licenses can cost thousands of dollars per core or seat. ModelScript is fully open-source with open-source solvers, while retaining the ability to link to commercial solvers (CPLEX, HiGHS, Gurobi) when available.
4. **Modern Developer Tooling (LSP & MCP)**:
   Includes a native Language Server Protocol server with compiler linting rules (`M2001`–`M5001`) and direct integration with LLM agents via Model Context Protocol.

---

## 5. Prioritized Implementation Roadmap to Close Key Gaps

```
Phase 1 (Near-Term)      Phase 2 (Mid-Term)         Phase 3 (Long-Term)
-------------------      ------------------         -------------------
[ ] Suffix System        [ ] Scripting Loops        [ ] AMPL Presolver
    (.val, .dual, .rc)       (for/while/let)            (singleton/bounds)
[ ] Full Nonlinear NL    [ ] Semicont & SOS1/SOS2   [ ] MP Reformulations
    (opcode tree graph)  [ ] Piecewise Linear           (logic / Big-M)
[ ] Table CSV Support    [ ] Interactive REPL       [ ] MPEC Complementarity
```

1. **Phase 1: Extended Suffixes & Nonlinear `.nl` Serializer**
   - Implement postfix expression opcode serialization in `writeNlProblem` so external solvers like Ipopt and KNITRO can solve general non-convex NLPs with exact automatic differentiation.
   - Standardize `.val`, `.dual`, `.rc`, and `.slack` on solution results.
2. **Phase 2: Scripting & Advanced Declarations**
   - Add a lightweight scripting interpreter in `languages/ampl` for `for`, `let`, `fix`, `unfix`, and `solve` sequences.
   - Implement SOS1, SOS2, and piecewise linear syntax expansion.
3. **Phase 3: Standalone Presolve & Reformulation Engine**
   - Build a ModelScript-native presolver for row/column elimination and bound tightening prior to solver invocation.