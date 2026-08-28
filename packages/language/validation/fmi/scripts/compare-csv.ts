// Maps ModelScript variables to Reference-FMU variables.
// In most cases we've renamed them in the .mo files to match precisely.
const VAR_MAPS: Record<string, Record<string, string>> = {
  BouncingBall: {
    h: "h",
    v: "v",
  },
  VanDerPol: {
    x: "x0",
    y: "x1",
  },
  Dahlquist: {
    x: "x",
  },
  Stair: {
    counter: "counter",
  },
  StateSpace: {
    "y[1]": "y[1]",
    "y[2]": "y[2]",
    "y[3]": "y[3]",
  },
};

export const getVarsMap = () => VAR_MAPS;

export function compareCSV(
  modelName: string,
  csv1Content: string,
  csv2Content: string,
): { abs: number; rel: number } | null {
  const lines1 = csv1Content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const lines2 = csv2Content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines1.length === 0 || lines2.length === 0) return null;

  const parseHeaderLine = (line: string) => {
    const result: string[] = [];
    let current = "";
    let inBracket = 0;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === "[") inBracket++;
      else if (char === "]") inBracket--;

      if (char === "," && inBracket === 0) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map((h) => h.replace(/["\r]/g, ""));
  };

  const headers1 = parseHeaderLine(lines1[0]);
  const headers2 = parseHeaderLine(lines2[0]);

  const map = VAR_MAPS[modelName] || {};

  let maxDeviation = 0;

  // Track stats per variable for NRMSE
  const varStats: Record<
    string,
    {
      sumSqErr: number;
      n: number;
      minRef: number;
      maxRef: number;
    }
  > = {};
  for (const key of Object.keys(map)) {
    varStats[key] = { sumSqErr: 0, n: 0, minRef: Infinity, maxRef: -Infinity };
  }

  const timeIdx1 = headers1.indexOf("time");
  const timeIdx2 = headers2.indexOf("time");

  if (timeIdx1 === -1 || timeIdx2 === -1) return null;

  const rowCount = Math.min(lines1.length, lines2.length);

  let i1 = 1;
  let i2 = 1;

  while (i1 < lines1.length && i2 < lines2.length) {
    const row1 = lines1[i1].split(",");
    const row2 = lines2[i2].split(",");

    const t1 = parseFloat(row1[timeIdx1] ?? "");
    const t2 = parseFloat(row2[timeIdx2] ?? "");

    if (isNaN(t1)) {
      i1++;
      continue;
    }
    if (isNaN(t2)) {
      i2++;
      continue;
    }

    // Align times (allowing small floating point differences)
    if (t1 < t2 - 1e-5) {
      i1++;
      continue;
    }
    if (t2 < t1 - 1e-5) {
      i2++;
      continue;
    }

    // Fast-forward i1 to the last row with the same time t1
    while (i1 + 1 < lines1.length) {
      const nextRow1 = lines1[i1 + 1].split(",");
      const nextT1 = parseFloat(nextRow1[timeIdx1] ?? "");
      if (Math.abs(nextT1 - t1) < 1e-9) {
        i1++;
      } else {
        break;
      }
    }

    // Fast-forward i2 to the last row with the same time t2
    while (i2 + 1 < lines2.length) {
      const nextRow2 = lines2[i2 + 1].split(",");
      const nextT2 = parseFloat(nextRow2[timeIdx2] ?? "");
      if (Math.abs(nextT2 - t2) < 1e-9) {
        i2++;
      } else {
        break;
      }
    }

    // Re-fetch rows since indices might have changed
    const finalRow1 = lines1[i1].split(",");
    const finalRow2 = lines2[i2].split(",");

    // Now t1 and t2 are approximately equal, and we are at the LAST event iteration
    for (const [mscVar, refVar] of Object.entries(map)) {
      let idx1 = headers1.indexOf(mscVar);
      let arrayIndex1 = -1;
      // Fallback for OpenModelica array variables (e.g., 'x[1]' -> 'x_1_')
      if (idx1 === -1 && mscVar.includes("[")) {
        const omcVar = mscVar.replace(/\[/g, "_").replace(/\]/g, "_");
        idx1 = headers1.indexOf(omcVar);
      }
      // Fallback for FMI 3.0 arrays in msc-FMU
      if (idx1 === -1 && mscVar.includes("[")) {
        const match = mscVar.match(/^([^\[]+)\[(\d+)\]$/);
        if (match) {
          const baseVar = match[1];
          arrayIndex1 = parseInt(match[2], 10) - 1;
          idx1 = headers1.indexOf(baseVar);
        }
      }

      let idx2 = headers2.indexOf(refVar);
      let arrayIndex2 = -1;

      // Fallback for FMI 3.0 arrays (e.g., 'y[1]' -> 'y' with index 1)
      if (idx2 === -1 && refVar.includes("[")) {
        const match = refVar.match(/^([^\[]+)\[(\d+)\]$/);
        if (match) {
          const baseVar = match[1];
          arrayIndex2 = parseInt(match[2], 10) - 1; // 1-indexed to 0-indexed
          idx2 = headers2.indexOf(baseVar);
        }
      }

      if (idx1 !== -1 && idx2 !== -1) {
        let val1Str = finalRow1[idx1] ?? "";
        if (arrayIndex1 !== -1 && val1Str.includes(" ")) {
          const parts = val1Str.trim().split(" ");
          val1Str = parts[arrayIndex1] ?? "";
        }
        const val1 = parseFloat(val1Str);

        let val2Str = finalRow2[idx2] ?? "";
        // If it's an FMI 3.0 array, extract the element
        if (arrayIndex2 !== -1 && val2Str.includes(" ")) {
          const parts = val2Str.trim().split(" ");
          val2Str = parts[arrayIndex2] ?? "";
        }
        const val2 = parseFloat(val2Str);

        if (!isNaN(val1) && !isNaN(val2)) {
          const diff = Math.abs(val1 - val2);
          if (diff > maxDeviation) {
            maxDeviation = diff;
          }

          const stats = varStats[mscVar];
          if (stats) {
            stats.sumSqErr += diff * diff;
            stats.n++;
            if (val2 < stats.minRef) stats.minRef = val2;
            if (val2 > stats.maxRef) stats.maxRef = val2;
          }
        }
      }
    }

    // Advance both to the next time step
    i1++;
    i2++;
  }

  let maxNrmse = 0;
  let comparedCount = 0;

  for (const stats of Object.values(varStats)) {
    if (stats.n > 0) {
      comparedCount += stats.n;
      const rmse = Math.sqrt(stats.sumSqErr / stats.n);
      const range = stats.maxRef - stats.minRef;

      // If range is extremely small (e.g. constant signal), normalize by 1.0 or max absolute value to avoid division by zero
      const normalization = range > 1e-10 ? range : Math.max(Math.abs(stats.maxRef), 1.0);
      const nrmse = rmse / normalization;

      if (nrmse > maxNrmse) {
        maxNrmse = nrmse;
      }
    }
  }

  return comparedCount > 0 ? { abs: maxDeviation, rel: maxNrmse } : null;
}
