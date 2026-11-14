#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Generate transient stability reference CSV trajectories using CURENT/ANDES
for cross-solver NRMSE / Theil TIC validation against @modelscript/psse.

Usage:
  python3 andes-ref-runner.py <case.raw> <case.dyr> <out.ref.csv> [fault_bus] [t_f] [t_clr] [t_end]
"""

import csv
import sys


def main() -> int:
    if len(sys.argv) < 4:
        print("Usage: andes-ref-runner.py <case.raw> <case.dyr> <out.ref.csv> [fault_bus] [t_f] [t_clr] [t_end]", file=sys.stderr)
        return 2

    raw_path, dyr_path, out_csv = sys.argv[1], sys.argv[2], sys.argv[3]
    fault_bus = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else None
    t_f = float(sys.argv[5]) if len(sys.argv) > 5 else 0.1
    t_clr = float(sys.argv[6]) if len(sys.argv) > 6 else 0.2
    t_end = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0

    try:
        import andes  # type: ignore
    except ImportError:
        print("ANDES is not installed (`pip install andes`). Skipping cross-solver reference generation.", file=sys.stderr)
        return 3

    ss = andes.load(raw_path, addfile=dyr_path, setup=False, default_config=True)
    if fault_bus is not None:
        ss.add("Fault", bus=fault_bus, tf=t_f, tc=t_clr)
    ss.setup()
    ss.PFlow.run()
    ss.TDS.config.tf = t_end
    ss.TDS.config.tstep = 0.01
    ss.TDS.run()

    t_arr = ss.dae.ts.t
    bus_ids = list(ss.Bus.idx.v)
    v_mat = ss.dae.ts.y[:, ss.Bus.v.a]

    headers = ["t"] + [f"vt_{b}" for b in bus_ids[:8]]
    with open(out_csv, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        for i in range(len(t_arr)):
            row = [f"{t_arr[i]:.6f}"] + [f"{v_mat[i, j]:.6f}" for j in range(min(8, len(bus_ids)))]
            writer.writerow(row)

    print(f"[andes-ref] Wrote {len(t_arr)} steps to {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
