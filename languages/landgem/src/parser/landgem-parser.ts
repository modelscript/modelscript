// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  LandgemModel,
  LandfillSite,
  DigesterParameters,
  WasteCohort,
  LandgemParameters,
} from "../types.js";

/**
 * Parses LandGEM and anaerobic digestion (biogas) model declarations.
 */
export function parseLandgem(content: string): LandgemModel {
  const lines = content.split(/\r?\n/);

  const sites: LandfillSite[] = [];
  const digesters: DigesterParameters[] = [];

  let currentSite: LandfillSite | null = null;
  let currentDigester: DigesterParameters | null = null;
  let inWasteBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.replace(/(#|!|\/\/).*$/, "").trim();
    if (!line) continue;

    const tokens = line.split(/\s+/);
    const key = tokens[0]!.toUpperCase();

    if (key === "SITE") {
      inWasteBlock = false;
      const rawName = tokens.slice(1).join(" ").replace(/["']/g, "").trim();
      const siteName = rawName || `LandfillSite_${sites.length + 1}`;
      const defaultParams: LandgemParameters = {
        l0: 100.0,
        k: 0.04,
        nmocPpmv: 600.0,
        methaneContentPercent: 50.0,
      };
      currentSite = {
        name: siteName,
        openYear: 2000,
        closeYear: 2030,
        params: defaultParams,
        cohorts: [],
        line: i + 1,
      };
      sites.push(currentSite);
      currentDigester = null;
      continue;
    }

    if (key === "DIGESTER") {
      inWasteBlock = false;
      const rawName = tokens.slice(1).join(" ").replace(/["']/g, "").trim();
      const digesterName = rawName || `Digester_${digesters.length + 1}`;
      currentDigester = {
        name: digesterName,
        volumeM3: 3000.0,
        temperatureC: 37.0,
        hrtDays: 20.0,
        feedCodGL: 40.0,
        ph: 7.2,
        line: i + 1,
      };
      digesters.push(currentDigester);
      currentSite = null;
      continue;
    }

    if (key === "WASTE_ACCEPTANCE" || key === "WASTE" || key === "INVENTORY") {
      inWasteBlock = true;
      continue;
    }

    // Inside waste acceptance block or standalone waste line
    if (inWasteBlock || key === "YEAR" || /^\d{4}$/.test(tokens[0]!)) {
      let yr: number;
      let mass: number;
      if (key === "YEAR") {
        yr = parseInt(tokens[1] ?? "0", 10);
        mass = parseFloat(tokens[2] ?? "0");
      } else {
        yr = parseInt(tokens[0]!, 10);
        mass = parseFloat(tokens[1] ?? "0");
      }

      if (!isNaN(yr) && !isNaN(mass)) {
        const cohort: WasteCohort = {
          year: yr,
          massMg: mass,
          line: i + 1,
        };
        if (currentSite) {
          currentSite.cohorts.push(cohort);
        } else {
          // If no site declared yet, create default site
          if (sites.length === 0) {
            currentSite = {
              name: "DefaultLandfill",
              openYear: yr,
              closeYear: yr + 20,
              params: { l0: 100.0, k: 0.04, nmocPpmv: 600.0, methaneContentPercent: 50.0 },
              cohorts: [],
              line: 1,
            };
            sites.push(currentSite);
          }
          sites[sites.length - 1]!.cohorts.push(cohort);
        }
      }
      continue;
    }

    // Site parameters
    if (currentSite) {
      if (key === "OPEN" && tokens[1]) {
        currentSite.openYear = parseInt(tokens[1], 10);
      } else if (key === "CLOSE" && tokens[1]) {
        currentSite.closeYear = parseInt(tokens[1], 10);
      } else if (key === "L0" && tokens[1]) {
        currentSite.params.l0 = parseFloat(tokens[1]);
      } else if (key === "K" && tokens[1]) {
        currentSite.params.k = parseFloat(tokens[1]);
      } else if (key === "NMOC" && tokens[1]) {
        currentSite.params.nmocPpmv = parseFloat(tokens[1]);
      } else if ((key === "METHANE_PERCENT" || key === "METHANE") && tokens[1]) {
        currentSite.params.methaneContentPercent = parseFloat(tokens[1]);
      }
    }

    // Digester parameters
    if (currentDigester) {
      if (key === "VOLUME" && tokens[1]) {
        currentDigester.volumeM3 = parseFloat(tokens[1]);
      } else if ((key === "TEMPERATURE" || key === "TEMP") && tokens[1]) {
        currentDigester.temperatureC = parseFloat(tokens[1]);
      } else if (key === "HRT" && tokens[1]) {
        currentDigester.hrtDays = parseFloat(tokens[1]);
      } else if ((key === "FEED_COD" || key === "COD") && tokens[1]) {
        currentDigester.feedCodGL = parseFloat(tokens[1]);
      } else if (key === "PH" && tokens[1]) {
        currentDigester.ph = parseFloat(tokens[1]);
      } else if (key === "REMOVAL_EFFICIENCY" && tokens[1]) {
        currentDigester.codRemovalEfficiency = parseFloat(tokens[1]);
      }
    }
  }

  return {
    sites,
    digesters,
  };
}
