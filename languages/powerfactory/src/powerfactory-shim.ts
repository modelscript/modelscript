// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT `powerfactory` Python API Automation Compatibility Layer for ModelScript.
 *
 * Implements a programmatic TypeScript API (PowerFactorySession) and an in-memory
 * Python automation script runner (executePythonPowerFactoryScript) matching standard
 * DIgSILENT Python function signatures:
 *   - import powerfactory as pf
 *   - app = pf.GetApplication()
 *   - proj = app.GetActiveProject()
 *   - ldf = app.GetFromStudyCase("ComLdf"); ldf.Execute()
 *   - shc = app.GetFromStudyCase("ComShc"); shc.Execute()
 *   - terms = app.GetCalcRelevantObjects("*.ElmTerm")
 *   - obj.GetAttribute("m:u"), obj.SetAttribute("pgini", 100.0)
 */

import {
  calculateShortCircuit,
  type PowerFlowSolution,
  type ShortCircuitAnalysisResult,
  solvePowerFlow,
} from "@modelscript/psse";
import { parsePowerFactoryFile } from "./parser/powerfactory-parser.js";
import { powerFactoryToPsse } from "./projections/powerfactory-to-psse.js";
import type { PowerFactoryModel } from "./types.js";

/** Generic PowerFactory Data Object with dynamic attribute access. */
export class PowerFactoryDataObject {
  public id: string;
  public loc_name: string;
  public className: string;
  public attributes = new Map<string, any>();

  constructor(id: string, loc_name: string, className: string) {
    this.id = id;
    this.loc_name = loc_name;
    this.className = className;
  }

  public GetAttribute(name: string): any {
    return this.attributes.get(name);
  }

  public SetAttribute(name: string, value: any): void {
    this.attributes.set(name, value);
  }
}

/** Abstract Calculation Command (ComLdf, ComShc, ComSim, ComMod). */
export class PowerFactoryCommand extends PowerFactoryDataObject {
  private session: PowerFactorySession;

  constructor(session: PowerFactorySession, className: string) {
    super(className, className, className);
    this.session = session;
  }

  public Execute(): number {
    return this.session.executeCommand(this.className);
  }
}

/** Study Case containing calculation commands and active variants. */
export class PowerFactoryStudyCase extends PowerFactoryDataObject {
  public commands = new Map<string, PowerFactoryCommand>();

  constructor(session: PowerFactorySession, name = "Study Case") {
    super("study_case", name, "IntCase");
    this.commands.set("ComLdf", new PowerFactoryCommand(session, "ComLdf"));
    this.commands.set("ComShc", new PowerFactoryCommand(session, "ComShc"));
    this.commands.set("ComSim", new PowerFactoryCommand(session, "ComSim"));
    this.commands.set("ComMod", new PowerFactoryCommand(session, "ComMod"));
  }
}

/** Top-level PowerFactory Project container. */
export class PowerFactoryProject extends PowerFactoryDataObject {
  public model: PowerFactoryModel;
  public activeStudyCase: PowerFactoryStudyCase;

  constructor(session: PowerFactorySession, model: PowerFactoryModel) {
    super(model.name, model.name, "IntPrj");
    this.model = model;
    this.activeStudyCase = new PowerFactoryStudyCase(session, "Active Study Case");
  }
}

/** Top-level Application object returned by pf.GetApplication(). */
export class PowerFactoryApplication {
  private session: PowerFactorySession;

  constructor(session: PowerFactorySession) {
    this.session = session;
  }

  public GetActiveProject(): PowerFactoryProject | null {
    return this.session.activeProject;
  }

  public GetActiveStudyCase(): PowerFactoryStudyCase | null {
    return this.session.activeProject?.activeStudyCase ?? null;
  }

  public GetFromStudyCase(commandClass: string): PowerFactoryCommand | null {
    const sc = this.GetActiveStudyCase();
    return sc?.commands.get(commandClass) ?? new PowerFactoryCommand(this.session, commandClass);
  }

  public GetCalcRelevantObjects(pattern = "*"): PowerFactoryDataObject[] {
    return this.session.getCalcRelevantObjects(pattern);
  }

  public PrintPlain(msg: string): void {
    this.session.messages.push(msg);
  }

