// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — Zero-Regex Character-by-Character Parser & Serializer for USGS PHREEQC (.pqi, .dat).
 *
 * Parses TITLE, SOLUTION, EQUILIBRIUM_PHASES, REACTION, KINETICS, MIX, SOLUTION_MASTER_SPECIES,
 * PHASES, and END blocks with 1-indexed line, column, and character offset ranges.
 */

import type {
  PhreeqcDocument,
  PhreeqcEquilibriumPhase,
  PhreeqcKinetics,
  PhreeqcMasterSpecies,
  PhreeqcMix,
  PhreeqcPhaseDefinition,
  PhreeqcRange,
  PhreeqcReaction,
  PhreeqcSoluteSpec,
  PhreeqcSolution,
} from "../types.js";

export interface PhreeqcWordToken {
  text: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface PhreeqcLine {
  lineNumber: number;
  indent: number;
  words: PhreeqcWordToken[];
  rawText: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

const TOP_LEVEL_KEYWORDS = new Set<string>([
  "TITLE",
  "REMARKS",
  "SOLUTION",
  "EQUILIBRIUM_PHASES",
  "PURE_PHASES",
  "REACTION",
  "KINETICS",
  "MIX",
  "SOLUTION_MASTER_SPECIES",
  "SOLUTION_SPECIES",
  "PHASES",
  "EXCHANGE",
  "SURFACE",
  "GAS_PHASE",
  "SOLID_SOLUTIONS",
  "RATES",
  "SELECTED_OUTPUT",
  "USER_PUNCH",
  "INCREMENTAL_REACTIONS",
  "TRANSPORT",
  "ADVECTION",
  "USE",
  "SAVE",
  "COPY",
  "END",
]);

function isHorizontalWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\f";
}

function isDigitChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function parseNumberStrict(str: string): number | null {
  if (str.length === 0) return null;
  let i = 0;
  const n = str.length;
  if (str[i] === "+" || str[i] === "-") {
    i++;
  }
  let hasDigits = false;
  while (i < n && isDigitChar(str[i]!)) {
    hasDigits = true;
    i++;
  }
  if (i < n && str[i] === ".") {
    i++;
    while (i < n && isDigitChar(str[i]!)) {
      hasDigits = true;
      i++;
    }
  }
  if (!hasDigits) return null;
  if (i < n && (str[i] === "e" || str[i] === "E")) {
    i++;
    if (i < n && (str[i] === "+" || str[i] === "-")) {
      i++;
    }
    let expDigits = false;
    while (i < n && isDigitChar(str[i]!)) {
      expDigits = true;
      i++;
    }
    if (!expDigits) return null;
  }
  if (i !== n) return null;
  const val = Number(str);
  return Number.isNaN(val) ? null : val;
}

/**
 * Scans PHREEQC source text character-by-character into logical lines of whitespace-delimited tokens,
 * stripping `#` comments without using any regular expressions.
 */
export function scanPhreeqcLines(source: string): PhreeqcLine[] {
  const lines: PhreeqcLine[] = [];
  const len = source.length;
  let pos = 0;
  let lineNum = 1;

  while (pos < len) {
    const lineStartOffset = pos;
    const currentLineNum = lineNum;

    // Find end of physical line
    let lineEndOffset = pos;
    while (lineEndOffset < len && source[lineEndOffset] !== "\n" && source[lineEndOffset] !== "\r") {
      lineEndOffset++;
    }

    // Scan characters in [lineStartOffset, lineEndOffset)
    const words: PhreeqcWordToken[] = [];
    let indent = 0;
    let seenNonSpace = false;
    let i = lineStartOffset;

    while (i < lineEndOffset) {
      const ch = source[i]!;

      // Comment starts with '#'
      if (ch === "#") {
        break;
      }

      // Semicolon acts as statement terminator / line break in PHREEQC
      if (ch === ";") {
        if (words.length > 0) {
          const firstWord = words[0]!;
          const lastWord = words[words.length - 1]!;
          lines.push({
            lineNumber: currentLineNum,
            indent,
            words: [...words],
            rawText: source.slice(firstWord.startOffset, lastWord.endOffset),
            startLine: currentLineNum,
            startColumn: firstWord.startColumn,
            endLine: currentLineNum,
            endColumn: lastWord.endColumn,
            startOffset: firstWord.startOffset,
            endOffset: lastWord.endOffset,
          });
          words.length = 0;
        }
        i++;
        continue;
      }

      if (isHorizontalWhitespace(ch)) {
        if (!seenNonSpace) {
          indent += ch === "\t" ? 4 : 1;
        }
        i++;
        continue;
      }

      seenNonSpace = true;
      const wordStartOffset = i;
      const wordStartCol = i - lineStartOffset + 1;
      let wordText = "";

      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++; // skip opening quote
        while (i < lineEndOffset && source[i] !== quote) {
          wordText += source[i]!;
          i++;
        }
        if (i < lineEndOffset && source[i] === quote) {
          i++; // skip closing quote
        }
      } else {
        while (i < lineEndOffset && !isHorizontalWhitespace(source[i]!) && source[i] !== "#" && source[i] !== ";") {
          wordText += source[i]!;
          i++;
        }
      }

      const wordEndOffset = i;
      const wordEndCol = i - lineStartOffset + 1;

      words.push({
        text: wordText,
        startLine: currentLineNum,
        startColumn: wordStartCol,
        endLine: currentLineNum,
        endColumn: wordEndCol,
        startOffset: wordStartOffset,
        endOffset: wordEndOffset,
      });
    }

    if (words.length > 0) {
      const firstWord = words[0]!;
      const lastWord = words[words.length - 1]!;
      lines.push({
        lineNumber: currentLineNum,
        indent,
        words,
        rawText: source.slice(firstWord.startOffset, lastWord.endOffset),
        startLine: currentLineNum,
        startColumn: firstWord.startColumn,
        endLine: currentLineNum,
        endColumn: lastWord.endColumn,
        startOffset: firstWord.startOffset,
        endOffset: lastWord.endOffset,
      });
    }

    // Advance past newline
    pos = lineEndOffset;
    if (pos < len) {
      if (source[pos] === "\r") {
        pos++;
        if (pos < len && source[pos] === "\n") {
          pos++;
        }
      } else if (source[pos] === "\n") {
        pos++;
      }
      lineNum++;
    }
  }

