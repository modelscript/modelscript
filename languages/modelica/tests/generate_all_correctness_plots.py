import os, subprocess
import numpy as np
import matplotlib.pyplot as plt

os.makedirs('/home/omar/Desktop/amc2026-final/figures', exist_ok=True)
os.makedirs('/tmp/amc_bench', exist_ok=True)

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

# Plot formatting
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#333333'
plt.rcParams['axes.linewidth'] = 0.8

overall_max_diff = 0.0

for model, var_name in models.items():
    print(f"Generating correctness plot for {model}...")
    mo_path = f"{models_dir}/{model}.mo"
    
    # 1. Run OMC
    omc_script = f"""
loadModel(Modelica);
loadFile("{mo_path}");
simulate({model}, stopTime=2.0, outputFormat="csv");
"""
    with open(f"/tmp/amc_bench/run_{model}.mos", "w") as f:
        f.write(omc_script)
    subprocess.run(["omc", f"run_{model}.mos"], cwd="/tmp/amc_bench", capture_output=True)

    omc_time = []
    omc_v = []
    with open(f"/tmp/amc_bench/{model}_res.csv", "r") as f:
        lines = f.read().strip().split('\n')
        header = lines[0].split(',')
        v_idx = header.index(f'"{var_name}"')
        for line in lines[1:]:
            cols = line.split(',')
            omc_time.append(float(cols[0]))
            omc_v.append(float(cols[v_idx]))
            
    omc_time = np.array(omc_time)
    omc_v = np.array(omc_v)

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(omc_time, omc_v, label='OMC (DASSL)', color='#111111', linewidth=3.5, zorder=1)

    configurations = [
        ("arena", "cvode", "MSC WASM (CVODE)", "#1f77b4", (0, (5, 2.5))),
        ("js", "dopri5", "MSC JS (Dopri5)", "#2ca02c", "--"),
        ("c", "rk4", "MSC C FMU (RK4)", "#ff7f0e", ":"),
        ("wasm", "rk4", "MSC WASM FMU (RK4)", "#d62728", "-."),
    ]

    for engine, solver, label, color, ls in configurations:
        cmd = [*msc_cmd, model, mo_path, "--engine", engine, "--solver", solver, "--format", "csv", "--stop-time", "2.0"]
        res = subprocess.run(cmd, capture_output=True, text=True, cwd="/home/omar/git3/modelscript")
        lines = [l for l in res.stdout.strip().split('\n') if l and not l.startswith("msc")]
        if not lines or len(lines) < 2:
            continue
        headers = lines[0].split(',')
        if var_name not in headers:
            continue
        v_col = headers.index(var_name)
        msc_time = []
        msc_val = []
        for line in lines[1:]:
            parts = line.split(',')
            try:
                msc_time.append(float(parts[0]))
                msc_val.append(float(parts[v_col]))
            except:
                pass
        msc_time = np.array(msc_time)
        msc_val = np.array(msc_val)
        
        # Compute diff against OMC
        interp_val = np.interp(omc_time, msc_time, msc_val)
        diff = np.max(np.abs(omc_v - interp_val))
        overall_max_diff = max(overall_max_diff, diff)
        print(f"  {label}: max diff = {diff:.2e}")
        
        ax.plot(msc_time, msc_val, label=label, color=color, linestyle=ls, linewidth=1.8, zorder=2)

    ax.set_xlabel('Time (s)', fontsize=12, fontweight='bold')
    ax.set_ylabel('Amplitude', fontsize=12, fontweight='bold')
    ax.tick_params(axis='both', which='major', labelsize=11)
    ax.grid(True, linestyle='--', alpha=0.5)
    ax.legend(fontsize=9, loc='best', framealpha=0.9)
    plt.tight_layout()
    
    out_pdf = f"/home/omar/Desktop/amc2026-final/figures/correctness_{model}.pdf"
    plt.savefig(out_pdf, bbox_inches='tight')
    plt.close()
    print(f"  Saved {out_pdf}")

print(f"\nAll plots regenerated successfully! Overall max diff: {overall_max_diff:.2e}")
