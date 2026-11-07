---
title: DICOM-RT Radiation Oncology & Clinical Dosimetry (.rtplan, .rtstruct, .rtdose)
description: Native WebAssembly parsing, QUANTEC Organ-at-Risk (OAR) dose constraint and MLC leaf/gantry kinematics verification, cumulative DVH integration, Linear-Quadratic BED / EQD2 biological dose calculation, DAEBuilder lowering, and OpenSCAD / SysML v2 projections.
---

# DICOM-RT Radiation Oncology & Clinical Dosimetry (`.rtplan`, `.rtstruct`, `.rtdose`)

`@modelscript/dicom-rt` (`languages/dicom-rt`) provides native WebAssembly parsing, **QUANTEC Organ-at-Risk (OAR)** dose constraint and Multi-Leaf Collimator (MLC) leaf/gantry kinematics verification, cumulative and differential **Dose-Volume Histogram (DVH)** integration, Linear-Quadratic **BED / EQD2** biological dose calculation, `DAEBuilder` lowering, and OpenSCAD / SysML v2 projections for **DICOM Radiotherapy (`RTPLAN`, `RTSTRUCT`, `RTDOSE`)** treatment plans.

---

## Supported Extensions & Standards

| Extension   | Format                 | Description                                                                                                                 |
| :---------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `.rtplan`   | DICOM RT Plan          | External-beam photon/electron/proton beam geometry, gantry/couch/collimator angles, MLC control points, and fraction groups |
| `.rtstruct` | DICOM RT Structure Set | 3D anatomical contours for Planning Target Volumes (`PTV`, `CTV`, `GTV`) and Organs at Risk (`OAR`)                         |
| `.rtdose`   | DICOM RT Dose          | 3D dose grid arrays and cumulative/differential Dose-Volume Histogram (`DVH`) curves                                        |

---

## Key Capabilities

### 1. Cumulative DVH, ICRU 83 Homogeneity & Paddick Conformity

`@modelscript/dicom-rt` integrates differential and cumulative Dose-Volume Histograms $V(D)$ across every Planning Target Volume (`PTV`) and Organ at Risk (`OAR`) to extract near-minimum dose $D_{98\%}$, prescription coverage $D_{95\%}$, median dose $D_{50\%}$, near-maximum hot-spot dose $D_{2\%}$, mean dose $D_{\text{mean}}$, and volume-at-dose $V_{x\text{Gy}}$:

$$\text{HI}_{\text{ICRU 83}} = \frac{D_{2\%} - D_{98\%}}{D_{50\%}}, \qquad \text{CI}_{\text{RTOG}} = \frac{PIV}{TV}, \qquad \text{CI}_{\text{Paddick}} = \frac{(TV_{\text{PIV}})^2}{TV \times PIV}$$

where $TV$ is the target volume, $PIV$ is the prescription isodose volume, and $TV_{\text{PIV}}$ is the target volume covered by the prescription isodose.

### 2. Linear-Quadratic Biological Dose ($\text{BED}$ & $\text{EQD2}$)

For a fractionation schedule of $n$ fractions at dose $d = D_{\text{total}}/n$ per fraction, `@modelscript/dicom-rt` evaluates the Linear-Quadratic (LQ) **Biologically Effective Dose ($\text{BED}$)** and **Equivalent Dose in $2\text{ Gy}$ Fractions ($\text{EQD2}$)**:

$$\text{BED} = n d \left(1 + \frac{d}{\alpha/\beta}\right), \qquad \text{EQD2} = \frac{\text{BED}}{1 + \frac{2}{\alpha/\beta}} = n d \left(\frac{d + \alpha/\beta}{2 + \alpha/\beta}\right)$$

using tissue-specific radiosensitivity ratios ($\alpha/\beta \approx 10\text{ Gy}$ for early-responding tumor targets, $\alpha/\beta \approx 2\text{ Gy}$ for late-responding CNS/spinal cord/optic pathways, and $\alpha/\beta \approx 3\text{ Gy}$ for lung, heart, rectum, and bladder).

### 3. QUANTEC Clinical OAR Constraints & MLC Delivery Kinematics

| Organ at Risk (`OAR`) | QUANTEC Metric                        | Clinical Threshold              | Endpoint Guarded                      |
| :-------------------- | :------------------------------------ | :------------------------------ | :------------------------------------ |
| Spinal Cord           | $D_{\max}$ ($D_{0.03\text{cc}}$)      | $\le 50\text{ Gy}$              | Radiation myelopathy ($< 0.2\%$ risk) |
| Brainstem             | $D_{\max}$                            | $\le 54\text{ Gy}$              | Cranial neuropathy / necrosis         |
| Optic Chiasm / Nerves | $D_{\max}$                            | $\le 55\text{ Gy}$              | Radiation-induced optic neuropathy    |
| Parotid Glands        | $D_{\text{mean}}$                     | $\le 25\text{ Gy}$              | Severe long-term xerostomia           |
| Bilateral Lungs       | $V_{20\text{Gy}}$ / $D_{\text{mean}}$ | $\le 30\%$ / $\le 20\text{ Gy}$ | Symptomatic radiation pneumonitis     |
| Heart / Pericardium   | $D_{\text{mean}}$                     | $\le 26\text{ Gy}$              | Pericarditis & late cardiac toxicity  |

Alongside dosimetric checks, `@modelscript/dicom-rt` audits Multi-Leaf Collimator (`MLCX`/`MLCY`) control points for leaf bank collisions ($x_{\text{B},i} - x_{\text{A},i} \ge \Delta_{\min}$), carriage overtravel, monotonic cumulative meterset weights ($w_0 = 0 \le w_k \le w_N = 1$), and non-coplanar gantry-couch collision clearance.

### 4. OpenSCAD, SysML v2 & DAE Projections

- Projects beam apertures and ROI structures into **OpenSCAD** 3D collimator blocks (`dicomRtToScad`), **OMG SysML v2** clinical safety requirement verification packages (`dicomRtToSysML2`), and `@modelscript/runtime`'s `DAEBuilder` arena (`lowerDicomRtToDae`).

---

## Pre-Flight Diagnostics

<LintRules lang="dicom-rt" />

---

## CLI Usage

```bash
# Inspect RTPLAN prescription, fractions, anatomical structures, and beams
msx dicom-rt inspect ProstateVMAT.rtplan

# Validate QUANTEC OAR dose limits, MLC leaf gaps, and gantry clearance
msx dicom-rt validate ProstateVMAT.rtplan

# Compute DVH metrics (D95, D2, HI, CI) and Linear-Quadratic BED / EQD2
msx dicom-rt dosimetry ProstateVMAT.rtplan

# Project treatment beams and ROI contours to OpenSCAD, SysML v2, or DAE arena
msx dicom-rt to-scad ProstateVMAT.rtplan > ProstateVMAT.scad
msx dicom-rt to-sysml ProstateVMAT.rtplan > ProstateVMAT.sysml
msx dicom-rt to-dae ProstateVMAT.rtplan
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseDicomRtModel,
  evaluateClinicalDosimetry,
  lowerDicomRtToDae,
  dicomRtToScad,
  dicomRtToSysML2,
} from "@modelscript/dicom-rt";
import { DAEBuilder } from "@modelscript/runtime";

const plan = parseDicomRtModel(rtplanSource);
const dosimetry = evaluateClinicalDosimetry(plan);

const builder = new DAEBuilder();
lowerDicomRtToDae(plan, builder);
const scadCode = dicomRtToScad(plan);
const sysmlPkg = dicomRtToSysML2(plan);
```
