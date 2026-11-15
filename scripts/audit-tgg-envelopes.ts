// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";

const LANGUAGES_DIR = path.resolve(process.cwd(), "languages");

interface AuditEntry {
  lang: string;
  status: "dedicated-tgg" | "inline-polyglot" | "missing";
  hasPlan: boolean;
}

const entries: AuditEntry[] = [];
for (const lang of fs.readdirSync(LANGUAGES_DIR).sort()) {
  const pkgDir = path.join(LANGUAGES_DIR, lang);
  if (!fs.statSync(pkgDir).isDirectory()) continue;

  const tggDir = path.join(pkgDir, "src", "tgg");
  const tggFile = path.join(pkgDir, "src", "tgg.ts");
  const langFile = path.join(pkgDir, "src", "language.ts");

  let status: AuditEntry["status"] = "missing";
  let hasPlan = false;

  if (fs.existsSync(tggDir) || fs.existsSync(tggFile)) {
    status = "dedicated-tgg";
    const tggIndex = path.join(tggDir, "index.ts");
    if (fs.existsSync(tggIndex)) {
      const content = fs.readFileSync(tggIndex, "utf8");
      hasPlan = content.includes("planTGGRules") || content.includes("TggPlan");
    }
  } else if (fs.existsSync(langFile)) {
    const content = fs.readFileSync(langFile, "utf8");
    if (content.includes("polyglot:")) {
      status = "inline-polyglot";
    }
  }

  entries.push({ lang, status, hasPlan });
}

const dedicated = entries.filter((e) => e.status === "dedicated-tgg");
const inline = entries.filter((e) => e.status === "inline-polyglot");
const missing = entries.filter((e) => e.status === "missing");
const withPlan = entries.filter((e) => e.hasPlan);

console.log(
  JSON.stringify(
    {
      total: entries.length,
      dedicatedTgg: dedicated.length,
      withCompiledPlan: withPlan.length,
      inlinePolyglot: inline.length,
      missing: missing.length,
      inlineLangs: inline.map((e) => e.lang),
      missingCount: missing.length,
    },
    null,
    2,
  ),
);
