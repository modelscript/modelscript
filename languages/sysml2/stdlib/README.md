# OMG SysML v2 & KerML Standard Library (`SysML@2026.3.0`)

The normative **OMG Systems Modeling Language v2 (SysML v2)** and **Kernel Modeling Language (KerML)** standard library for ModelScript. Packaged in dual **NPM** (`package.json`) and **OMG `.kpar`** (`.meta.json` / `.Index.json`) formats.

## Architecture & Normative Packages

### 1. Kernel Semantic Library (`KerML.sysml`)

- **`Base`** — Root classifier `Anything`, `Object`, `DataValue`, and structural `things` hierarchy.
- **`ScalarValues`** — Primitive value types (`Boolean`, `String`, `Real`, `Rational`, `Integer`, `Natural`, `Positive`, `Complex`, `Number`, `ScalarValue`).
- **`Links` & `Occurrences`** — Binary links (`Link`, `BinaryLink`), space-time `Occurrence` lifelines, and `happensBefore` / `during` temporal ordering.
- **`Performances` & `Functions`** — Behavioral `Performance`, `Evaluation`, `BooleanEvaluation`, and mathematical `Function` / `Predicate` foundations.
- **`ScalarFunctions`, `RealFunctions`, `TrigFunctions`, `NumericalFunctions`** — Standard arithmetic, algebraic, and trigonometric operators (`sin`, `cos`, `tan`, `sqrt`, `exp`, `ln`, `sum`, `product`).
- **`Collections`** — Ordered, unique, and multi-dimensional containers (`Collection`, `OrderedCollection`, `UniqueCollection`, `Bag`, `Set`, `OrderedSet`, `List`, `Array`).
- **`Quantities`, `MeasurementReferences`, `ISQ`, `SI`** — ISO/IEC 80000 International System of Quantities (`LengthValue`, `MassValue`, `TimeValue`, `ElectricCurrentValue`, `ThermodynamicTemperatureValue`, `ForceValue`, `EnergyValue`, `PowerValue`, `PressureValue`, `VoltageValue`, etc.) and SI unit definitions (`m`, `kg`, `s`, `A`, `K`, `mol`, `cd`, `N`, `Pa`, `J`, `W`, `C`, `V`, `F`, `Ohm`, `Hz`, `rad`).

### 2. Systems Modeling Library (`SysML.sysml`)

- **`SysML`** — Root umbrella package re-exporting all normative KerML, ISQ/SI, and Systems Domain packages.
- **`Items` & `Parts`** — Physical/information `Item`, `PhysicalItem`, `Signal`, modular `Part`, `System`, `Subsystem`, and `Component`.
- **`Ports`, `Connections`, `Interfaces`, `Allocations`** — Structural interaction points (`Port`, `FlowPort`, `PowerPort`, `DataPort`), links (`Connection`, `FlowConnection`), `Interface`, `BusInterface`, and `Allocation`.
- **`Actions` & `States`** — Behavioral transformations (`Action`, `SendAction`, `AcceptAction`, `AssignAction`) and hierarchical state machines (`StateAction`, `TransitionAction`).
- **`Constraints` & `Requirements`** — Parametric constraints (`ConstraintCheck`, `ConservationConstraint`) and traceable engineering requirements (`RequirementCheck`, `FunctionalRequirement`, `PerformanceRequirement`, `SafetyRequirement`).
- **`Calculations`, `AnalysisCases`, `VerificationCases`, `UseCases`** — Side-effect-free `Calculation`, `AnalysisCase`, `TradeStudy`, `VerificationCase` (`VerdictKind`), and operational `UseCase`.
- **`Views` & `Metadata`** — Stakeholder `View`, `Viewpoint`, and semantic `@MetadataItem` / `@RiskMetadata` annotations.

## Usage

```sysml
package SpacecraftPowerAnalysis {
    import SysML::*;
    import ISQ::*;
    import SI::*;

    part def SolarArray :> Part {
        attribute area : AreaValue = 12.5 [m^2];
        port powerOut : PowerPort;
    }

    requirement def MinBusVoltage :> PerformanceRequirement {
        doc /* Primary spacecraft bus voltage shall remain above 28.0 V. */
        attribute thresholdValue = 28.0;
        attribute unitSymbol = "V";
    }
}
```
