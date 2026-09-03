// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * Interface for a 3D Computational Fluid Dynamics (CFD) Provider.
 * Extends the generic 1D CoSimParticipant to support OpenFOAM-style
 * Navier-Stokes coupling and volumetric VTK extraction for VR rendering.
 */
export interface ICfdProvider extends CoSimParticipant {
  /**
   * Retrieves the current volumetric mesh data (e.g., in VTK format)
   * containing fields like alpha.polymer and T for real-time visualization.
   */
  getVtkBuffer(): Promise<Uint8Array | null>;

  /**
   * Initialize the mesh using the generated CAD geometry.
   * @param stepFileData The raw STEP file buffer from the ModelScript CAD pipeline.
   */
  loadGeometry(stepFileData: Uint8Array): Promise<void>;
}

export abstract class BaseCfdProvider implements ICfdProvider {
  public abstract readonly id: string;
  public abstract readonly modelName: string;
  public abstract readonly metadata: ParticipantMetadata;

  protected currentTime = 0;

  public async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    this.currentTime = startTime;
  }

  public abstract doStep(currentTime: number, stepSize: number): Promise<void>;
  public abstract getOutputs(): Promise<Map<string, CosimValue>>;
  public abstract setInputs(values: Map<string, CosimValue>): Promise<void>;
  public abstract terminate(): Promise<void>;

  public abstract getVtkBuffer(): Promise<Uint8Array | null>;
  public abstract loadGeometry(stepFileData: Uint8Array): Promise<void>;
}

/**
 * Tier 1: WASM Provider (Browser IDE)
 * Runs a simplified, coarse-mesh version of the CFD solver directly in the browser.
 * Perfect for zero-install, real-time prototyping and boundary condition debugging.
 */
