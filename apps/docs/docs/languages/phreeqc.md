# USGS PHREEQC Aqueous Geochemistry & Speciation (`.pqi`, `.dat`)

`@modelscript/phreeqc` (`languages/phreeqc`) provides native WebAssembly GLR parsing, ionic strength and Davies / Extended Debye-Hückel activity coefficient calculation, aqueous carbonate/redox speciation, mineral Saturation Index ($\text{SI}$) evaluation, `DAEBuilder` lowering, and Modelica 3.x projection for **USGS PHREEQC** hydrogeochemical, brine scaling, carbon mineralization, and water treatment models.

---

## Supported Extensions & Standards

| Extension | Format                 | Description                                                                                                              |
| :-------- | :--------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `.pqi`    | PHREEQC Input Deck     | Keyword data blocks (`TITLE`, `SOLUTION`, `EQUILIBRIUM_PHASES`, `REACTION`, `KINETICS`, `MIX`, `SELECTED_OUTPUT`, `END`) |
| `.dat`    | Thermodynamic Database | Aqueous species (`SOLUTION_SPECIES`) and mineral solubility (`PHASES`) database definitions                              |

---

## Key Capabilities

### 1. Ionic Strength & Activity Coefficients

- Computes solution ionic strength $I = \frac{1}{2}\sum_i m_i z_i^2$, charge balance error (% CBE), and ion activity coefficients $\gamma_i$ using the **Davies** or **WATEQ Extended Debye-Hückel** equation:
  $$\log_{10} \gamma_i = -A z_i^2 \left(\frac{\sqrt{I}}{1 + \sqrt{I}} - 0.3 I\right)$$

### 2. Mineral Saturation Indices ($\text{SI}$) & Equilibrium Phases

- Evaluates Ion Activity Products ($\text{IAP}$) and mineral Saturation Indices across carbonate, sulfate, and silicate phases (`Calcite`, `Dolomite`, `Gypsum`, `Anhydrite`, `Barite`, `Halite`, `Quartz`):
  $$\text{SI} = \log_{10}\!\left(\frac{\text{IAP}}{K_{\text{sp}}(T)}\right)$$
  identifying supersaturated scaling hazards ($\text{SI} > 0$) and undersaturated dissolution regimes ($\text{SI} < 0$).

### 3. DAE Arena Lowering & Modelica Projection

- Lowers aqueous mass-action, charge-balance, and kinetic mineral dissolution/precipitation equations into `@modelscript/runtime`'s `DAEBuilder` arena and projects them into Modelica 3.x hydrochemical blocks.

---

## Pre-Flight Diagnostics

<LintRules lang="phreeqc" />

---

## CLI Usage

```bash
# Validate electrical charge balance, pH/pe bounds, and phase blocks
msx lint GeothermalBrine.pqi

# Parse and inspect PHREEQC keyword blocks
msx parse GeothermalBrine.pqi
```