  public PrintInfo(msg: string): void {
    this.session.messages.push(`[INFO] ${msg}`);
  }

  public PrintError(msg: string): void {
    this.session.messages.push(`[ERROR] ${msg}`);
  }

  public ActivateProject(name: string): PowerFactoryProject | null {
    return this.session.activateProject(name);
  }
}

/**
 * Stateful DIgSILENT PowerFactory automation session.
 */
export class PowerFactorySession {
  public activeProject: PowerFactoryProject | null = null;
  public lastPowerFlow: PowerFlowSolution | null = null;
  public lastShortCircuit: ShortCircuitAnalysisResult | null = null;
  public messages: string[] = [];
  public virtualFiles = new Map<string, string | Uint8Array>();
  public dataObjects = new Map<string, PowerFactoryDataObject>();
  public termToBusMap = new Map<string, number>();

  public getApplication(): PowerFactoryApplication {
    return new PowerFactoryApplication(this);
  }

  public loadModel(model: PowerFactoryModel): PowerFactoryProject {
    this.activeProject = new PowerFactoryProject(this, model);
    this.rebuildDataObjects();
    return this.activeProject;
  }

  public activateProject(name: string): PowerFactoryProject | null {
    const file = this.virtualFiles.get(name) ?? this.virtualFiles.get(`${name}.dz`) ?? this.virtualFiles.get(`${name}.xml`);
    if (file) {
      const model = parsePowerFactoryFile(file, name);
      return this.loadModel(model);
    }
    return this.activeProject;
  }

  public executeCommand(cmdName: string): number {
    if (!this.activeProject) {
      this.messages.push("[ERROR] No active project loaded in session.");
      return 1;
    }

    const { psseCase, termToBusMap } = powerFactoryToPsse(this.activeProject.model);
    this.termToBusMap = termToBusMap;

    if (cmdName === "ComLdf") {
      try {
        const pfSol = solvePowerFlow(psseCase);
        this.lastPowerFlow = pfSol;

        // Populate solved power flow attributes back into DataObjects
        for (const bRes of pfSol.buses) {
          for (const [tId, bNum] of this.termToBusMap) {
            if (bNum === bRes.busNumber) {
              const obj = this.dataObjects.get(tId);
              if (obj) {
                obj.SetAttribute("m:u", bRes.vm); // Voltage magnitude pu
                obj.SetAttribute("m:phiu", bRes.va); // Voltage angle deg
                obj.SetAttribute("m:P", bRes.pgMw - bRes.plMw);
                obj.SetAttribute("m:Q", bRes.qgMvar - bRes.qlMvar);
              }
            }
          }
        }

        // Branch loading
        for (const brRes of pfSol.branches) {
          for (const [, line] of this.activeProject.model.lines) {
            const b1 = this.termToBusMap.get(line.bus1Id);
            const b2 = this.termToBusMap.get(line.bus2Id);
            if ((b1 === brRes.fromBus && b2 === brRes.toBus) || (b1 === brRes.toBus && b2 === brRes.fromBus)) {
              const obj = this.dataObjects.get(line.id);
              if (obj) {
                obj.SetAttribute("c:loading", brRes.loadingPercent);
                obj.SetAttribute("m:P:bus1", brRes.pFromMw);
                obj.SetAttribute("m:Q:bus1", brRes.qFromMvar);
              }
            }
          }
        }

        this.messages.push(`[LDF] Solved AC Power Flow in ${pfSol.iterations} iterations. Max mismatch: ${pfSol.maxMismatchPu.toExponential(3)} pu.`);
        return 0; // Success
      } catch (e: any) {
        this.messages.push(`[ERROR] AC Power Flow failed: ${e?.message ?? e}`);
        return 2;
      }
    } else if (cmdName === "ComShc") {
      try {
        const scRes = calculateShortCircuit(psseCase);
        this.lastShortCircuit = scRes;

        for (const bSc of scRes.buses) {
          for (const [tId, bNum] of this.termToBusMap) {
            if (bNum === bSc.busNumber) {
              const obj = this.dataObjects.get(tId);
              if (obj) {
                obj.SetAttribute("m:Ikss", bSc.ik3PhaseKa); // Initial symmetrical breaking current kA
                obj.SetAttribute("m:Ip", bSc.ipPeakMakeKa); // Peak short-circuit current kA
                obj.SetAttribute("m:Skss", bSc.sk3PhaseMva); // Fault MVA
              }
            }
          }
        }

        this.messages.push(`[SHC] Calculated short-circuit fault currents across ${scRes.buses.length} buses. Max fault: ${scRes.maxFaultCurrentKa.toFixed(2)} kA.`);
        return 0;
      } catch (e: any) {
        this.messages.push(`[ERROR] Short Circuit failed: ${e?.message ?? e}`);
        return 2;
      }
    }

    this.messages.push(`[INFO] Executed ${cmdName}.`);
    return 0;
  }

