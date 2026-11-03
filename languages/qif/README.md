<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/qif

ISO 23952 / ANSI DMSC Quality Information Framework (QIF 3.0) digital metrology, GD&T, and Statistical Process Control (SPC) language package for ModelScript.

---

## Core Capabilities

- **QIF 3.0 XML & JSON Model Parser**: High-performance parser for QIF MBD (Model-Based Definition), QIF Plans, QIF Measurement Results, and QIF Statistics.
- **GD&T Datum & Characteristic Engine**: Validates geometric dimensioning and tolerancing (position, profile, runout, orientation) against ASME Y14.5 and ISO 1101 standards.
- **STEP AP242 CAD Bridge**: Associates 3D B-Rep CAD geometry features from ISO 10303-21 STEP models with measured QIF inspection features.
- **Statistical Process Control (SPC)**: Computes process capability indices ($C_p$, $C_{pk}$, $P_p$, $P_{pk}$), control chart limits ($\bar{X}-R$), and histogram distributions.
- **LSP Integration**: Language Server Protocol features including metrology diagnostics, characteristic navigation, and inspection plan code lenses.

---

## Package Structure

| Path                     | Description                                                           |
| ------------------------ | --------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                 |
| `src/language.ts`        | QIF language definition and schema configuration                      |
| `src/parser/`            | QIF 3.0 XML and JSON metrology parser                                 |
| `src/lints/`             | GD&T specification and inspection tolerance linters                   |
| `src/spc/`               | Statistical Process Control and capability metrics engine             |
| `src/step-bridge/`       | Association bridge between STEP AP242 features and QIF inspection IDs |
| `src/projections/`       | Projections to STEP, CSV, and tabular reporting                       |
| `src/workspace-index.ts` | Workspace-wide inspection plan and measurement results indexer        |
| `src/lsp.ts`             | Language Server Protocol symbol and diagnostic provider               |
