---
title: "Optical Transmission & OTDR Codecs (.sor, OpenROADM)"
description: "@modelscript/optical (languages/optical) provides Telcordia GR-196 OTDR binary codecs, OpenROADM multi-degree topology parsing, Generalized Gaussian Noise (EGN) transmission solvers, and dynamic EDFA gain saturation DAE lowering."
---

# Optical Transmission & OTDR Codecs (`.sor`, OpenROADM)

`@modelscript/optical` (`languages/optical`) provides binary codecs, physical layer solvers, and linear-memory DAE lowerings for **telecommunications optical transport networks, DWDM long-haul systems, and outside plant fiber diagnostics**.

---

## Supported Standards & Formats

| Format / Standard             | File Extensions  | Description                                                                                   |
| :---------------------------- | :--------------- | :-------------------------------------------------------------------------------------------- |
| **Telcordia / Bellcore OTDR** | `.sor`           | Telcordia GR-196-CORE & SR-4731 standard binary OTDR backscatter traces and key event tables  |
| **OpenROADM MSA**             | `.json`, `.yang` | OpenROADM Multi-Source Agreement (v7.1 / v13.1) ROADM nodes, CDC SRGs, degrees, and spans     |
| **TIP GNPy**                  | `.json`          | Telecom Infra Project Open Optical & Packet Transport (OOPT) network and equipment topologies |

---

## Key Capabilities

### 1. Telcordia `.sor` Binary Codec & Metrics

- Fast zero-allocation binary parser and serializer for GR-196 / SR-4731 formats.
- Extracts `GenParams`, `SupParams`, `FxdParams`, `DataPts`, and `KeyEvents`.
- Computes fiber span metrics:
  - 2-point attenuation loss
  - Least-Squares Approximation (LSA) attenuation slope ($\text{dB/km}$)
  - Event loss ($\text{dB}$) and Fresnel reflectance ($\text{dB}$)
  - Optical Return Loss (ORL)

### 2. Generalized Gaussian Noise (EGN) Transmission Solver

- Evaluates non-linear interference (NLI) power spectral density across multi-span optical routes:
  $$G_{\text{nli}} = \frac{16}{27} \gamma^2 L_{\text{eff}} \frac{\text{asinh}\left(\frac{\pi^2}{2} |\beta_2| L_{\text{eff}} B_{\text{ch}}^2 N_{\text{ch}}^{2 \frac{B_{\text{ch}}}{\Delta f}}\right)}{\pi |\beta_2| B_{\text{ch}}}$$
- Solves Generalized Signal-to-Noise Ratio (GSNR) accounting for ASE noise and Kerr non-linearity:
  $$\text{GSNR}^{-1} = \text{OSNR}_{\text{ase}}^{-1} + \text{SNR}_{\text{nli}}^{-1}$$
- Computes accumulated chromatic dispersion ($\text{ps/nm}$), polarization mode dispersion (PMD), bit error rate (BER), and $Q$-factor.

### 3. Dynamic EDFA Gain Saturation DAE Lowering

- Lowers dynamic Erbium-Doped Fiber Amplifier (EDFA) gain saturation state equations directly to `@modelscript/runtime`'s `DAEBuilder`:
  $$\frac{dG}{dt} = \frac{G_0 - G}{\tau} - \frac{P_{\text{in}}}{P_{\text{sat}} \tau} G (G - 1)$$
  $$P_{\text{out}} = G \cdot P_{\text{in}}$$
- Allows continuous transient simulation of amplifier channel add/drop dynamics without wrapper AST overhead.

### 4. Precision Time Protocol (IEEE 1588 / SyncE) & Holdover

- Evaluates ITU-T G.8275.1 time error budgets ($cTE \le 5\text{ ns}$ per hop, $dTE$, MTIE, and TDEV).
- Validates 3GPP 5G TDD base station synchronization ($\pm 1.5\ \mu\text{s}$) and intra-cluster CoMP alignment ($\le 130\text{ ns}$).
- Models local oscillator phase drift during GNSS outages (OCXO, DOCXO, Rubidium, CSAC).

---

## Pre-Flight Optical Transport Lint Rules

<LintRules lang="optical" />

---

## CLI Usage (`msx optical`)

```bash
# Inspect Telcordia .sor OTDR trace events or OpenROADM network topology
msx optical inspect trace.sor
msx optical otdr trace.sor

# Solve multi-span DWDM GSNR, OSNR, and Shannon capacity
msx optical gsnr --distance=320 --span-len=80 --baud=64 --power=0.0 --edfa-nf=5.5

# Run static pre-flight optical transport lint rules
msx optical lint network.json

# Lower dynamic EDFA gain saturation ODEs to the linear-memory DAE arena
msx optical to-dae network.json --out=optical.dae
```

