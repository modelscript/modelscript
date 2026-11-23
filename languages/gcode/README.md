<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/gcode

RS-274 / ISO 6983 G-code CNC Numerical Control language package for ModelScript (**Beta** tier).

## Features

- **Native WASM GLR Parser (`@modelscript/dsl`)**: Full RS-274 / ISO 6983 grammar supporting `%` tape delimiters, `O` program numbers, `N` line numbers, modal G-codes (`G00`–`G95`), M-codes (`M00`–`M99`), axis/arc words (`X/Y/Z/A/B/C/I/J/K/R`), `F/S/T/P/Q/L`, `#` parameters & expressions, and `( ... )` / `;` comments.
- **Static Analysis & Linting (`GC1001`–`GC5006`)**: Detects syntax errors, cutting moves with zero/unset feedrate or stopped spindle, invalid arc center/radius geometry, rapid plunges below workplane `Z < 0`, conflicting modal G-codes in the same block, missing `M02`/`M30` program end, and undefined `M98` subprograms.
- **3D Toolpath Kinematics & CAD Swept Volume (`@modelscript/cad`)**: Modal CNC state machine supporting `G20`/`G21` unit scaling, `G90`/`G91` distance modes, `G17`/`G18`/`G19` planes, helical `G02`/`G03` arcs, `G81`–`G83` canned drilling cycles, `M98`/`M99` subprograms, exact path length & cycle time, and 3D CAD swept-volume solid generation.
- **DAE Lowering (`@modelscript/runtime`)**: Lowers spindle power, cutting torque, material removal rate (MRR), and cumulative energy/volume ODEs directly into `DAEBuilder`.
- **2D/CAD Projections**: Exports toolpaths to annotated SVG and AutoCAD-compatible ASCII DXF.
- **Cleanroom Standard Library (`@modelscript/gcode-std-lib`)**: ISO 6983 G/M-code and canned-cycle schemas plus standard endmill/drill cutting-speed presets with AssemblyScript WASM runtime.
- **UnifiedWorkspace Indexing & LSP**: Diagnostics, document symbols, hover documentation, and completions.
