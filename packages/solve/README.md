<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/solve`

Unified SciML-inspired solver, reachability, and formal verification foundation for ModelScript.

## Core Primitives

- **`OutwardInterval`** (`@modelscript/solve/interval`): Canonical IEEE-754 outward-rounded interval arithmetic using fast 32-bit `Uint32Array` `nextUp`/`nextDown` with `TwoSum` overflow protection and $O(\log n)$ integer powers.
- **`WasmScratchPool`** (`@modelscript/solve/wasm-pool`): Scoped, 8-byte-aligned linear-memory bump allocator (`scope()` / `dispose()` / `[Symbol.dispose]()`) eliminating `wasm.__new` leaks and hardcoded offsets.
- **`VerificationCertificate`** (`@modelscript/solve/certificate`): Enforces the strict rigor invariant that `isCertifiedSafe` can only be `true` when `verdict.status === "proven"` and `rigor` is `"exact-rational"` or `"outward-f64"`.
- **Unified `Problem` / `Algorithm` / `solve()` / `init()`**: Single-verb dispatch across `ODEProblem`, `DAEProblem`, `SDEProblem`, `DDEProblem`, `BVPProblem`, `ReachabilityProblem`, `BarrierProblem`, and `EnsembleProblem` with immutable `remake(prob, patch)`.

## Usage

```ts
import { ODEProblem, Rodas4P, remake, solve } from "@modelscript/solve";
import "@modelscript/simulate"; // Registers canonical ODE/DAE/SDE/DDE/BVP/Ensemble solvers

const prob = ODEProblem((_t, u, p?: { k: number }) => [-(p?.k ?? 1) * u[0]!], [1.0], [0, 1.0], { k: 2.0 });
const sol = solve(prob, Rodas4P(), { reltol: 1e-6, abstol: 1e-8 });
const fastSol = solve(remake(prob, { p: { k: 10.0 } }), Rodas4P());
```
