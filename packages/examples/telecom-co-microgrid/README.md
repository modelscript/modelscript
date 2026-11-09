<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# Telecom Central Office -48V DC Microgrid

This example package models and verifies a resilient -48V DC power microgrid for telecom central offices, wireless base stations, and cable headends conforming to Telcordia GR-513-CORE and ETSI EN 300 132-2.

## System Architecture

```
480V 3-Phase Utility Feed ──[ATS]── N+1 Switched-Mode Rectifier Bay ──┬── -48V DC Bus ── Critical Telecom Load
                                |                                     │   (-54V float)    (DWDM, 5G Core, BGP)
Standby Diesel Genset ──────────┘                                     └── Dual Battery Strings
(Tier 4, 1500 kVA, 10s start)                                             (2000 Ah VRLA / LFP)
```

## Features

1. **Hitless DC Takeover**: 0-millisecond transition to battery strings when utility power is lost, preventing optical DWDM and carrier Ethernet link flap.
2. **Automatic Transfer Switch (ATS)**: Standby diesel generator start, warm-up, and ATS transfer at $t = 12\text{s}$.
3. **Standards Compliance**: Verification of busbar voltage compliance with ETSI EN 300 132-2 ($-40.5\text{V}$ to $-57.0\text{V}$).
