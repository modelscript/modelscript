<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/asm`

IWA Activated Sludge Models (ASM1, ASM2d, ASM3, ADM1) biokinetics engine, Petersen stoichiometric matrix compiler, Takács 10-layer clarifier settling flux, and zero-GC linear-memory `DAEBuilder` arena lowering for ModelScript.

Supports water resource recovery facilities (WRRF) and municipal/industrial wastewater treatment plant simulation, BSM1 benchmark validation, biological nitrogen removal (nitrification/denitrification), and secondary sedimentation.

---

## Features

| Feature                            | Description                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance**           | Full implementation of IWA ASM1 (Henze et al., 1987), ASM2d, ASM3, and ADM1 models.                                                                                                         |
| **Petersen Stoichiometric Matrix** | Explicit stoichiometric mapping across soluble ($S_I, S_S, S_O, S_{NO}, S_{NH}, S_{ND}, S_{ALK}$) and particulate ($X_I, X_S, X_{BH}, X_{BA}, X_P, X_{ND}$) components.                     |
| **Nonlinear Monod Kinetics**       | Multi-substrate saturation kinetics with switching functions for aerobic, anoxic, and anaerobic states.                                                                                     |
| **Takács 10-Layer Clarifier**      | 1D sedimentation model with double-exponential settling velocity $v_s(X)$, hindered flux, and thickening underflow.                                                                         |
| **DAE Arena Lowering**             | Compiles CSTR reactors, hydraulic recycle loops, and oxygen mass transfer ($K_L a$) directly into linear-memory `@modelscript/runtime` `DAEBuilder` arena.                                  |
| **Diagnostic Linter**              | Validates plant architecture (`ASM1001`), non-positive volumes (`ASM2001`), aerobic oxygen starvation (`ASM2002`), negative concentrations (`ASM3001`), and clarifier geometry (`ASM4001`). |
| **LSP Integration**                | Multi-level outline trees for Bioreactors and Clarifiers, plus real-time diagnostics.                                                                                                       |

---

## Installation

```bash
npm install @modelscript/asm
```

---

## Quick Start

```typescript
import { parseAsmPlant, computeAsm1ConversionRates, lowerAsmToDae } from "@modelscript/asm";

// 1. Ingest a BSM1 wastewater treatment plant model (.asm / .bsm)
const plant = parseAsmPlant(bsmText);
console.log(`Plant: ${plant.name}, Bioreactors: ${plant.reactors.length}`);

// 2. Evaluate biokinetics net conversion rates
const netRates = computeAsm1ConversionRates(plant.influentConcentrations);
console.log(`Heterotrophic substrate removal rate: ${netRates["S_S"]} g COD/(m3*day)`);

// 3. Lower plant hydraulics and biokinetics directly into zero-GC DAE arena
const dae = lowerAsmToDae(plant);
console.log(`Instantiated DAE arena: ${dae.varCount} variables, ${dae.eqCount} equations`);
```

---

## License

AGPL-3.0-or-later
