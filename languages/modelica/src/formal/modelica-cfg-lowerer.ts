// SPDX-License-Identifier: AGPL-3.0-or-later

import { BasicBlock, CFGEdgeKind, GenericCFG } from "@modelscript/runtime";

export interface ModelicaStatement {
  kind: "assignment" | "if" | "for" | "while" | "when" | "return" | "break" | "call";
  targetVar?: string;
  valExpr?: string;
  condExpr?: string;
  loopVar?: string;
  rangeStart?: string;
  rangeEnd?: string;
  rangeStep?: string;
  thenStmts?: ModelicaStatement[];
  elseStmts?: ModelicaStatement[];
  elseIfs?: { condExpr: string; stmts: ModelicaStatement[] }[];
  loopBody?: ModelicaStatement[];
  whileBody?: ModelicaStatement[];
  whenBody?: ModelicaStatement[];
  callFn?: string;
  callArgs?: string[];
  startByte?: number;
  endByte?: number;
  rawText?: string;
}

/**
 * Lowers structured Modelica statements into a language-agnostic GenericCFG.
 */
export class ModelicaCFGLowerer {
  private cfg: GenericCFG;
  private loopExitStack: number[] = [];
  private loopHeaderStack: number[] = [];
  private exitBlock: BasicBlock;

  constructor() {
    this.cfg = new GenericCFG();
    this.exitBlock = this.cfg.createBlock("exit");
    this.cfg.exitBlockIds.add(this.exitBlock.id);
  }

