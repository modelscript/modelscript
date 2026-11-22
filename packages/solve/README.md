<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/solve`

Unified SciML-inspired solver, reachability, and formal verification foundation shared across `@modelscript/runtime` and `@modelscript/simulate`.

---

## Core Modules & Primitives

| Module / Primitive            | File                       | Subpath Export                   | Description                                                                                                                                                                                |
| :---------------------------- | :------------------------- | :------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`OutwardInterval`**         | `src/outward-interval.ts`  | `@modelscript/solve/interval`    | Canonical IEEE-754 outward-rounded interval arithmetic using fast 32-bit `Uint32Array` `nextUp`/`nextDown` with `TwoSum` overflow protection and $O(\log n)$ integer powers                |
| **`WasmScratchPool`**         | `src/wasm-scratch-pool.ts` | `@modelscript/solve/wasm-pool`   | Scoped, 8-byte-aligned linear-memory bump allocator (`scope()` / `dispose()` / `[Symbol.dispose]()`) eliminating `wasm.__new` leaks and hardcoded offsets                                  |
| **`VerificationCertificate`** | `src/certificate.ts`       | `@modelscript/solve/certificate` | Enforces the strict rigor invariant that `isCertifiedSafe` can only be `true` when `verdict.status === "proven"` and `rigor` is `"exact-rational"` or `"outward-f64"`                      |
| **Typed Problems**            | `src/problems.ts`          | `@modelscript/solve`             | Immutable problem descriptors (`ODEProblem`, `DAEProblem`, `SDEProblem`, `DDEProblem`, `BVPProblem`, `ReachabilityProblem`, `BarrierProblem`, `EnsembleProblem`) and `remake(prob, patch)` |
| **Algorithm Descriptors**     | `src/algorithms.ts`        | `@modelscript/solve`             | Typed solver algorithm descriptors (`Tsit5`, `Dopri5`, `Rodas4P`, `TRBDF2`, `CVODE`, `IDA`, reachability & barrier methods)                                                                |
| **Unified Dispatch**          | `src/solve.ts`             | `@modelscript/solve`             | Single-verb `solve(prob, alg, opts)` and `init(prob, alg, opts)` registry dispatch across numerical and formal verification backends                                                       |

---

## Subpath Exports

| Subpath                          | Target                     | Description                                                                                            |
| :------------------------------- | :------------------------- | :----------------------------------------------------------------------------------------------------- |
| `@modelscript/solve`             | `src/index.ts`             | Root barrel exporting problems, algorithms, `solve`, `init`, intervals, certificates, and scratch pool |
| `@modelscript/solve/interval`    | `src/outward-interval.ts`  | Outward-rounded IEEE-754 interval arithmetic                                                           |
| `@modelscript/solve/certificate` | `src/certificate.ts`       | Strict formal verification certificate types and constructors                                          |
| `@modelscript/solve/wasm-pool`   | `src/wasm-scratch-pool.ts` | Scoped WebAssembly linear-memory scratch pool                                                          |

---

## Usage

```ts
import { ODEProblem, Rodas4P, remake, solve } from "@modelscript/solve";
import "@modelscript/simulate"; // Registers canonical ODE/DAE/SDE/DDE/BVP/Ensemble solvers

const prob = ODEProblem((_t, u, p?: { k: number }) => [-(p?.k ?? 1) * u[0]!], [1.0], [0, 1.0], { k: 2.0 });
const sol = solve(prob, Rodas4P(), { reltol: 1e-6, abstol: 1e-8 });
const fastSol = solve(remake(prob, { p: { k: 10.0 } }), Rodas4P());
```

---

## Scripts

```bash
pnpm --filter @modelscript/solve run build      # Compile TypeScript (tsc)
pnpm --filter @modelscript/solve run test       # Run interval, certificate, wasm-pool, and dispatch tests
pnpm --filter @modelscript/solve run lint       # Run ESLint across src/ and tests/
pnpm --filter @modelscript/solve run typecheck  # Typecheck (tsc --noEmit)
pnpm --filter @modelscript/solve run clean      # Remove dist/ artifacts
```
