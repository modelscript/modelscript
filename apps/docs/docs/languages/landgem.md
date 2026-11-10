---
title: "EPA LandGEM Biogas & Landfill Gas (.landgem, .lfg, .biogas)"
description: "@modelscript/landgem (languages/landgem) provides native parsing, first-order decay kinetics, ADM1 anaerobic digester simulation, and CHP DAE lowering for US EPA Landfill Gas Emissions Model (LandGEM) and waste-to-energy facilities."
---

# EPA LandGEM Biogas & Landfill Gas (`.landgem`, `.lfg`, `.biogas`)

`@modelscript/landgem` (`languages/landgem`) provides native parsing, first-order methane decay kinetics, continuous stirred-tank anaerobic digestion (ADM1), and Combined Heat & Power (CHP) DAE lowering for **US EPA LandGEM** and industrial organic waste-to-energy models.

---

## Supported Extensions & Standards

| Extension | Format | Description |
| :--- | :--- | :--- |
| `.landgem`, `.lfg` | EPA LandGEM Model | Annual solid waste acceptance cohorts, methane capacity $L_0$, and decay rates $k$ |
| `.biogas` | Biogas / ADM1 Digester Deck | CSTR reactor parameters, hydraulic retention times (HRT), and influent COD loads |

---

## Key Capabilities

### 1. First-Order Decay Methane Generation Kinetics

- Evaluates the canonical US EPA LandGEM equation summing over all historical waste cohorts $i$:
  $$Q_{\text{CH}_4}(t) = \sum_{i=1}^{n} 2 k L_0 M_i e^{-k t_{i}}$$
  where $k$ is the methane generation rate constant ($\text{yr}^{-1}$), $L_0$ is the potential methane generation capacity ($\text{m}^3/\text{Mg}$), and $M_i$ is the mass of waste accepted in year $i$.
- Evaluates landfill gas (LFG) collection efficiency and non-methane organic compound (NMOC) emissions.

### 2. ADM1 Continuous Anaerobic Digestion Engine

- Models mesophilic ($37^\circ\text{C}$) and thermophilic ($55^\circ\text{C}$) anaerobic CSTR digesters with chemical oxygen demand (COD) destruction:
  $$r_{\text{COD}} = \eta_{\text{removal}} \cdot \frac{S_{\text{COD,in}}}{HRT}$$
  $$Q_{\text{CH}_4,\text{dig}} = r_{\text{COD}} \cdot V_{\text{reactor}} \cdot Y_{\text{CH}_4/\text{COD}}$$
  where theoretical methane yield $Y_{\text{CH}_4/\text{COD}} \approx 0.35 \, \text{m}^3 \, \text{CH}_4 / \text{kg COD}_{\text{removed}}$ at STP.
- Monitors Volatile Fatty Acid (VFA) accumulation and digester souring risk based on pH.

### 3. Combined Heat & Power (CHP) DAE Lowering

- Couples gas production directly into electrical and thermal energy output equations in `DAEBuilder`:
  $$P_{\text{elec}}(t) = Q_{\text{CH}_4}(t) \cdot \text{LHV}_{\text{CH}_4} \cdot \eta_{\text{elec}}$$
  $$P_{\text{thermal}}(t) = Q_{\text{CH}_4}(t) \cdot \text{LHV}_{\text{CH}_4} \cdot \eta_{\text{thermal}}$$
- Direct integration into electrical power networks (`@modelscript/opendss`) and district heating networks.

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="landgem" />

---

## CLI Usage

```bash
# Lint landfill cohorts and digester parameters
msx landgem lint MetroLandfill.landgem

# Compute 50-year methane generation trajectory and CHP electrical output
msx landgem biogas MetroLandfill.landgem

# Lower methane decay dynamics into ModelScript DAE arena
msx landgem to-dae MetroLandfill.landgem --out=biogas.dae
```
