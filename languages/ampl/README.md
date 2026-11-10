<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ampl

AMPL (A Mathematical Programming Language) modeling package (`.mod`, `.dat`, `.nl`) for ModelScript. Features an algebraic model and tabular data parser (`parseAmplModel`, `parseAmplData`), a relational set and multidimensional array instantiator (`instantiateAmpl`), static mathematical programming pre-flight linter (`lintAmpl`), universal AMPL Solver Library (`.nl`) serializer (`writeNlProblem`), direct linear-memory `DAEBuilder` lowering (`lowerAmplToDae`), and seamless solver bridges to ModelScript's in-WebAssembly COIN-OR solvers (CLP for LP, CBC for MILP, and IPOPT for NLP).

---

## Core Capabilities

- **AMPL Model & Tabular Data Parser (`parseAmplModel`, `parseAmplData`)**:
  - Parses `.mod` files declaring `set`, `param`, `var`, `minimize`/`maximize`, and `subject to` / `s.t.` equations with multi-dimensional indexing expressions.
  - Parses `.dat` tabular sections, including 1D parameter vectors, 2D matrix tables (`param: ... :=`), transposed slices, and set tuple literals.
- **Relational Set Algebra & Model Instantiator (`instantiateAmpl`)**:
  - Unrolls relational set comprehensions (`{i in ORIG, j in DEST : cost[i,j] < 50}`), Cartesian products, set unions, intersections, and set differences.
  - Instantiates concrete flat scalar decision variables and constraint rows from high-level indexed declarations.
- **Pre-flight Mathematical Programming Linter (`lintAmpl`, `M9501`–`M9510`)**:
  - Detects unbound sets, uninitialized parameters, conflicting variable bounds ($l_x > u_x$), division by zero in parameter expressions, and nonlinear terms in integer programs.
- **Direct WebAssembly Solver Execution (`solveAmpl`)**:
  - **Linear Programming (LP)**: Direct lowering to Compressed Sparse Column (CSC) `LpProblem` and execution via in-WASM **COIN-OR CLP**.
  - **Mixed-Integer Linear Programming (MILP)**: Binary and integer variable constraint lowering to in-WASM **COIN-OR CBC**.
  - **Nonlinear Programming (NLP)**: Automatic differentiation tape generation for objective and constraint Jacobians, with in-WASM **COIN-OR IPOPT** execution.
- **AMPL Solver Library (.nl) Interchange (`writeNlProblem`, `readSolResult`)**:
  - Serializes flat optimization problems into standard `.nl` format for interoperability with external solvers (HiGHS, KNITRO, Gurobi, CPLEX, SCIP).
- **Linear-Memory `DAEBuilder` Lowering (`lowerAmplToDae`)**:
  - Lowers algebraic constraints and decision variables directly into the ModelScript WebAssembly DAE arena for multi-physics co-simulation.
- **Language Server Protocol (LSP) Support**:
  - Document outline, symbol definitions, hover details, and diagnostics.
