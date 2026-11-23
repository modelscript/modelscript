<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/ieee-cdf`

Native ModelScript **Beta** language package for **IEEE Common Data Format (1973)** and **BPA IPF (Interactive Power Flow, 1970s)** power-flow network decks.

## Capabilities

- **WASM GLR Parser (`@modelscript/dsl`)**: Declarative grammar in `src/language.ts` compiled to `dist/parser.wasm` plus fixed-column and free-format parsers for IEEE CDF (`BUS DATA FOLLOWS`, `BRANCH DATA FOLLOWS`, `LOSS ZONES FOLLOWS`, `INTERCHANGE DATA FOLLOWS`, `TIE LINES FOLLOWS`, `-999`/`-99`/`-9`, `END OF DATA`) and BPA IPF (`B `, `BE`, `BQ`, `BS`, `L `, `T `, `E `, `R `, `C `).
- **Lints & Diagnostics (`CDF1001`–`CDF5006`)**: Structural, topological, and electrical validation including missing title/MVA base, missing `END OF DATA`, duplicate bus numbers, undefined branch endpoints, self-loops, zero-impedance branches, missing/multiple slack buses, out-of-bounds voltages, inverted PV $Q$ limits, and disconnected islands.
- **AC Newton-Raphson Power-Flow Solver**: Complex $Y_{\text{bus}}$ admittance matrix builder (nominal-$\pi$ lines, off-nominal tap transformers, phase shifters, bus shunts) and polar Newton-Raphson solver with PV reactive power ($Q_{\min}/Q_{\max}$) limit enforcement.
- **Linear-Memory DAE Lowering**: Direct lowering of bus voltage magnitudes, angles, and AC power-flow mismatch equations ($P_i(V,\theta) = P_{g,i}-P_{l,i}$, $Q_i(V,\theta) = Q_{g,i}-Q_{l,i}$) into `@modelscript/runtime` `DAEBuilder`.
- **Polyglot Projections**: Lossless export to MATPOWER v2 (`.m`), PSS/E v33 (`.raw`), and Modelica (`.mo`).
- **Cleanroom Standard Library (`@modelscript/ieee-cdf-std-lib`)**: Parametric bus/branch archetypes, deterministic SVG block icons, AssemblyScript WASM runtime, and embedded cleanroom IEEE 5-bus, IEEE 14-bus, and BPA 3-bus reference networks.
- **Workspace Indexing & LSP**: Diagnostics, document symbols, hover documentation, and completion items.

## Commands

```bash
npm run build
npm run typecheck
npm run lint
npm test
```
