# `@modelscript/verilog-a`

Verilog-A and Verilog-AMS (IEEE 1857 / Accellera) Compact Device Modeling and Analog Simulation Language Package for ModelScript.

Provides zero-regex, high-performance AST parsing, pre-flight analog device modeling and numerical convergence diagnostics (`M7601`–`M7620`), direct linear-memory WebAssembly `DAEBuilder` lowering, bidirectional projections (Modelica 3.x acausal analog models, SPICE subcircuits with non-linear B-sources), multi-file workspace indexing, and Language Server Protocol (LSP) services.

## Supported Formats

- `.va`: Verilog-A analog behavioral models and compact device models (BSIM, PSP, EKV, HEMT, diode, passive networks)
- `.vams`: Verilog-AMS continuous-discrete mixed-signal modules

## Diagnostic Error Codes (`M7601`–`M7620`)

| Code    | Rule                                  | Severity  | Description                                                                         |
| :------ | :------------------------------------ | :-------- | :---------------------------------------------------------------------------------- |
| `M7601` | `unassigned-analog-branch`            | `error`   | Electrical port pair has no constitutive branch equation in analog block.           |
| `M7602` | `discontinuous-derivative-expression` | `warning` | Discontinuous time-derivative operator `ddt()` used inside conditional statement.   |
| `M7603` | `invalid-parameter-range`             | `error`   | Parameter default value violates declared range `from [min:max]`.                   |
| `M7604` | `unbounded-exponential-growth`        | `warning` | Unbounded exponential function `exp()` used instead of safe `limexp()`.             |
| `M7605` | `port-discipline-mismatch`            | `error`   | Port has no declared discipline or mismatch with module domain.                     |
| `M7606` | `undefined-node-reference`            | `error`   | Branch access `V()` or `I()` references undeclared node.                            |
| `M7607` | `duplicate-module-declaration`        | `error`   | Duplicate module declaration with identical name in document.                       |
| `M7608` | `zero-resistance-branch`              | `error`   | Potential contribution `V(p, n) <+ 0.0` forms an unconstrained ideal short-circuit. |
| `M7609` | `floating-internal-node`              | `warning` | Internal node declared in discipline but never referenced in analog branch.         |
| `M7610` | `unsupported-analog-primitive`        | `warning` | Unsupported or deprecated analog primitive or system task.                          |

## Quick Start

```typescript
import {
  parseVerilogA,
  lintVerilogA,
  lowerVerilogAToDae,
  verilogAToModelica,
  verilogAToSpice,
} from "@modelscript/verilog-a";

// 1. Parse Verilog-A compact model
const doc = parseVerilogA(code);
const mod = doc.modules[0];

// 2. Pre-flight linting
const diagnostics = lintVerilogA(doc);

// 3. Direct linear DAE arena lowering
const dae = lowerVerilogAToDae(mod);
console.log(`Variables: ${dae.getVarCount()}, Equations: ${dae.getEqCount()}`);

// 4. Bidirectional projections
const modelicaCode = verilogAToModelica(mod);
const spiceSubcircuit = verilogAToSpice(mod);
```
