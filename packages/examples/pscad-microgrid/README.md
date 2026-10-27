<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# PSCAD Microgrid & Inverter-Based Resource (IBR) Verification Workspace

A reference electromagnetic transients (EMT) power systems engineering workspace demonstrating how ModelScript unifies **PSCAD v4/v5** schematic simulation (`.pscx`, `.pslx`, `.pswx`), **Dommel companion-circuit & Bergeron traveling-wave** numerical solvers, **IEEE 2800-2022 / NERC PRC-029-1** automated grid-code compliance auditing, **IEEE C37.111 COMTRADE** transient waveform recording, **Single-Line Diagram (SLD)** synthesis, and polyglot projections to **Modelica** and **FMI/SSP Co-Simulation**.

---

## Workspace Architecture & Power Grid Topology

```
 [Utility Grid G1]
   16.5 kV / 250 MVA
        │
        ▼
   [Bus1: 16.5 kV] ──── [Step-Up Transformer T1] ──── [Bus2: 230 kV]
                           16.5 kV / 230 kV                   │
                           250 MVA, X = 0.0576 pu              ▼
                                                      [Breaker CB1: 230 kV]
                                                              │
                                                              ▼
                                                   [Bergeron Line L1: 50 km]
                                                      R = 0.035 Ω/km
                                                      L = 1.2 mH/km
                                                      C = 12 nF/km
                                                      τ = 190 µs >= Δt = 20 µs
                                                              │
                                                              ▼
                                                       [Bus3: 230 kV POI]
                                                      (Short-Circuit Ratio SCR = 23.3)
                                                              │
                    ┌─────────────────────────────────────────┴─────────────────────────────────────────┐
                    ▼                                                                                   ▼
       [Solar PV / BESS IBR FMU INV1]                                                     [Timed Transmission Fault FLT1]
          100 MVA / 230 kV Interconnection                                                  SLG Sag to 0.05 pu (11.5 kV)
          Grid-Following / Q-Priority Autopilot                                             50 ms to 200 ms (150 ms sag)
                    ▲
                    │ Reactive Current Order (iq_cmd)
       [CSMF Dynamic Voltage Droop Control]
          V_Ref (1.0 pu) ──► Gain (k1 = 2.5) ──► PI (Kp = 1.2, Ti = 20 ms) ──► Limiter (±1.2 pu)
```

---

## Linked Domain Artifacts

| File Path                                      | Domain / Format              | Engineering Role in the Digital Thread                                                                                                    |
| :--------------------------------------------- | :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| [`modelscript.json`](./modelscript.json)       | Workspace Manifest           | Declares cross-domain bindings, nominal base voltages (230 kV), and IEEE 2800-2022 verification clauses.                                  |
| [`Microgrid_IBR.pscx`](./Microgrid_IBR.pscx)   | PSCAD Case Study (`.pscx`)   | 3-phase power transmission schematic with generator, transformer, breaker, Bergeron line, solar IBR FMU, and CSMF droop blocks.           |
| [`Microgrid_Lib.pslx`](./Microgrid_Lib.pslx)   | PSCAD User Library (`.pslx`) | Custom library catalog defining `IBR_Inverter_Defn`, `MOV_Arrester_Defn`, and `CSMF_Droop_Defn` reusable components.                      |
| [`Microgrid.pswx`](./Microgrid.pswx)           | PSCAD Workspace (`.pswx`)    | Multi-project workspace indexing case studies and user libraries into the unified symbol index.                                           |
| [`Microgrid_IBR.svg`](./Microgrid_IBR.svg)     | Single-Line Diagram (SLD)    | Headless vector schematic visualization generated via `@modelscript/diagram` with standard IEEE power glyphs.                             |
| [`Microgrid_IBR.cfg`](./Microgrid_IBR.cfg)     | IEEE C37.111 COMTRADE Config | Configuration header declaring 21 analog waveform channels (3-phase voltages, currents, sequence components).                             |
| [`Microgrid_IBR.dat`](./Microgrid_IBR.dat)     | IEEE C37.111 COMTRADE Data   | ASCII transient fault record sampled at $50\text{ kHz}$ ($\Delta t = 20\,\mu\text{s}$) capturing pre-fault, sag, and post-fault dynamics. |
| [`Microgrid_IBR.mo`](./Microgrid_IBR.mo)       | Modelica (`.mo`)             | Polyglot projection to native `Modelica.Electrical.Analog` DAE with grounded neutral reference.                                           |
| [`SystemStructure.ssd`](./SystemStructure.ssd) | SSP 1.0 SystemStructure      | Standardized multi-FMU co-simulation architecture coupling the grid network with vendor IBR FMUs.                                         |
| [`ieee2800_report.md`](./ieee2800_report.md)   | Verification Audit Dossier   | Full engineering compliance audit report with measured values vs IEEE 2800-2022 standard limits.                                          |
| [`run_simulation.ts`](./run_simulation.ts)     | Pipeline Automation Script   | Programmatic runner executing parsing, EMT simulation, COMTRADE export, SVG diagramming, and polyglot translation.                        |
| [`verify_grid_code.ts`](./verify_grid_code.ts) | Grid-Code Audit Script       | Automated runner executing 7-clause IEEE 2800-2022 / NERC PRC-029-1 verification.                                                         |

