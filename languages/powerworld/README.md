<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/powerworld

PowerWorld Simulator Auxiliary (`.aux`) transmission power flow, contingency, and script compiler, semantic linter, PSS/E `.raw` projector, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **Native WASM GLR Grammar (`@modelscript/dsl`)**: Declarative `.aux` grammar supporting `DATA (ObjectType, [Fields]) { ... }` and `SCRIPT { ... }` blocks.
- **Parser & Typed Network Extraction**: Extracts `Bus`, `Gen`, `Load`, `Branch`, `Shunt`, `Area`, `Zone`, and `Contingency` records with exact source spans.
- **Semantic Linter**: Checks bus uniqueness, unresolved `BusNum` / `BusNumFrom` / `BusNumTo` references, nominal voltage validity, zero-impedance branches, generator MW limits, thermal ratings, and slack bus presence.
- **Linear-Memory DAE Lowering**: Compiles transmission buses, branches, generators, loads, and shunts directly into `DAEBuilder`.
- **PSS/E `.raw` Projection**: Exports PowerWorld `.aux` cases to standard PSS/E v33 `.raw` format.

## Usage

```bash
npm run build --workspace=@modelscript/powerworld
npm test --workspace=@modelscript/powerworld
```
