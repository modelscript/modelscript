// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Sysml2CodeLens {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  command: { title: string; command: string; arguments?: any[] };
}

export interface Sysml2CodeLensContext {
  uri?: string;
  text?: string;
  flags?: {
    showVerification?: boolean;
    showPolyglotLinks?: boolean;
    showDiagram?: boolean;
    scaffolding?: boolean;
    demos?: boolean;
  };
  workspaceManager?: any;
  documentManager?: any;
}

type SysmlDefKind = "part" | "requirement" | "verification" | "action" | "state";

const SYSML_DEF_KEYWORD_MAP: Record<string, SysmlDefKind> = {
  part: "part",
  requirement: "requirement",
  verification: "verification",
  action: "action",
  calc: "action",
  state: "state",
  activity: "state",
};

function mkRange(startLine: number, startChar: number, endLine: number, endChar: number) {
  return { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } };
}

function isWsCharCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10 || code === 11 || code === 12;
}

function isIdentContCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || (code >= 48 && code <= 57);
}

function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && isWsCharCode(text.charCodeAt(i))) i++;
  return i;
}

function readAlnumIdent(text: string, idx: number): { token: string; next: number } | undefined {
  let i = idx;
  while (i < text.length && isIdentContCode(text.charCodeAt(i))) i++;
  return i > idx ? { token: text.slice(idx, i), next: i } : undefined;
}

function splitLinesPreserve(text: string): string[] {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.endsWith("\r")) lines[i] = line.slice(0, -1);
  }
  return lines;
}

function matchSysmlDefLine(line: string): { kind: SysmlDefKind; name: string } | undefined {
  let pos = skipWs(line, 0);
  let word = readAlnumIdent(line, pos);
  if (!word) return undefined;
  if (word.token === "abstract") {
    pos = skipWs(line, word.next);
    if (pos === word.next) return undefined;
    word = readAlnumIdent(line, pos);
    if (!word) return undefined;
  }
  const kind = SYSML_DEF_KEYWORD_MAP[word.token];
  if (!kind) return undefined;
  const defStart = skipWs(line, word.next);
  if (defStart === word.next || !line.startsWith("def", defStart)) return undefined;
  const nameStart = skipWs(line, defStart + 3);
  if (nameStart === defStart + 3) return undefined;
  const name = readAlnumIdent(line, nameStart);
  return name ? { kind, name: name.token } : undefined;
}

