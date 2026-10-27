<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/react

ModelScript React SDK & Engineering UI Widgets (`@modelscript/react`) — drop-in React 18/19 components, host-aware context provider (`ModelScriptProvider`), sandboxed WebWorker execution runner, in-browser C99-to-WebAssembly compiler hook (`useCWasmCompiler`), Simulink pre-flight linter hook (`useSimulinkLinter`), and interactive black-box FMU/binary testbenches.

---

## Architecture & Capabilities

### 1. Host-Aware Context Provider (`src/context.tsx`)

- **`ModelScriptProvider` & `useModelScript()`**: Automatically detects whether the React tree is mounted inside a standard Web browser (`"web"`), a native Tauri v2 desktop window (`"tauri"`), or a VS Code Webview (`"vscode"`), providing unified theme (`"dark" | "light"`), readiness, and runtime version state to child widgets.

### 2. Engineering UI Components (`src/components/`)

| Component               | File                                       | Description                                                                                                                                           |
| :---------------------- | :----------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BlackboxInspector`     | `src/components/BlackboxInspector.tsx`     | Interactive inspector for compiled `.fmu`, `.dll`, `.so`, `.dylib`, and `.wasm` binaries—displaying architectures, GUIDs, and causal variable tables. |
| `StepResponseTestbench` | `src/components/StepResponseTestbench.tsx` | Closed-loop step-response oscilloscope and parameter tuner for testing black-box FMUs and compiled DAE models in real time.                           |
| `LintDiagnosticsTable`  | `src/components/LintDiagnosticsTable.tsx`  | Sortable, filterable compiler & pre-flight diagnostic table with severity badges, error codes (`Mxxxx`), and source line jump links.                  |
| `ModelDropZone`         | `src/components/ModelDropZone.tsx`         | Drag-and-drop file ingestion widget supporting all 44 ModelScript engineering dialects and binary FMU/SSP archives.                                   |
| `WorkerProgressBar`     | `src/components/WorkerProgressBar.tsx`     | Real-time progress indicator for long-running background WebWorker compilation, meshing, and simulation sweeps.                                       |

### 3. WebAssembly Compiler, Linter & Worker Hooks (`src/hooks/`, `src/worker/`)

| Hook / Utility       | File                              | Description                                                                                                                                   |
| :------------------- | :-------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCWasmCompiler`   | `src/hooks/useCWasmCompiler.ts`   | Compiles embedded ISO C99 control code (`.c`/`.h`) directly into executable WebAssembly modules in the browser and exposes step entry points. |
| `useSimulinkLinter`  | `src/hooks/useSimulinkLinter.ts`  | Parses and lints MATLAB Simulink `.slx` / `.mdl` models for algebraic loops, sample-time mismatches, and unconnected ports.                   |
| `useWorkerTask`      | `src/hooks/useWorkerTask.ts`      | React hook managing lifecycle, cancellation, progress events, and error boundaries for background `WorkerRunner` tasks.                       |
| `useWorkspaceBridge` | `src/hooks/useWorkspaceBridge.ts` | Synchronizes React component state with the active VS Code Webview or Tauri desktop workspace filesystem.                                     |
| `WorkerRunner`       | `src/worker/worker-runner.ts`     | Sandboxed WebWorker task dispatcher (`src/worker/worker-protocol.ts`, `src/worker/sandbox-worker-code.ts`) with timeout guards.               |

---

## Usage

```tsx
import React from "react";
import {
  BlackboxInspector,
  LintDiagnosticsTable,
  ModelDropZone,
  ModelScriptProvider,
  StepResponseTestbench,
  useCWasmCompiler,
} from "@modelscript/react";

export function EngineeringDashboard() {
  const { compileC, isCompiling, wasmInstance } = useCWasmCompiler();

  return (
    <ModelScriptProvider theme="dark">
      <ModelDropZone
        onFileLoaded={(file, bytes) => {
          console.log("Loaded model:", file.name, bytes.byteLength);
        }}
      />
      <BlackboxInspector />
      <StepResponseTestbench />
      <LintDiagnosticsTable diagnostics={[]} />
    </ModelScriptProvider>
  );
}
```

---

## Scripts

| Command             | Description                                              |
| :------------------ | :------------------------------------------------------- |
| `npm run build`     | Compile TypeScript and React JSX declarations (`tsc -b`) |
| `npm run test`      | Run `WorkerRunner` and `useCWasmCompiler` test suites    |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`)            |
| `npm run clean`     | Remove `dist/` and `tsconfig.tsbuildinfo`                |
