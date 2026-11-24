# 20-sim (`.emx`, `.emxz`, `.sid`)

ModelScript provides **Beta**-tier native support for Controllab **20-sim** multi-domain Bond Graph and SIDOPS / SIDOPS+ simulation models via `@modelscript/twentysim`.

## Capabilities

- **Container & Equation Parsing:** Ingests 20-sim XML models (`.emx`), ZIP-packed archives (`.emxz`), embedded `<SpecificationCode><![CDATA[...]]></SpecificationCode>` blocks, and standalone SIDOPS files (`.sid`) with a native WebAssembly GLR parser (`parser.wasm`).
- **Bond Graph & SIDOPS Lowering:** Lowers `0`-junctions (common effort), `1`-junctions (common flow), canonical elements (`R`, `C`, `I`, `Se`, `Sf`, `MSe`, `MSf`, `TF`, `GY`, `MTF`, `MGY`), Signal/Control catalog blocks (`Gain`, `PlusMinus`, `Integrate`, `Step`, `Sine`, `PID`, `Constant`), and SIDOPS `ddt()`/`int()` equations directly into `@modelscript/runtime`'s `DAEBuilder` linear-memory arena.
- **SCAP Causality Linting:** Executes the Sequential Causality Assignment Procedure (SCAP) to flag effort/flow causality conflicts (`TS4001`), derivative causality on storage elements (`TS4002`), causal signal algebraic loops (`TS4003`), port kind mismatches (`TS3001`), and unconnected power ports (`TS5001`).
- **RK4 Simulation & SVG Rendering:** Simulates Bond Graph and SIDOPS models with exact power-conservation verification and renders Bond Graph SVGs with power half-arrows and causal stroke bars.
- **Bidirectional Modelica TGG:** Translates between 20-sim and Modelica via `twentySimToModelica()` and `modelicaToTwentySim()`.

## CLI Usage

```bash
msx twentysim inspect model.emx
msx twentysim lint model.emx
msx twentysim simulate model.emx --stop 5 --step 0.01
msx twentysim render model.emx -o bondgraph.svg
msx twentysim to-dae model.emx
msx twentysim to-modelica model.emx -o model.mo
```

---

## Linters & Diagnostic Rules

<LintRules lang="twentysim" />

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="twentysim" />
