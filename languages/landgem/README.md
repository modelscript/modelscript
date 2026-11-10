<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/landgem`

US EPA Landfill Gas Emissions Model (LandGEM v3.02), IPCC Tier 2 first-order decay methane generation kinetics, and anaerobic digestion (ADM1) biogas / RNG recovery package for ModelScript.

## Features

- **Multi-Decay Kinetics:** Models first-order organic decomposition:
  $$Q_{\text{CH}_4} = \sum_{i=1}^{n} 2 k L_0 M_i e^{-k t_i}$$
  with support for EPA Clean Air Act (CAA) defaults, AP-42 conventional/arid regions, and site-specific inventories.
- **Anaerobic Digester (ADM1) CSTR:** Simulates continuous stirred-tank digester biochemical kinetics (acidogenesis, acetogenesis, methanogenesis) with hydraulic retention time (HRT), volatile solids destruction, and methane composition.
- **RNG Pipeline & CHP Generation:** Computes renewable natural gas (RNG) pipeline injection heating value ($MJ/\text{m}^3$) and combined heat & power (CHP) electrical/thermal ratings ($kW_{\text{e}}, kW_{\text{th}}$).
- **Direct DAE Lowering:** Compiles methane generation curves and digester state equations into `@modelscript/runtime`'s linear memory `DAEBuilder` arena.
- **Pre-flight Linting:** Validates strictly positive kinetic rate constants ($k > 0$), positive generation potentials ($L_0 > 0$), chronology of waste acceptance years, and digester $pH$ methanogen inhibition bounds ($6.0 \le pH \le 8.5$).

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.landgem`, `.lfg` | EPA LandGEM Model Deck | Landfill site metadata, kinetic rates ($k, L_0$), and historical waste acceptance cohorts |
| `.biogas` | Biogas / ADM1 Digester Deck | Biochemical digester parameters, feed COD, HRT, and CHP engine specifications |

## Quick Example

```landgem
SITE "PineCreekLandfill"
  OPEN 2010
  CLOSE 2035
  L0 100.0  # m^3/Mg
  K 0.04    # 1/yr (AP-42 conventional)
  NMOC 600  # ppmv
  METHANE_PERCENT 50.0

WASTE_ACCEPTANCE
  2010 150000
  2011 160000
  2012 175000
  2013 180000

DIGESTER "FarmAnaerobicDigester"
  VOLUME 3500.0 # m^3
  TEMPERATURE 37.0 # degC
  HRT 21.0 # days
  FEED_COD 50.0 # g/L
  PH 7.3
```
