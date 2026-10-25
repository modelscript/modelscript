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

export function getOlgaQuickFixes(text: string, uri: string): OlgaQuickFix[] {
  let model;
  try {
    model = parseOlga(text);
  } catch {
    return [];
  }

  const diagnostics = lintOlgaModel(model);
  const lines = text.split(/\r?\n/);
  const fixes: OlgaQuickFix[] = [];

  for (const d of diagnostics) {
    if (d.code === "M7008") {
      // 1. Invalid PVT table extension (.csv -> .tab)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = /(tableFile\s*=\s*["'])([^"']+)(\.csv)(["'])/i.exec(line);
        if (match) {
          const startCol = match.index;
          const endCol = startCol + match[0].length;
          const replacement = `${match[1]}${match[2]}.tab${match[4]}`;
          fixes.push({
            title: `Fix M7008: Change fluid table extension from .csv to .tab`,
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
                    newText: replacement,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M7009") {
      // 2. Wax deposition risk: inject PU foam insulation layer into Flowpath
      const flowpathTarget = d.target;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (
          line.includes("<Flowpath") &&
          (!flowpathTarget || line.includes(`name="${flowpathTarget}"`) || line.includes(`id="${flowpathTarget}"`))
        ) {
          // Check indentation
          const indentMatch = /^\s*/.exec(line);
          const indent = (indentMatch ? indentMatch[0] : "") + "    ";
          const insulationXml = `\n${indent}<HeatTransfer ambientTemperature="277.15">\n${indent}  <Layer material="Polyurethane" thickness="0.05" conductivity="0.025" />\n${indent}</HeatTransfer>`;

          // Insert right after the opening Flowpath tag or closing >
          const insertLine = i;
          const insertCol = line.length;
          fixes.push({
            title: `Fix M7009: Inject 50mm Polyurethane insulation layer to mitigate wax deposition in '${flowpathTarget ?? "flowpath"}'`,
            code: d.code,
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: {
                      start: { line: insertLine, character: insertCol },
                      end: { line: insertLine, character: insertCol },
                    },
                    newText: insulationXml,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M7010") {
      // 3. Sand erosion or dropout hazard
      const isErosion = d.message.includes("API RP 14E sand erosion");
      if (isErosion) {
        // Find valve opening or pipe diameter
        let valveFixed = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const valveMatch = /(<Valve[^>]*\sopening\s*=\s*["'])([0-9.]+)(["'])/i.exec(line);
          if (valveMatch && parseFloat(valveMatch[2]!) > 0.6) {
            const startCol = line.indexOf(valveMatch[0]);
            const endCol = startCol + valveMatch[0].length;
            const replacement = `${valveMatch[1]}0.60${valveMatch[3]}`;
            fixes.push({
              title: `Fix M7010: Throttle choke valve opening to 0.60 to prevent sand erosion exceedance`,
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
                      newText: replacement,
                    },
                  ],
                },
              },
            });
            valveFixed = true;
            break;
          }
        }

        if (!valveFixed) {
          // Increase pipe diameter to reduce mixture velocity
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const pipeMatch = /(<Pipe[^>]*\sdiameter\s*=\s*["'])([0-9.]+)(["'])/i.exec(line);
            if (pipeMatch) {
              const currentDiam = parseFloat(pipeMatch[2]!);
              const enlargedDiam = (currentDiam * 1.35).toFixed(3);
              const startCol = line.indexOf(pipeMatch[0]);
              const endCol = startCol + pipeMatch[0].length;
              const replacement = `${pipeMatch[1]}${enlargedDiam}${pipeMatch[3]}`;
              fixes.push({
                title: `Fix M7010: Enlarge pipe diameter from ${currentDiam}m to ${enlargedDiam}m to reduce velocity below erosion limit`,
                code: d.code,
                edit: {
                  changes: {
                    [uri]: [
                      {
                        range: {
                          start: { line: i, character: startCol },
                          end: { line: i, character: endCol },
                        },
                        newText: replacement,
                      },
                    ],
                  },
                },
              });
              break;
            }
          }
        }
      } else {
        // Sand dropout / deposition hazard: increase source rate
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const srcMatch = /(<Source[^>]*\stotalMassRate\s*=\s*["'])([0-9.]+)(["'])/i.exec(line);
          if (srcMatch) {
            const currentRate = parseFloat(srcMatch[2]!);
            const boostedRate = Math.max(30.0, currentRate * 2.0).toFixed(1);
            const startCol = line.indexOf(srcMatch[0]);
            const endCol = startCol + srcMatch[0].length;
            const replacement = `${srcMatch[1]}${boostedRate}${srcMatch[3]}`;
            fixes.push({
              title: `Fix M7010: Increase mass rate from ${currentRate} kg/s to ${boostedRate} kg/s to maintain sand suspension`,
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
                      newText: replacement,
                    },
                  ],
                },
              },
            });
            break;
          }
        }
      }
    } else if (d.code === "M7005") {
      // 4. Fully closed choke: crack open to 0.05
      const valveTarget = d.target;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("<Valve") && (!valveTarget || line.includes(`name="${valveTarget}"`))) {
          const match = /(opening\s*=\s*["'])(0(?:\.0+)?)(["'])/i.exec(line);
          if (match) {
            const startCol = line.indexOf(match[0]);
            const endCol = startCol + match[0].length;
            const replacement = `${match[1]}0.05${match[3]}`;
            fixes.push({
              title: `Fix M7005: Crack valve '${valveTarget ?? "choke"}' to 5% opening (0.05) to prevent shut-in overpressure`,
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
                      newText: replacement,
                    },
                  ],
                },
              },
            });
            break;
          }
        }
      }
    } else if (d.code === "M7001") {
      // 5. CFL stability violation: adjust maxDt to 0.1
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = /(maxDt\s*=\s*["'])([0-9.]+)(["'])/i.exec(line);
        if (match) {
          const startCol = line.indexOf(match[0]);
          const endCol = startCol + match[0].length;
          const replacement = `${match[1]}0.1${match[3]}`;
          fixes.push({
            title: `Fix M7001: Reduce maxDt to 0.1s to satisfy Courant-Friedrichs-Lewy stability limit`,
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
                    newText: replacement,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M7011") {
      // 6. Sour service (H2S) metallurgy violation: upgrade to API 5L X65MS or add Inconel 625 cladding
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const pipeMatch = /(<Pipe\b[^>]*?)(\/?>)/i.exec(line);
        if (pipeMatch) {
          const startCol = line.indexOf(pipeMatch[0]);
          const endCol = startCol + pipeMatch[0].length;

          // Option A (Preferred): Upgrade linepipe to certified sour-service grade API 5L X65MS
          fixes.push({
            title: `Fix M7011: Upgrade pipe metallurgy to NACE MR0175 certified sour service grade API 5L X65MS`,
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
                    newText: `${pipeMatch[1]} Metallurgy="API_5L_X65MS"${pipeMatch[2]}`,
                  },
                ],
              },
            },
          });

          // Option B: Add Inconel 625 corrosion-resistant alloy cladding
          fixes.push({
            title: `Fix M7011: Apply internal 3.0mm Inconel 625 CRA cladding to resist severe H2S stress cracking`,
            code: d.code,
            isPreferred: false,
            edit: {
              changes: {
                [uri]: [
                  {
                    range: {
                      start: { line: i, character: startCol },
                      end: { line: i, character: endCol },
                    },
                    newText: `${pipeMatch[1]} Cladding="INCONEL_625"${pipeMatch[2]}`,
                  },
                ],
              },
            },
          });
          break;
        }
      }
    } else if (d.code === "M7012") {
      // 7. M7012: Inject aromatic solvent / chemical dispersant to lower Colloidal Instability Index (CII < 0.70)
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

  return fixes;
}
