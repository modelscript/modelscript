// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — LSP Quick-Fix Provider for Flow Assurance Diagnostics.
 *
 * Generates automated WorkspaceEdit patches for pre-flight linter diagnostics:
 * - M7001 (CFL condition violation) -> Adjust maxDt to numerical stability limit
 * - M7005 (Fully closed choke)      -> Crack choke opening to 5% to prevent overpressurization
 * - M7008 (PVT table extension)     -> Convert invalid extension (.csv) to standard (.tab)
 * - M7009 (Wax deposition risk)     -> Inject PU foam insulation layer into flowpath
 * - M7010 (Sand erosion/dropout)    -> Throttle choke to avoid erosion or increase rate
 */

import {
  appendChildSplice,
  encodeAttr,
  parseXmlSync,
  setAttributeSplice,
  type Splice,
  type XmlAttribute,
  type XmlElement,
} from "@modelscript/dsl/xml";
import { parseOlga } from "../parser/index.js";
import { lintOlgaModel } from "./index.js";

export interface OlgaQuickFix {
  title: string;
  code: string;
  isPreferred?: boolean;
  edit: {
    changes: Record<
      string,
      {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        newText: string;
      }[]
    >;
  };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function offsetToPosition(offset: number, lineStarts: number[]): { line: number; character: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const line = high;
  return { line, character: offset - lineStarts[line]! };
}

function spliceToChange(
  splice: Splice,
  lineStarts: number[],
): {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
} {
  return {
    range: {
      start: offsetToPosition(splice.start, lineStarts),
      end: offsetToPosition(splice.end, lineStarts),
    },
    newText: splice.text,
  };
}

function replaceAttrSplice(el: XmlElement, attrName: string, value: string, source: string): Splice {
  const existing = el.attributes.find((a) => a.name.toLowerCase() === attrName.toLowerCase());
  if (existing) {
    const quote = existing.quote ?? '"';
    return { start: existing.start, end: existing.end, text: `${existing.name}=${quote}${encodeAttr(value)}${quote}` };
  }
  return setAttributeSplice(el, attrName, value, source);
}

function collectElements(root: XmlElement | null): XmlElement[] {
  const result: XmlElement[] = [];
  const visit = (el: XmlElement) => {
    result.push(el);
    for (const ch of el.children) visit(ch);
  };
  if (root) visit(root);
  return result;
}

function findAttr(el: XmlElement, name: string): XmlAttribute | undefined {
  return el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
}

export function getOlgaQuickFixes(text: string, uri: string): OlgaQuickFix[] {
  let model;
  try {
    model = parseOlga(text);
  } catch {
    return [];
  }

  const diagnostics = lintOlgaModel(model);
  const isXml = text.trimStart().startsWith("<");
  const xmlDoc = isXml ? parseXmlSync(text) : null;
  const elements = collectElements(xmlDoc?.root ?? null);
  const lineStarts = computeLineStarts(text);
  const lines = text.split(/\r?\n/);
  const fixes: OlgaQuickFix[] = [];

  for (const d of diagnostics) {
    if (d.code === "M7008") {
      // 1. Invalid PVT table extension (.csv -> .tab)
      for (const el of elements) {
        const attr = findAttr(el, "tableFile");
        if (attr && attr.value.toLowerCase().endsWith(".csv")) {
          const splice = replaceAttrSplice(el, attr.name, `${attr.value.slice(0, -4)}.tab`, text);
          fixes.push({
            title: `Fix M7008: Change fluid table extension from .csv to .tab`,
            code: d.code,
            isPreferred: true,
            edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
          });
          break;
        }
      }
    } else if (d.code === "M7009") {
      // 2. Wax deposition risk: inject PU foam insulation layer into Flowpath
      const flowpathTarget = d.target;
      const targetEl = elements.find(
        (el) =>
          el.name.toLowerCase() === "flowpath" &&
          (!flowpathTarget ||
            findAttr(el, "name")?.value === flowpathTarget ||
            findAttr(el, "id")?.value === flowpathTarget),
      );
      if (targetEl) {
        const insulationXml =
          `<HeatTransfer ambientTemperature="277.15">\n` +
          `  <Layer material="Polyurethane" thickness="0.05" conductivity="0.025" />\n` +
          `</HeatTransfer>`;
        const splice = appendChildSplice(targetEl, insulationXml, text);
        fixes.push({
          title: `Fix M7009: Inject 50mm Polyurethane insulation layer to mitigate wax deposition in '${flowpathTarget ?? "flowpath"}'`,
          code: d.code,
          isPreferred: true,
          edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
        });
      }
    } else if (d.code === "M7010") {
      // 3. Sand erosion or dropout hazard
      const isErosion = d.message.includes("API RP 14E sand erosion");
      if (isErosion) {
        let valveFixed = false;
        for (const el of elements) {
          if (el.name.toLowerCase() !== "valve") continue;
          const openingAttr = findAttr(el, "opening");
          if (openingAttr && parseFloat(openingAttr.value) > 0.6) {
            const splice = replaceAttrSplice(el, openingAttr.name, "0.60", text);
            fixes.push({
              title: `Fix M7010: Throttle choke valve opening to 0.60 to prevent sand erosion exceedance`,
              code: d.code,
              isPreferred: true,
              edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
            });
            valveFixed = true;
            break;
          }
        }

        if (!valveFixed) {
          for (const el of elements) {
            if (el.name.toLowerCase() !== "pipe") continue;
            const diamAttr = findAttr(el, "diameter");
            if (diamAttr) {
              const currentDiam = parseFloat(diamAttr.value);
              const enlargedDiam = (currentDiam * 1.35).toFixed(3);
              const splice = replaceAttrSplice(el, diamAttr.name, enlargedDiam, text);
              fixes.push({
                title: `Fix M7010: Enlarge pipe diameter from ${currentDiam}m to ${enlargedDiam}m to reduce velocity below erosion limit`,
                code: d.code,
                edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
              });
              break;
            }
          }
        }
      } else {
        for (const el of elements) {
          if (el.name.toLowerCase() !== "source") continue;
          const rateAttr = findAttr(el, "totalMassRate");
          if (rateAttr) {
            const currentRate = parseFloat(rateAttr.value);
            const boostedRate = Math.max(30.0, currentRate * 2.0).toFixed(1);
            const splice = replaceAttrSplice(el, rateAttr.name, boostedRate, text);
            fixes.push({
              title: `Fix M7010: Increase mass rate from ${currentRate} kg/s to ${boostedRate} kg/s to maintain sand suspension`,
              code: d.code,
              isPreferred: true,
              edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
            });
            break;
          }
        }
      }
    } else if (d.code === "M7005") {
      // 4. Fully closed choke: crack open to 0.05
      const valveTarget = d.target;
      for (const el of elements) {
        if (el.name.toLowerCase() === "valve" && (!valveTarget || findAttr(el, "name")?.value === valveTarget)) {
          const openingAttr = findAttr(el, "opening");
          if (openingAttr && parseFloat(openingAttr.value) === 0) {
            const splice = replaceAttrSplice(el, openingAttr.name, "0.05", text);
            fixes.push({
              title: `Fix M7005: Crack valve '${valveTarget ?? "choke"}' to 5% opening (0.05) to prevent shut-in overpressure`,
              code: d.code,
              isPreferred: true,
              edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
            });
            break;
          }
        }
      }
    } else if (d.code === "M7001") {
      // 5. CFL stability violation: adjust maxDt to 0.1
      for (const el of elements) {
        const dtAttr = findAttr(el, "maxDt");
        if (dtAttr) {
          const splice = replaceAttrSplice(el, dtAttr.name, "0.1", text);
          fixes.push({
            title: `Fix M7001: Reduce maxDt to 0.1s to satisfy Courant-Friedrichs-Lewy stability limit`,
            code: d.code,
            isPreferred: true,
            edit: { changes: { [uri]: [spliceToChange(splice, lineStarts)] } },
          });
          break;
        }
      }
    } else if (d.code === "M7011") {
      // 6. Sour service (H2S) metallurgy violation: upgrade to API 5L X65MS or add Inconel 625 cladding
      const pipeEl = elements.find((el) => el.name.toLowerCase() === "pipe");
      if (pipeEl) {
        fixes.push({
          title: `Fix M7011: Upgrade pipe metallurgy to NACE MR0175 certified sour service grade API 5L X65MS`,
          code: d.code,
          isPreferred: true,
          edit: {
            changes: {
              [uri]: [spliceToChange(replaceAttrSplice(pipeEl, "Metallurgy", "API_5L_X65MS", text), lineStarts)],
            },
          },
        });
        fixes.push({
          title: `Fix M7011: Apply internal 3.0mm Inconel 625 CRA cladding to resist severe H2S stress cracking`,
          code: d.code,
          isPreferred: false,
          edit: {
            changes: {
              [uri]: [spliceToChange(replaceAttrSplice(pipeEl, "Cladding", "INCONEL_625", text), lineStarts)],
            },
          },
        });
      }
    } else if (d.code === "M7012") {
      // 7. M7012: Inject aromatic solvent / chemical dispersant to lower Colloidal Instability Index (CII < 0.70)
      let fixedXml = false;
      for (const el of elements) {
        const aroAttr = findAttr(el, "aromatics");
        if (aroAttr) {
          fixes.push({
            title: `Fix M7012: Inject aromatic chemical dispersant to increase aromatic solvent fraction to 45% (shifts fluid to stable CII < 0.70)`,
            code: d.code,
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [spliceToChange(replaceAttrSplice(el, aroAttr.name, "45.0", text), lineStarts)],
              },
            },
          });
          fixedXml = true;
          break;
        }
      }
      if (!fixedXml) {
        // Legacy OLGA .key keyword deck (non-XML)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const aroMatch = /(AROMATICS\s*=\s*)([0-9.]+)/i.exec(line);
          if (aroMatch) {
            const startCol = line.indexOf(aroMatch[0]);
            const endCol = startCol + aroMatch[0].length;
            fixes.push({
              title: `Fix M7012: Inject aromatic chemical dispersant to increase aromatic solvent fraction to 45% (shifts fluid to stable CII < 0.70)`,
              code: d.code,
              isPreferred: true,
              edit: {
                changes: {
                  [uri]: [
                    {
                      range: {
                        start: { line: i, character: startCol },
                        end: { line: i, character: endCol },
                      },
                      newText: `${aroMatch[1]}45.0`,
                    },
                  ],
                },
              },
            });
            break;
          }
        }
      }
    }
  }

  return fixes;
}
