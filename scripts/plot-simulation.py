import json
import matplotlib.pyplot as plt
import numpy as np
import os

def main():
    # Load the benchmark data
    results_dir = os.path.join(os.path.dirname(__file__), '..', 'results')
    data_path = os.path.join(results_dir, 'measurements_simulation.json')
    
    if not os.path.exists(data_path):
        print(f"Error: Could not find {data_path}")
        return
        
    with open(data_path, 'r') as f:
        data = json.load(f)['simulation']

    Ns = data['scalabilityNs']

    metrics = [
        ('compCpu', 'Compilation Time', 'Time (ms)', True),
        ('compMem', 'Compilation Memory', 'Memory (MB)', False),
        ('simCpu', 'Simulation Time', 'Time (ms)', True),
        ('simMem', 'Simulation Memory', 'Memory (MB)', False)
    ]

    # Use a professional, clean style for the manuscript
    plt.style.use('seaborn-v0_8-whitegrid')
    
    # Create a 2x2 subplot grid
    fig, axs = plt.subplots(2, 2, figsize=(12, 10))
    fig.suptitle('ModelScript Simulation Architecture Scalability', fontsize=16, fontweight='bold')
    
    markers = ['o', 's', '^', 'D', 'v', '<', '>']
    colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2']
    
    for idx, (metric_key, title, ylabel, use_log_y) in enumerate(metrics):
        row = idx // 2
        col = idx % 2
        ax = axs[row, col]
        
        metric_data = data[metric_key]
        
        for i, (label, values) in enumerate(metric_data.items()):
            # Plot the data
            ax.plot(Ns, values, marker=markers[i % len(markers)], color=colors[i % len(colors)],
                    linestyle='-', linewidth=2, markersize=8, label=label)
            
        ax.set_title(title, fontsize=14, fontweight='bold')
        ax.set_xlabel('Number of Equations (N)', fontsize=12)
        ax.set_ylabel(ylabel, fontsize=12)
        ax.grid(True, which="both", ls="--", alpha=0.5)
        
        # Log-log scale makes sense since both N and time/mem can span orders of magnitude
        ax.set_xscale('log')
        if use_log_y:
            ax.set_yscale('log')
            
        ax.tick_params(axis='both', which='major', labelsize=10)
        
        if idx == 0:
            ax.legend(loc='upper left', fontsize=10, frameon=True)

    plt.tight_layout()
    
    # Save the plot
    os.makedirs(results_dir, exist_ok=True)
    out_path = os.path.join(results_dir, 'simulation_scalability.pdf')
    plt.savefig(out_path, dpi=300, bbox_inches='tight')
    print(f"Generated plot: {out_path}")
    
    # Also save as PNG for quick viewing
    png_path = os.path.join(results_dir, 'simulation_scalability.png')
    plt.savefig(png_path, dpi=300, bbox_inches='tight')
    print(f"Generated plot: {png_path}")

if __name__ == '__main__':
    main()