  /**
   * Parses raw Modelica algorithmic source text into structured ModelicaStatement nodes.
   */
  static parseStatements(algText: string, defaultStartByte: number = 0): ModelicaStatement[] {
    const statements: ModelicaStatement[] = [];

    let body = algText;
    const algKwMatch = /^\s*(?:initial\s+)?algorithm\b/.exec(body);
    let offset = 0;
    if (algKwMatch) {
      offset = algKwMatch[0].length;
      body = body.slice(offset);
    }

    let i = 0;
    while (i < body.length) {
      while (i < body.length && /\s/.test(body[i]!)) i++;
      if (i >= body.length) break;

      const remaining = body.slice(i);

      // 1. If statement
      if (/^if\b/.test(remaining)) {
        const ifStart = i;
        let depth = 1;
        let j = i + 2;
        while (j < body.length && depth > 0) {
          if (body.slice(j).startsWith("if") && /\bif\b/.test(body.slice(j, j + 3))) {
            depth++;
            j += 2;
          } else if (body.slice(j).startsWith("end if") && /\bend\s+if\b/.test(body.slice(j, j + 7))) {
            depth--;
            j += 6;
            if (depth === 0) {
              while (j < body.length && (body[j] === ";" || /\s/.test(body[j]!))) {
                if (body[j] === ";") {
                  j++;
                  break;
                }
                j++;
              }
              break;
            }
          } else {
            j++;
          }
        }

        const ifText = body.slice(ifStart, j);
        const startByte = defaultStartByte + offset + ifStart;
        const endByte = defaultStartByte + offset + j;

        const branchTokens = ifText.split(/\b(elseif|else)\b/);
        const firstBranchMatch = /^if\b([\s\S]*?)\bthen\b([\s\S]*)$/.exec(branchTokens[0] || "");
        let thenStmts: ModelicaStatement[] = [];
        let condExpr = "";
        if (firstBranchMatch) {
          condExpr = firstBranchMatch[1]?.trim() || "";
          thenStmts = ModelicaCFGLowerer.parseStatements(firstBranchMatch[2]?.trim() || "", startByte);
        }

        const elseIfs: { condExpr: string; stmts: ModelicaStatement[] }[] = [];
        let elseStmts: ModelicaStatement[] | undefined = undefined;

        let k = 1;
        while (k < branchTokens.length) {
          const token = branchTokens[k]?.trim();
          const content = branchTokens[k + 1] || "";
          if (token === "elseif") {
            const match = /^\s*([\s\S]*?)\bthen\b([\s\S]*)$/.exec(content);
            if (match) {
              const eCond = match[1]?.trim() || "";
              const eBody = match[2]?.trim() || "";
              elseIfs.push({
                condExpr: eCond,
                stmts: ModelicaCFGLowerer.parseStatements(eBody, startByte),
              });
            }
          } else if (token === "else") {
            const elseBody = content.replace(/\bend\s+if[\s\S]*$/, "").trim();
            elseStmts = ModelicaCFGLowerer.parseStatements(elseBody, startByte);
          }
          k += 2;
        }

        statements.push({
          kind: "if",
          condExpr,
          thenStmts,
          elseIfs,
          elseStmts,
          rawText: ifText,
          startByte,
          endByte,
        });

        i = j;
        continue;
      }

      // 2. For statement
      if (/^for\b/.test(remaining)) {
        const forStart = i;
        let depth = 1;
        let j = i + 3;
        while (j < body.length && depth > 0) {
          if (body.slice(j).startsWith("for") && /\bfor\b/.test(body.slice(j, j + 4))) {
            depth++;
            j += 3;
          } else if (body.slice(j).startsWith("end for") && /\bend\s+for\b/.test(body.slice(j, j + 8))) {
            depth--;
            j += 7;
            if (depth === 0) {
              while (j < body.length && (body[j] === ";" || /\s/.test(body[j]!))) {
                if (body[j] === ";") {
                  j++;
                  break;
                }
                j++;
              }
              break;
            }
          } else {
            j++;
          }
        }

        const forText = body.slice(forStart, j);
        const startByte = defaultStartByte + offset + forStart;
        const endByte = defaultStartByte + offset + j;

        const forMatch = /^for\b([\s\S]*?)\bloop\b([\s\S]*?)\bend\s+for/i.exec(forText);
        const header = forMatch ? forMatch[1] || "" : "";
        const forBodyText = forMatch ? forMatch[2] || "" : "";

        let loopVar = "i";
        const idMatch = header.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (idMatch && idMatch[1]) loopVar = idMatch[1];

        let rangeStart = "1";
        let rangeEnd = "10";
        let rangeStep = "1";

        const inMatch = header.match(/\bin\b([\s\S]*)$/);
        if (inMatch && inMatch[1]) {
          const parts = inMatch[1].trim().split(":");
          if (parts.length === 2) {
            rangeStart = parts[0]?.trim() || "1";
            rangeEnd = parts[1]?.trim() || "10";
          } else if (parts.length === 3) {
            rangeStart = parts[0]?.trim() || "1";
            rangeStep = parts[1]?.trim() || "1";
            rangeEnd = parts[2]?.trim() || "10";
          }
        }

        statements.push({
          kind: "for",
          loopVar,
          rangeStart,
          rangeEnd,
          rangeStep,
          loopBody: ModelicaCFGLowerer.parseStatements(forBodyText, startByte),
          rawText: forText,
          startByte,
          endByte,
        });

        i = j;
        continue;
      }

      // 3. While statement
      if (/^while\b/.test(remaining)) {
        const whileStart = i;
        let depth = 1;
        let j = i + 5;
        while (j < body.length && depth > 0) {
          if (body.slice(j).startsWith("while") && /\bwhile\b/.test(body.slice(j, j + 6))) {
            depth++;
            j += 5;
          } else if (body.slice(j).startsWith("end while") && /\bend\s+while\b/.test(body.slice(j, j + 10))) {
            depth--;
            j += 9;
            if (depth === 0) {
              while (j < body.length && (body[j] === ";" || /\s/.test(body[j]!))) {
                if (body[j] === ";") {
                  j++;
                  break;
                }
                j++;
              }
              break;
            }
          } else {
            j++;
          }
        }

        const whileText = body.slice(whileStart, j);
        const startByte = defaultStartByte + offset + whileStart;
        const endByte = defaultStartByte + offset + j;

        const whileMatch = /^while\b([\s\S]*?)\bloop\b([\s\S]*?)\bend\s+while/i.exec(whileText);
        const condExpr = whileMatch ? whileMatch[1]?.trim() || "" : "";
        const whileBodyText = whileMatch ? whileMatch[2]?.trim() || "" : "";

        statements.push({
          kind: "while",
          condExpr,
          whileBody: ModelicaCFGLowerer.parseStatements(whileBodyText, startByte),
          rawText: whileText,
          startByte,
          endByte,
        });

        i = j;
        continue;
      }

      // 4. When statement
      if (/^when\b/.test(remaining)) {
        const whenStart = i;
        let depth = 1;
        let j = i + 4;
        while (j < body.length && depth > 0) {
          if (body.slice(j).startsWith("when") && /\bwhen\b/.test(body.slice(j, j + 5))) {
            depth++;
            j += 4;
          } else if (body.slice(j).startsWith("end when") && /\bend\s+when\b/.test(body.slice(j, j + 9))) {
            depth--;
            j += 8;
            if (depth === 0) {
              while (j < body.length && (body[j] === ";" || /\s/.test(body[j]!))) {
                if (body[j] === ";") {
                  j++;
                  break;
                }
                j++;
              }
              break;
            }
          } else {
            j++;
          }
        }

        const whenText = body.slice(whenStart, j);
        const startByte = defaultStartByte + offset + whenStart;
        const endByte = defaultStartByte + offset + j;

        const whenMatch = /^when\b([\s\S]*?)\bthen\b([\s\S]*?)\bend\s+when/i.exec(whenText);
        const condExpr = whenMatch ? whenMatch[1]?.trim() || "" : "";
        const whenBodyText = whenMatch ? whenMatch[2]?.trim() || "" : "";

        statements.push({
          kind: "when",
          condExpr,
          whenBody: ModelicaCFGLowerer.parseStatements(whenBodyText, startByte),
          rawText: whenText,
          startByte,
          endByte,
        });

        i = j;
        continue;
      }

      // 5. Simple statement up to ';'
      const semiIdx = body.indexOf(";", i);
      if (semiIdx === -1) {
        break;
      }

      const stmtText = body.slice(i, semiIdx).trim();
      const startByte = defaultStartByte + offset + i;
      const endByte = defaultStartByte + offset + semiIdx + 1;

      if (stmtText === "return" || stmtText.startsWith("return ") || stmtText.startsWith("return(")) {
        const retVal = stmtText.slice(6).trim();
        statements.push({
          kind: "return",
          valExpr: retVal || undefined,
          rawText: stmtText,
          startByte,
          endByte,
        });
      } else if (stmtText === "break") {
        statements.push({ kind: "break", rawText: stmtText, startByte, endByte });
      } else if (stmtText.includes(":=")) {
        const parts = stmtText.split(":=");
        const targetVar = parts[0]?.trim() || "";
        const valExpr = parts.slice(1).join(":=").trim();

        statements.push({
          kind: "assignment",
          targetVar,
          valExpr,
          rawText: stmtText,
          startByte,
          endByte,
        });
      } else if (/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/.test(stmtText)) {
        const callMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/.exec(stmtText)!;
        const callFn = callMatch[1]!;
        const callArgs = callMatch[2] ? callMatch[2].split(",").map((s) => s.trim()) : [];
        statements.push({
          kind: "call",
          callFn,
          callArgs,
          rawText: stmtText,
          startByte,
          endByte,
        });
      }

      i = semiIdx + 1;
    }

    return statements;
  }

