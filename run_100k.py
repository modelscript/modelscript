import os
import subprocess
import resource

os.makedirs('build', exist_ok=True)
msc_path = "/home/omar/git/modelscript/node_modules/.bin/msc"

def generate_cascade(n):
    lines = [f"model Cascade_{n}"]
    for i in range(1, n + 1):
        lines.append(f"  Real x{i}(start=1.0);")
    lines.append("equation")
    lines.append("  der(x1) = -x1;")
    for i in range(2, n + 1):
        lines.append(f"  der(x{i}) = x{i-1} - x{i};")
    lines.append(f"end Cascade_{n};")
    return "\n".join(lines)

os.makedirs('models', exist_ok=True)
with open('models/Cascade_100000.mo', 'w') as f:
    f.write(generate_cascade(100000))

print("Running 100k...")
res = subprocess.run([msc_path, "simulate", "Cascade_100000", "models/Cascade_100000.mo", "--engine", "js", "--stop-time", "0.0"], capture_output=True, text=True)
print(res.stdout)
print(res.stderr)
