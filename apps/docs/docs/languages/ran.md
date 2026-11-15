---
title: "RAN & Microwave Propagation (.adf, .pat, ITU-R P.530)"
description: "@modelscript/ran (languages/ran) provides NSMA WG16 antenna pattern codecs, 3D radiation gain interpolators, ITU-R P.530 rain fade models, and Fresnel clearance verification."
---

# RAN & Microwave Propagation (`.adf`, `.pat`, ITU-R P.530)

`@modelscript/ran` (`languages/ran`) provides antenna pattern ingestion, 3D envelope synthesis, and microwave link propagation modeling for **cellular Radio Access Networks (4G/5G), fixed wireless access (FWA), and utility microwave backhaul**.

---

## Supported Standards & Formats

| Format / Standard       | File Extensions | Description                                                                                              |
| :---------------------- | :-------------- | :------------------------------------------------------------------------------------------------------- |
| **NSMA WG16.99.050**    | `.adf`, `.nsma` | National Spectrum Management Association standardized antenna radiation patterns (azimuth and elevation) |
| **Planet / TIA-329**    | `.pat`, `.msi`  | Industry-standard Planet and TIA-329 antenna pattern decks                                               |
| **ITU-R P.530-18**      | Specification   | International Telecommunication Union rain fade attenuation and availability prediction                  |
| **ITU-R P.838 / P.837** | Specification   | Specific rain attenuation coefficients ($\gamma = k R^\alpha$) and digital rain maps                     |

---

## Key Capabilities

### 1. 2D/3D Antenna Radiation Pattern Interpolation

- Parses dual-polarized horizontal and vertical antenna gain cuts across $360^\circ$ azimuth and $\pm 90^\circ$ elevation.
- Computes half-power beamwidth (HPBW, 3 dB) and front-to-back (F/B) ratios.
- Bicubic 3D gain envelope interpolation combines horizontal and tilted vertical pattern cuts, capped by the front-to-back attenuation floor:
  $$G(\theta, \phi) = G_{\text{peak}} - \min\left(-(A_H(\phi) + A_V(\theta - \theta_{\text{tilt}})), A_m\right)$$

  | Symbol                               | Meaning                                                                         | Units / Domain       |
  | :----------------------------------- | :------------------------------------------------------------------------------ | :------------------- |
  | $G(\theta, \phi)$                    | 3D directional antenna gain at elevation $\theta$ and azimuth $\phi$            | $\text{dBi}$         |
  | $G_{\text{peak}}$                    | Maximum boresight antenna gain                                                  | $\text{dBi}$         |
  | $A_H(\phi)$                          | Horizontal (azimuth) relative attenuation pattern                               | $\text{dB}$, $\le 0$ |
  | $A_V(\theta - \theta_{\text{tilt}})$ | Vertical (elevation) relative attenuation shifted by downtilt                   | $\text{dB}$, $\le 0$ |
  | $\theta, \phi$                       | Elevation ($[-90^\circ, 90^\circ]$) and azimuth ($[0^\circ, 360^\circ)$) angles | $^\circ$             |
  | $\theta_{\text{tilt}}$               | Combined electrical and mechanical downtilt angle                               | $^\circ$             |
  | $A_m$                                | Maximum front-to-back attenuation cap                                           | $\text{dB}$, $> 0$   |

### 2. Microwave Link Budget & ITU-R P.530 Rain Fade

- Computes Free Space Path Loss (FSPL) over an unobstructed line-of-sight path and atmospheric absorption:
  $$\text{FSPL}(\text{dB}) = 20 \log_{10}(d) + 20 \log_{10}(f) + 92.45$$
  where $\text{FSPL}$ is the free-space path loss ($\text{dB}$), $d$ is the link distance ($\text{km}$, $> 0$), and $f$ is the carrier frequency ($\text{GHz}$, $> 0$).
- Solves ITU-R P.530-18 rain attenuation for $0.01\%$ of time ($A_{0.01} = \gamma_R \cdot d_{\text{eff}}$) and annual link availability percent (verifying "five-nines" $99.999\%$ uptime).

### 3. Fresnel Zone Clearance & Earth Curvature

- Computes the 1st Fresnel zone radius enclosing the primary radio-frequency energy ellipsoid along the propagation path:
  $$F_1 = 17.32 \sqrt{\frac{d_1 d_2}{f \cdot D}}$$

  | Symbol     | Meaning                                           | Units / Domain      |
  | :--------- | :------------------------------------------------ | :------------------ |
  | $F_1$      | First Fresnel zone radius at the obstacle         | $\text{m}$, $> 0$   |
  | $d_1, d_2$ | Distances from the obstacle to each link endpoint | $\text{km}$, $> 0$  |
  | $D$        | Total link path length ($D = d_1 + d_2$)          | $\text{km}$, $> 0$  |
  | $f$        | Carrier frequency                                 | $\text{GHz}$, $> 0$ |

- Evaluates Earth curvature bulge ($h_{\text{bulge}} = \frac{d_1 d_2}{12.74 k}$) using effective Earth radius factor $k = 4/3$.
- Identifies terrain and obstacle obstructions where clearance ratio falls below the $0.60 F_1$ threshold.

### 4. FCC OET Bulletin 65 & ICNIRP 2020 RF Radiation Safety (MPE)

- Computes near-field and far-field power density ($S = \frac{\text{EIRP}}{4\pi R^2}$ with ground reflection) across multi-operator colocation sites.
- Evaluates occupational/controlled and general-public/uncontrolled Maximum Permissible Exposure (MPE) horizontal and vertical exclusion boundaries.

### 5. FAA 14 CFR Part 77, ICAO Annex 14 & Transport Canada Airspace Obstruction

- Evaluates proposed cellular and microwave towers against FAA Part 77 imaginary surfaces (primary, approach, transitional, horizontal, conical), 200-ft AGL notice criteria, ICAO Annex 14 Obstacle Limitation Surfaces (OLS), and Transport Canada TP 312 / CAR 601.

---

## Regulatory Pre-Flight Lint Rules

<LintRules lang="ran" />

---

## CLI Usage (`msx ran`)

```bash
# Solve line-of-sight microwave link budget and ITU-R P.530 rain fade availability
msx ran microwave --freq=11.0 --dist=15.0 --tx-power=20.0 --tx-gain=38.0

# Generate FCC Part 101 Prior Coordination Notice (PCN) microwave engineering exhibit
msx ran pcn --freq=11.0 --dist=15.0

# Evaluate FCC OET-65 / ICNIRP 2020 RF Maximum Permissible Exposure (MPE) safety zones
msx ran mpe --freq=3700 --power-watts=40 --tx-gain=24.0

# Evaluate FAA 14 CFR Part 77 airspace obstruction and Form 7460-1 notice criteria
msx ran faa --dist=15.0

# Inspect NSMA WG16 (.adf) or Planet (.pat) antenna radiation pattern files
msx ran antenna sector_65deg.adf

# Evaluate 1st Fresnel zone clearance and Earth curvature bulge
msx ran fresnel --freq=11.0 --dist=15.0
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="ran" />
