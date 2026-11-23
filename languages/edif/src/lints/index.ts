// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static analysis and linter engine for EDIF 2.0.0 (`EDIF1001`–`EDIF5006`).
 */

import { EdifErrorCode, type EdifDiagnostic } from "../errors.js";
import { parseEdif } from "../parser/edif-parser.js";
import type { EdifCell, EdifDocument, EdifLibrary, EdifSpan, EdifView } from "../types.js";

function makeDiag(
  entry: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span?: EdifSpan,
  symbolName?: string,
): EdifDiagnostic {
  return {
    code: entry.code,
    id: entry.id,
    rule: entry.rule,
    severity: entry.severity,
    message,
    startOffset: span?.startOffset,
    endOffset: span?.endOffset,
    line: span?.line,
    column: span?.column,
    endLine: span?.endLine,
    endColumn: span?.endColumn,
    symbolName,
  };
}

const VALID_DIRECTIONS = new Set(["INPUT", "OUTPUT", "INOUT"]);

/**
 * Runs all EDIF 2.0.0 static analysis rules (`EDIF1001`–`EDIF5006`) on an `EdifDocument` or raw source string.
 */
export function lintEdif(docOrSource: EdifDocument | string): EdifDiagnostic[] {
  const doc = typeof docOrSource === "string" ? parseEdif(docOrSource) : docOrSource;
  const diags: EdifDiagnostic[] = [];

  // EDIF1001: Syntax errors
  for (const err of doc.syntaxErrors) {
    diags.push(makeDiag(EdifErrorCode.SYNTAX_ERROR, EdifErrorCode.SYNTAX_ERROR.message(err.message), err.span));
  }

  // EDIF1002: edifVersion must be 2 0 0
  if (
    !doc.edifVersion ||
    doc.edifVersion.length !== 3 ||
    doc.edifVersion[0] !== 2 ||
    doc.edifVersion[1] !== 0 ||
    doc.edifVersion[2] !== 0
  ) {
    const found = doc.edifVersion ? doc.edifVersion.join(" ") : "<missing>";
    diags.push(
      makeDiag(
        EdifErrorCode.INVALID_EDIF_VERSION,
        EdifErrorCode.INVALID_EDIF_VERSION.message(found),
        doc.edifVersionSpan ?? doc.span,
      ),
    );
  }

  // EDIF1003: edifLevel should be 0, 1, or 2
  if (doc.edifLevel !== undefined && (doc.edifLevel < 0 || doc.edifLevel > 2 || !Number.isInteger(doc.edifLevel))) {
    diags.push(
      makeDiag(
        EdifErrorCode.INVALID_EDIF_LEVEL,
        EdifErrorCode.INVALID_EDIF_LEVEL.message(String(doc.edifLevel)),
        doc.edifLevelSpan ?? doc.span,
      ),
    );
  }

  // Build library lookup & check EDIF2001 (duplicate libraries)
  const libMap = new Map<string, EdifLibrary>();
  const allLibs = [...doc.externals, ...doc.libraries];
  for (const lib of allLibs) {
    const key = lib.name.toLowerCase();
    if (libMap.has(key)) {
      diags.push(
        makeDiag(
          EdifErrorCode.DUPLICATE_LIBRARY,
          EdifErrorCode.DUPLICATE_LIBRARY.message(lib.name),
          lib.span,
          lib.name,
        ),
      );
    } else {
      libMap.set(key, lib);
    }
  }

  // Build cell lookup per library & check EDIF2002 (duplicate cells)
  const cellMapByLib = new Map<string, Map<string, EdifCell>>();
  for (const lib of allLibs) {
    const libKey = lib.name.toLowerCase();
    const cellMap = new Map<string, EdifCell>();
    for (const cell of lib.cells) {
      const cellKey = cell.name.toLowerCase();
      if (cellMap.has(cellKey)) {
        diags.push(
          makeDiag(
            EdifErrorCode.DUPLICATE_CELL,
            EdifErrorCode.DUPLICATE_CELL.message(cell.name, lib.name),
            cell.span,
            cell.name,
          ),
        );
      } else {
        cellMap.set(cellKey, cell);
      }
    }
    if (!cellMapByLib.has(libKey)) {
      cellMapByLib.set(libKey, cellMap);
    }
  }

  function resolveCell(libName: string | undefined, cellName: string, fallbackLib: EdifLibrary): EdifCell | undefined {
    const targetLibKey = (libName ?? fallbackLib.name).toLowerCase();
    const cm = cellMapByLib.get(targetLibKey);
    return cm?.get(cellName.toLowerCase());
  }

  function resolveView(cell: EdifCell, viewName: string): EdifView | undefined {
    return cell.views.find((v) => v.name.toLowerCase() === viewName.toLowerCase());
  }

  // Inspect each library -> cell -> view
  for (const lib of allLibs) {
    for (const cell of lib.cells) {
      for (const view of cell.views) {
        // Ports: check EDIF2005 (duplicate port) and EDIF5005 (invalid direction)
        const portMap = new Map<string, (typeof view.ports)[number]>();
        for (const port of view.ports) {
          const pKey = port.name.toLowerCase();
          if (portMap.has(pKey)) {
            diags.push(
              makeDiag(
                EdifErrorCode.DUPLICATE_PORT,
                EdifErrorCode.DUPLICATE_PORT.message(port.name, cell.name),
                port.span,
                port.name,
              ),
            );
          } else {
            portMap.set(pKey, port);
          }
          if (port.direction && !VALID_DIRECTIONS.has(port.direction.toUpperCase())) {
            diags.push(
              makeDiag(
                EdifErrorCode.INVALID_PORT_DIRECTION,
                EdifErrorCode.INVALID_PORT_DIRECTION.message(port.direction, port.name),
                port.span,
                port.name,
              ),
            );
          }
        }

        // Instances: check EDIF2003 (duplicate instance) and EDIF3001/3002/3003 (unresolved refs)
        const instMap = new Map<string, { inst: (typeof view.instances)[number]; targetView?: EdifView | undefined }>();
        for (const inst of view.instances) {
          const iKey = inst.name.toLowerCase();
          if (instMap.has(iKey)) {
            diags.push(
              makeDiag(
                EdifErrorCode.DUPLICATE_INSTANCE,
                EdifErrorCode.DUPLICATE_INSTANCE.message(inst.name, cell.name),
                inst.span,
                inst.name,
              ),
            );
          }

          let targetView: EdifView | undefined;
          const refLibName = inst.viewRef.libraryName;
          const refCellName = inst.viewRef.cellName;
          const refViewName = inst.viewRef.viewName;

          if (refLibName && !libMap.has(refLibName.toLowerCase())) {
            diags.push(
              makeDiag(
                EdifErrorCode.UNRESOLVED_LIBRARY_REF,
                EdifErrorCode.UNRESOLVED_LIBRARY_REF.message(refLibName),
                inst.viewRef.span ?? inst.span,
                refLibName,
              ),
            );
          } else if (refCellName) {
            const targetCell = resolveCell(refLibName, refCellName, lib);
            if (!targetCell) {
              diags.push(
                makeDiag(
                  EdifErrorCode.UNRESOLVED_CELL_REF,
                  EdifErrorCode.UNRESOLVED_CELL_REF.message(refCellName, refLibName ?? lib.name),
                  inst.viewRef.span ?? inst.span,
                  refCellName,
                ),
              );
            } else if (refViewName) {
              targetView = resolveView(targetCell, refViewName);
              if (!targetView) {
                diags.push(
                  makeDiag(
                    EdifErrorCode.UNRESOLVED_VIEW_REF,
                    EdifErrorCode.UNRESOLVED_VIEW_REF.message(refViewName, targetCell.name),
                    inst.viewRef.span ?? inst.span,
                    refViewName,
                  ),
                );
              }
            } else {
              targetView = targetCell.views[0];
            }
          }

          if (!instMap.has(iKey)) {
            instMap.set(iKey, { inst, targetView });
          }
        }

        // Nets: check EDIF2004, EDIF3004, EDIF3005, EDIF4001, EDIF4002
        const netNames = new Set<string>();
        for (const net of view.nets) {
          const nKey = net.name.toLowerCase();
          if (netNames.has(nKey)) {
            diags.push(
              makeDiag(
                EdifErrorCode.DUPLICATE_NET,
                EdifErrorCode.DUPLICATE_NET.message(net.name, cell.name),
                net.span,
                net.name,
              ),
            );
          } else {
            netNames.add(nKey);
          }

          // EDIF4001: Floating net (< 2 pins)
          if (net.joined.length < 2) {
            diags.push(
              makeDiag(
                EdifErrorCode.FLOATING_NET,
                EdifErrorCode.FLOATING_NET.message(net.name, net.joined.length),
                net.span,
                net.name,
              ),
            );
          }

          const outputDrivers: string[] = [];

          for (const pref of net.joined) {
            if (pref.instanceName) {
              const entry = instMap.get(pref.instanceName.toLowerCase());
              if (!entry) {
                diags.push(
                  makeDiag(
                    EdifErrorCode.UNRESOLVED_INSTANCE_REF,
                    EdifErrorCode.UNRESOLVED_INSTANCE_REF.message(pref.instanceName, net.name),
                    pref.span ?? net.span,
                    pref.instanceName,
                  ),
                );
              } else if (entry.targetView) {
                const targetPort = entry.targetView.ports.find(
                  (p) => p.name.toLowerCase() === pref.portName.toLowerCase(),
                );
                if (!targetPort) {
                  diags.push(
                    makeDiag(
                      EdifErrorCode.UNRESOLVED_PORT_REF,
                      EdifErrorCode.UNRESOLVED_PORT_REF.message(pref.portName, pref.instanceName),
                      pref.span ?? net.span,
                      pref.portName,
                    ),
                  );
                } else if (targetPort.direction?.toUpperCase() === "OUTPUT") {
                  outputDrivers.push(`${pref.instanceName}.${pref.portName}`);
                }
              }
            } else {
              // Port reference to enclosing cell interface
              const parentPort = portMap.get(pref.portName.toLowerCase());
              if (!parentPort) {
                diags.push(
                  makeDiag(
                    EdifErrorCode.UNRESOLVED_PORT_REF,
                    EdifErrorCode.UNRESOLVED_PORT_REF.message(pref.portName, cell.name),
                    pref.span ?? net.span,
                    pref.portName,
                  ),
                );
              } else if (parentPort.direction?.toUpperCase() === "INPUT") {
                outputDrivers.push(`${cell.name}.${pref.portName}`);
              }
            }
          }

          // EDIF4002: Shorted output-to-output drivers
          if (outputDrivers.length > 1) {
            diags.push(
              makeDiag(
                EdifErrorCode.SHORTED_OUTPUT_DRIVERS,
                EdifErrorCode.SHORTED_OUTPUT_DRIVERS.message(net.name, outputDrivers.join(", ")),
                net.span,
                net.name,
              ),
            );
          }
        }
      }
    }
  }

  // EDIF5001 & EDIF5002: Top-level design check
  if (!doc.design) {
    diags.push(
      makeDiag(EdifErrorCode.MISSING_DESIGN, EdifErrorCode.MISSING_DESIGN.message(doc.name), doc.span, doc.name),
    );
  } else {
    const designLib = doc.design.libraryName;
    const designCell = doc.design.cellName;
    let resolved = false;
    if (designLib) {
      const cm = cellMapByLib.get(designLib.toLowerCase());
      resolved = Boolean(cm && cm.has(designCell.toLowerCase()));
    } else {
      for (const cm of cellMapByLib.values()) {
        if (cm.has(designCell.toLowerCase())) {
          resolved = true;
          break;
        }
      }
    }
    if (!resolved) {
      diags.push(
        makeDiag(
          EdifErrorCode.UNRESOLVED_DESIGN_CELL,
          EdifErrorCode.UNRESOLVED_DESIGN_CELL.message(designCell || "<missing>", designLib ?? "<default>"),
          doc.design.span ?? doc.span,
          designCell,
        ),
      );
    }
  }

  // EDIF5006: Hierarchy cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const reportedCycles = new Set<string>();

  function dfs(lib: EdifLibrary, cell: EdifCell, path: string[]): void {
    const key = `${lib.name.toLowerCase()}::${cell.name.toLowerCase()}`;
    if (inStack.has(key)) {
      const cycleStr = [...path, cell.name].join(" -> ");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        diags.push(
          makeDiag(
            EdifErrorCode.HIERARCHY_CYCLE,
            EdifErrorCode.HIERARCHY_CYCLE.message(cycleStr),
            cell.span,
            cell.name,
          ),
        );
      }
      return;
    }
    if (visited.has(key)) return;
    visited.add(key);
    inStack.add(key);

    for (const view of cell.views) {
      for (const inst of view.instances) {
        if (!inst.viewRef.cellName) continue;
        const targetLibKey = (inst.viewRef.libraryName ?? lib.name).toLowerCase();
        const targetLib = libMap.get(targetLibKey);
        const targetCell = targetLib
          ? cellMapByLib.get(targetLibKey)?.get(inst.viewRef.cellName.toLowerCase())
          : undefined;
        if (targetLib && targetCell) {
          dfs(targetLib, targetCell, [...path, cell.name]);
        }
      }
    }

    inStack.delete(key);
  }

  for (const lib of allLibs) {
    for (const cell of lib.cells) {
      dfs(lib, cell, []);
    }
  }

  return diags;
}