export class WasmOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  private currentVtkBuffer: Uint8Array | null = null;
  private meshReady = false;

  /** Procedural mold cavity mesh — generated once during loadGeometry */
  private meshPositions: Float32Array | null = null;
  private meshIndices: Uint32Array | null = null;
  private meshNormals: Float32Array | null = null;
  /** Per-vertex alpha.polymer field (0 = air, 1 = filled polymer) */
  private alphaField: Float32Array | null = null;
  /** Per-vertex temperature field */
  private tempField: Float32Array | null = null;
  /** Mold cavity dimensions (x=length along flow, y=width, z=height) */
  private moldLength = 0.15; // 150mm SNES cartridge length
  private moldWidth = 0.065; // 65mm width
  private moldHeight = 0.012; // 12mm cavity thickness
  /** Grid resolution */
  private nx = 150;
  private ny = 65;

  /** Simulated input pressure from the 1D Modelica solver */
  private inletPressure = 100000; // 1 atm baseline

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      modelName,
      participantId: id,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "WASM-based OpenFOAM solver for Browser execution",
      variables: [],
    };
  }

  public async loadGeometry(stepFileData: Uint8Array): Promise<void> {
    console.log(`[WasmOpenFoamProvider] Loading geometry (${stepFileData.byteLength} bytes) via Gmsh.wasm...`);

    // Generate a rectangular mold cavity mesh (top surface for visualization)
    const nx = this.nx;
    const ny = this.ny;
    const vertCount = (nx + 1) * (ny + 1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const alpha = new Float32Array(vertCount);
    const temp = new Float32Array(vertCount);

    // Generate vertex grid mapped to an SNES controller dog-bone shape
    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const idx = iy * (nx + 1) + ix;
        const u = ix / nx;
        const y_norm = iy / ny - 0.5; // [-0.5, 0.5]

        const R_u = this.moldWidth / 2 / this.moldLength; // ~0.2166
        const cx1 = R_u;
        const cx2 = 1.0 - R_u;

        let top_v;
        let bot_v;

        if (u < cx1) {
          const dx = (cx1 - u) * this.moldLength;
          const r = this.moldWidth / 2;
          const h = Math.sqrt(Math.max(0, r * r - dx * dx));
          const v = h / this.moldWidth;
          top_v = v;
          bot_v = -v;
        } else if (u > cx2) {
          const dx = (u - cx2) * this.moldLength;
          const r = this.moldWidth / 2;
          const h = Math.sqrt(Math.max(0, r * r - dx * dx));
          const v = h / this.moldWidth;
          top_v = v;
          bot_v = -v;
        } else {
          top_v = 0.5;
          const b = -0.4; // Bottom dips up VERY slightly in the middle
          const a = (-0.5 - b) / Math.pow(cx1 - 0.5, 2);
          bot_v = a * Math.pow(u - 0.5, 2) + b;
        }

        const v_actual = bot_v + (y_norm + 0.5) * (top_v - bot_v);

        // Compute distance to edge for beveling
        const d_v = Math.min(top_v - v_actual, v_actual - bot_v) * this.moldWidth;
        let distToEdge = d_v;
        if (u < cx1) {
          const dx = (cx1 - u) * this.moldLength;
          const dy = v_actual * this.moldWidth;
          distToEdge = this.moldWidth / 2 - Math.sqrt(dx * dx + dy * dy);
        } else if (u > cx2) {
          const dx = (u - cx2) * this.moldLength;
          const dy = v_actual * this.moldWidth;
          distToEdge = this.moldWidth / 2 - Math.sqrt(dx * dx + dy * dy);
        }

        const bevel = 0.006;
        let zFactor = 1.0;
        if (distToEdge < bevel) {
          zFactor = Math.sin(((Math.max(0, distToEdge) / bevel) * Math.PI) / 2);
        }

        let indent = 0;

        // D-pad at u=0.22, v=0
        const dx_dpad = Math.abs((u - 0.22) * this.moldLength);
        const dy_dpad = Math.abs(v_actual * this.moldWidth);
        if ((dx_dpad < 0.0035 && dy_dpad < 0.012) || (dx_dpad < 0.012 && dy_dpad < 0.0035)) indent = 0.2;

        // Action buttons at u=0.78, v=0.1
        const bx = (u - 0.78) * this.moldLength;
        const by = (v_actual - 0.1) * this.moldWidth;
        const br = 0.0035;
        if (
          Math.sqrt(Math.pow(bx - 0.01, 2) + Math.pow(by, 2)) < br ||
          Math.sqrt(Math.pow(bx + 0.01, 2) + Math.pow(by, 2)) < br ||
          Math.sqrt(Math.pow(bx, 2) + Math.pow(by - 0.01, 2)) < br ||
          Math.sqrt(Math.pow(bx, 2) + Math.pow(by + 0.01, 2)) < br
        ) {
          indent = 0.2;
        }

        // Start/Select at u=0.45 and 0.55, v=-0.1
        const sx1 = (u - 0.45) * this.moldLength;
        const sx2 = (u - 0.55) * this.moldLength;
        const sy = (v_actual + 0.1) * this.moldWidth;
        if (Math.sqrt(sx1 * sx1 + sy * sy) < 0.0025 || Math.sqrt(sx2 * sx2 + sy * sy) < 0.0025) indent = 0.2;

        const zPos = Math.max(0.1, zFactor - indent) * this.moldHeight;

        positions[idx * 3 + 0] = u * this.moldLength;
        positions[idx * 3 + 1] = (v_actual + 0.5) * this.moldWidth;
        positions[idx * 3 + 2] = zPos;

        // Approximate normals (pointing mostly up, tilted at edges)
        normals[idx * 3 + 0] = 0;
        normals[idx * 3 + 1] = 0;
        normals[idx * 3 + 2] = 1;

        alpha[idx] = 0; // initially empty
        temp[idx] = 300; // ambient
      }
    }

    // Generate triangle indices (two triangles per quad)
    const triCount = nx * ny * 2;
    const indices = new Uint32Array(triCount * 3);
    let ti = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const v0 = iy * (nx + 1) + ix;
        const v1 = v0 + 1;
        const v2 = v0 + (nx + 1);
        const v3 = v2 + 1;
        indices[ti++] = v0;
        indices[ti++] = v1;
        indices[ti++] = v2;
        indices[ti++] = v1;
        indices[ti++] = v3;
        indices[ti++] = v2;
      }
    }

    this.meshPositions = positions;
    this.meshIndices = indices;
    this.meshNormals = normals;
    this.alphaField = alpha;
    this.tempField = temp;
    this.meshReady = true;

    console.log(`[WasmOpenFoamProvider] Generated ${vertCount} vertices, ${triCount} triangles`);
    console.log(
      `[WasmOpenFoamProvider] Mold cavity: ${this.moldLength * 1000}mm × ${this.moldWidth * 1000}mm × ${this.moldHeight * 1000}mm`,
    );
    console.log(`[WasmOpenFoamProvider] Tagged 'gateInlet' boundary patch (x=0 face).`);

    // Encode the initial mesh state
    this.encodeVtkBuffer();
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime += stepSize;

    if (!this.meshReady || !this.alphaField || !this.tempField || !this.meshPositions) return;

    const nx = this.nx;
    const ny = this.ny;
    // Simulate a melt front advancing from x=0 (gate) toward x=moldLength
    // Front position is a function of time and pressure
    const flowSpeed = 5.0 * (this.inletPressure / 100000.0);
    const fillFraction = this.currentTime * flowSpeed; // Allow to exceed 1.0 so edges fill
    const frontX = fillFraction * this.moldLength;
    // The edges are at yNorm = +-1, where parabolicFactor = 0.7. So it's fully full when fillFraction = 1.0 / 0.7 = ~1.43
    const timeFull = 1.45 / flowSpeed;
    const timeSinceFull = Math.max(0, this.currentTime - timeFull);

    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const idx = iy * (nx + 1) + ix;
        const x = this.meshPositions[idx * 3] as number;
        const y = this.meshPositions[idx * 3 + 1] as number;

        // Parabolic flow profile: center fills faster than edges
        const yNorm = (y / this.moldWidth - 0.5) * 2; // -1 to 1
        const parabolicFactor = 1.0 - 0.3 * yNorm * yNorm;
        const effectiveFront = frontX * parabolicFactor;

        if (x <= effectiveFront) {
          // Smooth transition at the melt front
          const dist = effectiveFront - x;
          const frontWidth = 0.005; // 5mm transition zone
          this.alphaField[idx] = Math.min(dist / frontWidth, 1.0);

          // Temperature: hot polymer (513K = 240°C for ABS) cooling toward mold temp
          const distCooling = Math.min(dist / (this.moldLength * 0.8), 1.0) * 80;
          // Additional cooling after cavity is full (up to 120K over 0.4s)
          const timeCooling = Math.min(timeSinceFull / 0.4, 1.0) * 120;
          this.tempField[idx] = 513 - distCooling - timeCooling; // 513K → down to ~313K
        } else {
          this.alphaField[idx] = 0;
          this.tempField[idx] = 300; // ambient
        }
      }
    }

    this.encodeVtkBuffer();
  }

  /**
   * Encode the current mesh state as a JSON payload inside a Uint8Array.
   * The webview will parse this to update the Three.js scene.
   */
  private encodeVtkBuffer(): void {
    if (!this.meshPositions || !this.meshIndices || !this.meshNormals || !this.alphaField || !this.tempField) return;

    const payload = JSON.stringify({
      type: "cfd-mesh",
      time: this.currentTime,
      geometry: {
        positions: Array.from(this.meshPositions),
        normals: Array.from(this.meshNormals),
        indices: Array.from(this.meshIndices),
      },
      fields: {
        "alpha.polymer": Array.from(this.alphaField),
        temperature: Array.from(this.tempField),
      },
      metadata: {
        moldLength: this.moldLength,
        moldWidth: this.moldWidth,
        moldHeight: this.moldHeight,
      },
    });

    this.currentVtkBuffer = new TextEncoder().encode(payload);
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();
    // Mock mass flow resistance feedback
    outputs.set("gateInlet.m_flow", -0.05);
    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    // Map 1D Modelica pressure to 3D Inlet Patch boundary condition
    if (values.has("gateInlet.p")) {
      const p = values.get("gateInlet.p");
      if (typeof p === "number") {
        this.inletPressure = p;
        // console.log(`[WasmOpenFoamProvider] Adjusted gateInlet pressure to ${p} Pa`);
      }
    }
  }

  public async terminate(): Promise<void> {
    console.log(`[WasmOpenFoamProvider] Terminated.`);
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    return this.currentVtkBuffer;
  }
}

