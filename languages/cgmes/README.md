<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cgmes

IEC 61970 / IEC 61968 Common Information Model (CIM16 / CIM17) and ENTSO-E Common Grid Model Exchange Standard (CGMES v2.4.15 & v3.0) RDF/XML power grid exchange package for ModelScript. Features a streaming RDF/XML parser (`parseCgmesRdf`, `parseCgmesFiles`), bus-branch/node-breaker topology processor (`processTopology`), 10 ENTSO-E grid validation lint rules (`C1001`–`C1010`, `lintCgmesModel`, `CgmesErrorCode`), and cross-language projections to PSS/E `.raw` v33 (`cgmesToPsse`) and OpenIPSL-compatible Modelica 3.x (`cgmesToModelica`).

---

## Core Capabilities

- **CIM / CGMES RDF/XML Multi-Profile Parser (`parseCgmesRdf`, `parseCgmesFiles`, `createEmptyCgmesModel`)**: Parses and merges multi-file CGMES v2.4.15 (CIM16) and v3.0 (CIM17) profile sets across Equipment (`EQ`), Steady State Hypothesis (`SSH`), Topology (`TP`), State Variables (`SV`), and Dynamics (`DY`), resolving `rdf:ID`, `rdf:about="#..."`, and `rdf:resource="#..."` `mRID` cross-references.
- **Node-Breaker & Bus-Branch Topology Processor (`processTopology`)**: Traverses `Substation` $\to$ `VoltageLevel` $\to$ `ConnectivityNode` / `TopologicalNode` $\to$ `Terminal` $\to$ `ConductingEquipment` (`ACLineSegment`, `PowerTransformer` / `PowerTransformerEnd`, `SynchronousMachine`, `EnergyConsumer`, `LinearShuntCompensator`, `Breaker`, `Disconnector`) to assemble solvable bus-branch power flow networks and detect topological islands.
- **10 ENTSO-E CGMES Quality & Consistency Lint Rules (`C1001`–`C1010`, `lintCgmesModel`)**: Pre-flight verification of `mRID` identifiers, orphaned equipment terminals, dangling topological nodes, voltage level base voltages and limits, 2-/3-winding transformer ends, generator capability limits ($P_{\min}/P_{\max}$, $Q_{\min}/Q_{\max}$), line impedances, negative loads, isolated substations, and `SvVoltage` state variable bindings.
- **PSS/E `.raw` v33 & Modelica 3.x Projections (`cgmesToPsse`, `cgmesToModelica`)**: Translates merged CGMES bus-branch networks into IEEE/PSS/E v33 `.raw` power flow decks (`@modelscript/psse`) and OpenIPSL-compatible Modelica 3.x transient stability models (`@modelscript/modelica`).

---

## Package Structure

| Path                         | Description                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Public package exports                                                                             |
| `src/language.ts`            | `cgmesLanguage` declarative specification, lint rules, and LSP actions                             |
| `src/types.ts`               | `CgmesModel`, `Substation`, `VoltageLevel`, `TopologicalNode`, `ACLineSegment`, `PowerTransformer` |
| `src/parser/rdf-parser.ts`   | `parseCgmesRdf`, `parseCgmesFiles`, and `createEmptyCgmesModel` CIM16/CIM17 RDF/XML profile parser |
| `src/parser/topology.ts`     | `processTopology` node-breaker to bus-branch converter and island analyzer                         |
| `src/lints/index.ts`         | `CgmesErrorCode` and `lintCgmesModel` ENTSO-E CGMES diagnostic engine (`C1001`–`C1010`)            |
| `src/projections/to-psse.ts` | `cgmesToPsse` translator to PSS/E v33 `.raw` power flow format                                     |
| `src/projections/to-mo.ts`   | `cgmesToModelica` translator to OpenIPSL-compatible Modelica 3.x power grid models                 |

---

## Pre-Flight Semantic Lint Rules (`C1001`–`C1010`)

| Code    | Rule                        | Severity  | Description                                                                                                    |
| ------- | --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `C1001` | `missing-mrid`              | `error`   | `TopologicalNode` or CIM resource has an empty or missing `mRID`.                                              |
| `C1002` | `orphan-terminal`           | `error`   | `Terminal` references a `ConductingEquipment` `mRID` that does not exist in the `EQ` profile.                  |
| `C1003` | `dangling-node`             | `warning` | `TopologicalNode` has zero connected equipment terminals.                                                      |
| `C1004` | `invalid-voltage-level`     | `error`   | `VoltageLevel` has non-positive `nominalVoltage` ($\le 0\text{ kV}$) or `lowVoltageLimit >= highVoltageLimit`. |
| `C1005` | `transformer-end-mismatch`  | `error`   | `PowerTransformer` has fewer than $2$ or more than $3$ `PowerTransformerEnd` windings.                         |
| `C1006` | `generator-limit-inversion` | `error`   | `SynchronousMachine` specifies `minP > maxP` or `minQ > maxQ`.                                                 |
| `C1007` | `zero-impedance-line`       | `warning` | `ACLineSegment` has zero or negative series impedance ($r \le 0$ and $x \le 0$).                               |
| `C1008` | `negative-load`             | `info`    | `EnergyConsumer` specifies negative active power ($P < 0\text{ MW}$), representing distributed gen.            |
| `C1009` | `isolated-substation`       | `warning` | `Substation` has no transmission lines (`ACLineSegment`) connecting it to the external network.                |
| `C1010` | `unbalanced-profile-data`   | `error`   | `SvVoltage` state variable references a `TopologicalNode` `mRID` not present in the `TP` profile.              |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx cgmes`)

```bash
# Inspect CGMES EQ/SSH/TP/SV profile counts and bus-branch topology
npx msx cgmes inspect grid_EQ.xml grid_SSH.xml grid_TP.xml grid_SV.xml

# Run ENTSO-E CGMES validation rules (C1001-C1010)
npx msx cgmes lint grid_EQ.xml grid_SSH.xml grid_TP.xml grid_SV.xml

# Project CGMES network to PSS/E v33 .raw or Modelica 3.x
npx msx cgmes to-psse grid_EQ.xml grid_SSH.xml grid_TP.xml -o grid.raw
npx msx cgmes to-modelica grid_EQ.xml grid_SSH.xml grid_TP.xml -o GridNetwork.mo
```

### Programmatic API

```typescript
import { cgmesToModelica, cgmesToPsse, lintCgmesModel, parseCgmesFiles, processTopology } from "@modelscript/cgmes";

// 1. Parse and merge EQ, SSH, TP, and SV RDF/XML profiles
const model = parseCgmesFiles([
  { path: "grid_EQ.xml", content: eqXml },
  { path: "grid_SSH.xml", content: sshXml },
  { path: "grid_TP.xml", content: tpXml },
  { path: "grid_SV.xml", content: svXml },
]);

// 2. Run ENTSO-E CGMES validation rules (C1001-C1010) and topology processor
const diagnostics = lintCgmesModel(model);
const topology = processTopology(model);
console.log(`Buses: ${topology.buses.length}, Islands: ${topology.islands.length}`);

// 3. Project to PSS/E v33 .raw deck and Modelica 3.x
const psseRaw = cgmesToPsse(model, { baseMva: 100 });
const modelicaCode = cgmesToModelica(model, { modelName: "EntsoeGrid" });
```

---

## Scripts

| Command             | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                    |
| `npm test`          | Run CGMES RDF/XML parser, topology, linter, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                            |
| `npm run typecheck` | Run `tsc --noEmit` type verification                             |
| `npm run clean`     | Remove `dist/` build artifacts                                   |

---

## License

`AGPL-3.0-or-later`
