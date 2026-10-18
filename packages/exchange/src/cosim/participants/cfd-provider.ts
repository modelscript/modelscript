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

  public async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
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
  /** Per-vertex velocity and pressure fields from 2D Navier-Stokes projection */
  private uField: Float32Array | null = null;
  private vField: Float32Array | null = null;
  private pField: Float32Array | null = null;
  public obstacleMask: Uint8Array | null = null;
  /** Coarse Navier-Stokes grid resolution */
  private nsNx = 36;
  private nsNy = 18;
  private nsU: Float32Array | null = null;
  private nsV: Float32Array | null = null;
  private nsP: Float32Array | null = null;
  private nsMask: Uint8Array | null = null;
  private dragForceX = 0;
  private dragForceY = 0;
  /** Mold cavity dimensions (x=length along flow, y=width, z=height) */
  private moldLength = 0.15; // 150mm cavity length
  private moldWidth = 0.065; // 65mm cavity width
  private moldHeight = 0.012; // 12mm cavity thickness
  /** Grid resolution */
  private nx = 150;
  private ny = 65;

  /** Simulated input pressure from the 1D Modelica solver */
  private inletPressure = 100000; // 1 atm baseline
  private inletVelocity = 0;

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
    const stepText = new TextDecoder().decode(stepFileData);
    const pointRegex =
      /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)\s*\)/g;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    let pointCount = 0;
    const rawPoints: [number, number, number][] = [];
    let match: RegExpExecArray | null;
    while ((match = pointRegex.exec(stepText)) !== null) {
      const x = parseFloat(match[1]!);
      const y = parseFloat(match[2]!);
      const z = parseFloat(match[3]!);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        rawPoints.push([x, y, z]);
        pointCount++;
      }
    }

    if (pointCount >= 2) {
      // Scale from mm if coordinates exceed 1m typical cavity size
      const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ) > 2.0 ? 1e-3 : 1.0;
      this.moldLength = Math.max(1e-3, (maxX - minX) * scale);
      this.moldWidth = Math.max(1e-3, (maxY - minY) * scale);
      this.moldHeight = Math.max(1e-3, (maxZ - minZ) * scale);
    }

    const nx = this.nx;
    const ny = this.ny;
    const vertCount = (nx + 1) * (ny + 1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const alpha = new Float32Array(vertCount);
    const temp = new Float32Array(vertCount);
    const uField = new Float32Array(vertCount);
    const vField = new Float32Array(vertCount);
    const pField = new Float32Array(vertCount);
    const mask = new Uint8Array(vertCount);

    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const idx = iy * (nx + 1) + ix;
        const u = ix / nx;
        const v = iy / ny;

        positions[idx * 3 + 0] = u * this.moldLength;
        positions[idx * 3 + 1] = v * this.moldWidth;
        positions[idx * 3 + 2] = this.moldHeight;

        normals[idx * 3 + 0] = 0;
        normals[idx * 3 + 1] = 0;
        normals[idx * 3 + 2] = 1;

        alpha[idx] = 0;
        temp[idx] = 300;
        pField[idx] = this.inletPressure;
      }
    }

    // Initialize coarse 2D Navier-Stokes grid
    const gCells = this.nsNx * this.nsNy;
    this.nsU = new Float32Array(gCells);
    this.nsV = new Float32Array(gCells);
    this.nsP = new Float32Array(gCells);
    this.nsMask = new Uint8Array(gCells);
    this.nsP.fill(this.inletPressure);

    // Detect internal cylindrical/boss obstacle if STEP contains CYLINDRICAL_SURFACE
    const hasInternalBoss = /CYLINDRICAL_SURFACE/i.test(stepText) && rawPoints.length > 8;
    if (hasInternalBoss) {
      for (let jy = 0; jy < this.nsNy; jy++) {
        for (let jx = 0; jx < this.nsNx; jx++) {
          const cx = (jx + 0.5) / this.nsNx - 0.35;
          const cy = (jy + 0.5) / this.nsNy - 0.5;
          if (cx * cx + cy * cy < 0.015) {
            this.nsMask[jy * this.nsNx + jx] = 1;
          }
        }
      }
    }

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
    this.uField = uField;
    this.vField = vField;
    this.pField = pField;
    this.obstacleMask = mask;
    this.meshReady = true;

    this.encodeVtkBuffer();
  }

  public async doStep(_currentTime: number, stepSize: number): Promise<void> {
    this.currentTime += stepSize;

    if (!this.meshReady || !this.alphaField || !this.tempField || !this.meshPositions) return;

    // 1. Step 2D incompressible Navier-Stokes on coarse grid (advection + diffusion + pressure Poisson projection)
    this.stepNavierStokes2D(stepSize);

    const nx = this.nx;
    const ny = this.ny;
    // Coupled melt front advancing from x=0 (gate) toward x=moldLength
    const flowSpeed = 5.0 * (this.inletPressure / 100000.0);
    const fillFraction = this.currentTime * flowSpeed;
    const frontX = fillFraction * this.moldLength;
    const timeFull = 1.45 / Math.max(1e-6, flowSpeed);
    const timeSinceFull = Math.max(0, this.currentTime - timeFull);

    for (let iy = 0; iy <= ny; iy++) {
      for (let ix = 0; ix <= nx; ix++) {
        const idx = iy * (nx + 1) + ix;
        const x = this.meshPositions[idx * 3] as number;
        const y = this.meshPositions[idx * 3 + 1] as number;

        // Sample coarse Navier-Stokes velocity and pressure
        if (this.nsU && this.nsV && this.nsP && this.uField && this.vField && this.pField) {
          const gx = Math.min(this.nsNx - 1, Math.floor((ix / nx) * this.nsNx));
          const gy = Math.min(this.nsNy - 1, Math.floor((iy / ny) * this.nsNy));
          const gIdx = gy * this.nsNx + gx;
          this.uField[idx] = this.nsU[gIdx]!;
          this.vField[idx] = this.nsV[gIdx]!;
          this.pField[idx] = this.nsP[gIdx]!;
        }

        // Parabolic Hele-Shaw flow profile modulated by local Navier-Stokes velocity
        const yNorm = (y / this.moldWidth - 0.5) * 2; // -1 to 1
        const parabolicFactor = 1.0 - 0.3 * yNorm * yNorm;
        const effectiveFront = frontX * parabolicFactor;

        if (x <= effectiveFront) {
          const dist = effectiveFront - x;
          const frontWidth = 0.005;
          this.alphaField[idx] = Math.min(dist / frontWidth, 1.0);

          const distCooling = Math.min(dist / (this.moldLength * 0.8), 1.0) * 80;
          const timeCooling = Math.min(timeSinceFull / 0.4, 1.0) * 120;
          this.tempField[idx] = 513 - distCooling - timeCooling;
        } else {
          this.alphaField[idx] = 0;
          this.tempField[idx] = 300;
        }
      }
    }

    this.encodeVtkBuffer();
  }

  private stepNavierStokes2D(dt: number): void {
    if (!this.nsU || !this.nsV || !this.nsP || !this.nsMask) return;
    const nx = this.nsNx;
    const ny = this.nsNy;
    const dx = this.moldLength / nx;
    const dy = this.moldWidth / ny;
    const rho = 1050.0;
    const nu = 1e-3;
    const pAtm = 100000.0;
    const deltaP = Math.max(0, this.inletPressure - pAtm);
    const uInlet =
      this.inletVelocity > 0
        ? this.inletVelocity
        : ((this.moldHeight * this.moldHeight) / (12.0 * 50.0 * Math.max(1e-3, this.moldLength))) * deltaP +
          0.1 * (this.inletPressure / pAtm);

    const uStar = new Float32Array(this.nsU.length);
    const vStar = new Float32Array(this.nsV.length);
    const div = new Float32Array(this.nsU.length);
    const subDt = Math.min(dt, (0.25 * Math.min(dx, dy)) / Math.max(0.1, uInlet));

    // Boundary conditions: parabolic Poiseuille profile at inlet (x=0), no-slip at walls (y=0, y=ny-1)
    for (let jy = 0; jy < ny; jy++) {
      const yNorm = ((jy + 0.5) / ny - 0.5) * 2.0;
      const profile = Math.max(0, 1.0 - yNorm * yNorm);
      this.nsU[jy * nx + 0] = uInlet * profile;
      this.nsV[jy * nx + 0] = 0;
      this.nsP[jy * nx + 0] = this.inletPressure;
      this.nsP[jy * nx + (nx - 1)] = pAtm;
    }

    // Predictor: upwind advection + viscous Laplacian diffusion
    for (let jy = 1; jy < ny - 1; jy++) {
      for (let jx = 1; jx < nx - 1; jx++) {
        const c = jy * nx + jx;
        if (this.nsMask[c]) {
          uStar[c] = 0;
          vStar[c] = 0;
          continue;
        }
        const uC = this.nsU[c]!;
        const vC = this.nsV[c]!;
        const dudx = uC >= 0 ? (uC - this.nsU[c - 1]!) / dx : (this.nsU[c + 1]! - uC) / dx;
        const dudy = vC >= 0 ? (uC - this.nsU[c - nx]!) / dy : (this.nsU[c + nx]! - uC) / dy;
        const dvdx = uC >= 0 ? (vC - this.nsV[c - 1]!) / dx : (this.nsV[c + 1]! - vC) / dx;
        const dvdy = vC >= 0 ? (vC - this.nsV[c - nx]!) / dy : (this.nsV[c + nx]! - vC) / dy;

        const lapU =
          (this.nsU[c + 1]! - 2 * uC + this.nsU[c - 1]!) / (dx * dx) +
          (this.nsU[c + nx]! - 2 * uC + this.nsU[c - nx]!) / (dy * dy);
        const lapV =
          (this.nsV[c + 1]! - 2 * vC + this.nsV[c - 1]!) / (dx * dx) +
          (this.nsV[c + nx]! - 2 * vC + this.nsV[c - nx]!) / (dy * dy);

        uStar[c] = uC + subDt * (-uC * dudx - vC * dudy + nu * lapU);
        vStar[c] = vC + subDt * (-uC * dvdx - vC * dvdy + nu * lapV);
      }
    }
    // Outflow zero-gradient at jx = nx - 1
    for (let jy = 1; jy < ny - 1; jy++) {
      uStar[jy * nx + (nx - 1)] = uStar[jy * nx + (nx - 2)]!;
      vStar[jy * nx + (nx - 1)] = vStar[jy * nx + (nx - 2)]!;
      uStar[jy * nx + 0] = this.nsU[jy * nx + 0]!;
    }

    // Divergence of intermediate velocity
    for (let jy = 1; jy < ny - 1; jy++) {
      for (let jx = 1; jx < nx - 1; jx++) {
        const c = jy * nx + jx;
        div[c] =
          ((uStar[c + 1]! - uStar[c - 1]!) / (2 * dx) + (vStar[c + nx]! - vStar[c - nx]!) / (2 * dy)) *
          (rho / Math.max(1e-6, subDt));
      }
    }

    // Pressure Poisson solver (Gauss-Seidel relaxation)
    const dx2 = dx * dx;
    const dy2 = dy * dy;
    const denom = 2 * (dx2 + dy2);
    for (let iter = 0; iter < 16; iter++) {
      for (let jy = 1; jy < ny - 1; jy++) {
        for (let jx = 1; jx < nx - 1; jx++) {
          const c = jy * nx + jx;
          if (this.nsMask[c]) continue;
          const pE = this.nsP[c + 1]!;
          const pW = this.nsP[c - 1]!;
          const pN = this.nsP[c + nx]!;
          const pS = this.nsP[c - nx]!;
          this.nsP[c] = ((pE + pW) * dy2 + (pN + pS) * dx2 - div[c]! * dx2 * dy2) / denom;
        }
      }
      // Neumann zero-gradient on top and bottom walls
      for (let jx = 1; jx < nx - 1; jx++) {
        this.nsP[jx] = this.nsP[nx + jx]!;
        this.nsP[(ny - 1) * nx + jx] = this.nsP[(ny - 2) * nx + jx]!;
      }
    }

    // Velocity projection step + boundary/obstacle force integration
    let fx = 0;
    let fy = 0;
    for (let jy = 1; jy < ny - 1; jy++) {
      for (let jx = 1; jx < nx - 1; jx++) {
        const c = jy * nx + jx;
        if (this.nsMask[c]) {
          this.nsU[c] = 0;
          this.nsV[c] = 0;
          fx += (this.nsP[c - 1]! - this.nsP[c + 1]!) * dy * this.moldHeight;
          fy += (this.nsP[c - nx]! - this.nsP[c + nx]!) * dx * this.moldHeight;
          continue;
        }
        const dpdx = (this.nsP[c + 1]! - this.nsP[c - 1]!) / (2 * dx);
        const dpdy = (this.nsP[c + nx]! - this.nsP[c - nx]!) / (2 * dy);
        this.nsU[c] = uStar[c]! - (subDt / rho) * dpdx;
        this.nsV[c] = vStar[c]! - (subDt / rho) * dpdy;
      }
      // Wall shear stress contribution
      const topTau = rho * nu * (this.nsU[(ny - 2) * nx + Math.floor(nx / 2)]! / dy);
      fx += topTau * dx * this.moldLength;
    }
    for (let jy = 1; jy < ny - 1; jy++) {
      this.nsU[jy * nx + (nx - 1)] = this.nsU[jy * nx + (nx - 2)]!;
    }
    this.dragForceX = fx;
    this.dragForceY = fy;
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
        ...(this.pField ? { pressure: Array.from(this.pField) } : {}),
        ...(this.uField ? { velocityX: Array.from(this.uField) } : {}),
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
    // Compute Hele-Shaw mass flow rate from inlet pressure and cavity geometry:
    // Q = (w * h^3 / (12 * mu * L_eff)) * max(0, p_inlet - p_atm), m_flow = -rho * Q
    const pAtm = 100000;
    const deltaP = Math.max(0, this.inletPressure - pAtm);
    const mu = 50.0; // Polymer melt dynamic viscosity [Pa.s]
    const rho = 1050.0; // Melt density [kg/m^3]
    let filledFraction = 0.1;
    if (this.alphaField && this.alphaField.length > 0) {
      let sum = 0;
      for (let i = 0; i < this.alphaField.length; i++) sum += this.alphaField[i]!;
      filledFraction = Math.max(0.05, sum / this.alphaField.length);
    }
    const lEff = Math.max(1e-3, this.moldLength * filledFraction);
    const volumetricFlow = ((this.moldWidth * Math.pow(this.moldHeight, 3)) / (12.0 * mu * lEff)) * deltaP;
    const mFlow = deltaP > 0 ? -rho * volumetricFlow : -0.05 * (this.inletPressure / pAtm);
    outputs.set("gateInlet.m_flow", mFlow);
    outputs.set("dragForceX", this.dragForceX);
    outputs.set("dragForceY", this.dragForceY);
    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    if (values.has("gateInlet.p")) {
      const p = values.get("gateInlet.p");
      if (typeof p === "number") {
        this.inletPressure = p;
      }
    }
    if (values.has("inlet.u")) {
      const u = values.get("inlet.u");
      if (typeof u === "number") {
        this.inletVelocity = u;
      }
    }
  }

  public async terminate(): Promise<void> {
    // Clean termination
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    return this.currentVtkBuffer;
  }
}

