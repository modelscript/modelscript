<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/pslf

GE PSLF (Positive Sequence Load Flow) language and model exchange package for ModelScript.

## Overview

General Electric's PSLF (Positive Sequence Load Flow) is the primary transmission planning and dynamic simulation format utilized across the Western Electricity Coordinating Council (WECC). This package provides:

- **EPC Parser & Serializer:** High-fidelity parsing and writing of PSLF Extended Power Flow Card (`.epc`) network models.
- **DYD Parser & Serializer:** Full parsing and serialization of PSLF dynamic simulation data (`.dyd`) files.
- **Bi-Directional PSS/E Projections:** Seamless lossless translation between PSLF `.epc`/`.dyd` and PSS/E `.raw`/`.dyr`.
- **WECC Renewable Model Support:** Native mapping of second-generation renewable energy models (`regca1`, `reeca1`, `repca1`, `wndt`) and legacy synchronous generator models (`gencls`, `gentpf`, `exst1`, `ieeego`).
- **Linter & Topology Diagnostics:** Verification of bus connectivity, reference angles, branch impedance bounds, and dynamic model parameter validity.

## Installation

```bash
npm install @modelscript/pslf
```

## CLI Usage

```bash
# Convert PSLF EPC to PSS/E RAW
msx pslf to-psse case.epc --out=case.raw

# Convert PSS/E RAW to PSLF EPC
msx pslf from-psse case.raw --out=case.epc

# Inspect & lint PSLF model files
msx pslf lint case.epc
msx pslf summary case.epc
```

## License

AGPL-3.0-or-later
