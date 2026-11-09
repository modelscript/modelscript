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
- Bicubic 3D gain envelope interpolation with electrical and mechanical downtilt:
  $$G(\theta, \phi) = G_{\text{peak}} - \min\left(-(A_H(\phi) + A_V(\theta - \theta_{\text{tilt}})), A_m\right)$$

### 2. Microwave Link Budget & ITU-R P.530 Rain Fade

- Computes Free Space Path Loss (FSPL) and atmospheric absorption:
  $$\text{FSPL}(\text{dB}) = 20 \log_{10}(d) + 20 \log_{10}(f) + 92.45$$
- Solves ITU-R P.530-18 rain attenuation for $0.01\%$ of time ($A_{0.01} = \gamma_R \cdot d_{\text{eff}}$) and annual link availability percent (verifying "five-nines" $99.999\%$ uptime).

### 3. Fresnel Zone Clearance & Earth Curvature

- Computes 1st Fresnel zone radius along the propagation path:
  $$F_1 = 17.32 \sqrt{\frac{d_1 d_2}{f \cdot D}}$$
- Evaluates Earth curvature bulge ($h_{\text{bulge}} = \frac{d_1 d_2}{12.74 k}$) using effective Earth radius factor $k = 4/3$.
- Identifies terrain and obstacle obstructions where clearance ratio falls below the $0.60 F_1$ threshold.

### 4. Regulatory Pre-Flight Linters

- Lints wireless link designs against **FCC Part 101** equivalent isotropically radiated power ceilings ($\text{EIRP} \le 55\text{ dBm}$).
- Detects abnormal downtilts and antenna gain mismatches.