  return lines;
}

function makeRangeFromLines(first: PhreeqcLine, last: PhreeqcLine): PhreeqcRange {
  return {
    startLine: first.startLine,
    startColumn: first.startColumn,
    endLine: last.endLine,
    endColumn: last.endColumn,
    startOffset: first.startOffset,
    endOffset: last.endOffset,
  };
}

function makeRangeFromLine(line: PhreeqcLine): PhreeqcRange {
  return {
    startLine: line.startLine,
    startColumn: line.startColumn,
    endLine: line.endLine,
    endColumn: line.endColumn,
    startOffset: line.startOffset,
    endOffset: line.endOffset,
  };
}

function isTopLevelKeyword(word: string): boolean {
  const upper = word.toUpperCase();
  return TOP_LEVEL_KEYWORDS.has(upper);
}

function parseHeaderNumberAndName(words: PhreeqcWordToken[]): { number: number; name?: string | undefined } {
  let num = 1;
  let nameStartIdx = 1;
  if (words.length >= 2) {
    const secondText = words[1]!.text;
    // Handle range like "1-5" by taking first integer, or plain integer
    let dashIdx = -1;
    for (let i = 1; i < secondText.length; i++) {
      if (secondText[i] === "-") {
        dashIdx = i;
        break;
      }
    }
    const numCandidate = dashIdx > 0 ? secondText.slice(0, dashIdx) : secondText;
    const parsed = parseNumberStrict(numCandidate);
    if (parsed !== null && Number.isInteger(parsed)) {
      num = parsed;
      nameStartIdx = 2;
    }
  }

  let name: string | undefined;
  if (words.length > nameStartIdx) {
    const parts: string[] = [];
    for (let i = nameStartIdx; i < words.length; i++) {
      parts.push(words[i]!.text);
    }
    name = parts.join(" ");
  }

  return { number: num, name };
}

