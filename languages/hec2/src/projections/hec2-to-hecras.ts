// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Hec2Deck } from "../types.js";

export interface HecRasProjectionOutput {
  /** HEC-RAS geometry file (`.g01`) content */
  geometryG01: string;
  /** HEC-RAS steady flow file (`.f01`) content */
  steadyFlowF01: string;
}

export interface HecRasProjectionOptions {
  riverName?: string | undefined;
  reachName?: string | undefined;
  profileName?: string | undefined;
}

function pad8(val: number): string {
  const s = Number.isInteger(val) ? String(val) : val.toFixed(2);
  return s.length >= 8 ? s.slice(0, 8) : s.padStart(8, " ");
}

/**
 * Projects a parsed HEC-2 deck to modern USACE HEC-RAS `.g01` (geometry) and `.f01` (steady flow) text files.
 */
export function projectHec2ToHecRas(deck: Hec2Deck, options: HecRasProjectionOptions = {}): HecRasProjectionOutput {
  const river = options.riverName ?? "HEC2_River";
  const reach = options.reachName ?? "MainReach";
  const profileName = options.profileName ?? "PF 1";
  const title = deck.titles[0] || "Projected from HEC-2";

  // Build .g01 geometry file (HEC-RAS orders cross-sections upstream-to-downstream)
  const gLines: string[] = [];
  gLines.push(`Geom Title=${title}`);
  gLines.push(`Program Version=6.41`);
  gLines.push(`Viewing Rectangle= 0 , 1000 , 1000 , 0`);
  gLines.push("");
  gLines.push(`River Reach=${river.padEnd(16)},${reach.padEnd(16)}`);
  gLines.push(`Reach XY= 2`);
  gLines.push(`               0               0               0            1000`);
  gLines.push(`Rch Text X Y=0,0`);
  gLines.push("");

  // Reverse order so upstream cross-section appears first (HEC-RAS convention)
  const ordered = [...deck.crossSections].reverse();
  for (const xs of ordered) {
    gLines.push(`Type RM Length L Ch R = 1 ,${xs.secno} ,${xs.xlobl},${xs.xlch},${xs.xlobr}`);
    gLines.push(`#Sta/Elev= ${xs.grPoints.length}`);

    // Emit 5 station-elevation pairs per line (10 numbers, 8-char columns: Station first, Elevation second in HEC-RAS!)
    for (let i = 0; i < xs.grPoints.length; i += 5) {
      const chunk = xs.grPoints.slice(i, i + 5);
      let row = "";
      for (const pt of chunk) {
        row += pad8(pt.station) + pad8(pt.elevation);
      }
      gLines.push(row);
    }

    // Manning's n (LOB, Channel, ROB) at start, STCHL, STCHR
    const firstSta = xs.grPoints[0]?.station ?? 0;
    gLines.push(`#Mann= 3 , 0 , 0`);
    gLines.push(
      pad8(firstSta) +
        pad8(xs.manning.left) +
        pad8(0) +
        pad8(xs.stchl) +
        pad8(xs.manning.channel) +
        pad8(0) +
        pad8(xs.stchr) +
        pad8(xs.manning.right) +
        pad8(0),
    );
    gLines.push(`Bank Sta=${xs.stchl},${xs.stchr}`);
    gLines.push(`XS Rating Curve= 0 ,0`);
    gLines.push(`Exp/Cntr=${xs.contractionCoef},${xs.expansionCoef}`);
    gLines.push("");
  }

  // Build .f01 steady flow file
  const q = deck.jobCard?.q ?? deck.dischargeTable?.discharges[0] ?? 100.0;
  const upstreamSecno = ordered[0]?.secno ?? 0;
  const fLines: string[] = [];
  fLines.push(`Flow Title=${title}`);
  fLines.push(`Program Version=6.41`);
  fLines.push(`Number of Profiles= 1`);
  fLines.push(`Profile Names=${profileName}`);
  fLines.push(`River Rch & RM=${river},${reach},${upstreamSecno}`);
  fLines.push(pad8(q));
  fLines.push(`Boundary for River Rch & Prof#=${river},${reach}, 1`);
  fLines.push(`Up Type= 0`);
  if (deck.jobCard?.wsel !== undefined && deck.jobCard.wsel > 0) {
    fLines.push(`Dn Type= 1`);
    fLines.push(`Dn Known WS=${deck.jobCard.wsel}`);
  } else if (deck.jobCard?.strt !== undefined && deck.jobCard.strt < 0) {
    fLines.push(`Dn Type= 2`);
  } else {
    fLines.push(`Dn Type= 3`);
    fLines.push(`Dn Slope=${deck.jobCard?.strt ?? 0.001}`);
  }
  fLines.push("");

  return {
    geometryG01: gLines.join("\n"),
    steadyFlowF01: fLines.join("\n"),
  };
}
