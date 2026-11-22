<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/atopile

**Maturity:** Beta · **Extensions:** `.ato` · **Docs:** [modelscript.org/languages/atopile](https://modelscript.org/languages/atopile)

Code-first electronic hardware & PCB design language (`.ato`) package for ModelScript.

## Capabilities

- **Native WebAssembly GLR Parser (`dist/parser.wasm`):** Declarative `.ato` grammar compiled via `@modelscript/dsl`.
- **Indentation-Aware `.ato` Parser:** Supports `import`/`from`, `module`/`component`/`interface`, `signal`, `pin`, `new` instances, direct (`~`) and bridged (`~>`) connections, physical values with SI units and tolerances (`10kohm +/- 1%`, `3.3V to 3.6V`), and `assert` constraints.
- **Hierarchical Netlist & BOM Elaboration (`elaborateAtopile`):** Lowers `.ato` modules into ModelScript's canonical `@modelscript/cad` `NetlistGraph` and BOM.
- **Direct MNA `DAEBuilder` Lowering (`lowerAtopileToDAE`):** Lowers resistors, capacitors, inductors, and sources directly into ModelScript's linear-memory `DAEBuilder`.
- **Worst-Case Tolerance Constraint Linter (`lintAtopile`):** Verifies duplicate declarations (`A2001`), unresolved types (`A2002`), and physical tolerance `assert` bounds (`A3001`).

## Package Structure

| File                             | Responsibility                                                          |
| -------------------------------- | ----------------------------------------------------------------------- |
| `src/language.ts`                | `@modelscript/dsl` language registration (`.ato`)                       |
| `src/grammar/atopile-grammar.ts` | Declarative `.ato` grammar definition for WASM GLR parser compilation   |
| `src/parser/atopile-parser.ts`   | Indentation-aware `.ato` parser and physical tolerance value parser     |
| `src/dae/dae-lower.ts`           | `lowerAtopileToDAE` direct MNA lowering into linear-memory `DAEBuilder` |
| `src/lints/index.ts`             | `lintAtopile` static & tolerance constraint linter (`A2001`–`A3001`)    |
| `src/indexing.ts`                | Workspace symbol indexing for `.ato` modules and components             |
| `src/index.ts`                   | Public package entry point and barrel exports                           |

## Scripts

```bash
pnpm --filter @modelscript/atopile build
pnpm --filter @modelscript/atopile test
pnpm --filter @modelscript/atopile lint
pnpm --filter @modelscript/atopile typecheck
```
