import os
import math
import sys
import xml.etree.ElementTree as ET

try:
    import gmsh
    import numpy as np
except ImportError:
    print("Error: gmsh and numpy are required. Run: sudo apt-get install -y python3-gmsh python3-numpy")
    sys.exit(1)

def run_analysis():
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 1)
    
    # Load the STEP model
    step_file = os.path.join(os.path.dirname(__file__), "cad", "drone.step")
    if not os.path.exists(step_file):
        print(f"File not found: {step_file}")
        sys.exit(1)
        
    gmsh.merge(step_file)
    
    # Synchronize and mesh
    gmsh.model.geo.synchronize()
    
    # Set mesh size larger to reduce the number of cells and browser load
    gmsh.option.setNumber("Mesh.MeshSizeMin", 0.02)
    gmsh.option.setNumber("Mesh.MeshSizeMax", 0.08)
    
    print("Meshing 3D model...")
    gmsh.model.mesh.generate(3)
    
    # Get nodes and elements
    nodeTags, nodeCoords, _ = gmsh.model.mesh.getNodes()
    points = np.array(nodeCoords).reshape(-1, 3)
    
    # We only care about 3D elements (tetrahedrons = type 4)
    elementTypes, elementTags, nodeTagsByElem = gmsh.model.mesh.getElements(dim=3)
    
    tet_idx = -1
    for i, etype in enumerate(elementTypes):
        if etype == 4: # 4-node tetrahedron
            tet_idx = i
            break
            
    if tet_idx == -1:
        print("No tetrahedral elements found in the mesh.")
        sys.exit(1)
        
    # Map gmsh node tags to 0-based indices for our VTU
    tag_to_idx = {tag: i for i, tag in enumerate(nodeTags)}
    
    # Flatten connectivity
    raw_connectivity = np.array(nodeTagsByElem[tet_idx])
    cells = []
    for tag in raw_connectivity:
        cells.append(tag_to_idx[tag])
    cells = np.array(cells).reshape(-1, 4)
    
    num_points = len(points)
    num_cells = len(cells)
    print(f"Generated mesh with {num_points} points and {num_cells} tetrahedrons.")
    
    # -------------------------------------------------------------
    # Simulated FEA computation (Static structural)
    # Assume it's a quadcopter. Center is heavy (battery), arms have upward thrust.
    # -------------------------------------------------------------
    
    # Compute center of mass
    center = np.mean(points, axis=0)
    
    # Identify arm extremities based on furthest points from center in XY plane
    xy_dist = np.sqrt((points[:, 0] - center[0])**2 + (points[:, 1] - center[1])**2)
    max_radius = np.max(xy_dist)
    
    stress_data = np.zeros(num_points)
    disp_data = np.zeros(num_points)
    
    for i in range(num_points):
        x, y, z = points[i]
        r = np.sqrt((x - center[0])**2 + (y - center[1])**2)
        
        # Bending displacement (arms bend up, center sags down)
        # Displacement proportional to radius^2
        disp_z = 0.005 * (r / max_radius)**2
        disp_data[i] = disp_z
        
        # Stress concentration near the center structural joints
        # High stress near the roots of the arms
        stress = 1.2e7 * (1.0 - r / max_radius) + 2e6 * np.sin(x*100) * np.cos(y*100)
        stress_data[i] = max(0, stress)
        
    # -------------------------------------------------------------
    # Write VTU file
    # -------------------------------------------------------------
    out_file = os.path.join(os.path.dirname(__file__), "drone_fea.vtu")
    print(f"Writing results to {out_file}...")
    
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
        
        offsets = np.arange(4, num_cells * 4 + 1, 4)
        f.write('        <DataArray type="Int32" Name="offsets" format="ascii">\n')
        f.write("          " + " ".join(str(o) for o in offsets) + "\n")
        f.write('        </DataArray>\n')
        
        types = np.full(num_cells, 10) # 10 is VTK_TETRA
        f.write('        <DataArray type="UInt8" Name="types" format="ascii">\n')
        f.write("          " + " ".join(str(t) for t in types) + "\n")
        f.write('        </DataArray>\n')
        f.write('      </Cells>\n')
        
        f.write('      <PointData>\n')
        f.write('        <DataArray type="Float32" Name="vonMisesStress" NumberOfComponents="1" format="ascii">\n')
        f.write("          " + " ".join(f"{v:.2f}" for v in stress_data) + "\n")
        f.write('        </DataArray>\n')
        f.write('        <DataArray type="Float32" Name="DisplacementZ" NumberOfComponents="1" format="ascii">\n')
        f.write("          " + " ".join(f"{v:.6f}" for v in disp_data) + "\n")
        f.write('        </DataArray>\n')
        f.write('      </PointData>\n')
        
        f.write('    </Piece>\n')
        f.write('  </UnstructuredGrid>\n')
        f.write('</VTKFile>\n')
        
    print("Done!")
    gmsh.finalize()

if __name__ == "__main__":
    run_analysis()
