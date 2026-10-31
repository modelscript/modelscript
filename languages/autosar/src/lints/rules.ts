// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AutosarDiagnostic, AutosarModel, AutosarPackage, AutosarSwComponent, SourceRange } from "../types.js";

const DEFAULT_RANGE: SourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

function checkDuplicateShortNames(pkg: AutosarPackage, diags: AutosarDiagnostic[]): void {
  const seen = new Set<string>();
  for (const [name, el] of pkg.elements) {
    if (seen.has(name)) {
      diags.push({
        code: "M7404",
        severity: "error",
        message: `Duplicate SHORT-NAME '${name}' detected in package '${pkg.shortName}'.`,
        range: el.range ?? pkg.range ?? DEFAULT_RANGE,
        elementName: name,
      });
    } else {
      seen.add(name);
    }
  }

  for (const sub of pkg.subPackages.values()) {
    checkDuplicateShortNames(sub, diags);
  }
}

function checkCompositionConnectors(swc: AutosarSwComponent, diags: AutosarDiagnostic[], model: AutosarModel): void {
  if (swc.kind !== "COMPOSITION-SW-COMPONENT-TYPE" || !swc.subComponents) return;

  const connectedRPorts = new Set<string>(); // "componentName.portName"

  if (swc.connectors) {
    for (const conn of swc.connectors) {
      if (conn.kind === "ASSEMBLY-SW-CONNECTOR") {
        if (conn.requirer?.component && conn.requirer?.port) {
          connectedRPorts.add(`${conn.requirer.component}.${conn.requirer.port}`);
        }

        // M7402: interface mismatch
        if (conn.provider && conn.requirer) {
          const provCompProto = swc.subComponents.get(conn.provider.component ?? "");
          const reqCompProto = swc.subComponents.get(conn.requirer.component ?? "");

          const provSwc = provCompProto
            ? model.components.get(provCompProto.typeRef.split("/").pop() ?? "")
            : undefined;
          const reqSwc = reqCompProto ? model.components.get(reqCompProto.typeRef.split("/").pop() ?? "") : undefined;

          const pPort = provSwc?.ports.get(conn.provider.port);
          const rPort = reqSwc?.ports.get(conn.requirer.port);

          if (pPort && rPort) {
            const pIfName = pPort.interfaceRef.split("/").pop() ?? pPort.interfaceRef;
            const rIfName = rPort.interfaceRef.split("/").pop() ?? rPort.interfaceRef;

            if (pIfName !== rIfName) {
              diags.push({
                code: "M7402",
                severity: "error",
                message: `Interface mismatch in connector '${conn.shortName}': Provider port '${pPort.shortName}' provides '${pIfName}' while requester port '${rPort.shortName}' requires '${rIfName}'.`,
                range: conn.range ?? swc.range ?? DEFAULT_RANGE,
                elementName: conn.shortName,
              });
            } else {
              // M7403: Data element type mismatch
              const iface = model.interfaces.get(pIfName);
              if (iface?.dataElements && iface.dataElements.length > 1) {
                // Check if any element types are malformed or incompatible
                for (const de of iface.dataElements) {
                  if (!de.typeRef) {
                    diags.push({
                      code: "M7403",
                      severity: "warning",
                      message: `Data element '${de.shortName}' in interface '${iface.shortName}' has no data type reference.`,
                      range: de.range ?? conn.range ?? DEFAULT_RANGE,
                      elementName: de.shortName,
                    });
                  }
                }
              }
            }
          }
        }
      } else if (conn.kind === "DELEGATION-SW-CONNECTOR") {
        if (conn.innerPort?.component && conn.innerPort?.port) {
          connectedRPorts.add(`${conn.innerPort.component}.${conn.innerPort.port}`);
        }
      }
    }
  }

  // M7401: check unconnected R-ports
  for (const [subName, subProto] of swc.subComponents) {
    const typeName = subProto.typeRef.split("/").pop() ?? subProto.typeRef;
    const subSwc = model.components.get(typeName);
    if (!subSwc) continue;

    for (const [portName, port] of subSwc.ports) {
      if (port.direction === "required") {
        const key = `${subName}.${portName}`;
        if (!connectedRPorts.has(key)) {
          diags.push({
            code: "M7401",
            severity: "error",
            message: `Required port '${portName}' on component '${subName}' (${typeName}) is unconnected in composition '${swc.shortName}'.`,
            range: subProto.range ?? swc.range ?? DEFAULT_RANGE,
            elementName: portName,
            quickFix: {
              title: `Connect required port '${portName}'`,
              edit: {
                text: `<!-- Connect ${key} -->`,
                range: subProto.range ?? DEFAULT_RANGE,
              },
            },
          });
        }
      }
    }
  }
}