export function getSysml2CodeLenses(text: string, uri: string, ctx?: Sysml2CodeLensContext): Sysml2CodeLens[] {
  const lenses: Sysml2CodeLens[] = [];
  if (!text) return lenses;

  const flags = ctx?.flags ?? {};
  const showVerification = flags.showVerification ?? false;
  const showPolyglotLinks = flags.showPolyglotLinks ?? false;
  const showDiagram = flags.showDiagram ?? false;
  const scaffolding = flags.scaffolding ?? false;
  const demos = flags.demos ?? false;

  const emitSysmlDefLenses = (kind: SysmlDefKind, name: string, range: Sysml2CodeLens["range"]) => {
    if (kind === "part") {
      const threadEntries =
        showPolyglotLinks && ctx?.workspaceManager?.getThreadsForUri ? ctx.workspaceManager.getThreadsForUri(uri) : [];
      const matchingThread =
        threadEntries.find((e: any) => e.meta?.name?.includes(name)) ??
        (threadEntries.length === 1 ? threadEntries[0] : undefined);

      if (matchingThread && showPolyglotLinks && ctx?.workspaceManager?.findAlignedElementsBySlot) {
        const aligned = ctx.workspaceManager.findAlignedElementsBySlot(matchingThread.slot);
        const engAligned = aligned.filter((el: any) => el.domain.toLowerCase() !== "requirements");
        const domainCount = engAligned.length > 0 ? engAligned.length : aligned.length;
        const labelMap: Record<string, string> = {
          sysml2: "SYSML",
          modelica: "MO",
          cad: "CAD",
          fea: "FEA",
          cfd: "CFD",
        };
        const activeDomainList = (engAligned.length > 0 ? engAligned : aligned).map(
          (el: any) => labelMap[el.domain.toLowerCase()] ?? el.domain.toUpperCase(),
        );
        lenses.push({
          range,
          command: {
            title: `⚡ Digital Thread: ${domainCount} Domains Linked (${activeDomainList.join(" + ")})`,
            command: "modelscript.openThreadExplorer",
            arguments: [uri, name],
          },
        });
        lenses.push({
          range,
          command: {
            title: "$(sync) Sync Digital Thread Parameters",
            command: "modelscript.syncDigitalThreadParams",
            arguments: [uri],
          },
        });
        if (showVerification) {
          lenses.push({
            range,
            command: {
              title: "🛡️ Verify Contracts & Hierarchy",
              command: "modelscript.openContractExplorer",
              arguments: [uri, name],
            },
          });
        }
      } else {
        if (showVerification) {
          lenses.push({
            range,
            command: {
              title: "🛡️ Verify Contracts & Hierarchy",
              command: "modelscript.openContractExplorer",
              arguments: [uri, name],
            },
          });
        }
        if (scaffolding) {
          lenses.push({
            range,
            command: {
              title: "⚡ Scaffold Multi-Domain (SCAD + MO + FEA)",
              command: "modelscript.scaffoldMultiDomain",
              arguments: [uri, name],
            },
          });
        }
        if (demos) {
          lenses.push({
            range,
            command: {
              title: "⚡ Tier 1: Validated | 📈 Tier 2: Pareto Candidates | 🚀 Schedule Tier 3 Confirmation",
              command: "modelscript.openCandidateTradeStudy",
              arguments: [uri, name],
            },
          });
        }
      }
      if (showDiagram) {
        lenses.push({
          range,
          command: {
            title: "⊞ Open Interactive Diagram",
            command: "modelscript.openDiagram",
            arguments: [uri],
          },
        });
      }
      return;
    }

    if (!showVerification) return;

    if (kind === "requirement") {
      lenses.push({
        range,
        command: {
          title: `🛡️ Verify Formal Requirement Contract: ${name}`,
          command: "modelscript.runReachabilityFlowpipe",
          arguments: [uri],
        },
      });
    } else if (kind === "verification") {
      lenses.push({
        range,
        command: {
          title: "▶ Run Continuous Reachability Verification (Nelson-Oppen / Salsa)",
          command: "modelscript.runReachabilityFlowpipe",
          arguments: [uri],
        },
      });
    } else if (kind === "action") {
      lenses.push({
        range,
        command: {
          title: "▶ Run Formal MC/DC Tests",
          command: "modelscript.runMcdcTests",
          arguments: [uri, name],
        },
      });
      lenses.push({
        range,
        command: {
          title: "📊 Decompose Regions",
          command: "modelscript.decomposeRegions",
          arguments: [uri, name],
        },
      });
    } else if (kind === "state") {
      lenses.push({
        range,
        command: {
          title: "⏱️ Replay Trace / Counterexample",
          command: "modelscript.openTraceReplay",
          arguments: [uri, name],
        },
      });
    }
  };

  let usedSysmlCst = false;
  const sysmlTreeEntry =
    ctx?.documentManager?.getDocumentTree?.(uri) ?? ctx?.documentManager?.documentTrees?.get?.(uri);
  const sysmlRootNode = sysmlTreeEntry?.tree?.rootNode ?? sysmlTreeEntry?.rootNode;
  if (sysmlRootNode) {
    const cstTypeToKind: Record<string, SysmlDefKind> = {
      partdefinition: "part",
      requirementdefinition: "requirement",
      verificationcasedefinition: "verification",
      actiondefinition: "action",
      calculationdefinition: "action",
      statedefinition: "state",
    };
    const visitSysml = (node: any) => {
      if (!node) return;
      const normType = (node.type || "").toLowerCase();
      const kind = cstTypeToKind[normType];
      if (kind) {
        const nameNode = node.childForFieldName?.("declaredName") ?? node.children?.find((c: any) => c.type === "Name");
        const name = nameNode?.text?.trim();
        if (name) {
          usedSysmlCst = true;
          const lineIdx = nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0;
          const col = nameNode?.startPosition?.column ?? node.startPosition?.column ?? 0;
          emitSysmlDefLenses(kind, name, mkRange(lineIdx, col, lineIdx, col + name.length));
        }
      }
      if (node.children) {
        for (const child of node.children) visitSysml(child);
      }
    };
    visitSysml(sysmlRootNode);
  }

  if (!usedSysmlCst) {
    const lines = splitLinesPreserve(text);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      const parsed = matchSysmlDefLine(line);
      if (parsed) {
        const col = line.indexOf(parsed.name);
        emitSysmlDefLenses(parsed.kind, parsed.name, mkRange(lineIdx, col, lineIdx, col + parsed.name.length));
      }
    }
  }

  return lenses;
}
