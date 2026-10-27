# SysML v2 & KerML (`.sysml`, `.sysml2`, `.kerml`)

`@modelscript/sysml2` (`languages/sysml2`) implements the OMG **Systems Modeling Language v2 (SysML v2)** and **Kernel Modeling Language (KerML)** textual notation, pairing a bundled KerML/SysML v2 standard library snapshot with a suite of formal verification, safety analysis, direct DAE compilation, and enterprise synchronization engines.

---

## Supported Extensions

| Extension           | Description                                                                            |
| :------------------ | :------------------------------------------------------------------------------------- |
| `.sysml`, `.sysml2` | OMG SysML v2 textual architecture, requirement, state, action, and verification models |
| `.kerml`            | OMG Kernel Modeling Language (KerML) metamodel & library definitions                   |

---

## Supported SysML v2 Constructs

- **Structural Modeling**: `package`, `part def`, `part`, `attribute def`, `attribute`, `item def`, `item`, `port def`, `port`, `connection def`, `connection`, `interface def`, `interface`, `flow`, `allocation def`, `allocate`
- **Behavioral & State Modeling**: `action def`, `action`, `state def`, `state`, `transition`, `First` / `then` succession flows, `fork`, `join`, `decide`, `merge`, ` calc def`, `calc`
- **Requirements & Verification**: `requirement def`, `requirement`, `satisfy`, `verify`, `verification def`, `concern`, `stakeholder`, `view`, `viewpoint`, `constraint def`, `constraint`, `assume`, `require`

---

## Formal Verification & Safety Analysis Engines

`@modelscript/sysml2` includes seven specialized formal verification modules in `languages/sysml2/src/`:

1. **Activity Control-Flow & Petri-Net Soundness (`activity-cfa.ts`, `activity-soundness.ts`, `activity-verifier.ts`)**:
   - Lowers SysML v2 `action def` successions (`first A then B`), `fork`/`join`, and `decide`/`merge` nodes into Workflow Nets (1-safe Petri nets).
   - Verifies **Option to Complete**, **Proper Completion**, **No Dead Transitions**, **Lack of Synchronization** (parallel branches converging into a `merge` instead of a `join`), and **Deadlock at Join** (exclusive `decide` branches converging into a `join`).
2. **Decision Table Completeness & Disjointness (`decision-table-verifier.ts`)**:
   - Analyzes guarded `decide` branches and requirement tables via interval covering and SMT/constraint checking to detect **Missing Cases** (uncovered input domain gaps) and **Overlapping Rules** (non-deterministic guard collisions).
   - Exposed via CLI: `npx msx verify-decisions architecture.sysml`.
3. **Assume-Guarantee Contract Verification (`contract-verifier.ts`, `multidomain-contract-bridge.ts`)**:
   - Extracts `assume constraint { ... }` and `require constraint { ... }` blocks from `requirement def` and `part def` hierarchies.
   - Verifies **Contract Compatibility** ($\bigwedge A_{\text{env}} \neq \bot$) and **Refinement Soundness** across composite sub-parts ($A_{\text{parent}} \Rightarrow A_{\text{child}}$ and $\bigwedge G_{\text{children}} \Rightarrow G_{\text{parent}}$), bridging directly into the Multi-Domain Theory Coordinator.
4. **Hierarchical State Machine Verifier (`state-machine-verifier.ts`)**:
   - Checks `state def` machines for **Unreachable States**, **Deadlock / Trap States** (non-final states with no outgoing transitions), **Non-Deterministic Transitions** (overlapping guards on the same trigger event), and **Missing Initial States**.
5. **Hybrid Automaton Flowpipe Bridge (`hybrid-flowpipe-bridge.ts`)**:
   - Couples discrete SysML v2 `state def` mode transitions with continuous Modelica DAE dynamics to compute Taylor-model / interval reachability flowpipes and verify that unsafe states are unreachable over time horizon $[0, T]$.
6. **Fault Tree & Physics-Informed Safety Analyzer (`safety-analyzer.ts`, `physics-safety-bridge.ts`)**:
   - Synthesizes Fault Trees from SysML v2 failure modes and interconnections, computes **Minimal Cut Sets (MCS)** via MOCUS/top-down boolean reduction, evaluates top-event failure probabilities, and cross-checks physical failure thresholds against simulated Modelica/FEA/CFD peak stresses and temperatures.
7. **Boundary-Value & MC/DC Test Vector Synthesizer (`boundary-test-synthesizer.ts`)**:
   - Automatically generates boundary-value ($x = c - \epsilon, c, c + \epsilon$) and Modified Condition/Decision Coverage (**MC/DC**) test vectors for every `requirement def` and `calc def` constraint.
   - Exposed via CLI: `npx msx generate-tests architecture.sysml`.

---

## Direct SysML v2 $\rightarrow$ DAE Lowering & Enterprise Interchange

- **Direct Arena DAE Lowering (`sysml2-dae-lowerer.ts`)**: Compiles SysML v2 `calc def`, `constraint def`, `attribute` bindings, and `flow` connections directly into `@modelscript/runtime`'s `DAEBuilder` without requiring an intermediate Modelica code-generation pass.
- **`.sysmlx` JSON-LD & Container Export (`sysmlx-interchange.ts`, `sysml2-container-exporter.ts`)**: Serializes and imports OMG SysML v2 REST/JSON-LD payloads (`.sysmlx`) and multi-artifact engineering containers.
- **Enterprise MBSE Gateway (`enterprise-sync-gateway.ts`)**: Synchronizes SysML v2 packages, elements, and cross-domain traceability links with **Dassault Cameo Teamwork Cloud (TWC)**, **OpenMBEE MMS**, and standard **OMG SysML v2 REST API** repositories (`npx msx sysml sync`).

---

## Polyglot TGG Rules (22 Cross-Domain Mappings)

`@modelscript/sysml2` defines 22 bidirectional Triple Graph Grammar (TGG) rules in `languages/sysml2/src/language.ts` spanning **Modelica** (14 rules), **OWL2** (5 rules), and **STEP** (3 rules):

| Target Language           | Rule Names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`modelica` (14 rules)** | `SysML2PartDefToModelicaModel`, `SysML2AttributeDefToModelicaType`, `SysML2PortDefToModelicaConnector`, `SysML2ConnectionDefToModelicaModel`, `SysML2ActionDefToModelicaBlock`, `SysML2ConstraintDefToModelicaBlock`, `SysML2RequirementDefToModelicaBlock`, `SysML2PartToModelicaComponent`, `SysML2AttributeToModelicaParameter`, `SysML2PortToModelicaConnector`, `SysML2ConnectionToModelicaConnect`, `SysML2FlowToModelicaConnect`, `SysML2StateToModelicaBlock`, `SysML2TransitionToModelicaWhen` |
| **`owl2` (5 rules)**      | `SysML2PartDefToOWL2Class`, `SysML2AttributeUsageToOWL2DataProperty`, `SysML2PortUsageToOWL2ObjectProperty`, `SysML2PartUsageToOWL2Individual`, `SysML2RequirementToOWL2Class`                                                                                                                                                                                                                                                                                                                          |
| **`step` (3 rules)**      | `SysML2PartDefToStepProduct`, `SysML2PartUsageToStepAssemblyUsage`, `SysML2AttributeToStepProperty`                                                                                                                                                                                                                                                                                                                                                                                                     |

## Diagnostic Rules

<LintRules lang="sysml2" />
