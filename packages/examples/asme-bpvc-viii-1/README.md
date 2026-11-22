<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ASME BPVC Section VIII Division 1 Reference Standard Pack

Reference standard-pack workspace demonstrating how ModelScript delivers engineering code compliance via SysML v2 + declarative lookup tables without hardcoding standard rules into unrelated models:

- [`pack/modelscript.yaml`](./pack/modelscript.yaml) — `category: standard-pack` manifest declaring `ASME-BPVC-VIII-1`, `activation: import`, `PressureVesselOracle`, and table calculator bindings.
- [`pack/tables/sa516-gr70-allowable-stress.json`](./pack/tables/sa516-gr70-allowable-stress.json) — Synthetic example stress-temperature curves (`SA-516-70`, `SA-516-60`).
- [`pack/src/asme_viii_1.sysml`](./pack/src/asme_viii_1.sysml) — SysML v2 `@StandardClause` constraints for **UG-27(c)(1)**, **UG-32(d)**, **UG-99(b)**, and **UG-125(a)**.
- [`src/VesselSeparator.mo`](./src/VesselSeparator.mo) — Modelica pressure separator importing `ASME_BPVC_VIII_1` and declaring `@twin` digital-thread parameters checked across static, formal interval, and transient verification stages.
