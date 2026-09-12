import os
import csv
import sys
import matplotlib.pyplot as plt

MODELS = {
    'BouncingBall': {'h': 'h', 'v': 'v'},
    'VanDerPol': {'x': 'x0', 'y': 'x1'},
    'Dahlquist': {'x': 'x'},
    'Stair': {'x': 'x'},
    'StateSpace': {'x[1]': 'x[1]', 'x[2]': 'x[2]'}
}

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../validation/exported_fmus'))
PLOTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../validation/plots'))

os.makedirs(PLOTS_DIR, exist_ok=True)

def read_csv(path):
    if not os.path.exists(path):
        return None
    data = {}
    with open(path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            for k, v in row.items():
                k_clean = k.strip('"').strip()
                if k_clean not in data:
                    data[k_clean] = []
                try:
                    data[k_clean].append(float(v))
                except ValueError:
                    data[k_clean].append(0.0)
    return data

for model_name, var_map in MODELS.items():
    model_dir = os.path.join(BASE_DIR, model_name)
    
    csv_paths = {
        'Native msc': os.path.join(model_dir, f'{model_name}_msc.csv'),
        'Ref-FMU (fmusim)': os.path.join(model_dir, f'{model_name}_refFmu_fmusim.csv'),
        'msc-FMU (fmusim)': os.path.join(model_dir, 'build_fmusim', 'fmusim_res.csv'),
        'msc-FMU (omc)': os.path.join(model_dir, 'build_omc', f'{model_name}_me_FMU_res.csv')
    }
    
    csv_data = {name: read_csv(path) for name, path in csv_paths.items()}
    
    # Filter out missing CSVs
    csv_data = {name: data for name, data in csv_data.items() if data is not None}
    
    if not csv_data:
        print(f"Skipping {model_name} (no data)")
        continue
        
    num_vars = len(var_map)
    fig, axes = plt.subplots(num_vars, 1, figsize=(10, 4 * num_vars), squeeze=False)
    fig.suptitle(f'{model_name} Cross-Simulation Trajectories', fontsize=16)
    
    # Some colors and styles
    styles = {
        'Ref-FMU (fmusim)': {'color': 'black', 'linestyle': '-', 'linewidth': 3, 'alpha': 0.5},
        'Native msc': {'color': 'red', 'linestyle': '--', 'linewidth': 2},
        'msc-FMU (fmusim)': {'color': 'blue', 'linestyle': '-.', 'linewidth': 2},
        'msc-FMU (omc)': {'color': 'green', 'linestyle': ':', 'linewidth': 2}
    }
    
    for i, (msc_var, ref_var) in enumerate(var_map.items()):
        ax = axes[i][0]
        ax.set_title(f'Variable: {msc_var} (Ref: {ref_var})')
        ax.set_xlabel('Time (s)')
        ax.set_ylabel('Value')
        ax.grid(True, alpha=0.3)
        
        for sim_name, data in csv_data.items():
            time_key = next((k for k in data.keys() if 'time' in k.lower()), None)
            if not time_key: continue
            
            # Figure out which key to use for this simulation
            if sim_name == 'Ref-FMU (fmusim)':
                var_key = ref_var
            else:
                var_key = msc_var
                
            # If Exact var_key not found, check ignoring quotes
            actual_key = next((k for k in data.keys() if k == var_key or k.replace('"', '') == var_key), None)
            
            if actual_key and time_key:
                style = styles.get(sim_name, {})
                ax.plot(data[time_key], data[actual_key], label=sim_name, **style)
                
        ax.legend()
        
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    out_path = os.path.join(PLOTS_DIR, f'{model_name}.png')
    plt.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Generated plot: {out_path}")
