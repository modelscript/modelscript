---
title: "SDL-88 (.sdl)"
description: "ITU-T Z.100 communicating Extended Finite State Machines"
---

# SDL-88 (`.sdl`)

**Package:** `@modelscript/sdl` · **Maturity:** `Beta` · **Extensions:** `.sdl`

**Maturity:** Beta · **Extensions:** `.sdl`, `.pr`, `.sdl88` · **Standard:** ITU-T Z.100 (SDL-88, 1976–1988)

Native **SDL-88 (Specification and Description Language — ITU-T Recommendation Z.100)** compiler, Extended Finite State Machine (EFSM) communicating discrete-event simulator, static reachability/deadlock verifier, direct `DAEBuilder` lowering, and Modelica state-machine projection package for ModelScript.

## Core Capabilities

- **WASM GLR Parser & Structured SDL-88 PR Parser**: Native `@modelscript/dsl` WebAssembly GLR parser (`sdlLanguage`) plus structured SDL/PR parser (`parseSdl`) supporting `SYSTEM`/`ENDSYSTEM`, `BLOCK`/`ENDBLOCK`, `PROCESS`/`ENDPROCESS`, `CHANNEL`/`ENDCHANNEL`, `SIGNALROUTE`, `CONNECT`, `SIGNAL`, `DCL`, `TIMER`, `START`, `STATE`/`ENDSTATE`, `INPUT`, `OUTPUT`, `TASK`, `DECISION`/`ENDDECISION`, `NEXTSTATE`, `SET`/`RESET`, `STOP`, and `/* */` comments.
- **Static Verification & Linter (`lintSdl`, `SdlErrorCode`)**: Rules `SDL1001`–`SDL5006` covering syntax errors, duplicate declarations, undefined signals/timers/states, unreachable states, sink/deadlock states, unmatched `NEXTSTATE`, missing `START`, and disconnected channels/signalroutes.
- **Direct DAE Arena Lowering (`lowerSdlToDae`, `sdlToDae`)**: Lowers SDL-88 EFSM states, `DCL` variables, and `TIMER` countdown dynamics directly into `@modelscript/runtime`'s linear-memory `IDaeBuilder`.
- **Communicating EFSM Simulator & Reachability Analyzer (`simulateSdl`, `analyzeSdlReachability`)**: Discrete-event simulation with per-process FIFO input queues, channel/signalroute routing, timer `SET`/`RESET`/expiry scheduling, packet-loss injection for protocol testing, and CFG reachability/deadlock analysis.
- **Modelica State-Machine Projection (`sdlToModelica`)**: Projects SDL-88 systems and processes to Modelica 3.3+ synchronous state machines (`initialState`, `transition`, `activeState`).
- **Cleanroom ITU-T Z.100 Standard Library**: Zero-I/O library bundle (`@modelscript/sdl-std-lib`) covering ITU-T Z.100 predefined sorts (`Boolean`, `Integer`, `Real`, `Duration`, `Time`, `PId`, `Charstring`) and canonical telecom protocol blocks (Alternating-Bit Protocol, Watchdog Timer, Call Setup).
- **Unified Indexing & LSP (`sdlIndexing`, `validateSdl`, `getSdlDocumentSymbols`, `getSdlHover`, `getSdlCompletions`)**: Full IDE diagnostics, outline symbols, hover info, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint SDL-88 models
msx lint model.sdl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/sdl test
```
