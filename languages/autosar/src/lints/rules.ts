// SPDX-License-Identifier: AGPL-3.0-or-later

import { AutosarErrorCode } from "../errors.js";
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
        code: AutosarErrorCode.DUPLICATE_SHORT_NAME.code,
        severity: AutosarErrorCode.DUPLICATE_SHORT_NAME.severity,
        message: AutosarErrorCode.DUPLICATE_SHORT_NAME.message(name, pkg.shortName),
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
                code: AutosarErrorCode.INTERFACE_MISMATCH.code,
                severity: AutosarErrorCode.INTERFACE_MISMATCH.severity,
                message: AutosarErrorCode.INTERFACE_MISMATCH.message(
                  conn.shortName,
                  pPort.shortName,
                  pIfName,
                  rPort.shortName,
                  rIfName,
                ),
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
                      code: AutosarErrorCode.DATA_ELEMENT_TYPE_MISMATCH.code,
                      severity: AutosarErrorCode.DATA_ELEMENT_TYPE_MISMATCH.severity,
                      message: AutosarErrorCode.DATA_ELEMENT_TYPE_MISMATCH.message(de.shortName, iface.shortName),
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
            code: AutosarErrorCode.UNCONNECTED_MANDATORY_PORT.code,
            severity: AutosarErrorCode.UNCONNECTED_MANDATORY_PORT.severity,
            message: AutosarErrorCode.UNCONNECTED_MANDATORY_PORT.message(portName, subName, typeName, swc.shortName),
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

function checkCircularCompositionDependencies(model: AutosarModel, diags: AutosarDiagnostic[]): void {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(compName: string, path: string[]): boolean {
    visited.add(compName);
    recStack.add(compName);

    const swc = model.components.get(compName);
    if (swc && swc.kind === "COMPOSITION-SW-COMPONENT-TYPE" && swc.subComponents) {
      for (const subProto of swc.subComponents.values()) {
        const targetName = subProto.typeRef.split("/").pop() ?? subProto.typeRef;
        const targetSwc = model.components.get(targetName);
        if (!targetSwc || targetSwc.kind !== "COMPOSITION-SW-COMPONENT-TYPE") continue;

        if (!visited.has(targetName)) {
          if (dfs(targetName, [...path, targetName])) return true;
        } else if (recStack.has(targetName)) {
          const cyclePath = [...path, targetName].join(" -> ");
          diags.push({
            code: AutosarErrorCode.CIRCULAR_COMPOSITION_DEPENDENCY.code,
            severity: AutosarErrorCode.CIRCULAR_COMPOSITION_DEPENDENCY.severity,
            message: AutosarErrorCode.CIRCULAR_COMPOSITION_DEPENDENCY.message(cyclePath),
            range: subProto.range ?? swc.range ?? DEFAULT_RANGE,
            elementName: compName,
          });
          return true;
        }
      }
    }

    recStack.delete(compName);
    return false;
  }

  for (const [compName, swc] of model.components) {
    if (swc.kind === "COMPOSITION-SW-COMPONENT-TYPE" && !visited.has(compName)) {
      dfs(compName, [compName]);
    }
  }
}

