# SysML v2 & KerML Support

ModelScript supports the OMG **Systems Modeling Language v2 (SysML v2)** and the underlying **Kernel Modeling Language (KerML)** under `languages/sysml2/`.

---

## Core Capabilities

- **WASM GLR Parser**: High-throughput parsing of `.sysml` and `.kerml` files into linear CST nodes.
- **KerML Standard Library**: Pre-indexed snapshots of foundational mathematical, spatial, and unit definitions (`ScalarValues`, `Quantities`, `ISQ`).
- **Structural Definitions**: Full AST queries for `part def`, `item def`, `port def`, and hierarchical usage trees (`part :> ...`).
- **Behavioral Semantics**: State machines (`state`, `transition`), action flows (`action`, `accept`), and calculation blocks.
- **Requirements Engineering**: `requirement def` modeling with satisfaction links (`satisfy`) and verification cases (`verify`).

---

## Example SysML v2 Model

```sysml
package VehicleArchitecture {
  private import ScalarValues::*;
  private import ISQ::*;

  part def BatteryPack {
    attribute capacity : Energy;
    attribute mass : Mass;
    port powerOut : ElectricalPowerPort;
  }

  part def ElectricPowertrain {
    part battery : BatteryPack;
    part inverter : Inverter;
    part motor : TractionMotor;

    connection c1 : PowerConnection
      connect battery.powerOut to inverter.powerIn;
  }

  requirement def MaxSpeedRequirement {
    doc /* Vehicle must achieve 150 km/h top speed under nominal payload. */
    attribute targetSpeed : Speed = 150 [km/h];
  }
}
```

---

## Cross-Domain Verification

SysML v2 requirements are mapped into the Nelson-Oppen Theory Coordinator:

```bash
# Verify SysML v2 requirements against Modelica physical behavior
npx msc verify MaxSpeedRequirement powertrain.sysml --modelica VehicleDynamics.mo
```