export function parsePhreeqc(sourceText: string, sourceFile?: string): PhreeqcDocument {
  const lines = scanPhreeqcLines(sourceText);
  const doc: PhreeqcDocument = {
    solutions: new Map(),
    equilibriumPhases: [],
    reactions: new Map(),
    kinetics: [],
    mixes: new Map(),
    sourceFile,
  };

  if (lines.length > 0) {
    doc.range = makeRangeFromLines(lines[0]!, lines[lines.length - 1]!);
  }

  let idx = 0;
  const totalLines = lines.length;

  while (idx < totalLines) {
    const line = lines[idx]!;
    const firstWord = line.words[0]!.text.toUpperCase();

    if (firstWord === "END") {
      idx++;
      continue;
    }

    if (firstWord === "TITLE" || firstWord === "REMARKS") {
      const titleParts: string[] = [];
      if (line.words.length > 1) {
        const inlineParts: string[] = [];
        for (let w = 1; w < line.words.length; w++) {
          inlineParts.push(line.words[w]!.text);
        }
        titleParts.push(inlineParts.join(" "));
      }
      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        titleParts.push(lines[idx]!.rawText);
        idx++;
      }
      doc.title = titleParts.join(" ").trim();
      continue;
    }

    if (firstWord === "SOLUTION") {
      const startLineObj = line;
      let endLineObj = line;
      const { number, name } = parseHeaderNumberAndName(line.words);

      const solution: PhreeqcSolution = {
        number,
        name,
        temp: 25.0,
        pH: 7.0,
        pe: 4.0,
        units: "mmol/kgw",
        waterMass: 1.0,
        solutes: new Map(),
        soluteSpecs: new Map(),
      };

      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        endLineObj = subLine;
        const w0 = subLine.words[0]!.text;
        const w0Lower = w0.toLowerCase();

        if (w0Lower === "temp" || w0Lower === "temperature" || w0Lower === "-temp" || w0Lower === "-temperature") {
          if (subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              solution.temp = val;
            }
          }
        } else if (w0Lower === "ph" || w0Lower === "-ph") {
          if (subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              solution.pH = val;
            }
            for (let k = 2; k < subLine.words.length; k++) {
              const mod = subLine.words[k]!.text.toLowerCase();
              if (mod === "charge") {
                solution.pHChargeBalance = true;
                solution.chargeBalanceElement = "pH";
              }
            }
          }
        } else if (w0Lower === "pe" || w0Lower === "-pe") {
          if (subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              solution.pe = val;
            }
          }
        } else if (w0Lower === "units" || w0Lower === "-units") {
          if (subLine.words.length >= 2) {
            solution.units = subLine.words[1]!.text;
          }
        } else if (w0Lower === "density" || w0Lower === "-density") {
          if (subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              solution.density = val;
            }
          }
        } else if (w0Lower === "-water" || w0Lower === "water") {
          if (subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              solution.waterMass = val;
            }
          }
        } else if (w0Lower === "redox" || w0Lower === "-redox") {
          // redox couple specification, ignore or continue
        } else if (subLine.words.length >= 2) {
          // Solute specification: <element> <concentration> [options...]
          const elemName = w0;
          const concVal = parseNumberStrict(subLine.words[1]!.text);
          if (concVal !== null) {
            const spec: PhreeqcSoluteSpec = {
              element: elemName,
              value: concVal,
              range: makeRangeFromLine(subLine),
            };
            let k = 2;
            while (k < subLine.words.length) {
              const opt = subLine.words[k]!.text;
              const optLower = opt.toLowerCase();
              if (optLower === "charge") {
                spec.chargeBalance = true;
                solution.chargeBalanceElement = elemName;
                k++;
              } else if (optLower === "as" && k + 1 < subLine.words.length) {
                spec.asSpecies = subLine.words[k + 1]!.text;
                k += 2;
              } else if (optLower === "gfw" && k + 1 < subLine.words.length) {
                const gfwVal = parseNumberStrict(subLine.words[k + 1]!.text);
                if (gfwVal !== null) spec.gfw = gfwVal;
                k += 2;
              } else if (
                optLower.includes("mol/") ||
                optLower.includes("mg/") ||
                optLower.includes("ug/") ||
                optLower.includes("g/") ||
                optLower === "ppm" ||
                optLower === "ppb" ||
                optLower === "meq/l"
              ) {
                spec.units = opt;
                k++;
              } else {
                // Equilibrium mineral phase name and optional target SI
                spec.equilibriumPhase = opt;
                if (k + 1 < subLine.words.length) {
                  const siVal = parseNumberStrict(subLine.words[k + 1]!.text);
                  if (siVal !== null) {
                    spec.equilibriumSI = siVal;
                    k += 2;
                    continue;
                  }
                }
                k++;
              }
            }
            solution.solutes.set(elemName, concVal);
            solution.soluteSpecs?.set(elemName, spec);
          }
        }
        idx++;
      }

      solution.range = makeRangeFromLines(startLineObj, endLineObj);
      doc.solutions.set(solution.number, solution);
      continue;
    }

    if (firstWord === "EQUILIBRIUM_PHASES" || firstWord === "PURE_PHASES") {
      const { number: blockNumber } = parseHeaderNumberAndName(line.words);
      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        const mineralName = subLine.words[0]!.text;
        let targetSI = 0.0;
        let initialMoles = 10.0;
        let dissolveOnly: boolean | undefined;
        let precipitateOnly: boolean | undefined;
        let alternativeFormula: string | undefined;

        if (subLine.words.length >= 2) {
          const siVal = parseNumberStrict(subLine.words[1]!.text);
          if (siVal !== null) {
            targetSI = siVal;
          }
        }
        if (subLine.words.length >= 3) {
          const thirdWord = subLine.words[2]!.text;
          const molesVal = parseNumberStrict(thirdWord);
          if (molesVal !== null) {
            initialMoles = molesVal;
          } else {
            alternativeFormula = thirdWord;
            if (subLine.words.length >= 4) {
              const fourthVal = parseNumberStrict(subLine.words[3]!.text);
              if (fourthVal !== null) {
                initialMoles = fourthVal;
              }
            }
          }
        }
        for (let k = 2; k < subLine.words.length; k++) {
          const tokLower = subLine.words[k]!.text.toLowerCase();
          if (tokLower === "dissolve_only" || tokLower === "dissolve") {
            dissolveOnly = true;
          } else if (tokLower === "precipitate_only" || tokLower === "precipitate") {
            precipitateOnly = true;
          }
        }

        const phaseEntry: PhreeqcEquilibriumPhase = {
          name: mineralName,
          targetSI,
          initialMoles,
          blockNumber,
          dissolveOnly,
          precipitateOnly,
          alternativeFormula,
          range: makeRangeFromLine(subLine),
        };
        doc.equilibriumPhases.push(phaseEntry);
        idx++;
      }
      continue;
    }

    if (firstWord === "REACTION") {
      const startLineObj = line;
      let endLineObj = line;
      const { number, name } = parseHeaderNumberAndName(line.words);
      const reaction: PhreeqcReaction = {
        number,
        name,
        reactants: new Map(),
        totalMoles: 0.0,
        steps: [],
        stepCount: 1,
      };

      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        endLineObj = subLine;
        const w0 = subLine.words[0]!.text;
        const w0Lower = w0.toLowerCase();
        const leadingNum = parseNumberStrict(w0);

        if (leadingNum !== null || w0Lower === "-steps" || w0Lower === "steps") {
          const startIdx = leadingNum !== null ? 0 : 1;
          // Check if line contains "in <N> steps"
          let inIndex = -1;
          for (let k = startIdx; k < subLine.words.length; k++) {
            if (subLine.words[k]!.text.toLowerCase() === "in") {
              inIndex = k;
              break;
            }
          }
          if (inIndex > startIdx && inIndex + 1 < subLine.words.length) {
            const amountVal = parseNumberStrict(subLine.words[startIdx]!.text) ?? 0.0;
            const countVal = parseNumberStrict(subLine.words[inIndex + 1]!.text) ?? 1;
            const stepCount = Math.max(1, Math.round(countVal));
            reaction.totalMoles = amountVal;
            reaction.stepCount = stepCount;
            if (inIndex > startIdx + 1) {
              reaction.units = subLine.words[startIdx + 1]!.text;
            }
            const stepInc = amountVal / stepCount;
            reaction.steps = [];
            for (let s = 0; s < stepCount; s++) {
              reaction.steps.push(stepInc);
            }
          } else {
            // Explicit list of step amounts
            for (let k = startIdx; k < subLine.words.length; k++) {
              const v = parseNumberStrict(subLine.words[k]!.text);
              if (v !== null) {
                reaction.steps.push(v);
              } else {
                reaction.units = subLine.words[k]!.text;
              }
            }
            if (reaction.steps.length > 0) {
              reaction.stepCount = reaction.steps.length;
              let sum = 0;
              for (const s of reaction.steps) sum += s;
              reaction.totalMoles = sum;
            }
          }
        } else {
          // Reactant species/formula and stoichiometric coefficient
          let stoich = 1.0;
          if (subLine.words.length >= 2) {
            const parsedStoich = parseNumberStrict(subLine.words[1]!.text);
            if (parsedStoich !== null) {
              stoich = parsedStoich;
            }
          }
          reaction.reactants.set(w0, stoich);
        }
        idx++;
      }

      reaction.range = makeRangeFromLines(startLineObj, endLineObj);
      doc.reactions.set(reaction.number, reaction);
      continue;
    }

    if (firstWord === "KINETICS") {
      const { number: blockNumber } = parseHeaderNumberAndName(line.words);
      let currentKin: PhreeqcKinetics | null = null;
      const blockKinetics: PhreeqcKinetics[] = [];

      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        const w0 = subLine.words[0]!.text;
        const w0Lower = w0.toLowerCase();

        if (w0.startsWith("-")) {
          if (w0Lower === "-m0" && currentKin && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              currentKin.m0 = val;
              currentKin.m = val;
            }
          } else if (w0Lower === "-m" && currentKin && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) {
              currentKin.m = val;
            }
          } else if ((w0Lower === "-parms" || w0Lower === "-params") && currentKin) {
            currentKin.parms = [];
            for (let k = 1; k < subLine.words.length; k++) {
              const v = parseNumberStrict(subLine.words[k]!.text);
              if (v !== null) currentKin.parms.push(v);
            }
            if (currentKin.parms.length >= 1) {
              currentKin.rateConstant = currentKin.parms[0]!;
            }
            if (currentKin.parms.length >= 2) {
              currentKin.surfaceArea = currentKin.parms[1]!;
            }
          } else if (w0Lower === "-k" && currentKin && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) currentKin.rateConstant = val;
          } else if (w0Lower === "-area" && currentKin && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) currentKin.surfaceArea = val;
          } else if (w0Lower === "-tol" && currentKin && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) currentKin.tol = val;
          } else if (w0Lower === "-formula" && currentKin && subLine.words.length >= 2) {
            const fParts: string[] = [];
            for (let k = 1; k < subLine.words.length; k++) {
              fParts.push(subLine.words[k]!.text);
            }
            currentKin.formula = fParts.join(" ");
          } else if (w0Lower === "-steps") {
            const steps: number[] = [];
            let stepCount = 1;
            let inIndex = -1;
            for (let k = 1; k < subLine.words.length; k++) {
              if (subLine.words[k]!.text.toLowerCase() === "in") {
                inIndex = k;
                break;
              }
            }
            if (inIndex > 1 && inIndex + 1 < subLine.words.length) {
              const totalTime = parseNumberStrict(subLine.words[1]!.text) ?? 3600;
              const nSteps = Math.max(1, Math.round(parseNumberStrict(subLine.words[inIndex + 1]!.text) ?? 1));
              stepCount = nSteps;
              const dt = totalTime / nSteps;
              for (let s = 0; s < nSteps; s++) steps.push(dt);
            } else {
              for (let k = 1; k < subLine.words.length; k++) {
                const v = parseNumberStrict(subLine.words[k]!.text);
                if (v !== null) steps.push(v);
              }
              stepCount = Math.max(1, steps.length);
            }
            for (const kin of blockKinetics) {
              kin.steps = steps;
              kin.stepCount = stepCount;
            }
          }
        } else {
          // New kinetic reaction block entry (e.g., "Calcite")
          currentKin = {
            name: w0,
            blockNumber,
            m0: 1.0,
            m: 1.0,
            parms: [1.0e-6, 1.0],
            rateConstant: 1.0e-6,
            surfaceArea: 1.0,
            steps: [3600],
            stepCount: 1,
            range: makeRangeFromLine(subLine),
          };
          // Handle inline parameters if provided on the same line
          let k = 1;
          while (k < subLine.words.length) {
            const tok = subLine.words[k]!.text.toLowerCase();
            if (tok === "-m0" && k + 1 < subLine.words.length) {
              const v = parseNumberStrict(subLine.words[k + 1]!.text);
              if (v !== null) {
                currentKin.m0 = v;
                currentKin.m = v;
              }
              k += 2;
            } else if (tok === "-m" && k + 1 < subLine.words.length) {
              const v = parseNumberStrict(subLine.words[k + 1]!.text);
              if (v !== null) currentKin.m = v;
              k += 2;
            } else if ((tok === "-parms" || tok === "-params") && k + 1 < subLine.words.length) {
              currentKin.parms = [];
              k++;
              while (k < subLine.words.length && !subLine.words[k]!.text.startsWith("-")) {
                const v = parseNumberStrict(subLine.words[k]!.text);
                if (v !== null) currentKin.parms.push(v);
                k++;
              }
              if (currentKin.parms.length >= 1) currentKin.rateConstant = currentKin.parms[0]!;
              if (currentKin.parms.length >= 2) currentKin.surfaceArea = currentKin.parms[1]!;
            } else {
              k++;
            }
          }
          blockKinetics.push(currentKin);
          doc.kinetics.push(currentKin);
        }
        idx++;
      }
      continue;
    }

    if (firstWord === "MIX") {
      const startLineObj = line;
      let endLineObj = line;
      const { number, name } = parseHeaderNumberAndName(line.words);
      const mix: PhreeqcMix = {
        number,
        name,
        fractions: new Map(),
      };

      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        endLineObj = subLine;
        if (subLine.words.length >= 2) {
          const solNum = parseNumberStrict(subLine.words[0]!.text);
          const fracVal = parseNumberStrict(subLine.words[1]!.text);
          if (solNum !== null && fracVal !== null) {
            mix.fractions.set(Math.round(solNum), fracVal);
          }
        }
        idx++;
      }

      mix.range = makeRangeFromLines(startLineObj, endLineObj);
      doc.mixes.set(mix.number, mix);
      continue;
    }

    if (firstWord === "SOLUTION_MASTER_SPECIES") {
      doc.masterSpecies = doc.masterSpecies ?? new Map<string, PhreeqcMasterSpecies>();
      idx++;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        if (subLine.words.length >= 4) {
          const element = subLine.words[0]!.text;
          const masterSpecies = subLine.words[1]!.text;
          const alkalinity = parseNumberStrict(subLine.words[2]!.text) ?? 0.0;
          const gfwFormula = subLine.words[3]!.text;
          const elementGfw =
            subLine.words.length >= 5 ? (parseNumberStrict(subLine.words[4]!.text) ?? undefined) : undefined;
          doc.masterSpecies.set(element, {
            element,
            masterSpecies,
            alkalinity,
            gfwFormula,
            elementGfw,
            range: makeRangeFromLine(subLine),
          });
        }
        idx++;
      }
      continue;
    }

    if (firstWord === "PHASES") {
      doc.phases = doc.phases ?? new Map<string, PhreeqcPhaseDefinition>();
      idx++;
      let currentPhase: PhreeqcPhaseDefinition | null = null;
      while (idx < totalLines && !isTopLevelKeyword(lines[idx]!.words[0]!.text)) {
        const subLine = lines[idx]!;
        const w0 = subLine.words[0]!.text;
        const w0Lower = w0.toLowerCase();
        if (w0Lower === "-log_k" || w0Lower === "log_k") {
          if (currentPhase && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) currentPhase.logK = val;
          }
        } else if (w0Lower === "-delta_h" || w0Lower === "delta_h") {
          if (currentPhase && subLine.words.length >= 2) {
            const val = parseNumberStrict(subLine.words[1]!.text);
            if (val !== null) currentPhase.deltaH = val;
          }
        } else if (!w0.startsWith("-") && !subLine.rawText.includes("=")) {
          currentPhase = {
            name: w0,
            reaction: "",
            logK: 0.0,
            range: makeRangeFromLine(subLine),
          };
          doc.phases.set(w0, currentPhase);
        } else if (currentPhase && subLine.rawText.includes("=")) {
          currentPhase.reaction = subLine.rawText;
        }
        idx++;
      }
      continue;
    }

    // Any other block or line: advance
    idx++;
  }

  return doc;
}

