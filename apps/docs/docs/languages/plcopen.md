# PLCopen XML & IEC 61131-3 Industrial Automation (`.xml`, `.st`)

`@modelscript/plcopen` (`languages/plcopen`) provides compiler, Virtual PLC cyclic execution, sampled-data DAE lowering, and formal verification for **IEC 61131-3** industrial control software and **PLCopen XML** interchange models.

---

## Supported Extensions & Standards

| Extension          | Standard / Format               | Description                                                                    |
| :----------------- | :------------------------------ | :----------------------------------------------------------------------------- |
| `.xml`, `.plcopen` | **PLCopen XML v2.01 / v2.0**    | XML exchange format for IEC 61131-3 control programs, POUs, and configurations |
| `.st`              | **IEC 61131-3 Structured Text** | Textual structured control language for PLCs and industrial controllers        |

---

## Key Capabilities

### 1. IEC 61131-3 Program Organization Units (POUs)

- Full support for standard control logic paradigms:
  - **Structured Text (ST)**: Variable declarations, conditionals (`IF-THEN-ELSE`), case selection, loops (`FOR`, `WHILE`), and mathematical expressions.
  - **Function Blocks (FB)**: State-retaining functional blocks including standard timers (`TON`, `TOF`, `TP`), counters (`CTU`, `CTD`, `CTUD`), and bistable multivibrators (`SR`, `RS`).
  - **Functions (FUN)**: Pure stateless mathematical computations.

### 2. High-Speed Deterministic Virtual PLC Engine

- Features a cycle-accurate Virtual PLC execution runtime (`VirtualPlc`):
  - **Sampled Scan Cycle**: Deterministic three-phase execution: input latching $\to$ logic evaluation $\to$ output write.
  - **Configurable Scan Period**: Executes discrete scan rates (e.g., $1\,\text{ms}$, $10\,\text{ms}$, $50\,\text{ms}$) coupled seamlessly with continuous physical models.

### 3. Direct Sampled-Data DAE Lowering

- Compiles discrete state variables, zero-order holds (ZOH), and timer registers into `@modelscript/runtime`'s `DAEBuilder` arena.
- Enables closed-loop hardware-in-the-loop (HIL) simulation of PLC control algorithms coupled with continuous Modelica physics (e.g., thermal plants, robotic actuators, motor drives).

### 4. Polyglot Projections

- **Modelica (`plcopenToModelica`)**: Lowers PLC function blocks into standard synchronous Modelica clocked state machines.
- **SysML v2 (`plcopenToSysML`)**: Maps IEC 61131-3 control architectures to SysML v2 `action def` successions and state machines.

---

## Static Analysis & Safety Linter Rules

The PLCopen analyzer detects industrial software defects before deployment to hardware:

| Rule Identifier         | Severity  | Condition Checked                                                                                    |
| :---------------------- | :-------- | :--------------------------------------------------------------------------------------------------- |
| `unbound-io-variable`   | `error`   | Controller logic accesses an I/O mapped variable that lacks hardware terminal assignment.            |
| `infinite-loop-hazard`  | `error`   | `WHILE` or `REPEAT` loop condition lacks deterministic termination bounds, risking watchdog timeout. |
| `cyclic-fb-recursion`   | `error`   | Direct or indirect recursive function block instance call detected (disallowed in IEC 61131-3).      |
| `negative-timer-preset` | `warning` | Timer preset duration $PT < 0$ or unassigned in a timer function block call.                         |

---

## CLI Usage

```bash
# Lint an IEC 61131-3 PLCopen XML project
msx plcopen lint AutomationController.xml

# Run 50 discrete scan cycles (dt = 10ms) through the Virtual PLC engine
msx plcopen run-scan AutomationController.xml --cycles 50 --dt-ms 10

# Lower control logic to DAE arena for closed-loop physics co-simulation
msx plcopen to-dae AutomationController.xml --out=controller.dae.json

# Project into Modelica synchronous clocked state machine components
msx plcopen to-modelica AutomationController.xml -o ControllerBlocks.mo
```
