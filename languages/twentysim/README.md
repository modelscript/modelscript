<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/twentysim`

20-sim (`.emx`, `.emxz`, and SIDOPS `.sid`) language frontend for ModelScript.

## Features

- **Container & Equation Parsing:** Parses 20-sim XML (`.emx`), ZIP-packed archives (`.emxz`), and standalone SIDOPS / SIDOPS+ equation models (`.sid`), backed by a native WASM GLR parser (`parser.wasm`).
- **Bond Graph & SIDOPS DAE Lowering:** Lowers `0`-junctions, `1`-junctions, canonical bond graph elements (`R`, `C`, `I`, `Se`, `Sf`, `TF`, `GY`, `MSe`, `MSf`, `MTF`, `MGY`), signal connections, and SIDOPS differential/algebraic equations (`ddt`, `int`) directly into `@modelscript/runtime`'s `DAEBuilder` linear-memory arena.
- **SCAP Causality Lints:** Runs the Sequential Causality Assignment Procedure (SCAP) to detect effort/flow causality conflicts (`TS4001`), derivative causality on storage elements (`TS4002`), algebraic loops (`TS4003`), port mismatches (`TS3001`), and dangling ports (`TS5001`).
- **Bond Graph SVG Diagram:** Generates structured diagram scenes and SVG renderings with power half-arrows and causal strokes.
- **Modelica Projection & LSP:** Projects 20-sim models to Modelica and provides LSP diagnostics, symbols, hover, and completions.
