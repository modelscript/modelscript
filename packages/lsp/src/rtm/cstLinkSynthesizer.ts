// SPDX-License-Identifier: AGPL-3.0-or-later

export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface WorkspaceTextEdit {
  range: TextRange;
  newText: string;
}

/**
 * Computes source code text edits to bi-directionally insert or delete
 * traceability links in SysML v2 and Modelica documents.
 */
export class CstLinkSynthesizer {
  /**
   * Helper to convert byte offset to 0-indexed line and character.
   */
  static offsetToPosition(text: string, offset: number): TextPosition {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const lines = text.substring(0, clamped).split("\n");
    const line = lines.length - 1;
    const character = lines[lines.length - 1]!.length;
    return { line, character };
  }

  /**
   * Synthesizes a trace link (satisfy / verify / allocate / connect / mitigate / refine) in a SysML v2 file.
   */
  static synthesizeSysMLTraceLink(
    documentText: string,
    sourceName: string,
    targetName: string,
    linkKind: "satisfy" | "verify" | "allocate" | "connect" | "mitigate" | "refine" = "satisfy",
  ): WorkspaceTextEdit[] | null {
    if (linkKind === "connect") {
      // Synthesize: connect sourceName to targetName;
      const lastBraceIndex = documentText.lastIndexOf("}");
      if (lastBraceIndex !== -1) {
        const pos = this.offsetToPosition(documentText, lastBraceIndex);
        return [
          {
            range: { start: pos, end: pos },
            newText: `  connect ${sourceName} to ${targetName};\n`,
          },
        ];
      } else {
        const endPos = this.offsetToPosition(documentText, documentText.length);
        return [
          {
            range: { start: endPos, end: endPos },
            newText: `\nconnect ${sourceName} to ${targetName};\n`,
          },
        ];
      }
    }

    // 1. Locate the source element declaration in documentText
    const regex = new RegExp(
      `\\b(part\\s+def|part|port\\s+def|port|action\\s+def|action|verification\\s+def|verification|hazard\\s+def|hazard|item\\s+def|item)\\s+${sourceName}\\b([^;{]*)(;|\\{)`,
      "m",
    );

    const match = regex.exec(documentText);
    if (!match) {
      if (linkKind === "allocate") {
        const lastBraceIndex = documentText.lastIndexOf("}");
        if (lastBraceIndex !== -1) {
          const pos = this.offsetToPosition(documentText, lastBraceIndex);
          return [
            {
              range: { start: pos, end: pos },
              newText: `  allocate ${sourceName} to ${targetName};\n`,
            },
          ];
        }
      }
      return null;
    }

    const keyword =
      linkKind === "satisfy"
        ? "satisfy"
        : linkKind === "verify"
          ? "verify"
          : linkKind === "mitigate"
            ? "mitigate"
            : linkKind === "refine"
              ? "refine"
              : "allocate";
    const statement = linkKind === "allocate" ? `allocate to ${targetName};` : `${keyword} ${targetName};`;

    const fullMatchIndex = match.index;
    const delimiter = match[3];

    if (delimiter === "{") {
      const openBraceIndex = fullMatchIndex + match[0].length;
      const pos = this.offsetToPosition(documentText, openBraceIndex);
      return [
        {
          range: { start: pos, end: pos },
          newText: `\n  ${statement}`,
        },
      ];
    } else if (delimiter === ";") {
      const semicolonIndex = fullMatchIndex + match[0].length - 1;
      const startPos = this.offsetToPosition(documentText, semicolonIndex);
      const endPos = this.offsetToPosition(documentText, semicolonIndex + 1);
      return [
        {
          range: { start: startPos, end: endPos },
          newText: ` {\n  ${statement}\n}`,
        },
      ];
    }

    return null;
  }