  /**
   * Lowers raw Modelica algorithmic source text directly into a GenericCFG.
   */
  static lowerText(algText: string, defaultStartByte: number = 0): GenericCFG {
    const stmts = ModelicaCFGLowerer.parseStatements(algText, defaultStartByte);
    return new ModelicaCFGLowerer().lower(stmts);
  }

  lower(statements: ModelicaStatement[]): GenericCFG {
    const entryBlock = this.cfg.createBlock("entry");
    this.cfg.entryBlockId = entryBlock.id;

    const finalBlock = this.lowerStatements(statements, entryBlock);
    if (finalBlock && finalBlock.id !== this.exitBlock.id) {
      this.cfg.addEdge(finalBlock.id, this.exitBlock.id, CFGEdgeKind.Normal);
    }

    return this.cfg;
  }

  private lowerStatements(statements: ModelicaStatement[], currentBlock: BasicBlock): BasicBlock {
    let curr = currentBlock;

    for (const stmt of statements) {
      curr = this.lowerSingleStatement(stmt, curr);
    }

    return curr;
  }

  private lowerSingleStatement(stmt: ModelicaStatement, curr: BasicBlock): BasicBlock {
    switch (stmt.kind) {
      case "assignment": {
        const target = stmt.targetVar ?? "";
        // Check if target is array element assignment: arr[idx] or arr[i, j]
        const arrMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.*)\]$/.exec(target);
        if (arrMatch) {
          const arrName = arrMatch[1]!;
          const idxExpr = arrMatch[2]!;
          const inst = this.cfg.createInstruction("ASSIGN_ARRAY", arrName, [idxExpr, stmt.valExpr ?? "0"], {
            startByte: stmt.startByte,
            endByte: stmt.endByte,
            rawText: stmt.rawText,
          });
          curr.addInstruction(inst);
          return curr;
        }

        const inst = this.cfg.createInstruction("ASSIGN", stmt.targetVar, stmt.valExpr ? [stmt.valExpr] : [], {
          startByte: stmt.startByte,
          endByte: stmt.endByte,
          rawText: stmt.rawText,
        });
        curr.addInstruction(inst);
        return curr;
      }

