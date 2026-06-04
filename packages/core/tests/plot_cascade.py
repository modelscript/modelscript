import subprocess
import re
import matplotlib.pyplot as plt
import os
import time

env = os.environ.copy()
env["NODE_OPTIONS"] = "--max-old-space-size=8192"

print("Running benchmark profile-cascade.ts...")
result = subprocess.run(["npx", "tsx", "tests/profile-cascade.ts"], capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), ".."), env=env)

print("ModelScript Output:")
print(result.stdout)
if result.stderr:
    print(result.stderr)

sizes = []
ms_flatten_times = []
ms_total_times = []

pattern = re.compile(r"Cascade_\s*(\d+).*flatten=\s*(\d+)ms.*total=\s*(\d+)ms")
for line in result.stdout.split('\n'):
    m = pattern.search(line)
    if m:
        sizes.append(int(m.group(1)))
        ms_flatten_times.append(int(m.group(2)))
        ms_total_times.append(int(m.group(3)))

if not sizes:
    print("Could not find any output matching the pattern.")
    exit(1)

omc_times = []
for N in sizes:
    tmp_file = os.path.abspath(os.path.join(os.path.dirname(__file__), f"../../../build/Cascade_{N}.mo"))
    mos_file = os.path.abspath(os.path.join(os.path.dirname(__file__), f"../../../build/run_omc_{N}.mos"))
    with open(mos_file, "w") as f:
        f.write(f'loadFile("{tmp_file}");\n')
        f.write(f'instantiateModel(Cascade_{N});\n')
        f.write('getErrorString();\n')
    
    print(f"Running OMC for Cascade_{N}...")
    t0 = time.time()
    omc_res = subprocess.run(["omc", mos_file], capture_output=True, text=True)
    t1 = time.time()
    
    if omc_res.returncode != 0 or "Error:" in omc_res.stdout:
        print(f"OMC error on N={N}:\n{omc_res.stdout}\n{omc_res.stderr}")
    
    elapsed_ms = int((t1 - t0) * 1000)
    omc_times.append(elapsed_ms)
    print(f"OMC for Cascade_{N} took {elapsed_ms}ms")

plt.figure(figsize=(10, 6))
# We will compare Total Time for both (Parse + Flatten) since OMC time includes parsing
plt.plot(sizes, ms_total_times, marker='o', linestyle='-', color='b', linewidth=2, markersize=8, label='ModelScript (Parse + Flatten)')
plt.plot(sizes, omc_times, marker='s', linestyle='--', color='r', linewidth=2, markersize=8, label='OpenModelica (omc)')
plt.xscale('log')
plt.yscale('log')
plt.xlabel('Number of Equations (N)', fontsize=14)
plt.ylabel('Total Processing Time (ms)', fontsize=14)
plt.title('ModelScript vs OpenModelica Performance (Cascade Model)', fontsize=16)
plt.grid(True, which="both", ls="--", alpha=0.7)
plt.legend(fontsize=12)

# Annotations for ModelScript
for i, txt in enumerate(ms_total_times):
    plt.annotate(f"{txt}ms", (sizes[i], ms_total_times[i]), textcoords="offset points", xytext=(0,-15), ha='center', fontsize=10, color='b')

# Annotations for OMC
for i, txt in enumerate(omc_times):
    plt.annotate(f"{txt}ms", (sizes[i], omc_times[i]), textcoords="offset points", xytext=(0,10), ha='center', fontsize=10, color='r')

out_path = "/home/omar/.gemini/antigravity/brain/04148d26-dbe0-41f5-ba67-511e6e3d3a15/artifacts/benchmark_plot.png"
plt.savefig(out_path, dpi=300, bbox_inches='tight')
print(f"Saved plot to {out_path}")
