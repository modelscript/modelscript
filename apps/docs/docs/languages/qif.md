---
title: "ISO 23952 QIF Digital Metrology & GD&T (.qif, .xml)"
description: "@modelscript/qif (languages/qif) provides native WebAssembly parsing, ASME Y14.5 / ISO 1101 Geometric Dimensioning and Tolerancing (GD&T) validation, Statistical Process Control (SPC) capability ev..."
---

# ISO 23952 QIF Digital Metrology & GD&T (`.qif`, `.xml`)

`@modelscript/qif` (`languages/qif`) provides native WebAssembly parsing, ASME Y14.5 / ISO 1101 Geometric Dimensioning and Tolerancing (GD&T) validation, Statistical Process Control (SPC) capability evaluation ($C_p$, $C_{pk}$, Test Uncertainty Ratio $\text{TUR}$), STEP AP242 PMI reconciliation, and `DAEBuilder` / Modelica / SysML v2 lowering for **ISO 23952 Quality Information Framework (QIF 3.0)** metrology documents.

---

## Supported Extensions & Standards

| Extension | Format            | Description                                                                                                                     |
| :-------- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `.qif`    | ISO 23952 QIF 3.0 | XML document encoding QIF MBD features, datum reference frames, GD&T characteristics, measurement plans, and CMM actual results |
| `.xml`    | QIF XML           | Standard QIF XML schema document with persistent QPID UUIDs                                                                     |

---

## Key Capabilities

### 1. MBD Features, Datums & GD&T Characteristics

- Parses QIF Model-Based Definition (`QIFDocument`) sections:
  - **Datum Definitions & Reference Frames (`DatumDefinitions`, `DatumReferenceFrames`)**: Primary, secondary, and tertiary datum precedence with material condition modifiers (`MMC`, `LMC`, `RFS`).
  - **Features (`FeatureDefinitions`, `FeatureItems`)**: Cylindrical, planar, spherical, and point geometric features with nominal locations and normals.
  - **Characteristics (`CharacteristicDefinitions`, `CharacteristicItems`)**: Dimensional tolerances, flatness, cylindricity, perpendicularity, true position, and surface profile tolerances.

### 2. Statistical Process Control (SPC) & Test Uncertainty Ratio (TUR)

- Evaluates measured Coordinate Measuring Machine (CMM) actuals (`MeasurementsResults`) against nominal tolerances:
  $$C_p = \frac{\text{USL} - \text{LSL}}{6\sigma}, \qquad C_{pk} = \min\left(\frac{\text{USL} - \mu}{3\sigma}, \frac{\mu - \text{LSL}}{3\sigma}\right), \qquad \text{TUR} = \frac{\text{Tolerance}}{2 U_{\text{cal}}}$$
- Flags processes with $C_{pk} < 1.33$ or measurement devices violating the $4:1$ $\text{TUR}$ metrology rule.

### 3. STEP AP242 Reconciliation & DAE Lowering

- Reconciles QIF inspection characteristics directly against ISO 10303-21 STEP AP242 CAD geometry (`reconcileStepWithQif`) or synthesizes baseline QIF inspection plans from STEP PMI (`synthesizeQifFromStep`).
- Lowers tolerance stack-ups and CMM measurement equations into `@modelscript/runtime`'s `DAEBuilder` arena and projects them into Modelica and SysML v2 verification models.

---

## Pre-Flight Diagnostics

<LintRules lang="qif" />

---

## CLI Usage

```bash
# Inspect QIF datums, features, GD&T characteristics, and CMM actuals
msx qif inspect TurbineBladeInspection.qif

# Validate ASME Y14.5 GD&T datum frames, QPIDs, and TUR ratios
msx qif validate TurbineBladeInspection.qif

# Compute Statistical Process Control (Cp, Cpk, pass/fail) metrics
msx qif spc TurbineBladeInspection.qif

# Reconcile QIF inspection characteristics against a STEP AP242 CAD assembly
msx qif reconcile-step TurbineBladeInspection.qif --step=TurbineBlade.step

# Project QIF tolerances to SysML v2 or Modelica
msx qif to-sysml TurbineBladeInspection.qif -o BladeMetrology.sysml
msx qif to-modelica TurbineBladeInspection.qif -o BladeMetrology.mo
```
