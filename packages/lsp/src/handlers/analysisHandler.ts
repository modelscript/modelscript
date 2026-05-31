/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars */
// @ts-nocheck

import { LspContext } from "../LspContext";

export function registerAnalysisHandlers(context: LspContext) {
  context.connection.onRequest(
    "modelscript/extractCosimGraph",
    (params: { uri: string; text: string }): CosimGraphResult => {
      try {
        const text = params.text;

        // ── Extract component declarations ──
        // Match patterns like:  ClassName instanceName(...);
        // Exclude keywords, parameter declarations, and Real/Integer/Boolean/String variables
        const componentRegex =
          /^\s+([A-Z][A-Za-z0-9_.]*)\s+([a-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:"[^"]*")?\s*;/gm;
        const builtinTypes = new Set(["Real", "Integer", "Boolean", "String", "StateSelect"]);
        const keywords = new Set([
          "parameter",
          "constant",
          "discrete",
          "input",
          "output",
          "flow",
          "stream",
          "replaceable",
          "redeclare",
          "inner",
          "outer",
          "final",
          "extends",
          "import",
          "equation",
          "algorithm",
          "initial",
          "end",
          "model",
          "class",
          "block",
          "connector",
          "record",
          "type",
          "package",
          "function",
          "when",
          "if",
          "for",
          "while",
          "connect",
          "protected",
          "public",
          "annotation",
          "external",
          "partial",
          "encapsulated",
          "within",
        ]);

        const participants: CosimParticipantInfo[] = [];
        const componentNames = new Set<string>();

        // Pre-filter: remove lines that start with "parameter", "constant", etc.
        const lines = text.split("\\n");
        const filteredText = lines
          .filter((line) => {
            const trimmed = line.trimStart();
            const firstWord = trimmed.split(/\s+/)[0] ?? "";
            // Keep lines that don't start with modifier keywords
            return !["parameter", "constant", "discrete", "input", "output"].includes(firstWord);
          })
          .join("\\n");

        let match: RegExpExecArray | null;
        while ((match = componentRegex.exec(filteredText)) !== null) {
          const className = match[1] ?? "";
          const instanceName = match[2] ?? "";
          const modBody = match[3] ?? "";

          // Skip built-in types and keywords
          if (builtinTypes.has(className) || keywords.has(className.toLowerCase())) continue;
          // Skip Modelica.Blocks.Interfaces types (connector definitions)
          if (className.includes("Interface")) continue;

          // Check for fileName parameter → FMU
          const fileNameMatch = modBody.match(/fileName\s*=\s*"([^"]*)"/);
          const isFmu = fileNameMatch !== null;

          participants.push({
            id: instanceName,
            type: isFmu ? "fmu" : "modelica",
            className,
            fileName: fileNameMatch?.[1],
          });
          componentNames.add(instanceName);
        }

        // ── Extract connect equations ──
        const connectRegex = /connect\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g;
        const couplings: CosimCouplingInfo[] = [];

        while ((match = connectRegex.exec(text)) !== null) {
          const ref1 = match[1] ?? "";
          const ref2 = match[2] ?? "";

          // Split into component.variable
          const dot1 = ref1.indexOf(".");
          const dot2 = ref2.indexOf(".");

          if (dot1 === -1 || dot2 === -1) continue; // Skip non-dotted references

          const comp1 = ref1.substring(0, dot1);
          const var1 = ref1.substring(dot1 + 1);
          const comp2 = ref2.substring(0, dot2);
          const var2 = ref2.substring(dot2 + 1);

          // Only add if both components are known participants
          if (!componentNames.has(comp1) || !componentNames.has(comp2)) continue;

          couplings.push({
            from: { participantId: comp1, variable: var1 },
            to: { participantId: comp2, variable: var2 },
          });
        }

        return { ok: true, participants, couplings };
      } catch (e) {
        console.error("[extractCosimGraph] Error:", e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest("modelscript/getRequirements", (params: { uri: string }) => {
    try {
      const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
      // Gather all verification results across the workspace
      const allResults = [];
      for (const res of context.validationService.verificationResultsByUri.values()) {
        allResults.push(...res);
      }
      return getRequirements(db, undefined, allResults); // Do not filter by uri to show workspace-level requirements
    } catch (e) {
      console.error("[requirements] Error:", e);
      return [];
    }
  });
}