  public getCalcRelevantObjects(pattern = "*"): PowerFactoryDataObject[] {
    const list: PowerFactoryDataObject[] = [];
    const isStar = pattern === "*" || pattern === "*.*";
    const classFilter = pattern.startsWith("*.") ? pattern.slice(2) : undefined;

    for (const obj of this.dataObjects.values()) {
      if (isStar || (classFilter && obj.className === classFilter)) {
        list.push(obj);
      }
    }
    return list;
  }

  private rebuildDataObjects(): void {
    this.dataObjects.clear();
    if (!this.activeProject) return;
    const m = this.activeProject.model;

    for (const [id, term] of m.terminals) {
      const obj = new PowerFactoryDataObject(id, term.loc_name, "ElmTerm");
      obj.SetAttribute("uknom", term.uknom);
      obj.SetAttribute("fnom", term.fnom);
      this.dataObjects.set(id, obj);
    }
    for (const [id, line] of m.lines) {
      const obj = new PowerFactoryDataObject(id, line.loc_name, "ElmLne");
      obj.SetAttribute("dline", line.dline);
      this.dataObjects.set(id, obj);
    }
    for (const [id, tr] of m.transformers2w) {
      const obj = new PowerFactoryDataObject(id, tr.loc_name, "ElmTr2");
      this.dataObjects.set(id, obj);
    }
    for (const [id, gen] of m.generators) {
      const obj = new PowerFactoryDataObject(id, gen.loc_name, "ElmSym");
      obj.SetAttribute("pgini", gen.pgini);
      obj.SetAttribute("qgini", gen.qgini);
      obj.SetAttribute("usetp", gen.usetp);
      this.dataObjects.set(id, obj);
    }
    for (const [id, lod] of m.loads) {
      const obj = new PowerFactoryDataObject(id, lod.loc_name, "ElmLod");
      obj.SetAttribute("plini", lod.plini);
      obj.SetAttribute("qlini", lod.qlini);
      this.dataObjects.set(id, obj);
    }
  }
}

/**
 * Executes a DIgSILENT PowerFactory Python automation script against an in-memory session.
 */
export function executePythonPowerFactoryScript(
  scriptText: string,
  virtualFiles: Record<string, string | Uint8Array> = {},
): PowerFactorySession {
  const session = new PowerFactorySession();
  for (const [p, content] of Object.entries(virtualFiles)) {
    session.virtualFiles.set(p, content);
  }

  // Auto-load first virtual grid file if present
  const firstGrid = Object.keys(virtualFiles).find((f) => f.endsWith(".dz") || f.endsWith(".xml") || f.endsWith(".pfd"));
  if (firstGrid) {
    session.activateProject(firstGrid);
  }

  const app = session.getApplication();

  // Parse and interpret Python lines safely
  const lines = scriptText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.includes("app.GetFromStudyCase(\"ComLdf\")") || line.includes("app.GetFromStudyCase('ComLdf')")) {
      app.GetFromStudyCase("ComLdf");
    }
    if (line.endsWith(".Execute()") || line.includes(".Execute()")) {
      if (line.includes("shc") || line.includes("ComShc")) {
        session.executeCommand("ComShc");
      } else {
        session.executeCommand("ComLdf");
      }
    }
    const printMatch = /app\.PrintPlain\((["'])(.*?)\1\)/.exec(line);
    if (printMatch) {
      app.PrintPlain(printMatch[2]!);
    }
  }

  return session;
}
