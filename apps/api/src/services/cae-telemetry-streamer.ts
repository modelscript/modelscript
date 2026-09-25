// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Response } from "express";
import { EventEmitter } from "node:events";

export type CaeSolverType = "calculix" | "su2" | "openfoam";

export interface CaeIterationEvent {
  type: "iteration";
  step?: number;
  iteration: number;
  time?: number;
  residuals: Record<string, number>;
  metrics?: Record<string, number>; // e.g. CL, CD, maxForce, etc.
  timestamp: number;
  rawLog?: string;
}

export interface CaePhaseEvent {
  type: "phase";
  phase: string;
  message?: string;
  timestamp: number;
}

export interface CaeErrorEvent {
  type: "error";
  message: string;
  timestamp: number;
}

export type CaeTelemetryEvent = CaeIterationEvent | CaePhaseEvent | CaeErrorEvent;

/**
 * Real-time CAE Telemetry Streamer.
 * Parses stdout/stderr streams from CalculiX, SU2, and OpenFOAM into structured telemetry events.
 */
export class CaeTelemetryStreamer extends EventEmitter {
  private buffer = "";
  private currentStep = 1;
  private su2Headers: string[] | null = null;

  constructor(public readonly solver: CaeSolverType) {
    super();
  }

  /**
   * Ingests a raw stdout/stderr text chunk and emits parsed telemetry events.
   */
  public processChunk(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // keep incomplete line in buffer

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        switch (this.solver) {
          case "calculix":
            this.parseCalculixLine(line);
            break;
          case "su2":
            this.parseSu2Line(line);
            break;
          case "openfoam":
            this.parseOpenFoamLine(line);
            break;
        }
      } catch (err: unknown) {
        // Continue processing other lines if one fails parsing
        console.warn(
          `[CaeTelemetryStreamer] Failed to parse line: ${line}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /**
   * Parses CalculiX (ccx) log lines.
   */
  public parseCalculixLine(line: string): void {
    // Step header
    const stepMatch = line.match(/STEP\s+(\d+)/i);
    if (stepMatch && stepMatch[1]) {
      this.currentStep = parseInt(stepMatch[1], 10);
      this.emitEvent({
        type: "phase",
        phase: `Step ${this.currentStep}`,
        message: line,
        timestamp: Date.now(),
      });
      return;
    }

    // Iteration & residual force
    const iterMatch = line.match(/iteration\s+(\d+)/i);
    const forceMatch = line.match(
      /(?:max\.?\s*residual\s*force|largest\s*residual)\s*=?\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i,
    );

    if (iterMatch && iterMatch[1]) {
      const iter = parseInt(iterMatch[1], 10);
      const residualForce = forceMatch && forceMatch[1] ? parseFloat(forceMatch[1]) : 0.0;
      this.emitEvent({
        type: "iteration",
        step: this.currentStep,
        iteration: iter,
        residuals: {
          force: residualForce,
        },
        metrics: {},
        timestamp: Date.now(),
        rawLog: line,
      });
      return;
    }

    if (line.includes("Convergence reached") || line.includes("Job finished")) {
      this.emitEvent({
        type: "phase",
        phase: "Completed",
        message: line,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Parses SU2 tabular log lines.
   * Format example:
   * |   Iter|  Time(s)|  Res_Flow[0]|  Res_Flow[1]|     CLift|     CDrag|
   * |     10|    0.150|    -3.854120|    -3.210451|   0.45100|   0.02100|
   */
  public parseSu2Line(line: string): void {
    if (line.startsWith("|") && line.endsWith("|")) {
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      // Check if header row
      if (cols.some((c) => /iter/i.test(c))) {
        this.su2Headers = cols.map((c) => c.toLowerCase());
        return;
      }

      // Check if numeric data row
      const firstCol = cols[0];
      if (this.su2Headers && firstCol !== undefined && /^\d+$/.test(firstCol)) {
        const iter = parseInt(firstCol, 10);
        let time = 0;
        const residuals: Record<string, number> = {};
        const metrics: Record<string, number> = {};

        for (let i = 1; i < cols.length && i < this.su2Headers.length; i++) {
          const colName = this.su2Headers[i];
          const rawVal = cols[i];
          if (!colName || rawVal === undefined) continue;
          const val = parseFloat(rawVal);
          if (Number.isNaN(val)) continue;

          if (colName.includes("time")) {
            time = val;
          } else if (colName.includes("res")) {
            // SU2 outputs log10 residuals: 10^val
            residuals[colName] = Math.pow(10, val);
          } else if (colName.includes("cl") || colName.includes("clift")) {
            metrics["cL"] = val;
          } else if (colName.includes("cd") || colName.includes("cdrag")) {
            metrics["cD"] = val;
          } else {
            metrics[colName] = val;
          }
        }

        this.emitEvent({
          type: "iteration",
          iteration: iter,
          time,
          residuals,
          metrics,
          timestamp: Date.now(),
          rawLog: line,
        });
      }
    }
  }

  /**
   * Parses OpenFOAM solver log lines.
   */
  public parseOpenFoamLine(line: string): void {
    // Time = 0.05
    const timeMatch = line.match(/^Time\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (timeMatch && timeMatch[1]) {
      const timeVal = parseFloat(timeMatch[1]);
      this.emitEvent({
        type: "iteration",
        iteration: Math.round(timeVal * 1000),
        time: timeVal,
        residuals: {},
        metrics: {},
        timestamp: Date.now(),
        rawLog: line,
      });
      return;
    }

    // Solving for Ux, Initial residual = 0.042, Final residual = 0.00012, No Iterations 4
    const solveMatch = line.match(
      /Solving for (\w+),\s*Initial residual\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?),\s*Final residual\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    );
    if (solveMatch && solveMatch[1] && solveMatch[2] && solveMatch[3]) {
      const varName = solveMatch[1];
      const initialRes = parseFloat(solveMatch[2]);
      const finalRes = parseFloat(solveMatch[3]);

      this.emitEvent({
        type: "iteration",
        iteration: this.currentStep++,
        residuals: {
          [`${varName}_initial`]: initialRes,
          [`${varName}_final`]: finalRes,
        },
        metrics: {},
        timestamp: Date.now(),
        rawLog: line,
      });
      return;
    }

    // Courant Number mean: 0.12 max: 0.85
    const courantMatch = line.match(/Courant Number mean:\s*([0-9.+-eE]+)\s*max:\s*([0-9.+-eE]+)/i);
    if (courantMatch && courantMatch[1] && courantMatch[2]) {
      this.emitEvent({
        type: "iteration",
        iteration: this.currentStep,
        residuals: {},
        metrics: {
          courantMean: parseFloat(courantMatch[1]),
          courantMax: parseFloat(courantMatch[2]),
        },
        timestamp: Date.now(),
        rawLog: line,
      });
    }
  }

  private emitEvent(event: CaeTelemetryEvent): void {
    this.emit("telemetry", event);
  }

  /**
   * Pipes Server-Sent Events (SSE) directly to an Express response.
   */
  public attachSseStream(res: Response): () => void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const onTelemetry = (event: CaeTelemetryEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Heartbeat every 15s to keep connection open through reverse proxies
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);

    this.on("telemetry", onTelemetry);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.off("telemetry", onTelemetry);
    };

    res.on("close", cleanup);
    return cleanup;
  }
}
