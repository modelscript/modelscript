// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PowerFlowSnapshot } from "@modelscript/exchange";
import { parseOpenDss, solveDistributionPowerFlow } from "@modelscript/opendss";
import { extractEmtNetlist, extractPscadSteadyStateSnapshot, parsePscx } from "@modelscript/pscad";
import { pssePowerFlowToSnapshot, psseToEmtNetlist, solvePowerFlowAsync, type PsseCase } from "@modelscript/psse";

/**
 * Discovers and solves all sibling power-grid files in a multi-file workspace
 * (`.pscx`, `.dss`, `.epc` PSLF, `.m` MATPOWER, PowerFactory `.dgs`/`.xml`, CGMES `.xml`)
 * into canonical `PowerFlowSnapshot`s for unified cross-tool comparison against PSS/E.
 */
export async function collectComparatorPowerFlowSnapshots(
  projectFiles: Readonly<Record<string, string>> | undefined,
  baselinePsseCase?: PsseCase | undefined,
  frequencyHz = 60.0,
  sbaseMva = 100.0,
): Promise<PowerFlowSnapshot[]> {
  const comparators: PowerFlowSnapshot[] = [];
  const entries = Object.entries(projectFiles ?? {});

  // 1. PSCAD (.pscx)
  let hasPscad = false;
  for (const [fName, content] of entries) {
    if (!fName.toLowerCase().endsWith(".pscx")) continue;
    try {
      const netlist = extractEmtNetlist(parsePscx(content));
      comparators.push(
        extractPscadSteadyStateSnapshot(netlist, {
          solver: `pscad:${fName.split("/").pop() ?? fName}`,
          nominalFrequencyHz: frequencyHz,
        }),
      );
      hasPscad = true;
    } catch {
      // Skip partial/invalid .pscx
    }
  }
  if (!hasPscad && baselinePsseCase) {
    const projected = psseToEmtNetlist(baselinePsseCase, { dyrCase: baselinePsseCase.dyr });
    comparators.push(
      extractPscadSteadyStateSnapshot(projected, {
        solver: "pscad (projected)",
        nominalFrequencyHz: frequencyHz,
      }),
    );
  }

  // 2. OpenDSS (.dss)
  for (const [fName, content] of entries) {
    if (!fName.toLowerCase().endsWith(".dss")) continue;
    try {
      const dssSol = solveDistributionPowerFlow(parseOpenDss(content));
      comparators.push({
        solver: `opendss:${fName.split("/").pop() ?? fName}`,
        converged: dssSol.converged,
        frequencyHz,
        sbaseMva,
        buses: Array.from(dssSol.buses.entries()).map(([busId, b]) => ({
          busId,
          vmPu: b.vMagPu,
          vaDeg: b.vAngleDeg,
        })),
        branches: [],
      });
    } catch {
      // Skip invalid .dss
    }
  }

  // 3. GE PSLF (.epc)
  for (const [fName, content] of entries) {
    if (!fName.toLowerCase().endsWith(".epc")) continue;
    try {
      const { parsePslfEpc, pslfEpcToPsseRaw } = await import("@modelscript/pslf");
      const psseCase = pslfEpcToPsseRaw(parsePslfEpc(content));
      const sol = await solvePowerFlowAsync(psseCase);
      const snap = pssePowerFlowToSnapshot(psseCase, sol, fName);
      comparators.push({ ...snap, solver: `pslf:${fName.split("/").pop() ?? fName}` });
    } catch {
      // Skip invalid .epc
    }
  }

  // 4. MATPOWER (.m)
  for (const [fName, content] of entries) {
    if (!fName.toLowerCase().endsWith(".m") || !content.includes("mpc.")) continue;
    try {
      const { parseMatpowerCase, matpowerToPsseRaw } = await import("@modelscript/matpower");
      const psseCase = matpowerToPsseRaw(parseMatpowerCase(content));
      const sol = await solvePowerFlowAsync(psseCase);
      const snap = pssePowerFlowToSnapshot(psseCase, sol, fName);
      comparators.push({ ...snap, solver: `matpower:${fName.split("/").pop() ?? fName}` });
    } catch {
      // Skip non-MATPOWER .m files
    }
  }

  // 5. DIgSILENT PowerFactory (.dgs / PowerFactory XML)
  for (const [fName, content] of entries) {
    const lower = fName.toLowerCase();
    const isPf = lower.endsWith(".dgs") || (lower.endsWith(".xml") && content.includes("<DataObject"));
    if (!isPf) continue;
    try {
      const { parsePowerFactoryText, powerFactoryToPsse } = await import("@modelscript/powerfactory");
      const { psseCase } = powerFactoryToPsse(parsePowerFactoryText(content, fName));
      const sol = await solvePowerFlowAsync(psseCase);
      const snap = pssePowerFlowToSnapshot(psseCase, sol, fName);
      comparators.push({ ...snap, solver: `powerfactory:${fName.split("/").pop() ?? fName}` });
    } catch {
      // Skip non-PowerFactory XML
    }
  }

  // 6. CGMES / CIM (.xml with rdf:RDF)
  const cgmesXmls = entries
    .filter(([fName, content]) => fName.toLowerCase().endsWith(".xml") && content.includes("rdf:RDF"))
    .map(([, content]) => content);
  if (cgmesXmls.length > 0) {
    try {
      const { parseCgmesFiles, cgmesToPsse } = await import("@modelscript/cgmes");
      const { psseCase } = cgmesToPsse(parseCgmesFiles(cgmesXmls));
      const sol = await solvePowerFlowAsync(psseCase);
      const snap = pssePowerFlowToSnapshot(psseCase, sol, "CGMES");
      comparators.push({ ...snap, solver: "cgmes" });
    } catch {
      // Skip incomplete CGMES XML
    }
  }

  return comparators;
}
