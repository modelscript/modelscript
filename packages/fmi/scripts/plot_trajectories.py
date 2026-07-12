import os
import sys
import pandas as pd
import matplotlib.pyplot as plt
import re

def parse_csv(path):
    if not os.path.exists(path):
        return None
    # For FMI 3.0 arrays we might have space separated strings.
    # We can use pandas to read, but we need to post-process strings.
    df = pd.read_csv(path)
    # Some columns might be object (string) if they contain spaces
    for col in df.columns:
        if df[col].dtype == object:
            # If it's a space separated string array like "1.1 2.2", just extract the first one for plotting?
            # Or expand to multiple columns.
            pass
    return df

def get_plot_var(model_name):
    # Same as VAR_MAPS
    mapping = {
        'BouncingBall': ['h'],
        'VanDerPol': ['x0'],
        'Dahlquist': ['x'],
        'Stair': ['counter'],
        'StateSpace': ['y[1]', 'y[2]', 'y[3]']
    }
    return mapping.get(model_name, [])

def get_msc_var(model_name):
    mapping = {
        'BouncingBall': ['h'],
        'VanDerPol': ['x'],
        'Dahlquist': ['x'],
        'Stair': ['counter'],
        'StateSpace': ['y[1]', 'y[2]', 'y[3]']
    }
    return mapping.get(model_name, [])

def extract_fmi3_array_col(df, col_name):
    # if col_name is like y[1], and 'y' exists and is string
    match = re.match(r"([^\[]+)\[(\d+)\]", col_name)
    if match:
        base = match.group(1)
        idx = int(match.group(2)) - 1
        if base in df.columns and (df[base].dtype == object or 'str' in df[base].dtype.name or 'obj' in df[base].dtype.name):
            return df[base].apply(lambda x: float(str(x).strip().split(' ')[idx]) if isinstance(x, str) else x)
    return None

def extract_col(df, col_name):
    if col_name in df.columns:
        return df[col_name]
    
    # Try openmodelica format
    omc_col = col_name.replace('[', '_').replace(']', '_')
    if omc_col in df.columns:
        return df[omc_col]
        
    return extract_fmi3_array_col(df, col_name)

def main():
    if len(sys.argv) < 2:
        print("Usage: plot_trajectories.py <validation_dir>")
        sys.exit(1)
        
    validation_dir = sys.argv[1]
    exported_dir = os.path.join(validation_dir, 'exported_fmus')
    plots_dir = os.path.join(validation_dir, 'plots')
    
    if not os.path.exists(plots_dir):
        os.makedirs(plots_dir)
        
    models = ['BouncingBall', 'VanDerPol', 'Dahlquist', 'Stair', 'StateSpace']
    
    for model in models:
        model_dir = os.path.join(exported_dir, model)
        if not os.path.exists(model_dir):
            continue
            
        import glob
        
        ref_files = glob.glob(os.path.join(model_dir, f"{model}_refFmu_fmusim_*.csv"))
        msc_path = os.path.join(model_dir, f"{model}_msc.csv")
        fmusim_files = glob.glob(os.path.join(model_dir, "build_fmusim_*", "fmusim_res.csv"))
        oms_files = glob.glob(os.path.join(model_dir, "build_oms_*", "oms_res.csv"))
        
        plt.figure(figsize=(10, 6))
        plt.title(f"{model} Trajectory Validation")
        plt.xlabel("Time (s)")
        
        ref_vars = get_plot_var(model)
        msc_vars = get_msc_var(model)
        plt.ylabel(", ".join(ref_vars))
        
        plotted = False
        
        for i_var, (ref_var, msc_var) in enumerate(zip(ref_vars, msc_vars)):
            var_suffix = f" {msc_var}" if len(msc_vars) > 1 else ""
            
            # Ground Truths
            for r_file in ref_files:
                df_ref = parse_csv(r_file)
                if df_ref is not None:
                    col = extract_col(df_ref, ref_var)
                    if col is not None:
                        mode_str = os.path.basename(r_file).replace(f"{model}_refFmu_fmusim_", "").replace(".csv", "")
                        style = 'k--' if 'cs' in mode_str else 'k:'
                        plt.plot(df_ref['time'], col, style, label=f'Ref-FMU ({mode_str}){var_suffix}', linewidth=2, alpha=0.5)
                        plotted = True
                    
            # Native MSC
            df_msc = parse_csv(msc_path)
            if df_msc is not None:
                col = extract_col(df_msc, msc_var)
                if col is not None:
                    print(f"Plotting {model} Native msc, {len(col)} points, col name: {msc_var}")
                    plt.plot(df_msc['time'], col, 'b-', label=f'Native msc{var_suffix}', alpha=0.9, linewidth=3)
                    plotted = True
                    
            # msc-FMU (fmusim)
            for f_file in fmusim_files:
                df_fmusim = parse_csv(f_file)
                if df_fmusim is not None:
                    col = extract_col(df_fmusim, msc_var)
                    if col is not None:
                        mode = os.path.basename(os.path.dirname(f_file)).replace("build_fmusim_", "")
                        print(f"Plotting {model} fmusim {mode}, {len(col)} points")
                        plt.plot(df_fmusim['time'], col, label=f'fmusim ({mode}){var_suffix}', alpha=0.7)
                        plotted = True
                    
            # msc-FMU (omsim)
            for o_file in oms_files:
                df_oms = parse_csv(o_file)
                if df_oms is not None:
                    col = extract_col(df_oms, msc_var)
                    if col is not None:
                        mode = os.path.basename(os.path.dirname(o_file)).replace("build_oms_", "")
                        plt.plot(df_oms['time'], col, label=f'omsim ({mode}){var_suffix}', alpha=0.7)
                        plotted = True
                
        if plotted:
            # deduplicate and sort legend
            handles, labels = plt.gca().get_legend_handles_labels()
            by_label = dict(zip(labels, handles))
            # Sort by label string
            sorted_labels = sorted(by_label.keys())
            sorted_handles = [by_label[l] for l in sorted_labels]
            plt.legend(sorted_handles, sorted_labels, loc='upper right', bbox_to_anchor=(1.25, 1.0))
            plt.grid(True)
            plt.tight_layout()
            plt.savefig(os.path.join(plots_dir, f"{model}.png"), dpi=150, bbox_inches='tight')
        plt.close()

if __name__ == '__main__':
    main()
