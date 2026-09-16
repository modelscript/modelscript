# Software-in-the-Loop (SIL) & Hardware-in-the-Loop (HIL) with ModelScript

This guide documents ModelScript's unified SIL and HIL architecture based on **eFMI-style deterministic code generation**, **WebAssembly**, **FMI Layered Standards (FMI-LS-BUS)**, and **browser-native Soft HIL**.

---

## Architecture Overview

```
                      Modelica Plant Model (.mo)
                                 │
                                 ▼
                 DAEBuilder Linear Memory Arena
                   ├── Fixed-step RK4 solver
                   └── Neural ROM Surrogates (rom-trainer)
                                 │
       ┌─────────────────────────┴─────────────────────────┐
       ▼                                                   ▼
1. BROWSER SOFT HIL                                 2. HARD REAL-TIME HIL
(Chrome / Edge Web APIs)                           (Linux RT-PREEMPT / WAMR)
- AudioWorklet real-time clock                      - SCHED_FIFO Priority 99
- WebSerial (SLCAN / COBS / JSON)                   - mlockall (Zero page faults)
- Dedicated Web Worker sandbox                      - Linux SocketCAN (can0)
- 10 Hz – 200 Hz control loops                      - > 1 kHz, < 50 µs jitter
- Testing: Arduino, STM32, ESP32, USB-CAN           - Testing: Production ECUs, Inverters
```

---

## 1. FMI-LS-BUS (Layered Standard for Network Communication)

ModelScript implements the **Modelica Association FMI-LS-BUS** standard:

- **`FmiLsBusManifest`**: Describes CAN, CAN-FD, LIN, and Ethernet buses and frames.
- **`generateFmiLsBusXml`**: Generates standard `fmi-ls-bus.xml` bundled inside the FMU archive.
- **`FmiLsBusCodec`**: High-performance bit-level encoder and decoder supporting Intel (little-endian) and Motorola (big-endian) bit alignments, linear scaling (`physical = raw * factor + offset`), signed/unsigned integers, and float32 data types.

### Example: Defining CAN Frames in TypeScript

```typescript
import { FmiLsBusFrame, FmiLsBusCodec, generateFmiLsBusXml } from "@modelscript/exchange";

const engineFrame: FmiLsBusFrame = {
  name: "EngineStatus",
  id: 0x120, // CAN ID 288
  length: 8,
  cycleTime: 0.01, // 10 ms (100 Hz)
  signals: [
    {
      name: "engineSpeed",
      valueReference: 1,
      startBit: 0,
      bitLength: 16,
      byteOrder: "littleEndian",
      factor: 0.25, // 1 LSB = 0.25 rpm
      offset: 0,
      unit: "rpm",
    },
    {
      name: "throttlePosition",
      valueReference: 2,
      startBit: 16,
      bitLength: 8,
      byteOrder: "littleEndian",
      factor: 0.392, // 0-100%
      offset: 0,
      unit: "%",
    },
  ],
};
```

---

## 2. In-Browser "Soft HIL" (WebSerial, WebUSB, WebHID)

For desktop and browser-based testing, ModelScript provides the [`WebSerialParticipant`](file:///home/omar/git3/modelscript/packages/exchange/src/cosim/participants/web-hardware.ts):

### Supported Hardware Adapters & Microcontrollers

- **USB-to-CAN Adapters (SLCAN)**: CANable, candleLight, USBtin, Zubax Babel.
- **Microcontrollers (USB-UART / CDC)**: STM32 Nucleo, ESP32, Arduino, Teensy, Raspberry Pi Pico.
- **Framing Protocols**:
  - `slcan`: Standard ASCII CAN protocol (`t12080102030405060708\r`).
  - `cobs`: Consistent Overhead Byte Stuffing for binary frames.
  - `json`: Line-delimited JSON objects (`{"rpm": 3200, "throttle": 45}\n`).

### Using WebSerialParticipant in Co-Simulation

```typescript
import { CoSimOrchestrator, CoSimSession, WebSerialParticipant } from "@modelscript/exchange";

// Create hardware participant
const hwParticipant = new WebSerialParticipant({
  id: "ecu_serial",
  baudRate: 115200,
  protocol: "slcan",
  busFrames: [engineFrame],
});

// Add to co-simulation session
session.addParticipant(hwParticipant);
```

### Unthrottled Browser Pacing via `AudioWorkletClock`

Browsers throttle `setInterval` to 1 Hz when tabs are backgrounded. ModelScript's [`AudioWorkletClock`](file:///home/omar/git3/modelscript/packages/exchange/src/cosim/audio-worklet-clock.ts) leverages the high-priority OS audio thread (44.1 kHz) to drive the simulation loop with sub-millisecond precision, immune to background throttling.

---

## 3. Hard Real-Time HIL on Linux RT-PREEMPT

For hard real-time execution with physical ECUs over CAN:

1. **Compile Model to Standalone C / WASM**:
   ModelScript's C generator produces a static memory model with an embedded zero-allocation `integrate_rk4` solver.
2. **Compile Neural ROM Surrogates to C**:
   Use `exportROMToC(trainedRom)` from `@modelscript/simulate` to generate zero-dependency static C arrays for surrogate evaluation in < 20 µs.
3. **Deploy with Standalone Runner**:
   Use [`hil-runner-template.c`](file:///home/omar/git3/modelscript/packages/exchange/src/fmu/hil-runner-template.c):
   - Compiles with `gcc -O3 hil-runner-template.c model.c -lm -o model_hil`.
   - Runs with `sudo ./model_hil can0` under `SCHED_FIFO` priority 80 with `mlockall`.
