---
title: "OpenADR Demand Response & FlexAlert (.oadr, .xml, .json)"
description: "@modelscript/openadr (languages/openadr) provides native parsing, event signal evaluation, curtailment shed calculation, and DAE lowering for OpenADR 2.0b XML and 3.0 JSON automated demand response programs."
---

# OpenADR Demand Response & FlexAlert (`.oadr`, `.xml`, `.json`)

`@modelscript/openadr` (`languages/openadr`) provides native parsing, time-series signal evaluation, Virtual End Node (VEN) curtailment shed calculation, and DAE lowering for **OpenADR (2.0b XML & 3.0 JSON)** automated demand response and dynamic flexibility tariffs.

---

## Supported Extensions & Standards

| Extension | Format                             | Description                                                                  |
| :-------- | :--------------------------------- | :--------------------------------------------------------------------------- |
| `.oadr`   | OpenADR Unified Payload            | Demand response program declarations, event intervals, and signal limits     |
| `.xml`    | OpenADR 2.0b `oadrDistributeEvent` | Standard XML schema for utility-to-facility event distribution               |
| `.json`   | OpenADR 3.0 REST/JSON              | Lightweight JSON schema for cloud DR orchestrators and microgrid aggregators |

---

## Key Capabilities

### 1. Dual 2.0b XML & 3.0 JSON Program Ingestion

- Ingests demand response program metadata: event windows, start times, notification lead times, and priority tiers.
- Parses multiple signal types:
  - `level`: Discrete curtailment levels (0: Normal, 1: Moderate, 2: High, 3: Critical)
  - `price`: Real-time locational marginal pricing ($/kWh)
  - `setpoint`: Absolute power limit target (kW)
  - `delta`: Relative power reduction request ($\Delta$ kW)
  - `multiplier`: Percentage multiplier on baseline load

### 2. VEN Curtailment Schedule Evaluation

- Evaluates facility response across non-overlapping and overlapping event windows.
- Resolves conflicting multi-event signals using standard OpenADR priority rules (`priority` field and latest issuance timestamps).
- Projects active power thresholds $P_{\text{limit}}(t)$ for coupling with HVAC thermal zones (`@modelscript/energyplus`), industrial pumps (`@modelscript/epanet`), and EV chargers (`@modelscript/ocpp`).

### 3. DAE Formulation for Microgrid Peak Shaving

- Couples curtailment targets into `@modelscript/runtime`'s `DAEBuilder`, bounding facility demand to the active OpenADR limit (with soft-slack $\varepsilon_{\text{shed}}$) and integrating total energy curtailed over the event window:
  $$P_{\text{facility}}(t) \le P_{\text{limit}}(t) + \varepsilon_{\text{shed}}$$
  $$E_{\text{shed}} = \int_{t_{\text{start}}}^{t_{\text{end}}} \max(0, P_{\text{baseline}}(t) - P_{\text{facility}}(t)) \, dt$$

  | Symbol                                | Meaning                                                | Units / Domain                                  |
  | :------------------------------------ | :----------------------------------------------------- | :---------------------------------------------- |
  | $P_{\text{facility}}(t)$              | Actual facility electrical power demand at time $t$    | $\text{kW}$                                     |
  | $P_{\text{limit}}(t)$                 | Active OpenADR curtailment power threshold             | $\text{kW}$                                     |
  | $\varepsilon_{\text{shed}}$           | Non-negative soft-slack violation variable             | $\text{kW}$ ($\varepsilon_{\text{shed}} \ge 0$) |
  | $E_{\text{shed}}$                     | Total energy curtailed below baseline during the event | $\text{kWh}$                                    |
  | $t_{\text{start}}, t_{\text{end}}, t$ | Event start time, end time, and integration time       | $\text{h}$                                      |
  | $P_{\text{baseline}}(t)$              | Counterfactual baseline facility load without DR event | $\text{kW}$                                     |

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="openadr" />

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="openadr" />

---

## CLI Usage

```bash
# Validate OpenADR event timings and signal declarations
msx openadr lint PeakShedEvent.oadr

# Evaluate time-series curtailment limits for a designated facility (VEN)
msx openadr curtail PeakShedEvent.oadr --ven=FACILITY-WATER-TREATMENT

# Lower demand response constraints into ModelScript DAE arena
msx openadr to-dae PeakShedEvent.oadr --out=dr_event.dae
```
