<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/desktop

ModelScript Native Desktop Studio (`@modelscript/desktop`) powered by **Tauri v2** — delivering a 100% air-gapped, cross-platform desktop engineering environment (Linux AppImage/Deb, macOS DMG, Windows MSI/NSIS) with native OS filesystem and dialog integration, direct FFI dynamic binary execution (`NativeFmuRunner`), universal black-box FMU/DLL/SO/DYLIB introspection, and strict **NERC CIP** & **FERC CEII** compliance controls.

---

## Architecture & Capabilities

### 1. Native Desktop File I/O & Dialog Bridge (`src/index.ts`)

- **Seamless Tauri v2 & Node.js Fallback**:
  - `isTauriEnvironment()`: Detects native Tauri desktop runtime (`window.__TAURI__`).
  - `readModelFile(filePath)` & `writeModelFile(filePath, content)`: Reads and writes local engineering text files (`.mo`, `.raw`, `.dyr`, `.pscx`, `.sysml`, `.json`, `.csv`) via `@tauri-apps/plugin-fs` with automatic Node.js `node:fs/promises` fallback for headless tests and CLI execution.
  - `readModelBinaryFile(filePath)` & `writeModelBinaryFile(filePath, data)`: Zero-copy binary file I/O for `.fmu`, `.dll`, `.so`, and `.dylib` artifacts.
  - `openModelFileDialog(options)` & `saveModelFileDialog(options)`: Native OS file pickers via `@tauri-apps/plugin-dialog`.

### 2. `NativeFmuRunner` & Black-Box Binary Execution (`src/native-runner.ts`, `src/index.ts`)

- **Automatic Architecture Matching (`canExecuteNatively`)**: Introspects binary headers (`introspectBlackboxBinary` from `@modelscript/exchange`) across `x86_64` and `aarch64` targets on Linux, Windows, and macOS to determine whether a binary can execute natively on the host CPU or via sandboxed emulation (`UniversalBinaryRunner`).
- **High-Throughput Native FFI Execution (`NativeFmuRunner`)**:
  - Dispatches directly to the host OS dynamic linker when `preferNative: true` and host architecture matches.
  - `step(currentTime, dt, inputs)` & `stepBatch(options)`: Executes high-speed batch time-stepping (`Float64Array` contiguous trajectory buffers with configurable sample decimation) at up to ~10,000,000 steps/sec.
- **End-to-End Desktop Simulation (`loadDesktopBlackboxModel`, `runDesktopBlackboxSimulation`, `exportSimulationCsv`)**: Loads black-box FMU or shared-library models from disk, steps across a time horizon with live progress callbacks (`onStepProgress`), and exports trajectories directly to CSV.

### 3. Air-Gapped NERC CIP & FERC CEII Compliance (`checkAirgapCompliance`)

- **Strict Zero-Egress Controls**:
  - `getDesktopSystemInfo()` & `checkAirgapCompliance()`: Certifies that outbound telemetry is disabled, all compilation and simulation execute 100% locally in WebAssembly/native memory, and Critical Energy Infrastructure Information (**FERC CEII**, 18 CFR § 388.113) and **NERC CIP-005 / CIP-007** boundary requirements are satisfied.

---

## Package Structure

| File                                        | Responsibility                                                                                                       |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                              | Desktop filesystem/dialog bridge, `loadDesktopBlackboxModel`, `runDesktopBlackboxSimulation`, and air-gap compliance |
| `src/native-runner.ts`                      | `NativeFmuRunner` high-speed native dynamic runner and `stepBatch` contiguous `Float64Array` trajectory engine       |
| `src/tauri-plugins.d.ts`                    | TypeScript ambient declarations for `@tauri-apps/*` plugins                                                          |
| `src-tauri/tauri.conf.json`                 | Tauri v2 application window, security CSP, capability, and multi-platform bundle configuration                       |
| `src-tauri/src/main.rs` & `lib.rs`          | Minimal Tauri v2 native window bootstrapper mounting `@tauri-apps/plugin-{fs,dialog,os,process,shell,clipboard}`     |
| `tests/tauri-config.test.ts`                | Verification suite for Tauri v2 configuration, security policies, and plugin capabilities                            |
| `tests/desktop-blackbox-simulation.test.ts` | End-to-end tests for native vs. emulated black-box binary loading, batch simulation, and CSV export                  |

---

## Programmatic Usage

```typescript
import {
  checkAirgapCompliance,
  exportSimulationCsv,
  getDesktopSystemInfo,
  runDesktopBlackboxSimulation,
} from "@modelscript/desktop";

// 1. Verify air-gapped NERC CIP / FERC CEII compliance
const info = await getDesktopSystemInfo();
const airgap = checkAirgapCompliance();
console.log(`Platform: ${info.platform} (${info.arch}), Air-Gap Compliant: ${airgap.compliant}`);

// 2. Run a local black-box FMU or shared library simulation
const result = await runDesktopBlackboxSimulation("./GovernorController.fmu", {
  startTime: 0.0,
  stopTime: 5.0,
  stepSize: 0.001,
  preferNative: true,
  inputs: (t) => ({ freq_ref: t >= 1.0 ? 60.05 : 60.0 }),
});

// 3. Export trajectory to disk
await exportSimulationCsv("./GovernorTrajectory.csv", result.trajectory);
```

---

## Scripts

| Command                  | Description                                                    |
| :----------------------- | :------------------------------------------------------------- |
| `npm run build`          | Compile TypeScript bridge to `dist/`                           |
| `npm run dev`            | Launch Tauri v2 desktop development window (`tauri dev`)       |
| `npm run build:tauri`    | Build native desktop bundles for the host OS                   |
| `npm run build:appimage` | Package Linux `.AppImage` bundle                               |
| `npm run build:deb`      | Package Debian/Ubuntu `.deb` installer                         |
| `npm run build:dmg`      | Package macOS `.dmg` disk image                                |
| `npm run build:msi`      | Package Windows `.msi` installer                               |
| `npm run build:portable` | Package Windows portable NSIS `.exe` bundle                    |
| `npm run test`           | Run Tauri configuration and black-box desktop simulation tests |
| `npm run typecheck`      | Run TypeScript type checking (`tsc --noEmit`)                  |
| `npm run lint`           | Run ESLint across `src/` and `tests/`                          |
