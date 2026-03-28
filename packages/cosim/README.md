# @modelscript/cosim

MQTT-linked co-simulation engine for the ModelScript ecosystem. Enables real-time co-simulation of Modelica models and FMUs orchestrated via an ISA-95 Unified Namespace (UNS).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Orchestrator                         │
│              (Gauss-Seidel Master Algorithm)              │
│                                                           │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐ │
│  │  JS-Sim │   │ FMU-JS  │   │FMU-Natv │   │External │ │
│  │Particip.│   │Particip.│   │Particip.│   │Particip.│ │
│  └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘ │
│       │             │             │              │       │
│       └─────────────┴──────┬──────┴──────────────┘       │
│                            │                             │
└────────────────────────────┼─────────────────────────────┘
                             │ MQTT (UNS)
                 ┌───────────┼───────────┐
                 │     Eclipse Mosquitto  │
                 │    :1883 (MQTT)        │
                 │    :9001 (WebSocket)   │
                 └───────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────┴────┐  ┌─────┴────┐  ┌──────┴─────┐
        │  Morsel   │  │  VS Code │  │ Historian   │
        │ (Browser) │  │   IDE    │  │(TimescaleDB)│
        └──────────┘  └──────────┘  └────────────┘
```

## Unified Namespace (UNS)

All MQTT topics follow an ISA-95 hierarchy:

```
modelscript/site/{siteId}/area/{areaId}/line/{sessionId}/cell/{participantId}/...
```

### Topic Map

| Topic Suffix                            | QoS | Retained | Description                         |
| --------------------------------------- | --- | -------- | ----------------------------------- |
| `/participants/{id}/meta`               | 1   | ✓        | Birth/death certificate             |
| `/line/{session}/control`               | 1   | ✗        | Orchestrator → participant commands |
| `/line/{session}/status`                | 0   | ✗        | Participant → orchestrator status   |
| `/line/{session}/results`               | 0   | ✗        | Aggregated step results             |
| `/line/{session}/cell/{id}/data/{var}`  | 0   | ✗        | Individual variable telemetry       |
| `/line/{session}/cell/{id}/data/_batch` | 0   | ✗        | Batched variable telemetry          |

## Module Structure

```
src/
├── mqtt/
│   ├── topics.ts          # ISA-95 UNS topic builders and parsers
│   ├── protocol.ts        # Message schemas (metadata, control, status, results)
│   └── client.ts          # Typed MQTT client with LWT and discovery
├── participant.ts         # CoSimParticipant interface (FMI-2.0-style)
├── coupling.ts            # Variable coupling graph (output → input)
├── realtime.ts            # Wall-clock pacer with speedup factor
├── session.ts             # Session lifecycle + state machine + registry
├── orchestrator.ts        # Gauss-Seidel master algorithm
├── participants/
│   ├── js-simulator.ts    # JS-native participant (wraps ModelicaSimulator)
│   ├── fmu-js.ts          # FMU-JS participant (placeholder, Phase 4)
│   └── fmu-native.ts      # FMU-native participant (placeholder, Phase 4)
├── historian/
│   └── recorder.ts        # MQTT → TimescaleDB recorder + query service
└── index.ts               # Public API exports
```

## Participant Types

| Type           | Runtime    | Status         | Description                                   |
| -------------- | ---------- | -------------- | --------------------------------------------- |
| `js-simulator` | In-process | ✅ Implemented | Wraps `@modelscript/core` ModelicaSimulator   |
| `fmu-js`       | In-process | 🔲 Phase 4     | Loads FMU `model.json` + JS simulator         |
| `fmu-native`   | Subprocess | 🔲 Phase 4     | dlopen() FMU shared library via C harness     |
| `external`     | MQTT       | 🔲 Phase 5     | External device/simulator publishing via MQTT |

## Usage

### Creating a Co-Simulation Session

```typescript
import {
  CosimMqttClient,
  CoSimSession,
  Orchestrator,
  JsSimulatorParticipant,
  createUnsContext,
} from "@modelscript/cosim";

// 1. Connect to MQTT broker
const unsContext = createUnsContext("lab", "project-a");
const mqttClient = new CosimMqttClient({
  brokerUrl: "mqtt://localhost:1883",
  unsContext,
});
await mqttClient.connect();

// 2. Create a session
const session = new CoSimSession(
  "sim-001",
  {
    startTime: 0,
    stopTime: 10,
    stepSize: 0.01,
  },
  1.0,
); // 1.0 = real-time factor

// 3. Add participants
const participant = new JsSimulatorParticipant({
  id: "bouncingBall",
  dae: flattenedDAE, // from @modelscript/core flattener
});
session.addParticipant(participant);

// 4. Configure couplings (for multi-participant scenarios)
session.addCoupling({
  from: { participantId: "plant", variableName: "y" },
  to: { participantId: "controller", variableName: "u" },
});

// 5. Run the orchestrator
const orchestrator = new Orchestrator(session, mqttClient, {
  onStep: (result) => console.log(`t=${result.time}`),
  onComplete: () => console.log("Done!"),
  onError: (err) => console.error(err),
});

await orchestrator.run();
```

### Participant Discovery

```typescript
// Subscribe to participant birth/death certificates
await mqttClient.subscribeParticipants();

mqttClient.onParticipant((id, meta) => {
  if (meta) {
    console.log(`Participant online: ${meta.modelName} (${meta.type})`);
    console.log(`  Variables: ${meta.variables.length}`);
  } else {
    console.log(`Participant offline: ${id}`);
  }
});
```

### Historian Queries

```typescript
import { HistorianQuery } from "@modelscript/cosim";
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgresql://localhost:5432/modelscript" });
const historian = new HistorianQuery(pool);

// Raw telemetry
const raw = await historian.queryRaw("bouncingBall", "h", new Date("2024-01-01"), new Date("2024-01-02"));

// Downsampled (1-second buckets)
const downsampled = await historian.queryAggregated(
  "bouncingBall",
  "h",
  new Date("2024-01-01"),
  new Date("2024-01-02"),
  1,
  "avg",
);
```

## Infrastructure

### Docker Services

The co-simulation engine requires two additional Docker services (added to the root `docker-compose.yml`):

| Service       | Image             | Ports      | Purpose                        |
| ------------- | ----------------- | ---------- | ------------------------------ |
| `mqtt`        | Eclipse Mosquitto | 1883, 9001 | MQTT broker (TCP + WebSocket)  |
| `timescaledb` | TimescaleDB       | 5432       | Time-series historian database |

### Environment Variables

| Variable          | Default                                                           | Description                |
| ----------------- | ----------------------------------------------------------------- | -------------------------- |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883`                                           | MQTT broker connection URL |
| `TIMESCALEDB_URL` | `postgresql://modelscript:modelscript@localhost:5432/modelscript` | Database connection string |
| `COSIM_UNS_SITE`  | `default`                                                         | UNS site identifier        |
| `COSIM_UNS_AREA`  | `default`                                                         | UNS area identifier        |

## Development

```bash
# Build
npm run build --workspace=@modelscript/cosim

# Lint
npm run lint --workspace=@modelscript/cosim

# Watch mode
npm run watch --workspace=@modelscript/cosim
```

## Roadmap

- **Phase 2**: TimescaleDB schema migrations, historian replay mode
- **Phase 3**: MQTT participant tree widget in Morsel and VS Code IDE
- **Phase 4**: FMU upload API, FMU-JS and FMU-native participant runners
- **Phase 5**: Real-time MQTT data sources in Morsel simulation loop
- **Phase 6**: Error recovery, session cleanup, production hardening

## License

AGPL-3.0-or-later
