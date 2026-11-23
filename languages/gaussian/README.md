<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/gaussian`

ModelScript **Beta**-tier language package for **Gaussian Input** (`.gjf` / `.com`) and **Internal Z-Matrix** quantum chemistry specifications (1970–present).

## Capabilities

- **WASM GLR Parser (`@modelscript/dsl`) & Line-Offset Deck Parser**: Link0 directives (`%chk`, `%mem`, `%nprocshared`, `%nproc`, `%rwf`), Route sections (`#`, `#p`, `#n`, `#t`, `method/basis`, `opt`, `freq`, `sp`, `td`, `scrf`, `pop`, `scf`), Title sections, Charge & Spin Multiplicity, Cartesian & Internal Z-Matrix geometries (including dummy atoms `X`), `Variables:` / `Constants:` blocks, `--Link1--` multi-step jobs, and `!` comments.
- **Static Analysis & Linter (`GAU1001`–`GAU5006`)**: Syntax validation, missing route section, electron-count charge/spin multiplicity parity verification, element validation, Z-matrix reference ordering & collinearity checks, bond length/angle bounds, and `%mem`/`%nproc` validation.
- **NeRF Kinematics & Vibrational Solver**: Natural Extension Reference Frame (NeRF) Z-matrix → 3D Cartesian conversion, inverse Cartesian → Z-matrix conversion, center-of-mass & principal moments of inertia ($I_A, I_B, I_C$) / rotational constants, and harmonic vibrational normal-mode analysis.
- **Direct DAE Arena Lowering**: Lowers molecular mechanics and harmonic vibrational normal-mode ODEs directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Chemical Format Projections**: Exports parsed/solved geometries to MDL Molfile V2000 (`.mol`), XYZ (`.xyz`), and PDB (`.pdb`).
- **Cleanroom Standard Library (`@modelscript/gaussian-std-lib`)**: Zero-I/O schemas, SVG block icons, and AssemblyScript WASM runtime for quantum chemistry methods (`HF`, `MP2`, `CCSD(T)`, `B3LYP`, `PBE0`, `M06-2X`) and basis sets (`STO-3G`, `3-21G`, `6-31G(d)`, `6-311++G(d,p)`, `cc-pVDZ`, `cc-pVTZ`).
- **Unified Indexing & LSP**: Diagnostics, document symbols, hover documentation, and completions.
