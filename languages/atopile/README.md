<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/atopile`

Code-first electronic hardware & PCB design language (`.ato`) package for ModelScript.

## Capabilities

- **Native WebAssembly GLR Parser (`dist/parser.wasm`):** Declarative `.ato` grammar compiled via `@modelscript/dsl`.
- **Indentation-Aware `.ato` Parser:** Supports `import`/`from`, `module`/`component`/`interface`, `signal`, `pin`, `new` instances, direct (`~`) and bridged (`~>`) connections, physical values with SI units and tolerances (`10kohm +/- 1%`, `3.3V to 3.6V`), and `assert` constraints.
- **Hierarchical Netlist & BOM Elaboration (`elaborateAtopile`):** Lowers `.ato` modules into ModelScript's canonical `@modelscript/cad` `NetlistGraph` and BOM.
- **Direct MNA `DAEBuilder` Lowering (`lowerAtopileToDAE`):** Lowers resistors, capacitors, inductors, and sources directly into ModelScript's linear-memory `DAEBuilder`.
- **Worst-Case Tolerance Constraint Linter (`lintAtopile`):** Verifies duplicate declarations (`A2001`), unresolved types (`A2002`), and physical tolerance `assert` bounds (`A3001`).

## Commands

```bash
npm run build --workspace=@modelscript/atopile
npm run test --workspace=@modelscript/atopile
npm run lint --workspace=@modelscript/atopile
```
