# GENSYS Railway Dynamics (`.calc`, `.sub`, `.geom`, `.trax`, `.wheel`)

ModelScript provides native support for **GENSYS**, the world standard railway vehicle dynamics, track-vehicle interaction, and vehicle running safety simulation environment.

---

## Capabilities

- **Command Deck Parsing**: Full support for `.calc`, `.run`, and `.sub` structured card records defining rigid car bodies, bogies, wheelsets, and primary/secondary spring-damper couplings.
- **Track Geometry & Irregularities**: Ingests `.geom` and `.trax` files with longitudinal distance, horizontal/vertical irregularities, cant (crosslevel), and curvature $1/R$.
- **Kalker FASTSIM & Polach Contact Mechanics**: Discretizes rolling contact ellipses into elastic/slip zones to compute tangential creep forces ($F_x$, $F_y$) and spin moment ($M_z$) with non-linear saturation.
- **WebAssembly Contact Mechanics Kernel**:
  - High-performance AssemblyScript linear memory kernel (`contact.wasm`) executing Kalker FASTSIM 8-slice strip integration and Polach creep mechanics.
  - High-throughput multi-axle batched contact patch solvers (`batchFastsim`, `batchPolach`).
- **EN 14363 / UIC 518 Vehicle Acceptance**: Automated safety evaluation of the derailment quotient ($Y/Q \le 0.8$) and Prud'homme lateral track shifting force limits.
- **Ride Comfort & Equivalent Conicity**: Evaluates Sperling ride index ($W_z$) and wheel-rail equivalent conicity ($\lambda$).
- **DAE Lowering & MultiBody Export**: Direct lowering to linear-memory `DAEBuilder` and automated projection to standard `Modelica.Mechanics.MultiBody` components.
- **FMI 2.0 / 3.0 Co-Simulation FMU Export**: Packages complete vehicle and track dynamics into standalone `.fmu` archives with standardized vehicle states, running safety outputs, and C co-simulation wrapper runtime.
- **Interactive 3D Viewport**: WebGL/Three.js 3D visualization rendering carbody shells, front/rear bogie frames, wheelsets, and primary/secondary spring dampers with orbit controls.

---

## CLI Usage

```bash
# Pre-flight linting of GENSYS vehicle deck
msx gensys lint coach.calc

# Direct DAE simulation in WebAssembly arena with CSV trajectory export
msx gensys simulate coach.calc --stop-time=5.0 --step=0.005 --out=results.csv

# Export vehicle dynamics as an FMI 2.0/3.0 Co-Simulation FMU
msx gensys to-fmu coach.ins --out=PassengerCoach.fmu

# Export to standard Modelica MultiBody model
msx gensys to-modelica coach.calc --out=PassengerCoach.mo

# Verify EN 14363 running safety criteria
msx gensys verify --y-force=28.5 --q-force=82.0 --axle-load=160.0
```

---

## Benchmarks

- **Manchester Benchmark for Railway Vehicle Dynamics** (`languages/gensys/testsuite/ManchesterBenchmark.ins`):
  - Standard passenger coach benchmark (Iwnicki et al.): 32-ton passenger carbody, two 3.2-ton bogie frames, four 1.8-ton wheelsets running at $V = 40\text{ m/s}$ (144 km/h).
  - Validates secondary and primary suspension settling dynamics, 8-patch FASTSIM contact in WASM, and EN 14363 / UIC 518 derailment safety limits.

---

## MCP Tools

AI agents interacting via the ModelScript MCP server have access to:

- `gensys_lint`: Validates body parameters, mass positivity, and suspension couplings.
- `gensys_verify_en14363`: Assesses derailment quotient and lateral track shift limits.
- `gensys_fastsim`: Computes rolling contact tangential creep forces and adhesion saturation.

## Diagnostic Rules

<LintRules lang="gensys" />