function checkInternalBehavior(swc: AutosarSwComponent, diags: AutosarDiagnostic[]): void {
  // M7409: atomic SWC missing internal behavior
  if (swc.kind !== "COMPOSITION-SW-COMPONENT-TYPE" && swc.ports.size > 0 && !swc.internalBehavior) {
    diags.push({
      code: "M7409",
      severity: "warning",
      message: `Atomic software component '${swc.shortName}' lacks internal behavior definition.`,
      range: swc.range ?? DEFAULT_RANGE,
      elementName: swc.shortName,
    });
    return;
  }

  if (!swc.internalBehavior) return;

  const ib = swc.internalBehavior;
  const triggeredRunnables = new Set<string>();

  // Check events & M7405 (WCET budget overflow)
  for (const ev of ib.events) {
    triggeredRunnables.add(ev.startOnEventRef);

    if (ev.kind === "TIMING-EVENT" && ev.period !== undefined && ev.period > 0) {
      const runnable = ib.runnables.get(ev.startOnEventRef);
      if (runnable?.executionTimeWcet !== undefined && runnable.executionTimeWcet > ev.period) {
        diags.push({
          code: "M7405",
          severity: "error",
          message: `Execution time WCET (${(runnable.executionTimeWcet * 1000).toFixed(1)} ms) of runnable '${runnable.shortName}' exceeds its timing event period (${(ev.period * 1000).toFixed(1)} ms).`,
          range: runnable.range ?? ev.range ?? ib.range ?? DEFAULT_RANGE,
          elementName: runnable.shortName,
        });
      }
    }
  }

  // M7410: Untriggered runnables
  for (const [rName, runnable] of ib.runnables) {
    if (!triggeredRunnables.has(rName)) {
      diags.push({
        code: "M7410",
        severity: "info",
        message: `Runnable entity '${rName}' in SWC '${swc.shortName}' has no associated RTE trigger event.`,
        range: runnable.range ?? ib.range ?? DEFAULT_RANGE,
        elementName: rName,
      });
    }
  }

  // M7408: Cyclic runnable data dependencies
  const writersOfData = new Map<string, string>(); // "port.dataElement" -> runnableName
  for (const [rName, runnable] of ib.runnables) {
    for (const write of runnable.dataWriteAccess) {
      writersOfData.set(`${write.port}.${write.dataElement}`, rName);
    }
  }

  const adj = new Map<string, Set<string>>();
  for (const rName of ib.runnables.keys()) {
    adj.set(rName, new Set());
  }

  for (const [rName, runnable] of ib.runnables) {
    for (const read of runnable.dataReadAccess) {
      const writer = writersOfData.get(`${read.port}.${read.dataElement}`);
      if (writer && writer !== rName) {
        adj.get(writer)?.add(rName);
      }
    }
  }

  // Cycle detection (DFS)
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(curr: string, path: string[]): boolean {
    visited.add(curr);
    recStack.add(curr);

    const neighbors = adj.get(curr) ?? new Set();
    for (const next of neighbors) {
      if (!visited.has(next)) {
        if (dfs(next, [...path, next])) return true;
      } else if (recStack.has(next)) {
        const cycle = [...path, next];
        diags.push({
          code: "M7408",
          severity: "error",
          message: `Cyclic data dependency detected between runnables: '${cycle.join("' -> '")}'.`,
          range: ib.runnables.get(curr)?.range ?? ib.range ?? DEFAULT_RANGE,
          elementName: curr,
        });
        return true;
      }
    }

    recStack.delete(curr);
    return false;
  }

  for (const r of ib.runnables.keys()) {
    if (!visited.has(r)) {
      dfs(r, [r]);
    }
  }
}

function checkPduAndFrames(model: AutosarModel, diags: AutosarDiagnostic[]): void {
  // M7406: Overlapping PDU bits (supporting both Intel little-endian and Motorola big-endian sawtooth bit ordering)
  for (const [pduName, pdu] of model.pdus) {
    const occupiedBits = new Map<number, string>(); // bitIdx -> signalName
    for (const sig of pdu.signals) {
      let bitIdx = sig.startBit;
      for (let b = 0; b < sig.length; b++) {
        const existingSig = occupiedBits.get(bitIdx);
        if (existingSig && existingSig !== sig.shortName) {
          diags.push({
            code: "M7406",
            severity: "error",
            message: `Signals '${existingSig}' and '${sig.shortName}' overlap bit index ${bitIdx} in PDU '${pduName}'.`,
            range: sig.range ?? pdu.range ?? DEFAULT_RANGE,
            elementName: sig.shortName,
          });
          break;
        }
        occupiedBits.set(bitIdx, sig.shortName);
        if (sig.byteOrder === "MOST-SIGNIFICANT-BYTE-FIRST") {
          bitIdx = bitIdx % 8 === 0 ? bitIdx + 15 : bitIdx - 1;
        } else {
          bitIdx++;
        }
      }
    }
  }

  // M7407: PDU exceeds CAN frame capacity
  for (const [frameName, frame] of model.frames) {
    if (frame.pduRef) {
      const pdu = model.pdus.get(frame.pduRef);
      if (pdu && pdu.byteLength > frame.length) {
        diags.push({
          code: "M7407",
          severity: "error",
          message: `PDU '${pdu.shortName}' length (${pdu.byteLength} bytes) exceeds CAN frame '${frameName}' payload capacity (${frame.length} bytes).`,
          range: frame.range ?? DEFAULT_RANGE,
          elementName: frameName,
        });
      }
    }
  }
}

/**
 * Pre-flight automotive linter verifying AUTOSAR architectures (M7401–M7410).
 */
export function lintAutosarModel(model: AutosarModel): AutosarDiagnostic[] {
  const diags: AutosarDiagnostic[] = [];

  // M7404: Duplicate short-names
  for (const pkg of model.packages.values()) {
    checkDuplicateShortNames(pkg, diags);
  }

  // M7401, M7402, M7403, M7405, M7408, M7409, M7410
  for (const swc of model.components.values()) {
    checkCompositionConnectors(swc, diags, model);
    checkInternalBehavior(swc, diags);
  }

  // M7406, M7407
  checkPduAndFrames(model, diags);

  return diags;
}
