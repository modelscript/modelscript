import os
import sys
import math
import numpy as np

try:
    import gmsh
except ImportError:
    print("Error: gmsh is required.")
    sys.exit(1)

def run_cfd():
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 1)
    
    step_file = os.path.join(os.path.dirname(__file__), "cad", "drone.step")
    if not os.path.exists(step_file):
        print(f"File not found: {step_file}")
        sys.exit(1)
        
    gmsh.merge(step_file)
    gmsh.model.geo.synchronize()
    
    # We only mesh the surface for CFD visualization (Boundary elements)
    # This represents the aerodynamic pressure mapped on the drone's skin
    gmsh.option.setNumber("Mesh.MeshSizeMin", 0.02)
    gmsh.option.setNumber("Mesh.MeshSizeMax", 0.08)
    
    print("Meshing 2D aerodynamic surface...")
    gmsh.model.mesh.generate(2)
    
    nodeTags, nodeCoords, _ = gmsh.model.mesh.getNodes()
    points = np.array(nodeCoords).reshape(-1, 3)
    
    # Extract 2D elements (triangles = type 2)
    elementTypes, elementTags, nodeTagsByElem = gmsh.model.mesh.getElements(dim=2)
    
    tri_idx = -1
    for i, etype in enumerate(elementTypes):
        if etype == 2: # 3-node triangle
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
    
    # -------------------------------------------------------------
    # Simulated CFD computation (Rotational aerodynamics)
    # Propeller spinning around Z-axis
    # -------------------------------------------------------------
    
    # Compute center
    center = np.mean(points, axis=0)
    
    pressure_data = np.zeros(num_points)
    velocity_data = np.zeros((num_points, 3))
    
    omega = 500.0  # Angular velocity (rad/s)
    air_density = 1.225 # kg/m^3
    
    for i in range(num_points):
        x, y, z = points[i]
        
        # Relative to center
        rx = x - center[0]
        ry = y - center[1]
        r = np.sqrt(rx**2 + ry**2)
        
        # Velocity vector (tangential)
        vx = -omega * ry
        vy = omega * rx
        vz = -5.0 # Slight induced downwash
        
        # Leading edge approximation:
        # If rotating CCW, blade at +Y moves in -X, so leading edge is -X.
        # Blade at -Y moves in +X, so leading edge is +X.
        # Thus, leading edge is where rx * ry < 0
        # We smooth this out using a normalized tangent dot product proxy.
        # For our simple rotated box, rx*ry < 0 is a good leading edge proxy.
        
        # Stagnation pressure on leading edge, suction on trailing edge
        edge_factor = -np.sign(rx * ry) * 0.8 if rx * ry != 0 else 0
        
        # Bernoulli's dynamic pressure: 0.5 * rho * v^2
        dynamic_pressure = 0.5 * air_density * (r * omega)**2
        
        # Total pressure distribution
        pressure = 101325 + dynamic_pressure * edge_factor
        
        pressure_data[i] = pressure
        velocity_data[i] = [vx, vy, vz]
        
    # -------------------------------------------------------------
    # Write VTU file
    # -------------------------------------------------------------
    out_file = os.path.join(os.path.dirname(__file__), "drone_cfd.vtu")
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
        
        types = np.full(num_cells, 5) # 5 is VTK_TRIANGLE
        f.write('        <DataArray type="UInt8" Name="types" format="ascii">\n')
        f.write("          " + " ".join(str(t) for t in types) + "\n")
        f.write('        </DataArray>\n')
        f.write('      </Cells>\n')
        
        f.write('      <PointData>\n')
        f.write('        <DataArray type="Float32" Name="SurfacePressure" NumberOfComponents="1" format="ascii">\n')
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
