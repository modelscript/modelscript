<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cgmes

European Network of Transmission System Operators for Electricity (ENTSO-E) Common Grid Model Exchange Standard (CGMES v2.4.15 and v3.0 / IEC 61970) package for ModelScript. Features CIM/CGMES RDF/XML profile parsing (`parseCgmesFiles`, `parseCgmesRdf`), node-breaker and bus-branch topology processing (`processTopology`), projection to PSS/E base cases (`cgmesToPsse`), OpenIPSL / Modelica electrical transmission network synthesis (`cgmesToModelica`), and 10 ENTSO-E pre-flight semantic lint rules (`C1001`–`C1010`, `lintCgmesModel`).

---

## Core Capabilities

- **CIM / CGMES RDF/XML Parser (`parseCgmesFiles`, `parseCgmesRdf`)**: Lossless parser extracting standard IEC 61970 CIM profiles:
  - **Equipment Profile (EQ)**: `Substation`, `VoltageLevel`, `BusbarSection`, `TopologicalNode`, `ConnectivityNode`, `Terminal`, `ACLineSegment`, `PowerTransformer`, `PowerTransformerEnd`, `SynchronousMachine`, `EnergyConsumer`, `LinearShuntCompensator`.
  - **Topology Profile (TP)**: Topological node and terminal association.
  - **Steady State Hypothesis (SSH)**: Generator active/reactive setpoints ($P_g, Q_g$) and consumer demand ($P_l, Q_l$).
  - **State Variables (SV)**: Solved nodal voltages ($V_{\text{pu}}, \theta^\circ$) and branch power flows ($P, Q$).
- **Node-Breaker & Bus-Branch Topology Processor (`processTopology`)**: High-performance Union-Find disjoint-set algorithm grouping `ConnectivityNode` components, synthesizing `TopologicalNode` references, and calculating electrical island counts.
- **PSS/E Base Case Projection (`cgmesToPsse`)**: Translates CGMES profiles into canonical `@modelscript/psse` `PsseCase` models with automatic impedance base conversion ($Z_{base} = V_{base}^2 / S_{base}$), generator capability curves, and swing bus selection for immediate AC/DC Optimal Power Flow (OPF) and Holomorphic Embedding Load Flow (HELM) solving.
- **OpenIPSL / Modelica Projection (`cgmesToModelica`)**: Synthesizes standardized OpenIPSL Modelica models (`OpenIPSL.Electrical.Buses.Bus`, `Line`, `TwoWindingTransformer`, `GENSAL`, `Load`) with automated `connect()` equations.
- **10 Pre-Flight Semantic Lint Rules (`C1001`–`C1010`, `lintCgmesModel`)**: Static ENTSO-E verification detecting missing mRIDs, orphan terminals, dangling nodes, invalid voltage levels, transformer end count mismatches, generator limit inversions, zero-impedance branches, and cross-profile discrepancies.

---

## Package Structure

| Path                                    | Description                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                      |
| `src/types.ts`                          | CIM / CGMES profile TypeScript definitions                                  |
| `src/parser/cgmes-rdf-parser.ts`        | `parseCgmesFiles`, `parseCgmesRdf` streaming XML/RDF parser                 |
| `src/topology/topology-processor.ts`    | `processTopology` Union-Find topology processor and island counter          |
| `src/projections/cgmes-to-psse.ts`      | `cgmesToPsse` converter to PSS/E base case format                           |
| `src/projections/cgmes-to-modelica.ts`  | `cgmesToModelica` OpenIPSL transmission model code generator                |
| `src/lints/index.ts`                    | `lintCgmesModel` ENTSO-E verification rules `C1001`–`C1010`                  |

---

## License

AGPL-3.0-or-later
