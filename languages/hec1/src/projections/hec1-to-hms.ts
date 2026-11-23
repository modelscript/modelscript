// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a USACE HEC-1 card deck into modern USACE HEC-HMS `.basin` and `.met` files.
 */

import type { Hec1Deck } from "../types.js";

export interface Hec1ToHmsResult {
  basinName: string;
  metName: string;
  basinText: string;
  metText: string;
}

/**
 * Converts a parsed `Hec1Deck` into HEC-HMS `.basin` and `.met` text artifacts.
 */
export function hec1ToHms(deck: Hec1Deck): Hec1ToHmsResult {
  const rawTitle = deck.titleLines[0] ?? "HEC1_Watershed";
  const basinName = rawTitle.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "") || "HEC1_Watershed";
  const metName = `${basinName}_Met`;

  // Infer downstream links by simulating the HEC-1 hydrograph stack
  const downstreamOf = new Map<string, string>();
  const stack: string[] = [];

  for (const st of deck.stationList) {
    if (st.kind === "subbasin") {
      stack.push(st.id);
    } else if (st.kind === "route") {
      const up = stack.pop();
      if (up) downstreamOf.set(up, st.id);
      stack.push(st.id);
    } else if (st.kind === "combine") {
      const count = Math.max(2, st.combineCount ?? 2);
      for (let k = 0; k < count && stack.length > 0; k++) {
        const up = stack.pop()!;
        downstreamOf.set(up, st.id);
      }
      stack.push(st.id);
    }
  }

  const basinLines: string[] = [
    `Basin: ${basinName}`,
    `     Description: Projected from USACE HEC-1 card deck`,
    `     Unit System: ${deck.unitSystem}`,
    `End:`,
    ``,
  ];

  const metLines: string[] = [
    `Meteorology: ${metName}`,
    `     Description: Projected from USACE HEC-1 card deck`,
    `     Unit System: ${deck.unitSystem}`,
    `     Precipitation Method: Specified Hyetograph`,
    `End:`,
    ``,
  ];

  for (const st of deck.stationList) {
    const ds = downstreamOf.get(st.id);
    if (st.kind === "subbasin") {
      basinLines.push(`Subbasin: ${st.id}`);
      if (st.description) basinLines.push(`     Description: ${st.description}`);
      basinLines.push(`     Area: ${st.area ?? 1.0}`);
      if (ds) basinLines.push(`     Downstream: ${ds}`);

      if (st.loss?.method === "SCS") {
        basinLines.push(`     LossRate: SCS`);
        basinLines.push(`     Curve Number: ${st.loss.curveNumber}`);
        if (st.loss.strtl !== undefined) {
          basinLines.push(`     Initial Abstraction: ${st.loss.strtl}`);
        }
        basinLines.push(`     Percent Impervious Area: ${st.loss.rtimp}`);
      } else if (st.loss?.method === "Uniform") {
        basinLines.push(`     LossRate: Initial and Constant`);
        basinLines.push(`     Initial Loss: ${st.loss.strtl}`);
        basinLines.push(`     Constant Loss Rate: ${st.loss.cnstl}`);
        basinLines.push(`     Percent Impervious Area: ${st.loss.rtimp}`);
      }

      if (st.unitHydrograph?.method === "Clark") {
        basinLines.push(`     Transform: Clark`);
        basinLines.push(`     Time of Concentration: ${st.unitHydrograph.tc}`);
        basinLines.push(`     Storage Coefficient: ${st.unitHydrograph.r}`);
      } else if (st.unitHydrograph?.method === "SCS") {
        basinLines.push(`     Transform: SCS`);
        basinLines.push(`     Lag: ${(st.unitHydrograph.tlag * 60.0).toFixed(2)}`);
      } else if (st.unitHydrograph?.method === "Snyder") {
        basinLines.push(`     Transform: Snyder`);
        basinLines.push(`     Snyder Lag: ${st.unitHydrograph.tp}`);
        basinLines.push(`     Snyder Peaking Coefficient: ${st.unitHydrograph.cp}`);
      }

      if (st.baseflow) {
        basinLines.push(`     Baseflow: Recession`);
        basinLines.push(`     Initial Discharge: ${st.baseflow.strtq}`);
        basinLines.push(`     Recession Constant: ${st.baseflow.rtior}`);
      }

      basinLines.push(`End:`);
      basinLines.push(``);

      // Meteorology entry for this subbasin
      metLines.push(`Subbasin: ${st.id}`);
      if (st.precipitationTotal !== undefined) {
        metLines.push(`     Total Storm Depth: ${st.precipitationTotal}`);
      }
      if (st.precipitationIncrements && st.precipitationIncrements.length > 0) {
        metLines.push(`     Gage: ${st.id}_PI`);
        metLines.push(`     Incremental Depth: ${st.precipitationIncrements.join(" ")}`);
      } else if (st.precipitationCumulative && st.precipitationCumulative.length > 0) {
        metLines.push(`     Gage: ${st.id}_PC`);
        metLines.push(`     Cumulative Depth: ${st.precipitationCumulative.join(" ")}`);
      }
      metLines.push(`End:`);
      metLines.push(``);
    } else if (st.kind === "route") {
      basinLines.push(`Reach: ${st.id}`);
      if (st.description) basinLines.push(`     Description: ${st.description}`);
      if (ds) basinLines.push(`     Downstream: ${ds}`);
      if (st.muskingum) {
        basinLines.push(`     Route: Muskingum`);
        basinLines.push(`     Muskingum K: ${st.muskingum.amskk}`);
        basinLines.push(`     Muskingum x: ${st.muskingum.x}`);
        basinLines.push(`     Muskingum Steps: ${st.muskingum.nstps}`);
      } else if (st.storageRouting) {
        basinLines.push(`     Route: Modified Puls`);
        basinLines.push(`     Number of Reaches: ${st.storageRouting.nstps}`);
      }
      basinLines.push(`End:`);
      basinLines.push(``);
    } else if (st.kind === "combine") {
      basinLines.push(`Junction: ${st.id}`);
      if (st.description) basinLines.push(`     Description: ${st.description}`);
      if (ds) basinLines.push(`     Downstream: ${ds}`);
      basinLines.push(`End:`);
      basinLines.push(``);
    }
  }

  return {
    basinName,
    metName,
    basinText: basinLines.join("\n"),
    metText: metLines.join("\n"),
  };
}
