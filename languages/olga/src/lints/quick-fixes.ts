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

import { CstDocumentSession, CstTransaction, CstXmlAdapter, encodeXmlAttrValue } from "@modelscript/dsl/unparser";
import type { SyntaxNode } from "@modelscript/dsl/utils";
import { getXmlWasmParser } from "@modelscript/dsl/xml";
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

function planSingleXmlFix(
  session: CstDocumentSession,
  mutate: (tx: CstTransaction) => void,
): {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}[] {
  const tx = new CstTransaction(session);
  mutate(tx);
  return tx.commit().edits;
}

function setFullXmlAttribute(tx: CstTransaction, el: SyntaxNode, attrName: string, value: string): void {
  const existing = CstXmlAdapter.getAttribute(el, attrName, tx.session.text);
  if (existing) {
    const q = existing.quote || '"';
    tx.replaceRange(
      existing.startOffset,
      existing.endOffset,
      `${existing.name}=${q}${encodeXmlAttrValue(value, q)}${q}`,
    );
    return;
  }
  CstXmlAdapter.setAttribute(tx, el, attrName, value);
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
  let session: CstDocumentSession | null = null;
  if (isXml) {
    let parser: unknown = null;
    try {
      parser = getXmlWasmParser();
    } catch {
      parser = null;
    }
    session = new CstDocumentSession({ uri, text, parser: parser as never, xmlFallback: true });
  }
  const elements: SyntaxNode[] = session?.rootNode
    ? CstXmlAdapter.findElements(session.rootNode, text, () => true)
    : [];
  const lines = text.split(/\r?\n/);
  const fixes: OlgaQuickFix[] = [];

  try {
    for (const d of diagnostics) {
      if (d.code === "M7008" && session) {
        // 1. Invalid PVT table extension (.csv -> .tab)
        for (const el of elements) {
          const attr = CstXmlAdapter.getAttribute(el, "tableFile", text);
          if (attr && attr.value.toLowerCase().endsWith(".csv")) {
            const edits = planSingleXmlFix(session, (tx) =>
              CstXmlAdapter.setAttribute(tx, el, attr.name, `${attr.value.slice(0, -4)}.tab`),
            );
            fixes.push({
              title: `Fix M7008: Change fluid table extension from .csv to .tab`,
              code: d.code,
              isPreferred: true,
              edit: { changes: { [uri]: edits } },
            });
            break;
          }
        }
      } else if (d.code === "M7009" && session) {
        // 2. Wax deposition risk: inject PU foam insulation layer into Flowpath
        const flowpathTarget = d.target;
        const targetEl = elements.find(
          (el) =>
            (CstXmlAdapter.getTagName(el, text) ?? "").toLowerCase() === "flowpath" &&
            (!flowpathTarget ||
              CstXmlAdapter.getAttribute(el, "name", text)?.value === flowpathTarget ||
              CstXmlAdapter.getAttribute(el, "id", text)?.value === flowpathTarget),
        );
        if (targetEl) {
          const insulationXml =
            `<HeatTransfer ambientTemperature="277.15">\n` +
            `  <Layer material="Polyurethane" thickness="0.05" conductivity="0.025" />\n` +
            `</HeatTransfer>`;
          const edits = planSingleXmlFix(session, (tx) => CstXmlAdapter.appendChild(tx, targetEl, insulationXml));
          fixes.push({
            title: `Fix M7009: Inject 50mm Polyurethane insulation layer to mitigate wax deposition in '${flowpathTarget ?? "flowpath"}'`,
            code: d.code,
            isPreferred: true,
            edit: { changes: { [uri]: edits } },
          });
        }
      } else if (d.code === "M7010" && session) {
        // 3. Sand erosion or dropout hazard
        const isErosion = d.message.includes("API RP 14E sand erosion");
        if (isErosion) {
          let valveFixed = false;
          for (const el of elements) {
            if ((CstXmlAdapter.getTagName(el, text) ?? "").toLowerCase() !== "valve") continue;
            const openingAttr = CstXmlAdapter.getAttribute(el, "opening", text);
            if (openingAttr && parseFloat(openingAttr.value) > 0.6) {
              const edits = planSingleXmlFix(session, (tx) =>
                CstXmlAdapter.setAttribute(tx, el, openingAttr.name, "0.60"),
              );
              fixes.push({
                title: `Fix M7010: Throttle choke valve opening to 0.60 to prevent sand erosion exceedance`,
                code: d.code,
                isPreferred: true,
                edit: { changes: { [uri]: edits } },
              });
              valveFixed = true;
              break;
            }
          }

          if (!valveFixed) {
            for (const el of elements) {
              if ((CstXmlAdapter.getTagName(el, text) ?? "").toLowerCase() !== "pipe") continue;
              const diamAttr = CstXmlAdapter.getAttribute(el, "diameter", text);
              if (diamAttr) {
                const currentDiam = parseFloat(diamAttr.value);
                const enlargedDiam = (currentDiam * 1.35).toFixed(3);
                const edits = planSingleXmlFix(session, (tx) =>
                  CstXmlAdapter.setAttribute(tx, el, diamAttr.name, enlargedDiam),
                );
                fixes.push({
                  title: `Fix M7010: Enlarge pipe diameter from ${currentDiam}m to ${enlargedDiam}m to reduce velocity below erosion limit`,
                  code: d.code,
                  edit: { changes: { [uri]: edits } },
                });
                break;
              }
            }
          }
        } else {
          for (const el of elements) {
            if ((CstXmlAdapter.getTagName(el, text) ?? "").toLowerCase() !== "source") continue;
            const rateAttr = CstXmlAdapter.getAttribute(el, "totalMassRate", text);
            if (rateAttr) {
              const currentRate = parseFloat(rateAttr.value);
              const boostedRate = Math.max(30.0, currentRate * 2.0).toFixed(1);
              const edits = planSingleXmlFix(session, (tx) =>
                CstXmlAdapter.setAttribute(tx, el, rateAttr.name, boostedRate),
              );
              fixes.push({
                title: `Fix M7010: Increase mass rate from ${currentRate} kg/s to ${boostedRate} kg/s to maintain sand suspension`,
                code: d.code,
                isPreferred: true,
                edit: { changes: { [uri]: edits } },
              });
              break;
            }
          }
        }
      } else if (d.code === "M7005" && session) {
        // 4. Fully closed choke: crack open to 0.05
        const valveTarget = d.target;
        for (const el of elements) {
          if (
            (CstXmlAdapter.getTagName(el, text) ?? "").toLowerCase() === "valve" &&
            (!valveTarget || CstXmlAdapter.getAttribute(el, "name", text)?.value === valveTarget)
          ) {
            const openingAttr = CstXmlAdapter.getAttribute(el, "opening", text);
            if (openingAttr && parseFloat(openingAttr.value) === 0) {
              const edits = planSingleXmlFix(session, (tx) => setFullXmlAttribute(tx, el, openingAttr.name, "0.05"));
              fixes.push({
                title: `Fix M7005: Crack valve '${valveTarget ?? "choke"}' to 5% opening (0.05) to prevent shut-in overpressure`,
                code: d.code,
                isPreferred: true,
                edit: { changes: { [uri]: edits } },
              });
              break;
            }
          }
        }
      } else if (d.code === "M7001" && session) {
        // 5. CFL stability violation: adjust maxDt to 0.1
        for (const el of elements) {
          const dtAttr = CstXmlAdapter.getAttribute(el, "maxDt", text);
          if (dtAttr) {
            const edits = planSingleXmlFix(session, (tx) => setFullXmlAttribute(tx, el, dtAttr.name, "0.1"));
            fixes.push({
              title: `Fix M7001: Reduce maxDt to 0.1s to satisfy Courant-Friedrichs-Lewy stability limit`,
              code: d.code,
              isPreferred: true,
              edit: { changes: { [uri]: edits } },
            });
            break;
          }
        }
      } else if (d.code === "M7011" && session) {
        // 6. Sour service (H2S) metallurgy violation: upgrade to API 5L X65MS or add Inconel 625 cladding
        const pipeEl = elements.find((el) => (CstXmlAdapter.getTagName(el, text) ?? "").toLowerCase() === "pipe");
        if (pipeEl) {
          fixes.push({
            title: `Fix M7011: Upgrade pipe metallurgy to NACE MR0175 certified sour service grade API 5L X65MS`,
            code: d.code,
            isPreferred: true,
            edit: {
              changes: {
                [uri]: planSingleXmlFix(session, (tx) =>
                  CstXmlAdapter.setAttribute(tx, pipeEl, "Metallurgy", "API_5L_X65MS"),
                ),
              },
            },
          });
          fixes.push({
            title: `Fix M7011: Apply internal 3.0mm Inconel 625 CRA cladding to resist severe H2S stress cracking`,
            code: d.code,
            isPreferred: false,
            edit: {
              changes: {
                [uri]: planSingleXmlFix(session, (tx) =>
                  CstXmlAdapter.setAttribute(tx, pipeEl, "Cladding", "INCONEL_625"),
                ),
              },
            },
          });
        }
      } else if (d.code === "M7012") {
        // 7. M7012: Inject aromatic solvent / chemical dispersant to lower Colloidal Instability Index (CII < 0.70)
        let fixedXml = false;
        if (session) {
          for (const el of elements) {
            const aroAttr = CstXmlAdapter.getAttribute(el, "aromatics", text);
            if (aroAttr) {
              fixes.push({
                title: `Fix M7012: Inject aromatic chemical dispersant to increase aromatic solvent fraction to 45% (shifts fluid to stable CII < 0.70)`,
                code: d.code,
                isPreferred: true,
                edit: {
                  changes: {
                    [uri]: planSingleXmlFix(session, (tx) => CstXmlAdapter.setAttribute(tx, el, aroAttr.name, "45.0")),
                  },
                },
              });
              fixedXml = true;
              break;
            }
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
  } finally {
    session?.dispose();
  }

  return fixes;
}
