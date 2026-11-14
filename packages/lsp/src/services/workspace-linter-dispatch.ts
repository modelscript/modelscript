// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkspaceDocumentInput, WorkspaceLintDiagnostic } from "@modelscript/runtime";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";

export type WorkspaceLinterFn = (
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
) => Promise<WorkspaceLintDiagnostic[]> | WorkspaceLintDiagnostic[];

/**
 * Lazy loaders for the 30 multi-file / workspace graph linters, keyed by LSP `langId`.
 */
const WORKSPACE_LINTER_LOADERS: Record<string, () => Promise<WorkspaceLinterFn>> = {
  // Phase 1: Power Grids, Protection & Electronics
  cgmes: async () => (await import("@modelscript/cgmes")).lintCgmesWorkspace,
  psse: async () => (await import("@modelscript/psse")).lintPsseWorkspace,
  pslf: async () => (await import("@modelscript/pslf")).lintPslfWorkspace,
  pscad: async () => (await import("@modelscript/pscad")).lintPscadWorkspace,
  opendss: async () => (await import("@modelscript/opendss")).lintOpenDssWorkspace,
  scl: async () => (await import("@modelscript/scl")).lintSclWorkspace,
  spice: async () => (await import("@modelscript/spice")).lintSpiceWorkspace,
  atp: async () => (await import("@modelscript/atp")).lintAtpWorkspace,
  "verilog-a": async () => (await import("@modelscript/verilog-a")).lintVerilogAWorkspace,

  // Phase 2: Systems Engineering, Co-Simulation & Compliance
  ssp: async () => (await import("@modelscript/ssp")).lintSspWorkspace,
  oscal: async () => (await import("@modelscript/oscal")).lintOscalWorkspace,
  autosar: async () => (await import("@modelscript/autosar")).lintAutosarWorkspace,
  automationml: async () => (await import("@modelscript/automationml")).lintAutomationMLWorkspace,
  plcopen: async () => (await import("@modelscript/plcopen")).lintPlcopenWorkspace,
  simulink: async () => (await import("@modelscript/simulink")).lintSimulinkWorkspace,

  // Phase 3: CAD, 3D Scenes & General Programming
  usd: async () => (await import("@modelscript/usd")).lintUsdWorkspace,
  urdf: async () => (await import("@modelscript/urdf")).lintUrdfWorkspace,
  scad: async () => (await import("@modelscript/scad")).lintScadWorkspace,
  c: async () => (await import("@modelscript/c")).lintCWorkspace,
  fortran: async () => (await import("@modelscript/fortran")).lintFortranWorkspace,
  ampl: async () => (await import("@modelscript/ampl")).lintAmplWorkspace,

  // Phase 4: Subsurface, Thermal & Computational Biology
  modflow: async () => (await import("@modelscript/modflow")).lintModflowWorkspace,
  "hec-ras": async () => (await import("@modelscript/hec-ras")).lintHecRasWorkspace,
  eclipse: async () => (await import("@modelscript/eclipse")).lintEclipseWorkspace,
  energyplus: async () => (await import("@modelscript/energyplus")).lintEnergyPlusWorkspace,
  topas: async () => (await import("@modelscript/topas")).lintTopasWorkspace,
  cellml: async () => (await import("@modelscript/cellml")).lintCellmlWorkspace,
  antimony: async () => (await import("@modelscript/antimony")).lintAntimonyWorkspace,
  sedml: async () => (await import("@modelscript/sedml")).lintSedmlWorkspace,
  sbol: async () => (await import("@modelscript/sbol")).lintSbolWorkspace,
};

export const SUPPORTED_WORKSPACE_LINTER_LANGUAGES: readonly string[] = Object.keys(WORKSPACE_LINTER_LOADERS);

export function hasWorkspaceLinter(langId: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_LINTER_LOADERS, langId);
}

/**
 * Runs the registered multi-file workspace linter for `langId` across `workspace`
 * and returns raw `WorkspaceLintDiagnostic` items (for CLI / MCP / LSP callers).
 */
export async function lintWorkspaceByLanguage(
  langId: string,
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
): Promise<WorkspaceLintDiagnostic[]> {
  const loader = WORKSPACE_LINTER_LOADERS[langId];
  if (!loader) return [];
  const linter = await loader();
  return linter(workspace, rootUri);
}

function toDiagnosticSeverity(sev: WorkspaceLintDiagnostic["severity"]): DiagnosticSeverity {
  if (sev === "error") return DiagnosticSeverity.Error;
  if (sev === "warning") return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Information;
}

function normalizeUri(uri: string): string {
  return uri.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
}

/**
 * Runs the registered multi-file workspace linter for `langId` (if any) across
 * `workspaceDocs` and appends non-duplicate diagnostics targeting `rootUri`.
 */
export async function runWorkspaceLinterForDocument(
  langId: string,
  workspaceDocs: Record<string, string>,
  rootUri: string,
  existingDiagnostics: Diagnostic[],
): Promise<void> {
  const loader = WORKSPACE_LINTER_LOADERS[langId];
  if (!loader) return;

  const linter = await loader();
  const wsDiags = await linter(workspaceDocs, rootUri);
  const normRoot = normalizeUri(rootUri);

  for (const d of wsDiags) {
    const diagUri = d.uri ? normalizeUri(d.uri) : normRoot;
    if (diagUri !== normRoot) continue;

    const alreadyPresent = existingDiagnostics.some(
      (ex) => String(ex.code ?? "") === String(d.code) && ex.message === d.message,
    );
    if (alreadyPresent) continue;

    const startLine = Math.max(0, (d.line ?? 1) - 1);
    const startChar = Math.max(0, (d.column ?? 1) - 1);
    const endLine = startLine;
    const endChar = startChar;

    existingDiagnostics.push({
      severity: toDiagnosticSeverity(d.severity),
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      code: d.code,
      message: d.message,
      source: langId,
    });
  }
}
