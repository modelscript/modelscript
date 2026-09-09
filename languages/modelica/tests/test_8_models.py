import os, subprocess
import numpy as np

models = {
    "SimpleCircuit": "V",
    "BouncingBall": "h",
    "CoupledClutches": "w1",
    "VanderPol": "x",
    "DuffingOscillator": "x",
    "RLC": "vC",
    "SpringMassDamper": "s",
    "LorenzSystem": "x"
}

msc_cmd = ["npx", "tsx", "/home/omar/git3/modelscript/apps/cli/src/main.ts", "simulate"]
models_dir = "/home/omar/git/amc2026/modelsold"

for m, var in models.items():
    mo_path = f"{models_dir}/{m}.mo"
    print(f"\n--- Testing {m} ({var}) ---")
    for engine, solver in [("js", "dopri5"), ("arena", "dopri5"), ("arena", "cvode")]:
        cmd = [*msc_cmd, m, mo_path, "--engine", engine, "--solver", solver, "--format", "csv", "--stop-time", "2.0"]
        res = subprocess.run(cmd, capture_output=True, text=True, cwd="/home/omar/git3/modelscript")
        lines = [l for l in res.stdout.strip().split('\n') if l and not l.startswith("msc")]
        if not lines or len(lines) < 2:
            print(f"  {engine}/{solver}: FAILED (no output). Stderr: {res.stderr[:200]}")
            continue
        headers = lines[0].split(',')
        if var not in headers:
            print(f"  {engine}/{solver}: FAILED (var {var} not in headers {headers})")
            continue
        idx = headers.index(var)
        last_row = lines[-1].split(',')
        print(f"  {engine}/{solver}: OK (final t={last_row[0]}, {var}={last_row[idx]})")

