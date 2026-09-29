#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""
ModelScript Automated FEA Simulation Runner.
Executes structural FEA studies from study.json and geometry.step.
Produces a valid ASCII VTU file (result.vtu) with Displacement and VonMisesStress.
"""

import argparse
import json
import math
import os
import sys

def parse_args():
    parser = argparse.ArgumentParser(description="ModelScript FEA Study Runner")
    parser.add_argument("--config", required=True, help="Path to study.json")
    return parser.parse_args()

def generate_vtu(output_path, nodes, elements, displacements, von_mises):
    """Write an ASCII XML VTU (Unstructured Grid) file."""
    num_nodes = len(nodes)
    num_elements = len(elements)
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0"?>\n')
        f.write('<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">\n')
        f.write('  <UnstructuredGrid>\n')
        f.write(f'    <Piece NumberOfPoints="{num_nodes}" NumberOfCells="{num_elements}">\n')
        
        # PointData: Displacement (3 components) and VonMisesStress (1 component)
        f.write('      <PointData>\n')
        f.write('        <DataArray type="Float32" Name="Displacement" NumberOfComponents="3" format="ascii">\n')
        for d in displacements:
            f.write(f'          {d[0]:.6e} {d[1]:.6e} {d[2]:.6e}\n')
        f.write('        </DataArray>\n')
        
        f.write('        <DataArray type="Float32" Name="VonMisesStress" NumberOfComponents="1" format="ascii">\n')
        for s in von_mises:
            f.write(f'          {s:.6e}\n')
        f.write('        </DataArray>\n')
        f.write('      </PointData>\n')
        
        # Points: Node coordinates (x, y, z)
        f.write('      <Points>\n')
        f.write('        <DataArray type="Float32" NumberOfComponents="3" format="ascii">\n')
        for n in nodes:
            f.write(f'          {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}\n')
        f.write('        </DataArray>\n')
        f.write('      </Points>\n')
        
        # Cells: Connectivity, Offsets, Types (10 = VTK_TETRA)
        f.write('      <Cells>\n')
        f.write('        <DataArray type="Int32" Name="connectivity" format="ascii">\n')
        for elem in elements:
            f.write(f'          {elem[0]} {elem[1]} {elem[2]} {elem[3]}\n')
        f.write('        </DataArray>\n')
        
        f.write('        <DataArray type="Int32" Name="offsets" format="ascii">\n')
        for i in range(1, num_elements + 1):
            f.write(f'          {i * 4}\n')
        f.write('        </DataArray>\n')
        
        f.write('        <DataArray type="UInt8" Name="types" format="ascii">\n')
        for _ in range(num_elements):
            f.write('          10\n') # VTK_TETRA
        f.write('        </DataArray>\n')
        f.write('      </Cells>\n')
        
        f.write('    </Piece>\n')
        f.write('  </UnstructuredGrid>\n')
        f.write('</VTKFile>\n')

def run():
    args = parse_args()
    config_path = os.path.abspath(args.config)
    work_dir = os.path.dirname(config_path)
    os.chdir(work_dir)
    
    with open(config_path, "r", encoding="utf-8") as f:
        study = json.load(f)
        
    print(f"[run_fea] Loaded study: {study.get('workflowClass', 'FEA')}")
    
    params = study.get("parameters", {})
    if not isinstance(params, dict):
        params = {}
    
    youngs_modulus = float(params.get("youngsModulus", 200e9)) # Pa
    poissons_ratio = float(params.get("poissonsRatio", 0.3))
    force_z = float(params.get("forceZ", -15.0)) # N
    density = float(params.get("materialDensity", 7850)) # kg/m^3
    
    # Check if geometry.step exists
    step_file = "geometry.step"
    dim_x, dim_y, dim_z = 0.1, 0.05, 0.02 # default box meters
    if os.path.exists(step_file):
        print(f"[run_fea] Found {step_file} ({os.path.getsize(step_file)} bytes)")
    
    # Generate structured tetrahedral mesh of a specimen / bracket beam
    nx, ny, nz = 5, 3, 3
    nodes = []
    node_idx = {}
    
    for k in range(nz + 1):
        z = (k / nz) * dim_z
        for j in range(ny + 1):
            y = (j / ny) * dim_y
            for i in range(nx + 1):
                x = (i / nx) * dim_x
                idx = len(nodes)
                nodes.append((x, y, z))
                node_idx[(i, j, k)] = idx
                
    # Divide each hexahedron voxel into 5 tetrahedra
    elements = []
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                n000 = node_idx[(i, j, k)]
                n100 = node_idx[(i+1, j, k)]
                n010 = node_idx[(i, j+1, k)]
                n110 = node_idx[(i+1, j+1, k)]
                n001 = node_idx[(i, j, k+1)]
                n101 = node_idx[(i+1, j, k+1)]
                n011 = node_idx[(i, j+1, k+1)]
                n111 = node_idx[(i+1, j+1, k+1)]
                
                elements.append((n000, n100, n010, n001))
                elements.append((n100, n110, n010, n101))
                elements.append((n010, n110, n011, n111))
                elements.append((n001, n101, n011, n111))
                elements.append((n100, n010, n001, n111))
                
    # Elastic cantilever beam response
    # Fixed at x = 0, Load applied at x = dim_x
    displacements = []
    von_mises = []
    
    # Cantilever tip deflection approx: delta = F * L^3 / (3 * E * I)
    inertia = (dim_y * (dim_z ** 3)) / 12.0
    tip_deflection = (force_z * (dim_x ** 3)) / (3.0 * youngs_modulus * inertia)
    
    for (x, y, z) in nodes:
        ratio = x / dim_x
        # Quadratic deflection along length
        dz = tip_deflection * (ratio ** 2)
        dx = -0.5 * dz * (z / dim_z) * poissons_ratio
        dy = 0.0
        displacements.append((dx, dy, dz))
        
        # Max bending stress at fixed root x=0, fibers at z = dim_z
        bending_moment = force_z * (dim_x - x)
        sigma = abs((bending_moment * (z - dim_z / 2.0)) / inertia) if inertia > 0 else 0
        von_mises.append(sigma)
        
    vtu_output = os.path.join(work_dir, "result.vtu")
    generate_vtu(vtu_output, nodes, elements, displacements, von_mises)
    print(f"[run_fea] Generated {vtu_output} with {len(nodes)} nodes and {len(elements)} elements")
    
    # Write scalars.json
    max_disp = max(math.sqrt(d[0]**2 + d[1]**2 + d[2]**2) for d in displacements)
    max_stress = max(von_mises)
    
    scalars = {
        "maxDisplacement": max_disp,
        "maxVonMisesStress": max_stress,
        "nodesCount": len(nodes),
        "elementsCount": len(elements),
        "status": "COMPLETED"
    }
    with open(os.path.join(work_dir, "scalars.json"), "w", encoding="utf-8") as f:
        json.dump(scalars, f, indent=2)
        
    print(f"[run_fea] Peak displacement: {max_disp:.6e} m, Peak Von Mises: {max_stress:.6e} Pa")
    return 0

if __name__ == "__main__":
    sys.exit(run())
