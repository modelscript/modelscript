# Cleanroom Standard Libraries

ModelScript ships **32 built-in cleanroom standard libraries** so users can parse, lint, visualize, lower to `DAEBuilder`, and simulate engineering artifacts from proprietary tools **without requiring the original vendor software or proprietary library files on disk**.

## Architecture

Every cleanroom standard library follows a uniform, browser- and Node.js-isomorphic package architecture registered in `@modelscript/runtime`'s `globalLibraryRegistry`:

1. **Manifest (`assets/<lang>-std-lib/modelscript.yaml`)** — Declares the package name (`@modelscript/<lang>-std-lib`), language ID, `dist/symbols.json`, `dist/diagrams.json`, and `dist/runtime.wasm`.
2. **Zero-I/O Isomorphic Bundle (`src/catalog/<lang>-std-lib-data.ts`)** — Pre-bundles symbols, cleanroom parametric SVG icons, port layouts, and base64-encoded `runtime.wasm` so `registerBuiltIn<Lang>LibrarySync()` works identically in **Node.js, Browsers, and Web Workers** with zero filesystem I/O.
3. **Auto-Registration** — Every language plugin (`src/language.ts`), LSP server startup (`packages/lsp`), and DAE/solver entrypoint automatically registers its cleanroom library in `globalLibraryRegistry`.
4. **Zero-GC AssemblyScript WASM Kernel (`dist/runtime.wasm`)** — Compiled cleanroom mathematical models using a 2048-byte aligned linear-memory slot ABI, with shared core physics kernels in `packages/runtime/assembly/physics/` (`ieee-wecc-dynamics.ts`, `protection-tcc.ts`, `thermo-eos.ts`).
5. **Cleanroom IP Provenance** — Every component schema carries a `provenance` citation referencing published open standards (IEEE, IEC, WECC, NERC, IAPWS-IF97, ISO 20765, ASTM, OMG, NIST WebBook, FDA) or open peer-reviewed literature.

## Built-In Cleanroom Standard Libraries (32)

### Electrical Power Grids, Protection & EMT (11)

