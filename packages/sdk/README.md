<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/sdk`

TypeScript and AssemblyScript SDK for authoring user-defined ModelScript capabilities, signal-processing kernels, visual artifacts, and portable WebAssembly verification modules bound to SysML v2 and Modelica models (e.g., via `msx init-kernel` and `msx sysml-run`).

---

## Architecture & Modules

| Module                       | Path                  | Responsibility                                                                                               |
| :--------------------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------- |
| **AssemblyScript Compiler**  | `src/asc-compiler.ts` | Compiles user-authored AssemblyScript capability kernels (`assembly/*.ts`) into standalone `.wasm` binaries  |
| **WASM Kernel Runner**       | `src/wasm-runner.ts`  | Instantiates and executes compiled WebAssembly capability kernels with typed input/output marshaling         |
| **TypeScript Kernel Runner** | `src/ts-runner.ts`    | Executes user-defined TypeScript verification and analysis kernels in-process                                |
| **DSP Primitives**           | `src/dsp.ts`          | Built-in digital signal processing helpers (FFT, filtering, windowing, spectral metrics) for kernel authors  |
| **Testing Harness**          | `src/testing.ts`      | Assertion and fixture utilities for unit-testing user-defined ModelScript capability packs                   |
| **Core Types**               | `src/types.ts`        | Shared TypeScript interfaces for capability manifests, kernel inputs/outputs, verdicts, and visual artifacts |
| **AssemblyScript Prelude**   | `assembly/index.ts`   | `@modelscript/sdk/assembly` linear-memory ABI helpers for AssemblyScript kernel authors                      |

---

## Subpath Exports

| Subpath                     | Target              | Description                                                       |
| :-------------------------- | :------------------ | :---------------------------------------------------------------- |
| `@modelscript/sdk`          | `src/index.ts`      | Root barrel exporting compilers, runners, DSP, testing, and types |
| `@modelscript/sdk/assembly` | `assembly/index.ts` | AssemblyScript runtime prelude for compiling WASM kernels         |

---

## Example Reference Workspace

See [`packages/examples/sysml-wasm-pack/`](../examples/sysml-wasm-pack/) for a complete example combining SysML v2 capability definitions, a Modelica plant, and both AssemblyScript (`assembly/analyzer.ts`) and TypeScript (`src/ts-analyzer.ts`) kernels.

---

## Scripts

```bash
pnpm --filter @modelscript/sdk run build      # Compile TypeScript (tsc)
pnpm --filter @modelscript/sdk run typecheck  # Typecheck (tsc --noEmit)
pnpm --filter @modelscript/sdk run test       # Run SDK unit tests
pnpm --filter @modelscript/sdk run clean      # Remove dist/ artifacts
```
