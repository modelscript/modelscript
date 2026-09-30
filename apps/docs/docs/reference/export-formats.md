# Standards & Export Formats

ModelScript bridges modern engineering workflows with extensive export and auditing formats, ensuring compatibility with standard enterprise tools, regulatory bodies, and CI/CD pipelines.

---

## 1. Functional Mock-up Interface (FMI 2.0 & 3.0)

ModelScript provides full-featured import and export for the **Functional Mock-up Interface (FMI)** standard via `@modelscript/exchange`:

```bash
# Export as FMI 3.0 Co-Simulation FMU
npx msc fmu export DC_Motor motor.mo --version 3.0 --type cs --output DC_Motor.fmu
```

### Supported FMI Profiles

- **FMI 2.0 / 3.0 Model Exchange (ME)**: Standalone C or WebAssembly DAE evaluation functions; numerical integration is handled by the importing master environment.
- **FMI 2.0 / 3.0 Co-Simulation (CS)**: Bundles the SUNDIALS CVODE/IDA solver directly within the FMU container, advancing internal time steps autonomously.
- **FMI 3.0 Scheduled Execution (SE)**: Supports deterministic, clock-triggered discrete step execution for real-time controllers.

---

## 2. System Structure and Parameterization (SSP 1.0)

Packages complete multi-FMU simulation systems into standardized `.ssp` archives according to the Modelica Association standard:

- **`SystemStructureDescription.xml`**: Defines FMU component instances and signal connections.
- **`SystemStructureParameterValues.xml`**: Encapsulates calibration sets and parameter variations.
- **`SystemStructureParameterMapping.xml`**: Applies linear transformation scalings across connected signals.

---

## 3. Static Analysis Results Interchange Format (SARIF)

ModelScript linter and verification diagnostics can be exported in OASIS **SARIF v2.1.0** format:

```bash
npx msc lint models/ --format sarif > linter-report.sarif
```

- Direct ingestion into **GitHub Code Scanning** and Azure DevOps pull request checks.
- Generates inline code annotations with rule identifiers (`M1001` - `M5001`), source locations, and suggested fixes.

---

## 4. Common Test Report Format (CTRF)

For automated test suites and regression runners, ModelScript outputs **CTRF** reports (`ctrf-report.json`):

```bash
npx msc test --format ctrf --output ctrf-report.json
```

- Compatible with CTRF GitHub Actions, GitLab CI, and CircleCI dashboards.
- Records test duration, pass/fail counts, assertion diagnostics, and flakiness metrics.

---

## 5. Formal LaTeX Verification Proofs

When safety-critical systems require formal certification (e.g. ISO 26262, DO-178C), ModelScript's Nelson-Oppen Theory Coordinator can export rigorous mathematical proofs in LaTeX:

```bash
npx msc verify SafetyConstraint system.mo --format latex > proof.tex
```

- Exports step-by-step CDCL(T) deductions, Unsat cores, and interpolants.
- Formats continuous reachability zonotope equations ready for academic or regulatory publication.

---

## 6. Time-Series Trajectory Formats

Numerical simulation results (`msc simulate`) can be streamed to three primary trajectory formats:

| Format      | Extension  | Use Case                                                                                       |
| :---------- | :--------- | :--------------------------------------------------------------------------------------------- |
| **CSV**     | `.csv`     | Human-readable inspection, spreadsheet analysis, and test bench comparison.                    |
| **JSON**    | `.json`    | Web applications, browser charting (e.g. Morsel), and REST API payloads.                       |
| **Parquet** | `.parquet` | High-performance columnar storage for massive parameter sweeps and machine learning pipelines. |
