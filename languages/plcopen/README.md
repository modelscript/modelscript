# @modelscript/plcopen

IEC 61131-3 PLCopen XML and Structured Text (ST) industrial automation and digital twin language package for ModelScript.

## Capabilities

- **Zero-Regex Ingestion:** Dual-mode parser supporting PLCopen TC6 XML (`.xml`, `.plcopen`) and IEC 61131-3 Structured Text (`.st`).
- **OpenModelica-Style Pre-Flight Linters:** Diagnostic codes `M7701`–`M7720` checking unassigned variable reads, hardware address collisions, cyclic task overruns, recursive calls, and timer bounds.
- **Multi-File Workspace Index:** `PlcopenWorkspaceIndex` implementing `IWorkspaceIndex` for multi-file cross-referencing.
- **Virtual PLC Cycle Engine:** Deterministic scan-cycle execution simulator implementing standard IEC 61131-3 timer blocks (`TON`, `TOF`, `TP`) and counters (`CTU`, `CTD`).
- **Direct DAE Arena Lowering:** Direct emission into ModelScript's linear-memory `DAEBuilder` struct-of-arrays arena.
- **Polyglot Projections:** Bidirectional translation to Modelica 3.x blocks and SysML v2 `action def`.
- **LSP & CLI Services:** Real-time diagnostics, document symbols, hover definitions, and `msx plcopen` commands.

## Diagnostic Codes

| Code    | Rule                       | Severity  | Description                                                       |
| :------ | :------------------------- | :-------- | :---------------------------------------------------------------- |
| `M7701` | `unassigned-variable-read` | `error`   | Local variable read before assignment or initialization.          |
| `M7702` | `cyclic-task-overrun`      | `warning` | Computational complexity in task may exceed periodic cycle time.  |
| `M7703` | `recursive-pou-call`       | `error`   | Recursive invocation of POU detected (prohibited in IEC 61131-3). |
| `M7704` | `io-mapping-collision`     | `error`   | Hardware I/O address collision at `%Q*`.                          |
| `M7705` | `type-mismatch-assignment` | `error`   | Type mismatch in assignment without explicit conversion.          |
| `M7706` | `timer-preset-negative`    | `error`   | Timer preset time `PT` cannot be negative.                        |
| `M7707` | `unbounded-loop-detected`  | `warning` | Loop without deterministic termination condition.                 |
| `M7708` | `unknown-pou-type`         | `error`   | Unknown or unresolvable POU or function block type instantiated.  |
| `M7709` | `unreachable-code`         | `warning` | Unreachable code after `RETURN` or `EXIT`.                        |
| `M7710` | `invalid-task-interval`    | `error`   | Task specifies invalid or non-positive periodic interval.         |