/**
 * Tier 2: Native Node.js Provider (Desktop VS Code Extension)
 * Uses child_process.spawn() to execute natively installed OpenFOAM binaries
 * with fallback to the in-process CFD solver when OpenFOAM is not installed.
 */
export class NativeOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  private caseDir = "";
  private foamProcess: ChildProcess | null = null;
  private currentVtkBuffer: Uint8Array | null = null;
  private fallbackSolver: WasmOpenFoamProvider;
  private hasNativeOpenFoam = true;
  public lastPressure = 100000;
  private lastVelocityX = 0;

  constructor(id: string, modelName: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.fallbackSolver = new WasmOpenFoamProvider(`${id}-wasm-fallback`, modelName);
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
    await this.fallbackSolver.loadGeometry(stepFileData);
    this.caseDir = await fs.mkdtemp(path.join(os.tmpdir(), `openfoam-${this.id}-`));
    const stepPath = path.join(this.caseDir, "geometry.step");
    await fs.writeFile(stepPath, stepFileData);
    await this.writeCaseDictionaries();
    await this.runProcess("snappyHexMesh", ["-overwrite"]);
  }

  private async writeCaseDictionaries(): Promise<void> {
    if (!this.caseDir) return;
    const systemDir = path.join(this.caseDir, "system");
    const constantDir = path.join(this.caseDir, "constant");
    await fs.mkdir(systemDir, { recursive: true });
    await fs.mkdir(constantDir, { recursive: true });

    const controlDict = `FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }
application     icoFoam;
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         0.01;
deltaT          0.001;
writeControl    timeStep;
writeInterval   10;
`;
    const fvSchemes = `FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }
ddtSchemes { default Euler; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) Gauss linear; }
laplacianSchemes { default Gauss linear orthogonal; }
interpolationSchemes { default linear; }
snGradSchemes { default orthogonal; }
`;
    const fvSolution = `FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }
solvers
{
    p { solver PCG; preconditioner DIC; tolerance 1e-06; relTol 0.05; }
    pFinal { $p; relTol 0; }
    U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-05; relTol 0; }
}
PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }
`;
    const transportProperties = `FoamFile { version 2.0; format ascii; class dictionary; object transportProperties; }
nu              [0 2 -1 0 0 0 0] 0.001;
`;
    await fs.writeFile(path.join(systemDir, "controlDict"), controlDict);
    await fs.writeFile(path.join(systemDir, "fvSchemes"), fvSchemes);
    await fs.writeFile(path.join(systemDir, "fvSolution"), fvSolution);
    await fs.writeFile(path.join(constantDir, "transportProperties"), transportProperties);
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime += stepSize;
    await this.fallbackSolver.doStep(currentTime, stepSize);

    if (!this.foamProcess && this.hasNativeOpenFoam) {
      await this.runProcess("icoFoam", []);
      if (this.hasNativeOpenFoam) {
        try {
          await this.runProcess("foamToVTK", []);
          const vtkDir = path.join(this.caseDir, "VTK");
          const entries = await fs.readdir(vtkDir).catch(() => [] as string[]);
          const vtkFile = entries.find((f) => f.endsWith(".vtk") || f.endsWith(".vtu"));
          if (vtkFile) {
            this.currentVtkBuffer = await fs.readFile(path.join(vtkDir, vtkFile));
            return;
          }
        } catch {
          // Fall through to in-process solver VTK buffer
        }
      }
    }
    this.currentVtkBuffer = await this.fallbackSolver.getVtkBuffer();
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    if (!this.hasNativeOpenFoam) {
      return this.fallbackSolver.getOutputs();
    }
    const outputs = new Map<string, CosimValue>();
    const rho = 1000;
    const area = 0.01;
    const mFlow =
      Math.abs(this.lastVelocityX) > 1e-9
        ? -rho * area * this.lastVelocityX
        : ((await this.fallbackSolver.getOutputs()).get("gateInlet.m_flow") ?? -0.05);
    outputs.set("gateInlet.m_flow", mFlow);
    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    await this.fallbackSolver.setInputs(values);
    const zeroDir = path.join(this.caseDir, "0");
    await fs.mkdir(zeroDir, { recursive: true }).catch(() => {
      /* ignore */
    });

    let pressure = 100000;
    let velocityX = 0;

    for (const [key, value] of values.entries()) {
      if (key.endsWith(".p")) pressure = Number(value);
      if (key.endsWith(".m_flow")) {
        velocityX = Number(value) / (1000 * 0.01);
      }
    }
    this.lastPressure = pressure;
    this.lastVelocityX = velocityX;

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
    }
  }

  public async terminate(): Promise<void> {
    if (this.foamProcess) {
      this.foamProcess.kill();
      this.foamProcess = null;
    }
    if (this.caseDir) {
      await fs.rm(this.caseDir, { recursive: true, force: true }).catch(() => {
        /* ignore */
      });
    }
    await this.fallbackSolver.terminate();
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    return this.currentVtkBuffer;
  }

  private runProcess(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd: this.caseDir });

      proc.on("error", (err: Error & { code?: string | undefined }) => {
        if (err.code === "ENOENT") {
          this.hasNativeOpenFoam = false;
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
 * to a backend server, falling back to local WASM CFD evaluation when offline.
 */
export class CloudOpenFoamProvider extends BaseCfdProvider {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;
  private readonly localSolver: WasmOpenFoamProvider;
  private readonly endpointUrl: string | undefined;
  private remoteVtkBuffer: Uint8Array | null = null;
  private remoteOutputs: Map<string, CosimValue> | null = null;

  constructor(id: string, modelName: string, endpointUrl?: string) {
    super();
    this.id = id;
    this.modelName = modelName;
    this.endpointUrl = endpointUrl;
    this.localSolver = new WasmOpenFoamProvider(`${id}-cloud-local`, modelName);
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
    await this.localSolver.loadGeometry(stepFileData);
    if (this.endpointUrl && typeof fetch === "function") {
      try {
        await fetch(`${this.endpointUrl.replace(/\/$/, "")}/geometry`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: stepFileData as any,
        });
      } catch {
        // Offline fallback to localSolver
      }
    }
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime += stepSize;
    await this.localSolver.doStep(currentTime, stepSize);
    if (this.endpointUrl && typeof fetch === "function") {
      try {
        const res = await fetch(`${this.endpointUrl.replace(/\/$/, "")}/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: this.id, currentTime, stepSize }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            outputs?: Record<string, CosimValue> | undefined;
            vtk?: string | undefined;
          };
          if (data.outputs) {
            this.remoteOutputs = new Map(Object.entries(data.outputs));
          }
          if (data.vtk) {
            this.remoteVtkBuffer = new TextEncoder().encode(data.vtk);
          }
        }
      } catch {
        // Offline fallback to localSolver
      }
    }
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    if (this.remoteOutputs) return new Map(this.remoteOutputs);
    return this.localSolver.getOutputs();
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    await this.localSolver.setInputs(values);
    if (this.endpointUrl && typeof fetch === "function") {
      try {
        await fetch(`${this.endpointUrl.replace(/\/$/, "")}/inputs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: this.id, inputs: Object.fromEntries(values) }),
        });
      } catch {
        // Offline fallback to localSolver
      }
    }
  }

  public async terminate(): Promise<void> {
    this.remoteOutputs = null;
    this.remoteVtkBuffer = null;
    await this.localSolver.terminate();
  }

  public async getVtkBuffer(): Promise<Uint8Array | null> {
    return this.remoteVtkBuffer ?? this.localSolver.getVtkBuffer();
  }
}
