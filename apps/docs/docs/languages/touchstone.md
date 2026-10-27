# Touchstone RF & Signal Integrity (`.sNp`, `.ts`)

`@modelscript/touchstone` (`languages/touchstone`) provides high-performance zero-regex parsing, Vector Fitting rational macromodeling, Hamiltonian passivity enforcement, linear DAE lowering, and Modelica 3.x projection for **Touchstone 1.0 & 2.0** multi-port RF, microwave, and high-speed digital interconnect decks.

---

## Supported Extensions & Standards

| Extension              | Format             | Description                                                                                                   |
| :--------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------ |
| `.s1p`                 | 1-Port Network     | Reflection coefficient ($S_{11}$) for antennas, terminations, and single-ended loads                          |
| `.s2p`                 | 2-Port Network     | Transmission ($S_{21}, S_{12}$) and reflection ($S_{11}, S_{22}$) for filters, amplifiers, transmission lines |
| `.s3p`, `.s4p`, `.sNp` | Multi-Port Network | Multi-pin connectors, differential transmission lines, crosstalk matrices                                     |
| `.ts`                  | Touchstone 2.0     | Advanced multi-port specification with mixed-mode S-parameters and per-port reference impedances              |

---

## Key Capabilities

### 1. Multi-Format Parameter Formats

- Parses multi-port frequency grids with automatic unit conversion (Hz, kHz, MHz, GHz) and parameter types:
  - **S-Parameters** (Scattering matrix)
  - **Y-Parameters** (Admittance matrix)
  - **Z-Parameters** (Impedance matrix)
  - **H / G Parameters** (Hybrid matrices)
- Supports all standard data formats:
  - **DB**: Magnitude in decibels ($20 \log_{10} |S|$), phase in degrees ($\angle S$)
  - **MA**: Linear magnitude ($|S|$), phase in degrees ($\angle S$)
  - **RI**: Real and imaginary components ($\text{Re}(S) + j \text{Im}(S)$)
- Enforces strict Touchstone matrix ordering conventions (e.g., $S_{21}, S_{12}$ transpose ordering for 2-port networks).

### 2. Vector Fitting & Rational Macromodeling

- Converts discrete frequency-domain tabulated measurements into continuous-time rational transfer functions via **Vector Fitting**:
  $$S_{ij}(s) \approx \sum_{m=1}^{P} \frac{r_m}{s - p_m} + d + s \cdot e$$
  where $p_m$ are complex conjugate pole pairs in the open left half-plane ($\text{Re}(p_m) < 0$), ensuring stability.
- Synthesizes a state-space realization:
  $$\dot{x}(t) = A x(t) + B u(t), \quad y(t) = C x(t) + D u(t)$$
  which lowers directly into ODE time-domain solvers without inverse FFT convolution lag.

### 3. Passivity Verification & Hamiltonian Matrix

- Verifies that the $N$-port network does not generate net energy across all frequencies:
  $$\|S(j\omega)\|_2 \le 1 \quad \forall \omega \in [0, \infty)$$
- Computes the eigenvalues of the **Hamiltonian matrix**:
  $$H = \begin{bmatrix} A + B (I - D^T D)^{-1} D^T C & B (I - D^T D)^{-1} B^T \\ -C^T (I - D D^T)^{-1} C & -(A + B (I - D^T D)^{-1} D^T C)^T \end{bmatrix}$$
  where purely imaginary eigenvalues identify exact passivity violation frequency crossover points.

### 4. Direct DAE Lowering & Modelica Projection

- Lowers state-space companion matrices directly into `@modelscript/runtime`'s `DAEBuilder` SoA linear memory arena.
- Projects multiport networks into `Modelica.Electrical.Analog` pin networks for joint electro-mechanical and power electronic simulations ([`@modelscript/spice`](./spice.md)).

---

## Pre-Flight Diagnostics

The Touchstone linter checks physical validity and numerical stability:

<LintRules lang="touchstone" />

---

## CLI Usage

```bash
# Inspect Touchstone port count, frequency range, and impedance
msx touchstone inspect BandpassFilter.s2p

# Run pre-flight linting and validity checks
msx touchstone lint BandpassFilter.s2p

# Verify S-parameter passivity and compute maximum singular value
msx touchstone passivity BandpassFilter.s2p

# Fit rational state-space macromodel via Vector Fitting
msx touchstone fit BandpassFilter.s2p --order=6

# Lower state-space model to ModelScript linear DAE arena
msx touchstone to-dae BandpassFilter.s2p

# Project into Modelica 3.x electrical analog component
msx touchstone to-modelica BandpassFilter.s2p -o FilterModel.mo
```