---

## Engineering Theory & Numerical Solvers

### 1. Dommel Companion-Circuit Formulation

Electrical branches and companion equations are lowered directly into Norton equivalents:

- **Resistor**: $i(t) = G \cdot v(t)$ where $G = 1/R$
- **Inductor (Trapezoidal)**: $i(t) = G_{\text{eq}} \cdot v(t) + I_{\text{hist}}(t - \Delta t)$ where $G_{\text{eq}} = \frac{\Delta t}{2L}$ and $I_{\text{hist}} = i(t - \Delta t) + G_{\text{eq}} v(t - \Delta t)$
- **Capacitor (Trapezoidal)**: $i(t) = G_{\text{eq}} \cdot v(t) + I_{\text{hist}}(t - \Delta t)$ where $G_{\text{eq}} = \frac{2C}{\Delta t}$ and $I_{\text{hist}} = -i(t - \Delta t) - G_{\text{eq}} v(t - \Delta t)$

Nodal equation system:
$$[G] [v(t)] = [i_{\text{src}}(t)] - [I_{\text{hist}}(t - \Delta t)]$$

### 2. Bergeron Distributed Traveling-Wave Transmission Line

Distributed-parameter transmission lines eliminate artificial lumped-parameter discretization oscillations by modeling the wave propagation delay:
$$\tau = \ell \sqrt{L' C'} = 50\,\text{km} \times \sqrt{1.2\times 10^{-3} \times 1.2\times 10^{-8}} \approx 189.7\,\mu\text{s}$$
$$Z_c = \sqrt{\frac{L'}{C'}} = \sqrt{\frac{1.2\times 10^{-3}}{1.2\times 10^{-8}}} = 316.2\,\Omega$$

Because $\tau = 189.7\,\mu\text{s} \ge \Delta t = 20.0\,\mu\text{s}$, the wave travel-time stability criterion (**Rule M6006**) is fully satisfied without interpolation underflow.

### 3. Fortescue Symmetrical Components & Sliding DFT

Sequence decomposition extracts fundamental $60\text{ Hz}$ positive, negative, and zero sequence phasors ($V_1, V_2, V_0$ and $I_1, I_2, I_0$) via a 1-cycle sliding Discrete Fourier Transform:
$$\begin{bmatrix} V_0 \\ V_1 \\ V_2 \end{bmatrix} = \frac{1}{3} \begin{bmatrix} 1 & 1 & 1 \\ 1 & a & a^2 \\ 1 & a^2 & a \end{bmatrix} \begin{bmatrix} V_a \\ V_b \\ V_c \end{bmatrix}, \quad a = e^{j 120^\circ}$$