      case "call": {
        const inst = this.cfg.createInstruction("CALL", stmt.callFn, stmt.callArgs ?? [], {
          startByte: stmt.startByte,
          endByte: stmt.endByte,
          rawText: stmt.rawText,
        });
        curr.addInstruction(inst);
        return curr;
      }

      case "return": {
        const inst = this.cfg.createInstruction("RETURN", undefined, stmt.valExpr ? [stmt.valExpr] : [], {
          startByte: stmt.startByte,
          endByte: stmt.endByte,
        });
        curr.addInstruction(inst);
        this.cfg.addEdge(curr.id, this.exitBlock.id, CFGEdgeKind.Return);
        return this.cfg.createBlock("unreachable_after_return");
      }

      case "break": {
        const inst = this.cfg.createInstruction("BREAK", undefined, undefined, {
          startByte: stmt.startByte,
          endByte: stmt.endByte,
        });
        curr.addInstruction(inst);
        const exitId = this.loopExitStack[this.loopExitStack.length - 1];
        if (exitId !== undefined) {
          this.cfg.addEdge(curr.id, exitId, CFGEdgeKind.Normal);
        }
        return this.cfg.createBlock("unreachable_after_break");
      }

      case "if": {
        const mergeBlock = this.cfg.createBlock("if_merge");
        let currentCondBlock = curr;
        let currentCondExpr = stmt.condExpr ?? "true";

        // 1. Then branch
        const thenEntry = this.cfg.createBlock("then_entry");
        this.cfg.addEdge(currentCondBlock.id, thenEntry.id, CFGEdgeKind.TrueBranch, currentCondExpr);
        const thenEnd = this.lowerStatements(stmt.thenStmts ?? [], thenEntry);
        this.cfg.addEdge(thenEnd.id, mergeBlock.id, CFGEdgeKind.Normal);

        // 2. ElseIf branches
        for (const elseIf of stmt.elseIfs ?? []) {
          const nextCondBlock = this.cfg.createBlock("elseif_cond");
          this.cfg.addEdge(currentCondBlock.id, nextCondBlock.id, CFGEdgeKind.FalseBranch, `not (${currentCondExpr})`);

          const elseIfEntry = this.cfg.createBlock("elseif_entry");
          this.cfg.addEdge(nextCondBlock.id, elseIfEntry.id, CFGEdgeKind.TrueBranch, elseIf.condExpr);
          const elseIfEnd = this.lowerStatements(elseIf.stmts, elseIfEntry);
          this.cfg.addEdge(elseIfEnd.id, mergeBlock.id, CFGEdgeKind.Normal);

          currentCondBlock = nextCondBlock;
          currentCondExpr = elseIf.condExpr;
        }

        // 3. Else branch
        if (stmt.elseStmts && stmt.elseStmts.length > 0) {
          const elseEntry = this.cfg.createBlock("else_entry");
          this.cfg.addEdge(currentCondBlock.id, elseEntry.id, CFGEdgeKind.FalseBranch, `not (${currentCondExpr})`);
          const elseEnd = this.lowerStatements(stmt.elseStmts, elseEntry);
          this.cfg.addEdge(elseEnd.id, mergeBlock.id, CFGEdgeKind.Normal);
        } else {
          this.cfg.addEdge(currentCondBlock.id, mergeBlock.id, CFGEdgeKind.FalseBranch, `not (${currentCondExpr})`);
        }

        return mergeBlock;
      }

