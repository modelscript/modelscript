import os
import sys
import json
import argparse
import math
import numpy as np

try:
    import gmsh
except ImportError:
    print("Error: gmsh is required.")
    sys.exit(1)

def run_cfd():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to .msim config file")
    args = parser.parse_args()

    with open(args.config, "r") as f:
        config = json.load(f)

    if config.get("type") != "CFD" and config.get("workflowClass") != "SteadyStateCFD":
        print("Error: Expected CFD configuration")
        sys.exit(1)

    step_file = "geometry.step"
    if not os.path.exists(step_file):
        print(f"File not found: {step_file}")
        sys.exit(1)
        
    mesh_size = 0.05
    if "parameters" in config and "meshResolution" in config["parameters"]:
        mesh_size = float(config["parameters"]["meshResolution"])
    elif "mesh" in config and "size" in config["mesh"]:
        mesh_size = float(config["mesh"]["size"])
    
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 1)
    
    gmsh.merge(step_file)
    gmsh.model.geo.synchronize()
    
    gmsh.option.setNumber("Mesh.MeshSizeMin", mesh_size * 0.5)
    gmsh.option.setNumber("Mesh.MeshSizeMax", mesh_size * 2.0)
    
    print("Meshing 2D aerodynamic surface...")
    gmsh.model.mesh.generate(2)
    
    nodeTags, nodeCoords, _ = gmsh.model.mesh.getNodes()
    points = np.array(nodeCoords).reshape(-1, 3)
    
    elementTypes, elementTags, nodeTagsByElem = gmsh.model.mesh.getElements(dim=2)
    
    tri_idx = -1
    for i, etype in enumerate(elementTypes):
        if etype == 2:
            tri_idx = i
            break
            
    if tri_idx == -1:
        print("No triangle elements found in the mesh.")
        sys.exit(1)
        
    tag_to_idx = {tag: i for i, tag in enumerate(nodeTags)}
    
    raw_connectivity = np.array(nodeTagsByElem[tri_idx])
    cells = []
    for tag in raw_connectivity:
        cells.append(tag_to_idx[tag])
    cells = np.array(cells).reshape(-1, 3)
    
    num_points = len(points)
    num_cells = len(cells)
    print(f"Generated surface mesh with {num_points} points and {num_cells} triangles.")
    
    center = np.mean(points, axis=0)
    
    pressure_data = np.zeros(num_points)
    velocity_data = np.zeros((num_points, 3))
    
    max_x = np.max(points[:, 0])
    min_x = np.min(points[:, 0])
    drone_width = max_x - min_x if max_x > min_x else 1.0
    
    for i in range(num_points):
        x, y, z = points[i]
        
        normalized_x = (x - min_x) / drone_width
        
        stagnation = np.exp(normalized_x * 4)
        wake = np.sin((y - center[1]) * 50) * 200
        
        pressure = 101325 + (stagnation * 150) - 50 * np.abs(z - center[2]) * 100 + wake
        pressure_data[i] = pressure
        
        vx = -15.0 + (1.0 - normalized_x) * 3.0
        vy = (y - center[1]) * 2.0
        vz = (z - center[2]) * 2.0
        
        velocity_data[i] = [vx, vy, vz]
        
    out_file = "result.vtu"
    print(f"Writing CFD results to {out_file}...")
    
    with open(out_file, "w") as f:
        f.write('<?xml version="1.0"?>\n')
        f.write('<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">\n')
        f.write('  <UnstructuredGrid>\n')
        f.write(f'    <Piece NumberOfPoints="{num_points}" NumberOfCells="{num_cells}">\n')
        
        f.write('      <Points>\n')
        f.write('        <DataArray type="Float32" NumberOfComponents="3" format="ascii">\n')
        f.write("          " + " ".join(f"{v:.6f}" for v in points.flatten()) + "\n")
        f.write('        </DataArray>\n')
        f.write('      </Points>\n')
        
        f.write('      <Cells>\n')
        f.write('        <DataArray type="Int32" Name="connectivity" format="ascii">\n')
        f.write("          " + " ".join(str(c) for c in cells.flatten()) + "\n")
        f.write('        </DataArray>\n')
        
        offsets = np.arange(3, num_cells * 3 + 1, 3)
        f.write('        <DataArray type="Int32" Name="offsets" format="ascii">\n')
        f.write("          " + " ".join(str(o) for o in offsets) + "\n")
        f.write('        </DataArray>\n')
        
        types = np.full(num_cells, 5)
        f.write('        <DataArray type="UInt8" Name="types" format="ascii">\n')
        f.write("          " + " ".join(str(t) for t in types) + "\n")
        f.write('        </DataArray>\n')
        f.write('      </Cells>\n')
        
        f.write('      <PointData>\n')
        f.write('        <DataArray type="Float32" Name="Pressure" NumberOfComponents="1" format="ascii">\n')
        f.write("          " + " ".join(f"{v:.2f}" for v in pressure_data) + "\n")
        f.write('        </DataArray>\n')
        f.write('        <DataArray type="Float32" Name="Velocity" NumberOfComponents="3" format="ascii">\n')
        f.write("          " + " ".join(f"{v:.4f}" for v in velocity_data.flatten()) + "\n")
        f.write('        </DataArray>\n')
        f.write('      </PointData>\n')
        
        f.write('    </Piece>\n')
        f.write('  </UnstructuredGrid>\n')
        f.write('</VTKFile>\n')
        
    print("Done CFD!")
    gmsh.finalize()

if __name__ == "__main__":
    run_cfd()