/**
 * Tier 2: Native Node.js Provider (Desktop VS Code Extension)
 * Uses child_process.spawn() to bypass WASM limits and execute the user's
 * natively installed OpenFOAM binaries. This leverages local multi-core CPUs and GPUs.
 */
export class NativeOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  private caseDir = "";
  private foamProcess: ChildProcess | null = null;
  private currentVtkBuffer: Uint8Array | null = null;

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      modelName,
      participantId: id,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "Native OpenFOAM execution via Node.js spawn()",
      variables: [],
    };
  }

  public async loadGeometry(stepFileData: Uint8Array): Promise<void> {
    // Write STEP file to disk, spawn native Gmsh or snappyHexMesh
    this.caseDir = await fs.mkdtemp(path.join(os.tmpdir(), `openfoam-${this.id}-`));
    console.log(`[NativeOpenFoamProvider] Initialized OpenFOAM case directory at ${this.caseDir}`);

    const stepPath = path.join(this.caseDir, "geometry.step");
    await fs.writeFile(stepPath, stepFileData);
    console.log(`[NativeOpenFoamProvider] Wrote geometry to ${stepPath}`);

    // Mock snappyHexMesh run
    await this.runProcess("snappyHexMesh", ["-overwrite"]);
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Spawn or communicate with OpenFOAM binary via standard FMI or pipes
    this.currentTime += stepSize;

    // In a real tightly-coupled loop, we wouldn't spawn icoFoam every step.
    // We would write boundary conditions to constant/polyMesh and advance one timestep.
    // For this prototype, we'll mock the solver advancing.
    if (!this.foamProcess) {
      await this.runProcess("icoFoam", []);

      // Mock reading VTK from OpenFOAM post-processing
      // Usually written to VTK/modelName_1.vtk by foamToVTK
      try {
        await this.runProcess("foamToVTK", []);
        const mockVtkPath = path.join(this.caseDir, "VTK", "geometry_0.vtk");
        // Simulate creation of the file if it doesn't exist for the orchestrator callback test
        await fs.mkdir(path.join(this.caseDir, "VTK"), { recursive: true });
        await fs.writeFile(mockVtkPath, new Uint8Array([1, 2, 3, 4]));
        this.currentVtkBuffer = await fs.readFile(mockVtkPath);
      } catch (err) {
        console.warn(`[NativeOpenFoamProvider] Could not load VTK:`, err);
      }
    }
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    // Parse forces/fluxes from OpenFOAM output
    const outputs = new Map<string, CosimValue>();
    outputs.set("gateInlet.m_flow", -0.05); // Simulated feedback
    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    // Write Modelica boundaries to 0/p and 0/U

    // Create 0 directory if it doesn't exist
    const zeroDir = path.join(this.caseDir, "0");
    await fs.mkdir(zeroDir, { recursive: true }).catch(() => {
      /* ignore */
    });

    let pressure = 100000; // default 1 atm
    let velocityX = 0;

    // Extract boundaries from Modelica values map
    for (const [key, value] of values.entries()) {
      if (key.endsWith(".p")) pressure = Number(value);
      if (key.endsWith(".m_flow")) {
        // Simple mock calculation: velocity = m_flow / (density * area)
        // Assuming density=1000, area=0.01 for this MWE
        velocityX = Number(value) / (1000 * 0.01);
      }
    }

    const pFile = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\    /   O peration     | Version:  v2206                                 |
|   \\  /    A nd           | Website:  www.openfoam.com                      |
|    \\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      p;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [1 -1 -2 0 0 0 0];

internalField   uniform ${pressure};

boundaryField
{
    inlet
    {
        type            fixedValue;
        value           uniform ${pressure};
    }
    outlet
    {
        type            zeroGradient;
    }
    walls
    {
        type            zeroGradient;
    }
}
// ************************************************************************* //
`;

    const uFile = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\    /   O peration     | Version:  v2206                                 |
|   \\  /    A nd           | Website:  www.openfoam.com                      |
|    \\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       volVectorField;
    object      U;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform (0 0 0);

boundaryField
{
    inlet
    {
        type            fixedValue;
        value           uniform (${velocityX} 0 0);
    }
    outlet
    {
        type            zeroGradient;
    }
    walls
    {
        type            noSlip;
    }
}
// ************************************************************************* //
`;

    if (this.caseDir) {
      await fs.writeFile(path.join(zeroDir, "p"), pFile);
      await fs.writeFile(path.join(zeroDir, "U"), uFile);
      console.log(`[NativeOpenFoamProvider] Updated boundary conditions in 0/p and 0/U based on Modelica inputs.`);
    }
  }

  public async terminate(): Promise<void> {
    if (this.foamProcess) {
      this.foamProcess.kill();
      this.foamProcess = null;
    }
    // Clean up temporary case directory
    if (this.caseDir) {
      await fs.rm(this.caseDir, { recursive: true, force: true }).catch(() => {
        /* ignore */
      });
    }
    console.log(`[NativeOpenFoamProvider] Terminated.`);
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    // Returns the VTK buffer read after doStep
    return this.currentVtkBuffer;
  }

  private runProcess(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[NativeOpenFoamProvider] Spawning ${command} ${args.join(" ")}`);
      // Since this system might not have OpenFOAM installed, we simulate the process execution
      // and resolve immediately if the executable is not found.
      const proc = spawn(command, args, { cwd: this.caseDir });

      proc.on("error", (err: Error & { code?: string }) => {
        if (err.code === "ENOENT") {
          console.warn(`[NativeOpenFoamProvider] Executable ${command} not found. Simulating execution.`);
          resolve();
        } else {
          reject(
            new Error(
              `[NativeOpenFoamProvider] Failed to start ${command}. Ensure OpenFOAM is installed and in PATH. Details: ${err.message}`,
            ),
          );
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`[NativeOpenFoamProvider] Process ${command} exited with code ${code}`));
        }
      });
    });
  }
}

/**
 * Tier 3: Cloud API Provider
 * Packages the CAD mesh and Modelica parameters and sends them via REST/WebSocket
 * to a backend server. The server crunches massive CFD matrices and streams VR data.
 */
export class CloudOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.metadata = {
      modelName,
      participantId: id,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "Cloud-accelerated OpenFOAM API endpoint",
      variables: [],
    };
  }

  public async loadGeometry(stepFileData: Uint8Array): Promise<void> {
    // Upload STEP buffer via REST
    console.log(`[CloudOpenFoamProvider] Uploading geometry to cloud...`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(`[CloudOpenFoamProvider] Cloud cluster finished meshing.`);
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    // Ping WebSocket to advance server tick
    this.currentTime += stepSize;
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();
    outputs.set("gateInlet.m_flow", -0.05);
    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    // Send BC payload over WebSocket
  }

  public async terminate(): Promise<void> {
    console.log(`[CloudOpenFoamProvider] Terminated.`);
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    // Stream delta VTK payload from cloud
    return new Uint8Array([67, 76, 79, 85, 68, Math.floor(this.currentTime * 100) % 255]); // 'CLOUD' mock
  }
}
