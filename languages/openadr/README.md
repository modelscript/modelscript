<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/openadr`

Open Automated Demand Response (OpenADR 2.0b / 3.0) grid flexibility, dynamic pricing, and curtailment dispatch package for ModelScript.

## Features

- **OpenADR 2.0b / 3.0 Event Parsing:** Parses XML payloads (`oadrDistributeEvent`) and JSON REST schemas for demand response programs, event status (`near`, `active`, `completed`), and dynamic price signals.
- **Interval Schedule Evaluation:** Evaluates time-stamped curtailment intervals, computing active setpoints ($P_{\text{target}}$) and load-reduction deltas ($\Delta P$).
- **Direct Linear DAE Lowering:** Lowers dynamic utility pricing multipliers and curtailment constraints directly into `@modelscript/runtime`'s `DAEBuilder` arena.
- **Cross-Domain Coupling:** Coordinates demand response events with building thermal storage in `@modelscript/energyplus` and EV fleet charging in `@modelscript/ocpp`.
- **Pre-flight Linting:** Checks for interval time gaps, negative durations, missing event targets, and invalid signal multipliers.

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.oadr` | Declarative OpenADR Demand Response Program | Program rules & scheduled event intervals |
| `.oadr.xml` | Standard OpenADR 2.0b XML Payload | `oadrDistributeEvent` message structure |
| `.oadr.json` | OpenADR 3.0 REST API JSON Event Deck | Modern JSON-based event and price signals |

## Quick Example

```oadr
program "Summer_Peak_Flex_2026" {
  programId: "DR-PROG-101"
  event "EV_Depot_Curtailment_01" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "VEN-FLEET-DEPOT-1"

    interval {
      start: "2026-07-15T14:00:00Z"
      durationSeconds: 7200
      payload: 100.0  // Limit fleet depot to 100 kW
    }

    interval {
      start: "2026-07-15T16:00:00Z"
      durationSeconds: 3600
      payload: 50.0   // Extreme peak: curtail to 50 kW
    }
  }
}
```
