<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/ocpp`

Open Charge Point Protocol (OCPP 2.0.1 / 1.6J) EV public charging, charge point management, dynamic load balancing, and smart grid demand response package for ModelScript.

## Features

- **OCPP Message & Profile Parsing:** Parses JSON-RPC messages and schema definitions for `SetChargingProfile`, `NotifyChargingLimit`, `MeterValues`, `TransactionEvent`, and station status reports.
- **Smart Charging Load Allocator:** Balances multiple EV charging transactions within transformer physical capacity limits ($P_{\text{grid, max}}$), applying peak shaving, time-of-use tariffs, and vehicle departure deadlines.
- **Zero-GC DAE Lowering:** Lowers charger active power ($P$), reactive power ($Q$), state of charge ($\text{SoC}$), and feeder connection balances directly into `@modelscript/runtime`'s `DAEBuilder` arena.
- **Grid Feeder Coupling:** Integrates with `@modelscript/opendss` and `@modelscript/psse` for transmission/distribution impact analysis and phase unbalance mitigation.
- **Pre-flight Linting:** Validates station power limits, connector IDs, phase sequence allocations, and battery SoC constraints.

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.ocpp` | Declarative EVSE & Smart Charging Schedule | Multi-station charging profile definitions |
| `.ocpp.json` | Standard OCPP JSON-RPC Payload | `SetChargingProfile` & transaction events |
| `.cpo` | Charge Point Operator Station Configuration | Hardware ratings, EVSE limits & grid constraints |

## Quick Example

```ocpp
station "Depot_Station_1" {
  model: "Terra-184"
  vendor: "ABB"
  gridLimitKW: 180.0

  evse 1 {
    connector 1 {
      type: "CCS2"
      maxPowerKW: 90.0
      currentSession: {
        transactionId: "TX-1001"
        evBatteryCapacityKWh: 80.0
        currentSoC: 0.25
        targetSoC: 0.85
        departureMinutes: 45
      }
    }
  }

  evse 2 {
    connector 1 {
      type: "CCS2"
      maxPowerKW: 90.0
      currentSession: {
        transactionId: "TX-1002"
        evBatteryCapacityKWh: 120.0
        currentSoC: 0.40
        targetSoC: 0.90
        departureMinutes: 60
      }
    }
  }
}
```