  /**
   * Deletes an existing trace link statement from a SysML v2 document.
   */
  static removeSysMLTraceLink(
    documentText: string,
    targetName: string,
    linkKind: "satisfy" | "verify" | "allocate" | "connect" | "mitigate" | "refine" = "satisfy",
    declarationRange?: [number, number],
    sourceName?: string,
  ): WorkspaceTextEdit[] | null {
    if (declarationRange && declarationRange[1] > declarationRange[0]) {
      const startPos = this.offsetToPosition(documentText, declarationRange[0]);
      const endPos = this.offsetToPosition(documentText, declarationRange[1]);
      return [
        {
          range: { start: startPos, end: endPos },
          newText: "",
        },
      ];
    }

    if (linkKind === "connect" && sourceName) {
      const connectRegex = new RegExp(
        `^[ \\t]*connect\\s+(${sourceName}\\s+to\\s+${targetName}|${targetName}\\s+to\\s+${sourceName})\\s*;[ \\t]*\\r?\\n?`,
        "m",
      );
      const match = connectRegex.exec(documentText);
      if (match) {
        const startPos = this.offsetToPosition(documentText, match.index);
        const endPos = this.offsetToPosition(documentText, match.index + match[0].length);
        return [{ range: { start: startPos, end: endPos }, newText: "" }];
      }
    }

    if (linkKind === "allocate" && sourceName) {
      const allocRegex = new RegExp(
        `^[ \\t]*allocate\\s+${sourceName}\\s+to\\s+${targetName}\\s*;[ \\t]*\\r?\\n?`,
        "m",
      );
      const match = allocRegex.exec(documentText);
      if (match) {
        const startPos = this.offsetToPosition(documentText, match.index);
        const endPos = this.offsetToPosition(documentText, match.index + match[0].length);
        return [{ range: { start: startPos, end: endPos }, newText: "" }];
      }
    }

    const keyword =
      linkKind === "satisfy"
        ? "satisfy"
        : linkKind === "verify"
          ? "verify"
          : linkKind === "mitigate"
            ? "mitigate"
            : linkKind === "refine"
              ? "refine"
              : "allocate";
    const lineRegex = new RegExp(`^[ \\t]*${keyword}\\s+(to\\s+)?${targetName}\\s*;[ \\t]*\\r?\\n?`, "m");
    const match = lineRegex.exec(documentText);
    if (!match) return null;

    const startPos = this.offsetToPosition(documentText, match.index);
    const endPos = this.offsetToPosition(documentText, match.index + match[0].length);

    return [
      {
        range: { start: startPos, end: endPos },
        newText: "",
      },
    ];
  }

  /**
   * Synthesizes a traceability annotation into a Modelica model.
   */
  static synthesizeModelicaTraceLink(
    documentText: string,
    sourceClassName: string,
    targetReqName: string,
    linkKind: "satisfy" | "verify" | "allocate" = "satisfy",
  ): WorkspaceTextEdit[] | null {
    // Find the `end <sourceClassName>;` of the model
    const endRegex = new RegExp(`\\bend\\s+${sourceClassName}\\s*;`, "m");
    const match = endRegex.exec(documentText);
    if (!match) return null;

    const attrName = linkKind === "satisfy" ? "satisfies" : linkKind === "verify" ? "verifies" : "allocates";
    const annotationSnippet = `  annotation(__modelscript(${attrName}="${targetReqName}"));\n`;

    const pos = this.offsetToPosition(documentText, match.index);
    return [
      {
        range: { start: pos, end: pos },
        newText: annotationSnippet,
      },
    ];
  }

  /**
   * Removes a traceability annotation from a Modelica model.
   */
  static removeModelicaTraceLink(documentText: string, targetReqName: string): WorkspaceTextEdit[] | null {
    const annotRegex = new RegExp(
      `^[ \\t]*annotation\\s*\\([\\s\\S]*?__modelscript\\s*\\([\\s\\S]*?"${targetReqName}"[\\s\\S]*?\\)\\s*\\);[ \\t]*\\r?\\n?`,
      "m",
    );
    const match = annotRegex.exec(documentText);
    if (!match) return null;

    const startPos = this.offsetToPosition(documentText, match.index);
    const endPos = this.offsetToPosition(documentText, match.index + match[0].length);

    return [
      {
        range: { start: startPos, end: endPos },
        newText: "",
      },
    ];
  }
}