/**
 * Serializes a `PhreeqcDocument` AST back into canonical USGS PHREEQC `.pqi` input deck format.
 */
export function serializePhreeqc(doc: PhreeqcDocument): string {
  const lines: string[] = [];

  if (doc.title) {
    lines.push(`TITLE ${doc.title}`);
    lines.push("");
  }

  for (const [, sol] of doc.solutions) {
    const header = sol.name ? `SOLUTION ${sol.number} ${sol.name}` : `SOLUTION ${sol.number}`;
    lines.push(header);
    lines.push(`    temp      ${sol.temp}`);
    lines.push(`    pH        ${sol.pH}${sol.pHChargeBalance ? " charge" : ""}`);
    lines.push(`    pe        ${sol.pe}`);
    lines.push(`    units     ${sol.units}`);
    if (sol.density !== undefined) {
      lines.push(`    density   ${sol.density}`);
    }
    if (sol.waterMass !== 1.0) {
      lines.push(`    -water    ${sol.waterMass}`);
    }
    for (const [elem, conc] of sol.solutes) {
      const spec = sol.soluteSpecs?.get(elem);
      let suffix = "";
      if (spec?.units) suffix += ` ${spec.units}`;
      if (spec?.asSpecies) suffix += ` as ${spec.asSpecies}`;
      if (spec?.chargeBalance) suffix += " charge";
      if (spec?.equilibriumPhase) {
        suffix += ` ${spec.equilibriumPhase}`;
        if (spec.equilibriumSI !== undefined) suffix += ` ${spec.equilibriumSI}`;
      }
      lines.push(`    ${elem.padEnd(10, " ")}${conc}${suffix}`);
    }
    lines.push("");
  }

  if (doc.equilibriumPhases.length > 0) {
    // Group by blockNumber
    const byBlock = new Map<number, PhreeqcEquilibriumPhase[]>();
    for (const ep of doc.equilibriumPhases) {
      const list = byBlock.get(ep.blockNumber) ?? [];
      list.push(ep);
      byBlock.set(ep.blockNumber, list);
    }
    for (const [blockNum, phases] of byBlock) {
      lines.push(`EQUILIBRIUM_PHASES ${blockNum}`);
      for (const ep of phases) {
        let extra = "";
        if (ep.dissolveOnly) extra = " dissolve_only";
        else if (ep.precipitateOnly) extra = " precipitate_only";
        lines.push(`    ${ep.name.padEnd(12, " ")}${ep.targetSI} ${ep.initialMoles}${extra}`);
      }
      lines.push("");
    }
  }

  for (const [, rxn] of doc.reactions) {
    const header = rxn.name ? `REACTION ${rxn.number} ${rxn.name}` : `REACTION ${rxn.number}`;
    lines.push(header);
    for (const [reactant, stoich] of rxn.reactants) {
      lines.push(`    ${reactant.padEnd(10, " ")}${stoich}`);
    }
    if (rxn.totalMoles > 0) {
      lines.push(`    ${rxn.totalMoles} moles in ${rxn.stepCount} steps`);
    }
    lines.push("");
  }

  if (doc.kinetics.length > 0) {
    const byBlock = new Map<number, PhreeqcKinetics[]>();
    for (const kin of doc.kinetics) {
      const list = byBlock.get(kin.blockNumber) ?? [];
      list.push(kin);
      byBlock.set(kin.blockNumber, list);
    }
    for (const [blockNum, kins] of byBlock) {
      lines.push(`KINETICS ${blockNum}`);
      for (const kin of kins) {
        lines.push(`    ${kin.name}`);
        lines.push(`        -m0     ${kin.m0}`);
        lines.push(`        -m      ${kin.m}`);
        if (kin.parms.length > 0) {
          lines.push(`        -parms  ${kin.parms.join(" ")}`);
        }
      }
      const firstKin = kins[0];
      if (firstKin && firstKin.steps.length > 0) {
        let totalTime = 0;
        for (const dt of firstKin.steps) totalTime += dt;
        lines.push(`    -steps ${totalTime} in ${firstKin.stepCount} steps`);
      }
      lines.push("");
    }
  }

  for (const [, mix] of doc.mixes) {
    const header = mix.name ? `MIX ${mix.number} ${mix.name}` : `MIX ${mix.number}`;
    lines.push(header);
    for (const [solNum, frac] of mix.fractions) {
      lines.push(`    ${solNum} ${frac}`);
    }
    lines.push("");
  }

  lines.push("END");
  return lines.join("\n");
}
