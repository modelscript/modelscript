import matplotlib.pyplot as plt

sizes = [10, 100, 1000, 10000, 100000]

# Pre-recorded times (ms)
ms_total_times = [24, 92, 1061, 23344, None] # 100000 is TLE/OOM
omc_times = [5, 10, 40, 610, 4981]

plt.figure(figsize=(10, 6))

# Plot ModelScript (only up to 10000)
ms_valid_sizes = sizes[:-1]
ms_valid_times = ms_total_times[:-1]
plt.plot(ms_valid_sizes, ms_valid_times, marker='o', linestyle='-', color='b', linewidth=2, markersize=8, label='ModelScript (Parse + Flatten)')

# Plot OpenModelica
plt.plot(sizes, omc_times, marker='s', linestyle='--', color='r', linewidth=2, markersize=8, label='OpenModelica (omc)')

plt.xscale('log')
plt.yscale('log')
plt.xlabel('Number of Equations (N)', fontsize=14)
plt.ylabel('Total Processing Time (ms)', fontsize=14)
plt.title('ModelScript vs OpenModelica Performance (Cascade Model)', fontsize=16)
plt.grid(True, which="both", ls="--", alpha=0.7)
plt.legend(fontsize=12)

# Annotations for ModelScript
for i, txt in enumerate(ms_valid_times):
    plt.annotate(f"{txt}ms", (ms_valid_sizes[i], ms_valid_times[i]), textcoords="offset points", xytext=(0,10), ha='center', fontsize=10, color='b')

# Annotations for OMC
for i, txt in enumerate(omc_times):
    plt.annotate(f"{txt}ms", (sizes[i], omc_times[i]), textcoords="offset points", xytext=(0,-15), ha='center', fontsize=10, color='r')

out_path = "/home/omar/.gemini/antigravity/brain/04148d26-dbe0-41f5-ba67-511e6e3d3a15/artifacts/omc_comparison_plot.png"
plt.savefig(out_path, dpi=300, bbox_inches='tight')
print(f"Saved plot to {out_path}")