      case "when": {
        const mergeBlock = this.cfg.createBlock("when_merge");
        const whenEntry = this.cfg.createBlock("when_entry");
        const condExpr = stmt.condExpr ?? "true";

        this.cfg.addEdge(curr.id, whenEntry.id, CFGEdgeKind.TrueBranch, condExpr);
        this.cfg.addEdge(curr.id, mergeBlock.id, CFGEdgeKind.FalseBranch, `not (${condExpr})`);

        const whenEnd = this.lowerStatements(stmt.whenBody ?? [], whenEntry);
        this.cfg.addEdge(whenEnd.id, mergeBlock.id, CFGEdgeKind.Normal);

        return mergeBlock;
      }

      case "while": {
        const headerBlock = this.cfg.createBlock("while_header");
        const bodyBlock = this.cfg.createBlock("while_body");
        const exitBlock = this.cfg.createBlock("while_exit");

        this.cfg.addEdge(curr.id, headerBlock.id, CFGEdgeKind.Normal);
        this.cfg.addEdge(headerBlock.id, bodyBlock.id, CFGEdgeKind.TrueBranch, stmt.condExpr);
        this.cfg.addEdge(headerBlock.id, exitBlock.id, CFGEdgeKind.FalseBranch, `not (${stmt.condExpr})`);

        this.loopHeaderStack.push(headerBlock.id);
        this.loopExitStack.push(exitBlock.id);

        const bodyEnd = this.lowerStatements(stmt.whileBody ?? [], bodyBlock);
        this.cfg.addEdge(bodyEnd.id, headerBlock.id, CFGEdgeKind.Normal); // Loop back-edge

        this.loopHeaderStack.pop();
        this.loopExitStack.pop();

        return exitBlock;
      }

      case "for": {
        const loopVar = stmt.loopVar ?? "i";
        const startVal = stmt.rangeStart ?? "1";
        const endVal = stmt.rangeEnd ?? "10";
        const stepVal = stmt.rangeStep ?? "1";

        // Initialize loop variable in pre-header
        curr.addInstruction(
          this.cfg.createInstruction("ASSIGN", loopVar, [startVal], {
            startByte: stmt.startByte,
            endByte: stmt.endByte,
          }),
        );

        const headerBlock = this.cfg.createBlock("for_header");
        const bodyBlock = this.cfg.createBlock("for_body");
        const exitBlock = this.cfg.createBlock("for_exit");

        const condExpr = `${loopVar} <= ${endVal}`;
        this.cfg.addEdge(curr.id, headerBlock.id, CFGEdgeKind.Normal);
        this.cfg.addEdge(headerBlock.id, bodyBlock.id, CFGEdgeKind.TrueBranch, condExpr);
        this.cfg.addEdge(headerBlock.id, exitBlock.id, CFGEdgeKind.FalseBranch, `not (${condExpr})`);

        this.loopHeaderStack.push(headerBlock.id);
        this.loopExitStack.push(exitBlock.id);

        let bodyEnd = this.lowerStatements(stmt.loopBody ?? [], bodyBlock);

        // Increment loop variable: i := i + step
        bodyEnd.addInstruction(this.cfg.createInstruction("ASSIGN", loopVar, [`${loopVar} + ${stepVal}`]));

        this.cfg.addEdge(bodyEnd.id, headerBlock.id, CFGEdgeKind.Normal); // Loop back-edge

        this.loopHeaderStack.pop();
        this.loopExitStack.pop();

        return exitBlock;
      }

      default: {
        return curr;
      }
    }
  }
}
