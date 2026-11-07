---
title: OpenIGTLink & PLUS Surgical Navigation (.igtl, .plus.xml)
description: Native WebAssembly parsing, SE(3) homogeneous transform orthogonality and frame graph connectivity verification, stylus pivot calibration, Fitzpatrick Target Registration Error (TRE) estimation, DAEBuilder lowering, and ROS 2 URDF / Modelica projections.
---

# OpenIGTLink & PLUS Surgical Navigation (`.igtl`, `.plus.xml`)

`@modelscript/igtl` (`languages/igtl`) provides native WebAssembly parsing, $SE(3)$ homogeneous transform orthogonality ($\mathbf{R}^\top\mathbf{R} = \mathbf{I}$, $\det\mathbf{R} = +1$) and coordinate-frame graph connectivity verification, **stylus pivot calibration**, **Fitzpatrick (1998) Target Registration Error ($\text{TRE}$)** estimation, `DAEBuilder` lowering, and ROS 2 URDF / Modelica projections for **OpenIGTLink** and **PLUS Toolkit** image-guided surgical navigation systems.

---

## Supported Extensions & Standards

| Extension           | Format              | Description                                                                                                                                                                             |
| :------------------ | :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.plus.xml`, `.xml` | PLUS Toolkit Config | `PlusConfiguration` XML defining optical/EM trackers (`DataCollection`), `<CoordinateDefinitions>` $SE(3)$ transforms, pivot/phantom calibration, and `<PlusOpenIGTLinkServer>` streams |
| `.igtl`             | OpenIGTLink Stream  | Surgical navigation `TRANSFORM`, `POSITION`, `TRACKING_DATA`, `IMAGE`, and `STATUS` message definitions                                                                                 |

---

## Key Capabilities

### 1. $SE(3)$ Coordinate Frame Graph & Matrix Orthogonality

`@modelscript/igtl` parses $4 \times 4$ homogeneous transformations $\mathbf{T}_{\text{From}\to\text{To}} \in SE(3)$ across surgical coordinate frames (`Tracker`, `Patient`, `Reference`, `Stylus`, `StylusTip`, `Probe`, `UltrasoundImage`, `RAS`) and verifies $SO(3)$ rotation matrix orthogonality ($\|\mathbf{R}^\top\mathbf{R} - \mathbf{I}\|_F < 10^{-4}$ and $\det\mathbf{R} = +1$):

$$^{A}\mathbf{T}_{C} = {}^{A}\mathbf{T}_{B} \, {}^{B}\mathbf{T}_{C}, \qquad \mathbf{T}^{-1} = \begin{bmatrix} \mathbf{R}^\top & -\mathbf{R}^\top\mathbf{t} \\ \mathbf{0}^\top & 1 \end{bmatrix}$$

Breadth-first traversal over `<CoordinateDefinitions>` resolves arbitrary multi-hop kinematic chains (e.g., $\text{StylusTip} \to \text{Stylus} \to \text{Tracker} \to \text{Reference} \to \text{Patient} \to \text{RAS}$) and detects disconnected subgraphs or contradictory cycle transforms.

### 2. Stylus Pivot Calibration & Fitzpatrick Target Registration Error ($\text{TRE}$)

- **Spherical Stylus Pivot Calibration**: Given $M$ poses $\{(\mathbf{R}_i, \mathbf{t}_i)\}_{i=1}^M$ of a tracked surgical pointer pivoting around a stationary divot, `@modelscript/igtl` solves the overdetermined linear least-squares system (`solveTransformChainAndPivot`) for the local tip offset $\mathbf{p}_{\text{tip}}$ and global pivot position $\mathbf{p}_{\text{pivot}}$:
  $$\begin{bmatrix} \mathbf{R}_1 & -\mathbf{I}_3 \\ \vdots & \vdots \\ \mathbf{R}_M & -\mathbf{I}_3 \end{bmatrix} \begin{bmatrix} \mathbf{p}_{\text{tip}} \\ \mathbf{p}_{\text{pivot}} \end{bmatrix} = \begin{bmatrix} -\mathbf{t}_1 \\ \vdots \\ -\mathbf{t}_M \end{bmatrix}, \qquad e_{\text{RMS}} = \sqrt{\frac{1}{M}\sum_{i=1}^M \|\mathbf{R}_i \mathbf{p}_{\text{tip}} + \mathbf{t}_i - \mathbf{p}_{\text{pivot}}\|^2}$$
- **Fitzpatrick (1998) Target Registration Error**: Evaluates expected RMS registration error at surgical target $\mathbf{r}$ from $N$ anatomical/bone-screw fiducial markers with isotropic Fiducial Localization Error ($\text{FLE}$) and principal-axis RMS distances $f_k$:
  $$\langle \text{TRE}^2(\mathbf{r}) \rangle = \frac{\langle \text{FLE}^2 \rangle}{N}\left(1 + \frac{1}{3}\sum_{k=1}^{3}\frac{d_k^2}{f_k^2}\right)$$

### 3. ROS 2 URDF, Modelica & DAE Projections

- Projects surgical tracker coordinate trees into **ROS 2 URDF** (`igtlToUrdf`), **Modelica 3.x** (`igtlToModelica`), and `@modelscript/runtime`'s `DAEBuilder` arena (`lowerIgtlToDae`).

---

## Pre-Flight Diagnostics

<LintRules lang="igtl" />

---

## CLI Usage

```bash
# Inspect tracking devices, SE(3) transforms, and OpenIGTLink servers
msx igtl inspect LaparoscopicTracker.plus.xml

# Validate SE(3) rotation orthogonality, frame connectivity, and TRE limits
msx igtl validate LaparoscopicTracker.plus.xml

# Solve coordinate frame chains, stylus pivot calibration, and Fitzpatrick TRE
msx igtl calibrate LaparoscopicTracker.plus.xml

# Project surgical navigation frame tree to ROS 2 URDF, Modelica, or DAE arena
msx igtl to-urdf LaparoscopicTracker.plus.xml > SurgicalTracker.urdf
msx igtl to-modelica LaparoscopicTracker.plus.xml > SurgicalTracker.mo
msx igtl to-dae LaparoscopicTracker.plus.xml
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseIgtlModel,
  solveTransformChainAndPivot,
  lowerIgtlToDae,
  igtlToUrdf,
  igtlToModelica,
} from "@modelscript/igtl";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseIgtlModel(plusXmlSource);
const calibration = solveTransformChainAndPivot(model);

const builder = new DAEBuilder();
lowerIgtlToDae(model, builder);
const urdfXml = igtlToUrdf(model);
const modelicaCode = igtlToModelica(model);
```
