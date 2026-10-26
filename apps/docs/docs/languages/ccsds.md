# CCSDS Astrodynamics & Space Telemetry (`.oem`, `.opm`, `.omm`, `.xtce`)

`@modelscript/ccsds` (`languages/ccsds`) provides comprehensive compiler, trajectory propagation, and verification support for the **Consultative Committee for Space Data Systems (CCSDS)** and **OMG XML Telemetric & Command Exchange (XTCE)** standards.

---

## Supported Extensions & Standards

| Extension       | Standard / Specification                        | Engineering Domain                                         |
| :-------------- | :---------------------------------------------- | :--------------------------------------------------------- |
| `.oem`          | **CCSDS 502.0-B-2** Orbit Ephemeris Message     | Time-tagged position and velocity state vector ephemerides |
| `.opm`          | **CCSDS 502.0-B-2** Orbit Parameter Message     | Osculating Keplerian orbital elements and maneuvers        |
| `.omm`          | **CCSDS 502.0-B-2** Orbit Mean-Elements Message | Mean orbital elements (SGP4/SDP4 TLE compatible)           |
| `.xtce`, `.xml` | **OMG XTCE v1.2** Telemetric & Command Exchange | Bit-level satellite telemetry decommutation and commanding |

---

## Key Capabilities

### 1. Perturbed 6-DOF Cowell Orbit Propagator

- Integrates high-fidelity gravitational and environmental perturbations in Cartesian J2000 / GCRF coordinates:
  $$\ddot{\mathbf{r}} = -\frac{\mu}{r^3}\mathbf{r} + \mathbf{a}_{J_2} + \mathbf{a}_{\text{drag}} + \mathbf{a}_{\text{SRP}} + \mathbf{a}_{\text{3rd}}$$
- **$J_2$ Earth Oblateness**: Evaluates central body oblateness forces from zonal harmonic coefficients.
- **Atmospheric Drag**: Exponential barometric and Jacchia-Roberts atmospheric density models coupled with satellite cross-sectional area and drag coefficient $C_D$.
- **Solar Radiation Pressure (SRP)**: Cannonball radiation pressure models with cylindrical and dual-cone solar eclipse shadowing.
- **Third-Body Gravitation**: Lunar and solar ephemeris gravitational perturbations.

### 2. OMG XTCE Bit-Packing & Decommutation Engine

- Parses hierarchical `<TelemetryMetaData>`, `<ParameterSet>`, `<ContainerSet>`, and `<SequenceContainer>` schemas.
- Validates bit-level alignments, integer sign encodings (twos-complement, sign-magnitude), IEEE 754 float packaging, and calibrated polynomial transfer functions.

### 3. Direct DAE Lowering

- Compiles orbital states and spacecraft attitudes directly into `@modelscript/runtime`'s `DAEBuilder` SoA linear memory arena for joint trajectory and attitude determination simulations.

### 4. Polyglot Projections & TGG Mappings

- **Modelica Export (`ccsdsToModelica`)**: Generates continuous Modelica 3.x space flight models compatible with orbital physics libraries.
- **SysML v2 Mission Architecture (`ccsdsToSysml`)**: Projects ground station contacts, communication downlink schedules, and orbit maintenance requirements into SysML v2 `part def` and `requirement def` hierarchies.

---

## Static Analysis & Pre-Flight Linter Rules

The CCSDS analyzer enforces space mission integrity and flight safety constraints:

| Rule Identifier          | Severity  | Condition Checked                                                                                            |
| :----------------------- | :-------- | :----------------------------------------------------------------------------------------------------------- |
| `suborbital-perigee`     | `error`   | Orbit perigee altitude drops below safe atmospheric entry threshold ($r_p < R_\text{Earth} + h_\text{min}$). |
| `unsupported-frame`      | `error`   | Ephemeris references an undefined or unsupported non-inertial reference frame.                               |
| `uncalibrated-parameter` | `warning` | XTCE parameter definition lacks valid engineering unit calibration or polynomial transform.                  |
| `bit-packing-overlap`    | `error`   | Bit-level overlap or invalid byte alignment detected inside telecommand sequence containers.                 |

---

## CLI Usage

```bash
# Lint an Orbit Ephemeris Message or XTCE container definition
msx ccsds lint mission_orbit.oem
msx ccsds lint satellite_telemetry.xtce

# Propagate trajectory and lower to DAE linear memory
msx ccsds to-dae orbit.opm --duration 86400 --step 60

# Project orbital state vectors into Modelica simulation code
msx ccsds to-modelica orbit.opm -o OrbitDynamics.mo

# Export orbital mission constraints to SysML v2 requirements
msx ccsds to-sysml orbit.omm -o OrbitRequirements.sysml
```
