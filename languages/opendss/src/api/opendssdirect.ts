// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenDSSDirect / COM Emulation API for ModelScript OpenDSS.
 *
 * Provides a drop-in stateful scripting interface matching the standard Python
 * `OpenDSSDirect.py` and Windows COM automation (`OpenDSSEngine.DSS`) interfaces.
 */

import { parseOpenDss } from "../parser/opendss-parser.js";
import { solveAdmittancePowerFlow } from "../solvers/opendss-ybus-solver.js";
import type { DssDeck } from "../types.js";

export interface BusDirectProxy {
  Name: string;
  NumNodes: number;
  Nodes: number[];
  kVBase: number;
  VMagPu: number[];
  Voltages: number[];
}

export class OpenDssDirectSession {
  private _deck: DssDeck;
  private _scriptBuffer: string[] = [];
  private _lastSolutionConverged = false;
  private _lastIterations = 0;
  private _busResults = new Map<string, { vMagPu: number; vAngleDeg: number; vKv: number }>();
  private _totalLoadKw = 0;
  private _totalLoadKvar = 0;
  private _lossesKw = 0;

  public readonly Text: {
    Command: (cmd: string) => string;
  };

  public readonly Basic: {
    ClearAll: () => void;
    NewCircuit: (name: string) => void;
  };

  public readonly Solution: {
    Solve: () => boolean;
    readonly Converged: boolean;
    readonly Iterations: number;
    readonly Mode: number;
    readonly StepSize: number;
  };

  public readonly Circuit: {
    readonly Name: string;
    readonly AllBusNames: string[];
    readonly NumBuses: number;
    readonly NumElements: number;
    readonly TotalPower: [number, number];
    readonly Losses: [number, number];
    readonly AllBusVmagPu: number[];
    Buses: (busName: string) => BusDirectProxy;
  };

  public readonly Lines: {
    readonly AllNames: string[];
    readonly Count: number;
    readonly First: number;
    readonly Next: number;
  };

  public readonly Transformers: {
    readonly AllNames: string[];
    readonly Count: number;
  };

  public readonly Loads: {
    readonly AllNames: string[];
    readonly Count: number;
  };

  public readonly Capacitors: {
    readonly AllNames: string[];
    readonly Count: number;
  };

  constructor(initialScript = "") {
    this._deck = parseOpenDss(initialScript);
    if (initialScript.trim().length > 0) {
      this._scriptBuffer.push(initialScript);
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.Text = {
      Command: (cmd: string): string => self.Command(cmd),
    };

    this.Basic = {
      ClearAll: (): void => {
        self.Command("clear");
      },
      NewCircuit: (name: string): void => {
        self.Command(`New Circuit.${name} basekv=12.47 pu=1.0 phases=3 bus1=SourceBus`);
      },
    };

    this.Solution = {
      Solve: (): boolean => {
        const res = solveAdmittancePowerFlow(self._deck);
        self._lastSolutionConverged = res.converged;
        self._lastIterations = res.iterations;
        self._totalLoadKw = res.totalLoadKw;
        self._totalLoadKvar = res.totalLoadKvar;
        self._lossesKw = res.lossesKw;

        self._busResults.clear();
        for (const [bName, bRes] of res.buses) {
          self._busResults.set(bName, {
            vMagPu: bRes.vMagPu,
            vAngleDeg: bRes.vAngleDeg,
            vKv: bRes.voltageKv,
          });
        }
        return self._lastSolutionConverged;
      },
      get Converged(): boolean {
        return self._lastSolutionConverged;
      },
      get Iterations(): number {
        return self._lastIterations;
      },
      get Mode(): number {
        return 0; // Snapshot
      },
      get StepSize(): number {
        return 1.0;
      },
    };

    this.Circuit = {
      get Name(): string {
        return self._deck.circuit?.name ?? "NoCircuit";
      },
      get AllBusNames(): string[] {
        const names = new Set<string>();
        if (self._deck.circuit) names.add(self._deck.circuit.bus1);
        for (const [, l] of self._deck.lines) {
          names.add(l.bus1);
          names.add(l.bus2);
        }
        for (const [, x] of self._deck.transformers) {
          for (const b of x.buses) names.add(b);
        }
        for (const [, load] of self._deck.loads) {
          names.add(load.bus1);
        }
        return Array.from(names);
      },
      get NumBuses(): number {
        return self.Circuit.AllBusNames.length;
      },
      get NumElements(): number {
        return (
          self._deck.lines.size +
          self._deck.transformers.size +
          self._deck.loads.size +
          self._deck.pvSystems.size +
          self._deck.capacitors.size
        );
      },
      get TotalPower(): [number, number] {
        return [self._totalLoadKw, self._totalLoadKvar];
      },
      get Losses(): [number, number] {
        return [self._lossesKw, 0];
      },
      get AllBusVmagPu(): number[] {
        const result: number[] = [];
        for (const busName of self.Circuit.AllBusNames) {
          const r = self._busResults.get(busName);
          result.push(r ? r.vMagPu : 1.0);
        }
        return result;
      },
      Buses: (busName: string): BusDirectProxy => {
        const r = self._busResults.get(busName);
        const vMag = r ? r.vMagPu : 1.0;
        const vKv = r ? r.vKv : 12.47;
        return {
          Name: busName,
          NumNodes: 3,
          Nodes: [1, 2, 3],
          kVBase: vKv,
          VMagPu: [vMag, vMag, vMag],
          Voltages: [vKv * 1000, vKv * 1000, vKv * 1000],
        };
      },
    };

    this.Lines = {
      get AllNames(): string[] {
        return Array.from(self._deck.lines.keys());
      },
      get Count(): number {
        return self._deck.lines.size;
      },
      get First(): number {
        return self._deck.lines.size > 0 ? 1 : 0;
      },
      get Next(): number {
        return 0;
      },
    };

    this.Transformers = {
      get AllNames(): string[] {
        return Array.from(self._deck.transformers.keys());
      },
      get Count(): number {
        return self._deck.transformers.size;
      },
    };

    this.Loads = {
      get AllNames(): string[] {
        return Array.from(self._deck.loads.keys());
      },
      get Count(): number {
        return self._deck.loads.size;
      },
    };

    this.Capacitors = {
      get AllNames(): string[] {
        return Array.from(self._deck.capacitors.keys());
      },
      get Count(): number {
        return self._deck.capacitors.size;
      },
    };
  }

  /**
   * Executes an OpenDSS command string.
   */
  public Command(cmd: string): string {
    const trimmed = cmd.trim();
    if (trimmed.length === 0) return "";

    const lower = trimmed.toLowerCase();
    if (lower === "clear") {
      this._deck = parseOpenDss("");
      this._scriptBuffer = [];
      this._lastSolutionConverged = false;
      this._busResults.clear();
      return "Circuit cleared";
    }

    if (lower === "solve") {
      this.Solution.Solve();
      return this._lastSolutionConverged ? "Solved successfully" : "Solution did not converge";
    }

    // Append to script buffer and re-parse
    this._scriptBuffer.push(trimmed);
    const combined = this._scriptBuffer.join("\n");
    this._deck = parseOpenDss(combined);
    return "";
  }

  public getDeck(): DssDeck {
    return this._deck;
  }
}

/**
 * Factory creating a new stateful OpenDSSDirect session.
 */
export function createOpenDssDirect(initialScript = ""): OpenDssDirectSession {
  return new OpenDssDirectSession(initialScript);
}