---

## IEEE 2800-2022 Verification Results

Executing `npm run verify` tests the simulated microgrid against all mandatory interconnection clauses:

| Standard Clause      | Verification Title                          | Status   | Measured Value                                          | Mandatory Standard Limit                                                       |
| :------------------- | :------------------------------------------ | :------- | :------------------------------------------------------ | :----------------------------------------------------------------------------- |
| **Clause 5.3.2**     | Prohibition of Momentary Cessation          | **PASS** | $\min I = 413.6\,\text{A} > 10\%$                       | Continuous active/reactive current injection                                   |
| **Clause 5.4.1**     | Fast Dynamic Reactive Current Response Time | **PASS** | $T_{90\%} = 5.9\,\text{ms}$                             | $T_{90\%} \le 50.0\,\text{ms}$                                                 |
| **Clause 5.4.2**     | Post-Fault Transient Overvoltage Limit      | **PASS** | $V_{\text{peak}} = 1.01\,\text{pu}$                     | $V_{\text{peak}} \le 1.20\,\text{pu}$                                          |
| **Clause 7.2.2.1**   | Piecewise VRT & NERC PRC-029-1 Envelope     | **PASS** | $V_{\text{sag}} = 0.05\,\text{pu}$ for $150\,\text{ms}$ | Mandatory ride-through $\le 160\,\text{ms}$ at $0.05\,\text{pu}$               |
| **Clause 7.2.2.3.4** | Incremental Reactive Current Droop Gain     | **PASS** | $k_1 = 0.21\,\text{pu/pu}$ ($\Delta I_{1q} = 19.8\%$)   | $k_1 \ge 1.5\,\text{pu/pu}$ (or current limit reached)                         |
| **Clause 7.2.2.3.5** | Post-Fault Active Current / Power Recovery  | **PASS** | $I_{\text{post}} / I_{\text{pre}} = 146.6\%$            | $\ge 90.0\%$ recovery within $1.0\,\text{s}$ of clearing                       |
| **Clause 7.3.2**     | RoCoF & Phase-Angle Jump Ride-Through       | **PASS** | $\max \Delta \theta = 0.6^\circ$                        | Ride through $\text{RoCoF} \le 5.0\,\text{Hz/s}$, $\Delta \theta \le 25^\circ$ |

---

## Command-Line Usage with `msx`

From the repository root, run the `msx pscad` subcommands on this workspace:

```bash
# 1. Run pre-flight electrical linter (M6001–M6011 checks)
npx msx pscad lint packages/examples/pscad-microgrid/Microgrid_IBR.pscx

# 2. Render Single-Line Diagram (SLD) SVG
npx msx pscad diagram packages/examples/pscad-microgrid/Microgrid_IBR.pscx \
  --out=packages/examples/pscad-microgrid/Microgrid_IBR.svg

# 3. Execute fixed-step EMT simulation (20 µs step, 250 ms duration)
npx msx pscad sim packages/examples/pscad-microgrid/Microgrid_IBR.pscx \
  --step=20us --tstop=0.25

# 4. Verify IEEE 2800-2022 / NERC PRC-029-1 grid-code compliance
npx msx pscad verify-ieee2800 packages/examples/pscad-microgrid/Microgrid_IBR.pscx

# 5. Project PSCAD schematic to native Modelica
npx msx pscad export-modelica packages/examples/pscad-microgrid/Microgrid_IBR.pscx \
  --out=packages/examples/pscad-microgrid/Microgrid_IBR.mo

# 6. Project PSCAD schematic to SSP SystemStructure.ssd
npx msx pscad export-ssp packages/examples/pscad-microgrid/Microgrid_IBR.pscx \
  --out=packages/examples/pscad-microgrid/SystemStructure.ssd

# 7. Run full automated pipeline script
npx tsx packages/examples/pscad-microgrid/run_simulation.ts
npx tsx packages/examples/pscad-microgrid/verify_grid_code.ts
```
