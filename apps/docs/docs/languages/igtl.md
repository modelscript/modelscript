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

- Parses $4 \times 4$ homogeneous transformations $\mathbf{T}_{\text{From}\to\text{To}} \in SE(3)$ across surgical coordinate frames (`Tracker`, `Patient`, `Reference`, `Stylus`, `StylusTip`, `Probe`, `UltrasoundImage`, `RAS`) and computes composite chains via breadth-first graph traversal with automatic matrix inversion $\mathbf{T}^{-1} = \begin{bmatrix} \mathbf{R}^\top & -\mathbf{R}^\top\mathbf{t} \\ \mathbf{0}^\top & 1 \end{bmatrix}$.

### 2. Stylus Pivot Calibration & Fitzpatrick Target Registration Error ($\text{TRE}$)

- Solves least-squares spherical pivot calibration (`solveTransformChainAndPivot`) to determine stylus tip offset $\mathbf{p}_{\text{tip}}$, pivot point $\mathbf{p}_{\text{pivot}}$, and RMS calibration residual ($< 1.5\text{ mm}$).
- Evaluates expected surgical Target Registration Error at target $\mathbf{r}$ from $N$ fiducial markers with Fiducial Localization Error ($\text{FLE}$) using **Fitzpatrick's formula**:
  $$\langle \text{TRE}^2(\mathbf{r}) \rangle = \frac{\langle \text{FLE}^2 \rangle}{N}\left(1 + \frac{1}{3}\sum_{k=1}^{3}\frac{d_k^2}{f_k^2}\right)$$

### 3. ROS 2 URDF & Modelica Projections

- Projects surgical tracker coordinate trees into **ROS 2 URDF** (`igtlToUrdf`) and **Modelica 3.x** (`igtlToModelica`).

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

# Project surgical navigation frame tree to ROS 2 URDF or Modelica
msx igtl to-urdf LaparoscopicTracker.plus.xml > SurgicalTracker.urdf
msx igtl to-modelica LaparoscopicTracker.plus.xml > SurgicalTracker.mo
```
