<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/las

CWLS Log ASCII Standard (`.las` 1.2 / 2.0 / 3.0) WebAssembly GLR parser, semantic validator, `@modelscript/simulate/charts` `IndexedDataset` adapter, Modelica parameter package generator, and workspace indexer for ModelScript.

## Core Capabilities

- **LAS 1.2 / 2.0 / 3.0 Parsing (`parseLas`)**: Parses `~V`, `~W`, `~C`, `~P`, `~O`, and `~A` sections, wrapped lines (`WRAP = YES`), custom delimiters (`DLM = COMMA | TAB | SPACE`), LAS 3.0 multi-sections, and `NULL` sentinel normalization.
- **Canonical Dataset Interoperability (`lasToDataset` / `datasetToLas`)**: Converts well-log data into `@modelscript/simulate/charts` `IndexedDataset` structures with `inverted: true` depth axes for multi-track plotting, crossplots, and interval histograms.
- **Semantic Diagnostics (`lintLas`)**: Validates `LAS1001`–`LAS1007` (missing sections, duplicate curves, column count mismatches, non-numeric cells, and depth monotonicity).
- **Modelica Codegen (`parseLasToModelica`) & Workspace Indexing (`lasWorkspaceHooks`)**: Exposes logged curves and physical units to Modelica/ModelScript models.
