// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CaeResultProcessor } from "./cae-result-processor.js";
import { CaeTelemetryStreamer, type CaeSolverType } from "./cae-telemetry-streamer.js";
import { getComputeProfile } from "./hpc/compute-profiles.js";
import { HpcEngine } from "./hpc/hpc-engine.js";
import type { HpcJobSpec, HpcUsageMetrics } from "./hpc/hpc-types.js";

export interface CaeJobSpec {
  jobId: string;
  solver: CaeSolverType;
  deckContent: string;
  deckFormat: "inp" | "cfg";
  geometryPath?: string | undefined;
  cores?: number | undefined;
  timeoutSeconds?: number | undefined;
  runner?: "auto" | "docker" | "host" | "fallback" | undefined;
  profile?: string | undefined;
  resultDir: string;
}

export interface CaeExecutionResult {
  jobId: string;
  status: "completed" | "failed" | "cancelled";
  resultVtuPath?: string | undefined;
  scalarsPath?: string | undefined;
  error?: string | undefined;
  durationMs: number;
  usage?: HpcUsageMetrics | undefined;
  profile?: string | undefined;
  simulatedFallback?: boolean | undefined;
}

export function getValidatedGeometryPath(rawPath: string): string {
  if (typeof rawPath !== "string") {
    throw new Error("Invalid geometry path: expected string");
  }
  const resolved = path.resolve(rawPath);

  const cwdRoot = path.resolve(process.cwd());
  const relCwd = path.relative(cwdRoot, resolved);
  if (!relCwd.startsWith("..") && !path.isAbsolute(relCwd)) {
    const candidate = path.resolve(cwdRoot, relCwd);
    if (fs.existsSync(candidate)) {
      const real = fs.realpathSync(candidate);
      const relReal = path.relative(cwdRoot, real);
      if (!relReal.startsWith("..") && !path.isAbsolute(relReal)) {
        return path.resolve(cwdRoot, relReal);
      }
    }
  }

  const tmpRoot = path.resolve(os.tmpdir());
  const relTmp = path.relative(tmpRoot, resolved);
  if (!relTmp.startsWith("..") && !path.isAbsolute(relTmp)) {
    const candidate = path.resolve(tmpRoot, relTmp);
    if (fs.existsSync(candidate)) {
      const real = fs.realpathSync(candidate);
      const relReal = path.relative(tmpRoot, real);
      if (!relReal.startsWith("..") && !path.isAbsolute(relReal)) {
        return path.resolve(tmpRoot, relReal);
      }
    }
  }

  throw new Error(`Unauthorized or nonexistent geometry path: ${rawPath}`);
}

/**
 * Multi-Target Cloud Solver Runner.
 * Executes CalculiX (ccx), SU2 (SU2_CFD), and OpenFOAM solvers via the unified HPC engine
 * supporting local process execution and Slurm supercomputing clusters.
 */
export class CaeSolverRunner {
  private readonly hpcEngine: HpcEngine;
  private readonly activeNativeJobIds = new Map<string, string>();
  private readonly cancelledJobs = new Set<string>();

  constructor(hpcEngine?: HpcEngine) {
    this.hpcEngine = hpcEngine || new HpcEngine();
  }

