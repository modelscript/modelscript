# CSV Telemetry & Tabular Data

ModelScript provides high-throughput tabular parsing and telemetry validation under `languages/csv/`.

---

## Core Capabilities

- **High-Throughput SIMD / WASM Parser**: Streams megabyte-scale telemetry files into linear memory buffers with zero intermediate string allocation.
- **Typed Column Inference**: Automatically detects IEEE 754 floating-point, integer, boolean, timestamp, and string column schemas.
- **Trajectory Interpolation**: Binds continuous Modelica simulation time ($t$) to discrete sampled measurement tables using cubic spline or linear interpolation.
- **Parameter Calibration Datasets**: Supplies reference trajectories to non-linear least-squares optimization loops for model parameter tuning.

---

## Example Usage in Modelica

Tabular CSV data can be referenced directly in Modelica simulations:

```modelica
model SensorValidation
  Modelica.Blocks.Sources.CombiTimeTable testBenchData(
    tableOnFile = true,
    tableName = "tab1",
    fileName = "testbench_run_042.csv"
  );
  Real measuredRPM;
  Real simulatedRPM;
equation
  measuredRPM = testBenchData.y[1];
  // Calibration error formulation
  error = simulatedRPM - measuredRPM;
end SensorValidation;
```