function checkPortDirections(swc: AutosarSwComponent, diags: AutosarDiagnostic[]): void {
  for (const [, port] of swc.ports) {
    if (port.interfaceTrefKind && port.interfaceTrefKind !== port.direction) {
      diags.push({
        code: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.code,
        severity: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.severity,
        message: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.message(
          port.shortName,
          `${port.direction} port declares '${port.interfaceTrefKind}' interface reference`,
        ),
        range: port.range ?? swc.range ?? DEFAULT_RANGE,
        elementName: port.shortName,
      });
    }
  }

  if (swc.internalBehavior) {
    for (const [, runnable] of swc.internalBehavior.runnables) {
      for (const write of runnable.dataWriteAccess) {
        const port = swc.ports.get(write.port);
        if (port && port.direction === "required") {
          diags.push({
            code: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.code,
            severity: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.severity,
            message: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.message(
              port.shortName,
              `runnable '${runnable.shortName}' writes to required R-Port '${port.shortName}'`,
            ),
            range: runnable.range ?? port.range ?? swc.range ?? DEFAULT_RANGE,
            elementName: port.shortName,
          });
        }
      }
      for (const read of runnable.dataReadAccess) {
        const port = swc.ports.get(read.port);
        if (port && port.direction === "provided") {
          diags.push({
            code: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.code,
            severity: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.severity,
            message: AutosarErrorCode.INCOMPATIBLE_PORT_INTERFACE_DIRECTION.message(
              port.shortName,
              `runnable '${runnable.shortName}' reads from provided P-Port '${port.shortName}'`,
            ),
            range: runnable.range ?? port.range ?? swc.range ?? DEFAULT_RANGE,
            elementName: port.shortName,
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
      code: AutosarErrorCode.MISSING_INTERNAL_BEHAVIOR.code,
      severity: AutosarErrorCode.MISSING_INTERNAL_BEHAVIOR.severity,
      message: AutosarErrorCode.MISSING_INTERNAL_BEHAVIOR.message(swc.shortName),
      range: swc.range ?? DEFAULT_RANGE,
      elementName: swc.shortName,
    });
    return;
  }

  if (!swc.internalBehavior) return;

  const ib = swc.internalBehavior;
  const triggeredRunnables = new Set<string>();

  // Check events, M7411 (non-positive period), & M7405 (WCET budget overflow)
  for (const ev of ib.events) {
    triggeredRunnables.add(ev.startOnEventRef);

    if (ev.kind === "TIMING-EVENT" && ev.period !== undefined) {
      if (ev.period <= 0) {
        diags.push({
          code: AutosarErrorCode.INVALID_RUNNABLE_PERIOD.code,
          severity: AutosarErrorCode.INVALID_RUNNABLE_PERIOD.severity,
          message: AutosarErrorCode.INVALID_RUNNABLE_PERIOD.message(ev.startOnEventRef, ev.period),
          range: ev.range ?? ib.range ?? DEFAULT_RANGE,
          elementName: ev.startOnEventRef,
        });
      } else {
        const runnable = ib.runnables.get(ev.startOnEventRef);
        if (runnable?.executionTimeWcet !== undefined && runnable.executionTimeWcet > ev.period) {
          diags.push({
            code: AutosarErrorCode.WCET_BUDGET_OVERFLOW.code,
            severity: AutosarErrorCode.WCET_BUDGET_OVERFLOW.severity,
            message: AutosarErrorCode.WCET_BUDGET_OVERFLOW.message(
              runnable.shortName,
              (runnable.executionTimeWcet * 1000).toFixed(1),
              (ev.period * 1000).toFixed(1),
            ),
            range: runnable.range ?? ev.range ?? ib.range ?? DEFAULT_RANGE,
            elementName: runnable.shortName,
          });
        }
      }
    }
  }

  // M7410: Untriggered runnables
  for (const [rName, runnable] of ib.runnables) {
    if (!triggeredRunnables.has(rName)) {
      diags.push({
        code: AutosarErrorCode.UNTRIGGERED_RUNNABLE.code,
        severity: AutosarErrorCode.UNTRIGGERED_RUNNABLE.severity,
        message: AutosarErrorCode.UNTRIGGERED_RUNNABLE.message(rName, swc.shortName),
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
          code: AutosarErrorCode.CYCLIC_RUNNABLE_DEPENDENCY.code,
          severity: AutosarErrorCode.CYCLIC_RUNNABLE_DEPENDENCY.severity,
          message: AutosarErrorCode.CYCLIC_RUNNABLE_DEPENDENCY.message(cycle),
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

function checkInterfacesAndDataTypes(model: AutosarModel, diags: AutosarDiagnostic[]): void {
  // M7414: Missing SwAddrMethod when SW-DATA-DEF-PROPS is declared without SW-ADDR-METHOD-REF
  for (const iface of model.interfaces.values()) {
    if (!iface.dataElements) continue;
    for (const de of iface.dataElements) {
      if (de.swDataDefProps !== undefined && !de.swDataDefProps.swAddrMethodRef) {
        diags.push({
          code: AutosarErrorCode.MISSING_SW_ADDR_METHOD.code,
          severity: AutosarErrorCode.MISSING_SW_ADDR_METHOD.severity,
          message: AutosarErrorCode.MISSING_SW_ADDR_METHOD.message(de.shortName),
          range: de.range ?? iface.range ?? DEFAULT_RANGE,
          elementName: de.shortName,
        });
      }
    }
  }

  // M7412: Invalid data type mapping
  if (model.dataTypeMappings) {
    for (const map of model.dataTypeMappings) {
      const appName = map.applicationDataTypeRef.split("/").pop() || map.shortName || "unnamed";
      const implName = map.implementationDataTypeRef.split("/").pop() || "";
      if (!map.applicationDataTypeRef || !map.implementationDataTypeRef) {
        diags.push({
          code: AutosarErrorCode.INVALID_DATA_TYPE_MAPPING.code,
          severity: AutosarErrorCode.INVALID_DATA_TYPE_MAPPING.severity,
          message: AutosarErrorCode.INVALID_DATA_TYPE_MAPPING.message(
            appName,
            !map.implementationDataTypeRef
              ? "missing implementation data type reference"
              : "missing application data type reference",
          ),
          range: map.range ?? DEFAULT_RANGE,
          elementName: appName,
        });
      } else if (map.applicationDataTypeRef === map.implementationDataTypeRef) {
        diags.push({
          code: AutosarErrorCode.INVALID_DATA_TYPE_MAPPING.code,
          severity: AutosarErrorCode.INVALID_DATA_TYPE_MAPPING.severity,
          message: AutosarErrorCode.INVALID_DATA_TYPE_MAPPING.message(
            appName,
            `application data type cannot map to itself ('${implName}')`,
          ),
          range: map.range ?? DEFAULT_RANGE,
          elementName: appName,
        });
      }
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
            code: AutosarErrorCode.OVERLAPPING_PDU_BITS.code,
            severity: AutosarErrorCode.OVERLAPPING_PDU_BITS.severity,
            message: AutosarErrorCode.OVERLAPPING_PDU_BITS.message(existingSig, sig.shortName, bitIdx, pduName),
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
          code: AutosarErrorCode.PDU_EXCEEDS_FRAME_CAPACITY.code,
          severity: AutosarErrorCode.PDU_EXCEEDS_FRAME_CAPACITY.severity,
          message: AutosarErrorCode.PDU_EXCEEDS_FRAME_CAPACITY.message(
            pdu.shortName,
            pdu.byteLength,
            frameName,
            frame.length,
          ),
          range: frame.range ?? DEFAULT_RANGE,
          elementName: frameName,
        });
      }
    }
  }
}

/**
 * Pre-flight automotive linter verifying AUTOSAR architectures (M7401–M7415).
 */
export function lintAutosarModel(model: AutosarModel): AutosarDiagnostic[] {
  const diags: AutosarDiagnostic[] = [];

  // M7404: Duplicate short-names
  for (const pkg of model.packages.values()) {
    checkDuplicateShortNames(pkg, diags);
  }

  // M7401, M7402, M7403, M7405, M7408, M7409, M7410, M7411, M7415
  for (const swc of model.components.values()) {
    checkCompositionConnectors(swc, diags, model);
    checkPortDirections(swc, diags);
    checkInternalBehavior(swc, diags);
  }

  // M7413: Circular composition dependencies
  checkCircularCompositionDependencies(model, diags);

  // M7412, M7414: Interfaces, SwAddrMethod, and DataTypeMappingSet checks
  checkInterfacesAndDataTypes(model, diags);

  // M7406, M7407
  checkPduAndFrames(model, diags);

  return diags;
}