  /**
   * Runs a solver job asynchronously with real-time telemetry streaming and result processing.
   */
  public async executeJob(spec: CaeJobSpec, telemetryStreamer: CaeTelemetryStreamer): Promise<CaeExecutionResult> {
    const startTime = Date.now();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `modelscript-cae-${spec.solver}-${spec.jobId}-`));
    fs.mkdirSync(spec.resultDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(spec.resultDir, "job_spec.json"), JSON.stringify(spec, null, 2), "utf8");
    } catch {}

    const logPath = path.join(spec.resultDir, "solver.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    try {
      if (this.cancelledJobs.has(spec.jobId)) {
        throw new Error("Job CANCELLED before execution");
      }

      // 1. Stage input files in temporary workspace
      const deckFileName = spec.solver === "calculix" ? "job.inp" : "config.cfg";
      const deckPath = path.join(tmpDir, deckFileName);
      fs.writeFileSync(deckPath, spec.deckContent, "utf8");

      if (spec.geometryPath && typeof spec.geometryPath === "string") {
        const safeSource = getValidatedGeometryPath(spec.geometryPath);
        const cleanBase = path.basename(spec.geometryPath).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!cleanBase || cleanBase === "." || cleanBase === "..") {
          throw new Error("Invalid geometry filename");
        }
        const relDest = path.relative(tmpDir, path.resolve(tmpDir, cleanBase));
        if (relDest.startsWith("..") || path.isAbsolute(relDest)) {
          throw new Error(`Unauthorized destination path: ${cleanBase}`);
        }
        const geomDest = path.resolve(tmpDir, relDest);

        try {
          fs.symlinkSync(safeSource, geomDest);
        } catch {
          fs.copyFileSync(safeSource, geomDest);
        }
      }

      // 2. Select execution command
      const { command, args, simulatedFallback } = this.resolveExecutionCommand(spec, tmpDir, deckFileName);
      if (simulatedFallback) {
        telemetryStreamer.emit("telemetry", {
          type: "phase",
          phase: "Fallback",
          message: `Native ${spec.solver.toUpperCase()} binary not found in PATH; running built-in synthetic solver fallback.`,
          timestamp: Date.now(),
        });
      }

      // 3. Resolve profile & build HPC spec
      const profile = getComputeProfile(spec.profile);
      const requestedMinutes = spec.timeoutSeconds ? Math.ceil(spec.timeoutSeconds / 60) : undefined;
      const maxProfileMinutes = profile.maxWallClockMinutes ?? 30;
      const effectiveTimeLimitMinutes =
        requestedMinutes !== undefined ? Math.min(requestedMinutes, maxProfileMinutes) : undefined;

      const hpcSpec: HpcJobSpec = {
        jobId: spec.jobId,
        name: `CAE-${spec.solver.toUpperCase()}-${spec.jobId}`,
        command,
        args,
        workingDir: tmpDir,
        profileId: profile.id,
        resources: {
          cpusPerTask: spec.cores || profile.cpus,
          memoryMb: profile.memoryMb,
          partition: profile.partition,
          gpus: profile.gpus,
          gpuType: profile.gpuType,
          timeLimitMinutes: effectiveTimeLimitMinutes,
        },
      };

      // 4. Submit and wait for completion with live telemetry streaming
      const { submission } = await this.hpcEngine.submitJob(hpcSpec, profile.id);
      this.activeNativeJobIds.set(spec.jobId, submission.nativeJobId);

      if (this.cancelledJobs.has(spec.jobId)) {
        await this.hpcEngine.cancel(submission.nativeJobId);
        throw new Error("Job CANCELLED by user");
      }

      const usage = await this.hpcEngine.waitForCompletion(submission.nativeJobId, tmpDir, profile, (chunk) => {
        logStream.write(chunk);
        telemetryStreamer.processChunk(chunk);
      });

      if (this.cancelledJobs.has(spec.jobId)) {
        throw new Error("Job CANCELLED by user");
      }

      if (usage.exitCode !== 0) {
        throw new Error(`Solver exited with code ${usage.exitCode}`);
      }

      // 5. Post-process solver results into result.vtu
      const vtuPath = path.join(spec.resultDir, "result.vtu");
      const scalarsPath = path.join(spec.resultDir, "scalars.json");

      await this.processResults(spec, tmpDir, vtuPath, scalarsPath, simulatedFallback);

      telemetryStreamer.emit("telemetry", {
        type: "phase",
        phase: "Completed",
        message: "Simulation and post-processing completed successfully.",
        timestamp: Date.now(),
      });

      return {
        jobId: spec.jobId,
        status: "completed",
        resultVtuPath: vtuPath,
        scalarsPath,
        durationMs: Date.now() - startTime,
        usage,
        profile: profile.id,
        simulatedFallback,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logStream.write(`\n[CAE Runner Error]: ${errMsg}\n`);
      return {
        jobId: spec.jobId,
        status: errMsg.includes("CANCELLED") ? "cancelled" : "failed",
        error: errMsg,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.activeNativeJobIds.delete(spec.jobId);
      this.cancelledJobs.delete(spec.jobId);
      logStream.end();
      if (fs.existsSync(tmpDir)) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      }
    }
  }

  /**
   * Cancels a running solver job using its mapped native cluster job ID.
   */
  public cancelJob(jobId: string): boolean {
    this.cancelledJobs.add(jobId);
    const nativeId = this.activeNativeJobIds.get(jobId) ?? jobId;
    void this.hpcEngine.cancel(nativeId);
    return true;
  }

  private resolveExecutionCommand(
    spec: CaeJobSpec,
    tmpDir: string,
    deckFileName: string,
  ): { command: string; args: string[]; simulatedFallback?: boolean | undefined } {
    // Check if Docker is available and explicitly enabled or requested
    const hasDocker = this.isExecutableInPath("docker");
    const useDocker = spec.runner === "docker" || (hasDocker && process.env["CAE_USE_DOCKER"] === "true");

    if (useDocker) {
      const imageName =
        spec.solver === "calculix"
          ? "ghcr.io/modelscript/solver-calculix:latest"
          : spec.solver === "su2"
            ? "ghcr.io/modelscript/solver-su2:latest"
            : "ghcr.io/modelscript/solver-openfoam:latest";

      const dockerArgs = [
        "run",
        "--rm",
        `--cpus=${spec.cores || 4}`,
        "-v",
        `${tmpDir}:/workspace:rw`,
        "-w",
        "/workspace",
        imageName,
      ];

      if (spec.solver === "calculix") {
        dockerArgs.push("ccx", "-i", "job");
      } else if (spec.solver === "su2") {
        dockerArgs.push("SU2_CFD", deckFileName);
      } else {
        dockerArgs.push("simpleFoam");
      }

      return { command: "docker", args: dockerArgs, simulatedFallback: false };
    }

    // Check host binaries
    if (spec.solver === "calculix" && this.isExecutableInPath("ccx")) {
      return { command: "ccx", args: ["-i", "job"], simulatedFallback: false };
    }
    if (spec.solver === "su2" && this.isExecutableInPath("SU2_CFD")) {
      return { command: "SU2_CFD", args: [deckFileName], simulatedFallback: false };
    }
    if (spec.solver === "openfoam" && this.isExecutableInPath("simpleFoam")) {
      return { command: "simpleFoam", args: [], simulatedFallback: false };
    }

    // Built-in synthetic fallback runner for CI / local test
    const scriptPath = path.join(tmpDir, "fallback_runner.cjs");
    fs.writeFileSync(scriptPath, this.generateFallbackScript(spec), "utf8");
    return {
      command: process.execPath,
      args: [scriptPath],
      simulatedFallback: true,
    };
  }

  private async processResults(
    spec: CaeJobSpec,
    tmpDir: string,
    vtuPath: string,
    scalarsPath: string,
    simulatedFallback?: boolean,
  ): Promise<void> {
    if (spec.solver === "calculix") {
      const frdPath = path.join(tmpDir, "job.frd");
      if (fs.existsSync(frdPath)) {
        const frdText = fs.readFileSync(frdPath, "utf8");
        const parsedFrd = CaeResultProcessor.parseCalculixFrd(frdText);
        const vtuXml = CaeResultProcessor.convertFrdToVtu(parsedFrd);
        fs.writeFileSync(vtuPath, vtuXml, "utf8");

        const scalars = {
          ...CaeResultProcessor.extractScalarSummary(vtuXml, "CalculiX"),
          ...(simulatedFallback ? { simulatedFallback: true } : {}),
        };
        fs.writeFileSync(scalarsPath, JSON.stringify(scalars, null, 2), "utf8");

        const meshPayload = CaeResultProcessor.extractFeaMeshPayload(parsedFrd);
        const meshPayloadPath = path.join(spec.resultDir, "mesh_payload.json");
        fs.writeFileSync(meshPayloadPath, JSON.stringify(meshPayload), "utf8");
        return;
      }
    }

    // SU2 results (.vtk or restart_flow.dat)
    if (spec.solver === "su2") {
      const vtkFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".vtk") || f.endsWith(".vtu"));
      const firstVtk = vtkFiles[0];
      if (firstVtk) {
        fs.copyFileSync(path.join(tmpDir, firstVtk), vtuPath);
        const scalars = {
          ...CaeResultProcessor.extractScalarSummary(vtuPath, "SU2"),
          ...(simulatedFallback ? { simulatedFallback: true } : {}),
        };
        fs.writeFileSync(scalarsPath, JSON.stringify(scalars, null, 2), "utf8");

        const vtuXml = fs.readFileSync(vtuPath, "utf8");
        const meshPayload = CaeResultProcessor.parseVtuToMeshPayload(vtuXml);
        const meshPayloadPath = path.join(spec.resultDir, "mesh_payload.json");
        fs.writeFileSync(meshPayloadPath, JSON.stringify(meshPayload), "utf8");
        return;
      }
    }

    // Any .vtu created by fallback or solver
    const vtuCandidates = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".vtu"));
    const firstVtu = vtuCandidates[0];
    if (firstVtu) {
      fs.copyFileSync(path.join(tmpDir, firstVtu), vtuPath);
      const scalars = {
        ...CaeResultProcessor.extractScalarSummary(vtuPath, spec.solver),
        ...(simulatedFallback ? { simulatedFallback: true } : {}),
      };
      fs.writeFileSync(scalarsPath, JSON.stringify(scalars, null, 2), "utf8");

      const vtuXml = fs.readFileSync(vtuPath, "utf8");
      const meshPayload = CaeResultProcessor.parseVtuToMeshPayload(vtuXml);
      const meshPayloadPath = path.join(spec.resultDir, "mesh_payload.json");
      fs.writeFileSync(meshPayloadPath, JSON.stringify(meshPayload), "utf8");
      return;
    }

    throw new Error(`Solver produced no valid .frd, .vtk, or .vtu result.`);
  }

  private isExecutableInPath(name: string): boolean {
    const paths = (process.env["PATH"] || "").split(path.delimiter);
    for (const p of paths) {
      const full = path.join(p, name);
      if (fs.existsSync(full)) {
        try {
          fs.accessSync(full, fs.constants.X_OK);
          return true;
        } catch {
          // not executable
        }
      }
    }
    return false;
  }

  private generateFallbackScript(spec: CaeJobSpec): string {
    let scale = 1.0;
    const match = spec.deckContent.match(/2,\s*2,\s*([\d.eE+-]+)/);
    if (match && match[1]) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0) scale = num / 100.0;
    } else {
      let foundVal: number | null = null;
      let inCload = false;
      for (const rawLine of spec.deckContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.toUpperCase().startsWith("*CLOAD")) {
          inCload = true;
          continue;
        }
        if (inCload) {
          if (line.startsWith("*")) break;
          const parts = line.split(",").map((s) => s.trim());
          if (parts.length >= 3) {
            const loadVal = Math.abs(parseFloat(parts[2]!));
            if (!isNaN(loadVal) && loadVal > 0) {
              foundVal = loadVal / 100.0;
              break;
            }
          }
        }
      }
      if (foundVal !== null) {
        scale = foundVal;
      } else {
        const hashByte = Buffer.from(spec.jobId).reduce((a, b) => a + b, 0);
        scale = 0.8 + (hashByte % 10) * 0.1;
      }
    }

    // Parse *NODE and *ELEMENT from job.inp if present
    const parsedNodes: { id: number; x: number; y: number; z: number }[] = [];
    const parsedElems: { id: number; nodes: number[] }[] = [];
    let section: "none" | "node" | "element" = "none";
    for (const rawLine of spec.deckContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("**")) continue;
      if (line.startsWith("*")) {
        const upper = line.toUpperCase();
        if (upper.startsWith("*NODE")) section = "node";
        else if (upper.startsWith("*ELEMENT")) section = "element";
        else section = "none";
        continue;
      }
      const cols = line
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (section === "node" && cols.length >= 4) {
        const id = parseInt(cols[0]!, 10);
        const x = parseFloat(cols[1]!);
        const y = parseFloat(cols[2]!);
        const z = parseFloat(cols[3]!);
        if (!isNaN(id) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
          parsedNodes.push({ id, x, y, z });
        }
      } else if (section === "element" && cols.length >= 5) {
        const id = parseInt(cols[0]!, 10);
        const nodes = cols
          .slice(1)
          .map((c) => parseInt(c, 10))
          .filter((n) => !isNaN(n));
        if (!isNaN(id) && nodes.length >= 4) {
          parsedElems.push({ id, nodes });
        }
      }
    }

    let frdContent: string;
    if (parsedNodes.length > 4 && parsedElems.length > 0) {
      let minX = Infinity,
        maxX = -Infinity;
      for (const n of parsedNodes) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
      }
      const spanX = Math.max(1e-6, maxX - minX);
      const nodeLines = parsedNodes.map((n) => ` -1 ${n.id} ${n.x} ${n.y} ${n.z}`).join("\\n");
      const elemLines = parsedElems.map((e) => ` -1 ${e.id} 1 1 ${e.nodes.join(" ")}`).join("\\n");
      const dispLines = parsedNodes
        .map((n) => {
          const xi = (n.x - minX) / spanX;
          const dz = (-0.005 * scale * xi * xi).toFixed(6);
          const dx = (0.001 * scale * xi).toFixed(6);
          return ` -1 ${n.id} ${dx} 0.0 ${dz}`;
        })
        .join("\\n");
      const stressLines = parsedNodes
        .map((n) => {
          const xi = (n.x - minX) / spanX;
          const sxx = ((1e7 + 4e7 * (1 - xi)) * scale).toExponential(3);
          return ` -1 ${n.id} ${sxx} 0 0 0 0 0`;
        })
        .join("\\n");
      frdContent = `    1C\\n${nodeLines}\\n    -3\\n    3C\\n${elemLines}\\n    -3\\n -4 DISP\\n${dispLines}\\n    -3\\n -4 STRESS\\n${stressLines}\\n    -3\\n`;
    } else {
      const s1 = (1e7 * scale).toExponential(3);
      const s2 = (2e7 * scale).toExponential(3);
      const s3 = (1.5e7 * scale).toExponential(3);
      const s4 = (5e7 * scale).toExponential(3);
      const d2 = (-0.002 * scale).toFixed(5);
      const d3 = (-0.002 * scale).toFixed(5);
      const d4 = (-0.005 * scale).toFixed(5);
      frdContent = `    1C\\n -1 1 0.0 0.0 0.0\\n -1 2 1.0 0.0 0.0\\n -1 3 0.0 1.0 0.0\\n -1 4 0.0 0.0 1.0\\n    -3\\n    3C\\n -1 1 1 1 1 2 3 4\\n    -3\\n -4 DISP\\n -1 1 0.0 0.0 0.0\\n -1 2 0.001 0.0 ${d2}\\n -1 3 0.0 0.001 ${d3}\\n -1 4 0.0 0.0 ${d4}\\n    -3\\n -4 STRESS\\n -1 1 ${s1} 0 0 0 0 0\\n -1 2 ${s2} 0 0 0 0 0\\n -1 3 ${s3} 0 0 0 0 0\\n -1 4 ${s4} 0 0 0 0 0\\n    -3\\n`;
    }

    return `
const fs = require('fs');
console.log('Starting ${spec.solver.toUpperCase()} simulation...');
if ('${spec.solver}' === 'calculix') {
  console.log('STEP 1');
  console.log('iteration 1 max. residual force = 1.452E-02');
  console.log('iteration 2 max. residual force = 3.210E-04');
  console.log('iteration 3 max. residual force = 1.150E-06');
  console.log('Convergence reached');
  fs.writeFileSync('job.frd', '${frdContent}');
} else {
  console.log('|   Iter|  Time(s)|  Res_Flow[0]|     CLift|     CDrag|');
  console.log('|      1|    0.010|    -1.200000|   0.12000|   0.05000|');
  console.log('|      2|    0.020|    -3.500000|   0.45000|   0.02100|');
  console.log('|      3|    0.030|    -5.800000|   0.45210|   0.02080|');
  fs.writeFileSync('result.vtu', '<VTKFile type="UnstructuredGrid" version="0.1"><UnstructuredGrid><Piece NumberOfPoints="4" NumberOfCells="1"><PointData><DataArray type="Float32" Name="Pressure" format="ascii">101325 101330 101320 101310</DataArray></PointData><Points><DataArray type="Float32" NumberOfComponents="3" format="ascii">0 0 0 1 0 0 0 1 0 0 0 1</DataArray></Points><Cells><DataArray type="Int32" Name="connectivity" format="ascii">0 1 2 3</DataArray><DataArray type="Int32" Name="offsets" format="ascii">4</DataArray><DataArray type="UInt8" Name="types" format="ascii">10</DataArray></Cells></Piece></UnstructuredGrid></VTKFile>');
}
console.log('Job finished successfully.');
`;
  }
}
