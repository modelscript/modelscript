# SysML v2 + AssemblyScript WASM Reference Pack

A self-contained engineering package combining:

- `src/plant.mo` — Modelica first-order/second-order step-response plant
- `src/system.sysml` — SysML v2 `verification def` with `require constraint` and `wasm://` kernel binding
- `assembly/analyzer.ts` — AssemblyScript analysis kernel compiled in-browser via `@modelscript/sdk`

Open `src/system.sysml` in VS Code and click **`▶ Run & Visualize (StepResponseCheck)`** or run it from the **Testing** sidebar.
