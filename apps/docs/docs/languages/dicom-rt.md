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

- Evaluates $D_{98\%}$, $D_{95\%}$, $D_{50\%}$, $D_{2\%}$, $D_{\text{mean}}$, and $V_{x\text{Gy}}$ across Target and OAR structures:
  $$\text{HI}_{\text{ICRU 83}} = \frac{D_{2\%} - D_{98\%}}{D_{50\%}}, \qquad \text{CI}_{\text{Paddick}} = \frac{(TV_{\text{PIV}})^2}{TV \times PIV}$$

### 2. Linear-Quadratic Biological Dose ($\text{BED}$ & $\text{EQD2}$)

- Computes Biologically Effective Dose and Equivalent Dose in $2\text{ Gy}$ fractions for tumor targets ($\alpha/\beta \approx 10\text{ Gy}$) and late-responding normal tissues ($\alpha/\beta \approx 2\text{–}3\text{ Gy}$):
  $$\text{BED} = n d \left(1 + \frac{d}{\alpha/\beta}\right), \qquad \text{EQD2} = \frac{\text{BED}}{1 + \frac{2}{\alpha/\beta}}$$

### 3. QUANTEC Safety Verification & OpenSCAD / SysML v2 Projections

- Checks spinal cord, brainstem, optic chiasm, parotid, lung, heart, rectum, and bladder doses against clinical **QUANTEC** limits, verifies MLC leaf bank non-interdigitation/overtravel, and projects beam apertures to **OpenSCAD** (`dicomRtToScad`) and **SysML v2** (`dicomRtToSysML2`).

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

# Project treatment beams and ROI contours to OpenSCAD or SysML v2
msx dicom-rt to-scad ProstateVMAT.rtplan > ProstateVMAT.scad
msx dicom-rt to-sysml ProstateVMAT.rtplan > ProstateVMAT.sysml
```