| Language       | Package                             | Cleanroom Coverage                                                                                                  |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pscad`        | `@modelscript/pscad-master-lib`     | EMT Master Library (sources, RLC, Bergeron/FD lines, transformers, machines, converters, controls)                  |
| `psse`         | `@modelscript/psse-std-lib`         | 366 IEEE/WECC dynamic models (`GENROU`, `SEXS`, `ESAC1A`, `TGOV1`, `REGCA1`, `CMPLDW`, etc.)                        |
| `pslf`         | `@modelscript/pslf-std-lib`         | 94 GE PSLF / WECC dynamic models (`genrou`, `exst1`, `hygov`, `pss2a`, `regc_a`, `reec_a`, `cmpldw`, `lshd1`, etc.) |
| `powerworld`   | `@modelscript/powerworld-std-lib`   | 43 PowerWorld `.aux` transient stability & dynamic models                                                           |
| `powerfactory` | `@modelscript/powerfactory-std-lib` | 66 DIgSILENT Global Library cable/line/transformer types, IEEE/IEC DSL frames, and protection relays                |
| `rtds`         | `@modelscript/rtds-std-lib`         | 30 RSCAD EMT components (50 µs Dommel RLC, Bergeron, VSC/MMC, SRF-PLL, Park `abc ↔ dq0`, relays)                    |
| `cyme`         | `@modelscript/cyme-std-lib`         | 25 distribution equipment models (Carson conductors, 32-step regulators, fuses, IEEE 1547-2018 DER)                 |
| `oneliner`     | `@modelscript/oneliner-std-lib`     | 28 relay & sequence equipment models (IEEE C37.112 / IEC 60255 overcurrent, Mho/Quad 21, Diff 87, Dir 67)           |
| `sel`          | `@modelscript/sel-std-lib`          | 29 SEL relay elements (U1–U5 / C1–C5 TCC curves, 50/51/21/67/87/79/81/50BF, `SV_TIMER`, SELogic)                    |
| `plscadd`      | `@modelscript/plscadd-std-lib`      | 22 ASTM/IEC `.wir` conductors, hyperbolic catenary sag-tension, ruling-span state-change, NESC C2 / IEEE 738        |
| `atp`          | `@modelscript/atp-std-lib`          | 26 EMTP-ATP cards (Dommel RLC, Bergeron/JMarti/Semlyen, Type 92 MOV, Type 15 impulse, TACS)                         |

### Controls, Aerospace, Multibody & Marine (8)

| Language   | Package                         | Cleanroom Coverage                                                                                                          |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `simulink` | `@modelscript/simulink-std-lib` | 90 standard Simulink & Simscape blocks (Continuous, Discrete, Math, Discontinuities, Logic, Routing, Lookup, Sources/Sinks) |
| `easy5`    | `@modelscript/easy5-std-lib`    | 47 components across `gp`, `hc`, `gd`, `ec`, `ae`, and `vc` libraries + US Standard Atmosphere 1976                         |
| `rocets`   | `@modelscript/rocets-std-lib`   | 30 rocket propulsion modules (turbopumps, choked nozzles, combustors, valves, NIST cryo fluids)                             |
| `adams`    | `@modelscript/adams-std-lib`    | 40 runtime functions (`STEP`, `STEP5`, `IMPACT`, `BISTOP`), joints, 6-DOF bushings, and Pacejka `PAC2002_TIRE`              |
| `simpack`  | `@modelscript/simpack-std-lib`  | 26 force elements (`$F_*`), joints (`$J_*`), Polach/Kalker wheel-rail contact, and Pacejka MF tires                         |
| `gtsuite`  | `@modelscript/gtsuite-std-lib`  | 24 1D gas-dynamics & powertrain templates (Wiebe combustion, Woschni heat transfer, turbomachinery, battery)                |
| `gensys`   | `@modelscript/gensys-std-lib`   | 29 rail multibody couplings (`k_s`, `c_s`, `k_air`, `wr_coupl_pe3`), Hertz contact, S1002/UIC60 profiles                    |
| `sima`     | `@modelscript/sima-std-lib`     | 20 offshore SIMO/RIFLEX hydrodynamic, catenary mooring, JONSWAP/NPD metocean, fender & thruster elements                    |

### Process, Oil & Gas, Subsurface & Nuclear (7)

| Language  | Package                        | Cleanroom Coverage                                                                                                           |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `aspen`   | `@modelscript/aspen-std-lib`   | 69 unit operations (`Flash2`, `RadFrac`, `HeatX`, `Compr`, `RCSTR`, etc.), Peng-Robinson/SRK/NRTL, NIST pure components      |
| `gproms`  | `@modelscript/gproms-std-lib`  | 22 PML dynamic reactors, separators, heat exchangers, valves, and PID controllers                                            |
| `olga`    | `@modelscript/olga-std-lib`    | 20 multiphase pipeline modules (Zuber-Findlay drift-flux, Beggs-Brill, Taitel-Dukler, Perkins choke, PVT)                    |
| `lps`     | `@modelscript/lps-std-lib`     | 22 gas/liquid pipeline models (Weymouth, Darcy-Weisbach, Joukowsky surge, AGA-8, GERG-2008, Peng-Robinson)                   |
| `eclipse` | `@modelscript/eclipse-std-lib` | 20 black-oil/compositional reservoir physics models (Peaceman PI, Corey/Stone I-II, Fetkovich aquifers, PVT/EOS)             |
| `relap5`  | `@modelscript/relap5-std-lib`  | 25 thermal-hydraulic & nuclear models (6-group point kinetics, ANS-79 decay heat, Dittus-Boelter/Chen/Zuber CHF, IAPWS-IF97) |
| `tough`   | `@modelscript/tough-std-lib`   | 22 EOS & porous-media models (`EOS1`–`EOS9`, `ECO2N`, Van Genuchten `IRP7`/`ICP7`, Corey `IRP3`)                             |

### Pharmacometrics & Hybrid Ecosystems (6)

| Language    | Package                          | Cleanroom Coverage                                                                                                            |
| ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `nmtran`    | `@modelscript/nmtran-std-lib`    | 25 NONMEM PREDPP subroutines (`ADVAN1`–`ADVAN13`, `TRANS1`–`TRANS6`, Hill `PRED_EMAX`, TMDD, residual error)                  |
| `mlxtran`   | `@modelscript/mlxtran-std-lib`   | 24 Monolix PK/PD/TMDD/TGI models (`bolus_1cpt_VCl`, `oral1_1cpt_kaVCl`, PK macros, Simeoni TGI)                               |
| `magicdraw` | `@modelscript/magicdraw-std-lib` | 33 MagicDraw/Cameo SysML customization, SI/QUDV ValueType conversions, and CST rollup/constraint evaluators                   |
| `fea`       | `@modelscript/fea-std-lib`       | 26 Abaqus/NASTRAN element & material cards (`MAT1`, `MAT8`/`PCOMP`, `ABQ_PLASTIC_J2`, Neo-Hookean, Norton creep)              |
| `spice`     | `@modelscript/spice-std-lib`     | 28 discrete semiconductors (Shockley, Ebers-Moll, Shichman-Hodges) + LTspice/PSpice behavioral primitives                     |
| `ampl`      | `@modelscript/ampl-std-lib`      | 33 built-in math, statistical (`ampl_Normal`, Lanczos `ampl_Gamma`), piecewise-linear (`ampl_pwl`), and aggregation functions |

## Extending with Custom User Models (AssemblyScript WASM & FMI 2.0/3.0)

When a user artifact references a proprietary or site-specific user-defined model (`S-Function`, `USRMDL`, `epcmod`, `USER2`, `UMAT`, `MODELS`, etc.), ModelScript provides two sandboxed escape hatches:

### 1. Runtime AssemblyScript Compilation

```ts
import { compileAssemblyScriptCleanroomModel, createIsolatedWasmInstance } from "@modelscript/runtime";

const { wasmBytes, diagnostics } = await compileAssemblyScriptCleanroomModel(`
  export function customStep(u: f64, gain: f64): f64 {
    return u * gain;
  }
`);

if (wasmBytes) {
  const inst = createIsolatedWasmInstance(wasmBytes)!;
  const customStep = inst.exports.customStep as (u: number, gain: number) => number;
  console.log(customStep(2.0, 3.5)); // 7.0
}
```

### 2. FMI 2.0 / 3.0 Co-Simulation Linking

Every cleanroom catalog package exports a language-native FMU linker (for example `fmuToSimulinkBlock`, `fmuToPslfDyd`, `fmuToPowerFactoryDsl`, `fmuToAspenUser2`, `fmuToFeaInpCard`, `fmuToSpiceSubckt`) so black-box vendor FMUs can be co-simulated directly alongside cleanroom WASM models.
