<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/qif

ISO 23952 / ANSI QIF 3.0 (Quality Information Framework) Digital Metrology, ASME Y14.5 / ISO 1101 GD&T, CMM Inspection Planning, and Statistical Process Control (SPC) language package (`.qif`) for ModelScript. Features an ISO 23952 QIF XML & JSON parser (`parseQif`), multi-file workspace indexing (`QifWorkspaceIndex`), ASME Y14.5 MMC/LMC bonus tolerance & SPC capability engine (`evaluateActualCompliance`, `evaluateQifSpc`), STEP AP242 B-Rep PMI reconciliation (`extractStepEntities`, `reconcileStepWithQif`), direct linear-memory `DAEBuilder` lowering (`lowerQifToDae`), 9 metrological lint rules (`M8101`–`M8109`, `lintQifDocument`, `QifErrorCode`), SysML v2 and Modelica 3.x projections (`qifToSysML2`, `qifToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **ISO 23952 QIF 3.0 Parser (`parseQif`)**: Parses `QIFDocument` trees (`QPId`, `DatumDefinitions`, `DatumReferenceFrames`, `Features`, `Characteristics`, `MeasurementResources`, `QifRules`, and `MeasurementsResults`) from QIF 3.0 XML or structured JSON with exact source spans.
- **ASME Y14.5 / ISO 1101 GD&T & SPC Capability Engine (`evaluateActualCompliance`, `evaluateQifSpc`)**: Computes Maximum/Least Material Condition (`MMC`/`LMC`) bonus tolerances from measured feature-of-size actuals, evaluates 3D position/flatness/cylindricity/profile zone compliance, and calculates $\bar{X}$, $s$, $C_p$, $C_{pk}$, $P_p$, $P_{pk}$, and Test Uncertainty Ratio ($\text{TUR}$).
- **STEP AP242 CAD B-Rep Reconciliation (`extractStepEntities`, `reconcileStepWithQif`)**: Cross-checks QIF feature `stepEntityId` links against STEP AP242 (`@modelscript/step`) `ADVANCED_FACE`, `CYLINDRICAL_SURFACE`, and `PLANE` entities to ensure complete digital thread coverage.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerQifToDae`)**: Lowers worst-case and RSS tolerance stackup chains, thermal expansion compensation, and CMM probing dynamics directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **9 Metrological & GD&T Lint Rules (`M8101`–`M8109`, `lintQifDocument`)**: Static verification of `QPId` references, duplicate IDs, datum precedence frames, valid `MMC`/`LMC` modifiers, composite position tolerance tiers, CMM minimum probing point counts, ISO/IEC 17025 $4:1$ $\text{TUR}$ ratios, out-of-tolerance actual pass/fail flags, and STEP AP242 entity resolution.
- **SysML v2 & Modelica 3.x Projections (`qifToSysML2`, `qifToModelica`)**: Projects QIF GD&T characteristics into SysML v2 `requirement def` / `verification def` constraints and Modelica 3.x tolerance stackup models.

---

## Package Structure

| Path                       | Description                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                             |
| `src/language.ts`          | `qifLanguage` definition, compiler actions, and MCP tool (`qif_inspect_and_spc`)                   |
| `src/types.ts`             | `QifDocument`, `QifFeature`, `QifCharacteristic`, `QifDatumReferenceFrame`, `QifSpcSummary` types  |
| `src/parser/index.ts`      | `parseQif` ISO 23952 QIF 3.0 XML and JSON parser                                                   |
| `src/lints/rules.ts`       | `QifErrorCode`, `lintQifDocument` (`M8101`–`M8109`), and `evaluateActualCompliance`                |
| `src/lints/index.ts`       | Linter barrel exports                                                                              |
| `src/spc/index.ts`         | `evaluateQifSpc` statistical process control ($C_p$, $C_{pk}$, $\text{TUR}$, MMC/LMC bonus) engine |
| `src/step-bridge/index.ts` | `extractStepEntities` and `reconcileStepWithQif` STEP AP242 B-Rep PMI reconciliation               |
| `src/dae/index.ts`         | `lowerQifToDae` direct lowering of tolerance stackup equations into `DAEBuilder` linear memory     |
| `src/projections/index.ts` | `qifToSysML2` and `qifToModelica` cross-language translators                                       |
| `src/workspace-index.ts`   | `QifWorkspaceIndex` implementing `IWorkspaceIndex` across `.qif` files                             |
| `src/lsp.ts`               | LSP validation, document symbols, hover, completion, and definition providers                      |

