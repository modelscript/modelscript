---
title: "EPA LandGEM Biogas & Landfill Gas (.landgem, .lfg, .biogas)"
description: "@modelscript/landgem (languages/landgem) provides native parsing, first-order decay kinetics, ADM1 anaerobic digester simulation, and CHP DAE lowering for US EPA Landfill Gas Emissions Model (LandGEM) and waste-to-energy facilities."
---

# EPA LandGEM Biogas & Landfill Gas (`.landgem`, `.lfg`, `.biogas`)

`@modelscript/landgem` (`languages/landgem`) provides native parsing, first-order methane decay kinetics, continuous stirred-tank anaerobic digestion (ADM1), and Combined Heat & Power (CHP) DAE lowering for **US EPA LandGEM** and industrial organic waste-to-energy models.

---

## Supported Extensions & Standards

| Extension          | Format                      | Description                                                                        |
| :----------------- | :-------------------------- | :--------------------------------------------------------------------------------- |
| `.landgem`, `.lfg` | EPA LandGEM Model           | Annual solid waste acceptance cohorts, methane capacity $L_0$, and decay rates $k$ |
| `.biogas`          | Biogas / ADM1 Digester Deck | CSTR reactor parameters, hydraulic retention times (HRT), and influent COD loads   |

---

## Key Capabilities

### 1. First-Order Decay Methane Generation Kinetics

- Evaluates the canonical US EPA LandGEM equation, which sums the exponentially decaying methane generation contributions across all historical annual waste cohorts $i$:
  $$Q_{\text{CH}_4}(t) = \sum_{i=1}^{n} 2 k L_0 M_i e^{-k t_{i}}$$

  | Symbol               | Meaning                                               | Units / Domain                             |
  | :------------------- | :---------------------------------------------------- | :----------------------------------------- |
  | $Q_{\text{CH}_4}(t)$ | Methane generation rate at time $t$                   | $\text{m}^3/\text{yr}$                     |
  | $t$                  | Simulation time                                       | $\text{yr}$                                |
  | $i, n$               | Waste cohort index and total number of annual cohorts | $\text{dimensionless}$ ($i = 1, \dots, n$) |
  | $k$                  | Methane generation rate constant                      | $\text{yr}^{-1}$                           |
  | $L_0$                | Potential methane generation capacity                 | $\text{m}^3/\text{Mg}$                     |
  | $M_i$                | Mass of waste accepted in year $i$                    | $\text{Mg}$                                |
  | $t_i$                | Age of waste cohort $i$ at time $t$                   | $\text{yr}$ ($t_i \ge 0$)                  |

- Evaluates landfill gas (LFG) collection efficiency and non-methane organic compound (NMOC) emissions.

### 2. ADM1 Continuous Anaerobic Digestion Engine

- Models mesophilic ($37^\circ\text{C}$) and thermophilic ($55^\circ\text{C}$) anaerobic CSTR digesters by computing the volumetric chemical oxygen demand (COD) removal rate and scaling it by reactor volume and methane yield:
  $$r_{\text{COD}} = \eta_{\text{removal}} \cdot \frac{S_{\text{COD,in}}}{HRT}$$
  $$Q_{\text{CH}_4,\text{dig}} = r_{\text{COD}} \cdot V_{\text{reactor}} \cdot Y_{\text{CH}_4/\text{COD}}$$

  | Symbol                       | Meaning                                                                | Units / Domain                                               |
  | :--------------------------- | :--------------------------------------------------------------------- | :----------------------------------------------------------- |
  | $r_{\text{COD}}$             | Volumetric COD removal rate                                            | $\text{kg COD}/(\text{m}^3 \cdot \text{d})$                  |
  | $\eta_{\text{removal}}$      | Fractional COD removal efficiency                                      | $\text{dimensionless}$ ($0 \le \eta_{\text{removal}} \le 1$) |
  | $S_{\text{COD,in}}$          | Influent COD concentration                                             | $\text{kg COD}/\text{m}^3$                                   |
  | $HRT$                        | Hydraulic retention time                                               | $\text{d}$ ($HRT > 0$)                                       |
  | $Q_{\text{CH}_4,\text{dig}}$ | Digester methane production rate                                       | $\text{m}^3\,\text{CH}_4/\text{d}$                           |
  | $V_{\text{reactor}}$         | Active liquid volume of the CSTR digester                              | $\text{m}^3$                                                 |
  | $Y_{\text{CH}_4/\text{COD}}$ | Theoretical methane yield per unit COD removed ($\approx 0.35$ at STP) | $\text{m}^3\,\text{CH}_4/\text{kg COD}_{\text{removed}}$     |

- Monitors Volatile Fatty Acid (VFA) accumulation and digester souring risk based on pH.

### 3. Combined Heat & Power (CHP) DAE Lowering

- Couples biogas production directly into electrical and thermal power output equations in `DAEBuilder` using the fuel's lower heating value and conversion efficiencies:
  $$P_{\text{elec}}(t) = Q_{\text{CH}_4}(t) \cdot \text{LHV}_{\text{CH}_4} \cdot \eta_{\text{elec}}$$
  $$P_{\text{thermal}}(t) = Q_{\text{CH}_4}(t) \cdot \text{LHV}_{\text{CH}_4} \cdot \eta_{\text{thermal}}$$

  | Symbol                     | Meaning                                  | Units / Domain                                               |
  | :------------------------- | :--------------------------------------- | :----------------------------------------------------------- |
  | $P_{\text{elec}}(t)$       | Net electrical power output              | $\text{W}$ (or $\text{kW}$)                                  |
  | $P_{\text{thermal}}(t)$    | Recoverable thermal power output         | $\text{W}$ (or $\text{kW}$)                                  |
  | $Q_{\text{CH}_4}(t)$       | Methane volumetric flow rate at time $t$ | $\text{m}^3/\text{s}$                                        |
  | $\text{LHV}_{\text{CH}_4}$ | Lower heating value of methane           | $\text{J}/\text{m}^3$                                        |
  | $\eta_{\text{elec}}$       | Electrical conversion efficiency         | $\text{dimensionless}$ ($0 \le \eta_{\text{elec}} \le 1$)    |
  | $\eta_{\text{thermal}}$    | Thermal recovery efficiency              | $\text{dimensionless}$ ($0 \le \eta_{\text{thermal}} \le 1$) |

- Direct integration into electrical power networks (`@modelscript/opendss`) and district heating networks.

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="landgem" />

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
