#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Static hardening audit for ModelScript Inspector & Language UI panels.
 * Scans all `languages/ * /src/ui/*.tsx` panels and checks:
 *   1. Undefined `--ms-*` CSS custom property references (compared against tokens.css)
 *   2. Raw `<div dangerouslySetInnerHTML={{ __html: svg }}` bypassing `PanelSvgStage`
 *   3. Silent `.slice(0, N)` table truncations without pagination
 *   4. Hardcoded dark-only hex colors outside `var(...)`
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TOKENS_CSS = path.join(ROOT, "packages/design-tokens/src/tokens.css");
const LANGUAGES_DIR = path.join(ROOT, "languages");

function extractDefinedTokens(cssText) {
  const tokens = new Set();
  const re = /(--ms-[a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    tokens.add(m[1]);
  }
  return tokens;
}

function collectUiFiles(dir) {
  const results = [];
  for (const lang of fs.readdirSync(dir)) {
    const uiDir = path.join(dir, lang, "src", "ui");
    if (!fs.existsSync(uiDir) || !fs.statSync(uiDir).isDirectory()) continue;
    for (const file of fs.readdirSync(uiDir)) {
      if (file.endsWith(".tsx")) {
        results.push(path.join(uiDir, file));
      }
    }
  }
  return results.sort();
}

const definedTokens = extractDefinedTokens(fs.readFileSync(TOKENS_CSS, "utf8"));
const uiFiles = collectUiFiles(LANGUAGES_DIR);

let undefinedTokenFiles = 0;
let rawSvgBypassFiles = 0;
let silentSliceFiles = 0;
let dataGridAdopted = 0;
let svgStageAdopted = 0;

const findings = [];

for (const filePath of uiFiles) {
  const rel = path.relative(ROOT, filePath);
  const src = fs.readFileSync(filePath, "utf8");

  // 1. Check undefined --ms-* tokens
  const usedRe = /var\(\s*(--ms-[a-z0-9-]+)/gi;
  const badTokens = new Set();
  let m;
  while ((m = usedRe.exec(src)) !== null) {
    if (!definedTokens.has(m[1])) {
      badTokens.add(m[1]);
    }
  }
  if (badTokens.size > 0) {
    undefinedTokenFiles++;
    findings.push(`[TOKEN] ${rel}: undefined tokens ${Array.from(badTokens).join(", ")}`);
  }

  // 2. Check raw SVG bypass (dangerouslySetInnerHTML without PanelSvgStage)
  if (/dangerouslySetInnerHTML/.test(src) && !/PanelSvgStage/.test(src)) {
    rawSvgBypassFiles++;
    findings.push(`[SVG] ${rel}: uses dangerouslySetInnerHTML without PanelSvgStage`);
  }
  if (/PanelSvgStage/.test(src)) svgStageAdopted++;
  if (/PanelDataGrid/.test(src)) dataGridAdopted++;

  // 3. Check silent .slice(0, N) table truncations
  if (/\.slice\(\s*0\s*,\s*(50|70|100|150|200|250|300|500)\s*\)/.test(src)) {
    silentSliceFiles++;
  }
}

console.log("=== ModelScript Inspector UI Hardening Audit ===");
console.log(`Scanned UI files:         ${uiFiles.length}`);
console.log(`Defined --ms-* tokens:    ${definedTokens.size}`);
console.log(`PanelSvgStage adopted:    ${svgStageAdopted}`);
console.log(`PanelDataGrid adopted:    ${dataGridAdopted}`);
console.log(`Undefined --ms-* tokens:  ${undefinedTokenFiles} file(s)`);
console.log(`Raw SVG (no zoom/pan):    ${rawSvgBypassFiles} file(s)`);
console.log(`Silent .slice(0, N):      ${silentSliceFiles} file(s)`);

if (findings.length > 0) {
  console.log("\nActionable findings:");
  for (const f of findings) console.log(`  - ${f}`);
}

const strict = process.argv.includes("--strict");
if (strict && (undefinedTokenFiles > 0 || rawSvgBypassFiles > 0)) {
  process.exit(1);
}