---

## Pre-Flight Semantic Lint Rules (`M8101`–`M8109`)

| Code    | Rule                              | Severity  | Description                                                                                                                |
| ------- | --------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `M8101` | `qif-unresolved-qpid`             | `error`   | Characteristic or actual references an undeclared `featureId`, `characteristicId`, `deviceId`, or datum label.             |
| `M8102` | `qif-duplicate-qpid`              | `error`   | Duplicate element identifier or `QPId` UUID declared within the QIF document.                                              |
| `M8103` | `qif-invalid-datum-precedence`    | `error`   | `DatumReferenceFrame` contains duplicate primary/secondary/tertiary datum labels (e.g. `A \| A \| B`).                     |
| `M8104` | `qif-invalid-material-modifier`   | `error`   | `MMC` or `LMC` material modifier applied to a non-feature-of-size or prohibited GD&T form/orientation characteristic.      |
| `M8105` | `qif-composite-frame-mismatch`    | `error`   | Composite tolerance lower-tier feature-relating tolerance is $\ge$ upper-tier pattern-locating tolerance.                  |
| `M8106` | `qif-insufficient-probing-points` | `error`   | CMM measurement probing point count is below the geometric minimum for the feature type or `QifRules.minPointsPerFeature`. |
| `M8107` | `qif-tur-uncertainty-warning`     | `warning` | Test Uncertainty Ratio ($\text{TUR} = \text{Tolerance} / (2 U_{\text{device}})$) is below minimum threshold ($4:1$).       |
| `M8108` | `qif-out-of-tolerance-actual`     | `error`   | Measured actual exceeds effective tolerance (including MMC/LMC bonus) while marked `PASS`, or is in-spec marked `FAIL`.    |
| `M8109` | `qif-unresolved-step-entity`      | `error`   | QIF feature `stepEntityId` does not resolve to an entity in the linked STEP AP242 CAD model.                               |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx qif`)

```bash
# Lint an ISO 23952 QIF 3.0 document (M8101-M8109)
npx msx qif lint turbine_blade.qif

# Evaluate GD&T MMC/LMC bonus tolerances and SPC capability (Cp, Cpk, TUR)
npx msx qif spc turbine_blade.qif

# Reconcile QIF features against a STEP AP242 CAD file
npx msx qif reconcile-step turbine_blade.qif --step turbine_blade.step

# Lower to DAE or project to SysML v2 (.sysml) and Modelica (.mo)
npx msx qif to-dae turbine_blade.qif
npx msx qif to-sysml2 turbine_blade.qif
npx msx qif to-modelica turbine_blade.qif
```

### Programmatic API

```typescript
import {
  evaluateQifSpc,
  lintQifDocument,
  lowerQifToDae,
  parseQif,
  qifToModelica,
  qifToSysML2,
  reconcileStepWithQif,
} from "@modelscript/qif";

// 1. Parse ISO 23952 QIF 3.0 XML/JSON and run metrological lint rules (M8101-M8109)
const doc = parseQif(qifXml, "housing_inspection.qif");
const diagnostics = lintQifDocument(doc);

// 2. Evaluate ASME Y14.5 MMC/LMC bonus tolerances and SPC capability indices (Cp, Cpk)
const spc = evaluateQifSpc(doc);
console.log(`Pass rate: ${(spc.overallPassRate * 100).toFixed(1)}%, Min Cpk: ${spc.minCpk.toFixed(2)}`);

// 3. Lower tolerance stackup to DAEBuilder or project to SysML v2 / Modelica 3.x
const dae = lowerQifToDae(doc);
const sysmlRequirements = qifToSysML2(doc);
const modelicaStackup = qifToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                               |
| `npm test`          | Run QIF 3.0 parser, GD&T linter, SPC capability, STEP bridge, and DAE tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                       |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                        |
| `npm run clean`     | Remove `dist/` build artifacts                                              |

---

## License

`AGPL-3.0-or-later`
