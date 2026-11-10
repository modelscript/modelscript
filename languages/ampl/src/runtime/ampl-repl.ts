// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Interactive AMPL REPL Shell (`ampl-repl.ts`).
 *
 * Provides a rich interactive terminal shell with multi-line statement accumulation,
 * auto-completion for AMPL keywords and model entities, and meta commands (.help, .vars, .cons, .reset, .exit).
 */

import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { AmplSession, type AmplSessionOptions } from "./ampl-session.js";

export interface AmplReplOptions extends AmplSessionOptions {
  input?: Readable | undefined;
  output?: Writable | undefined;
  prompt?: string | undefined;
  banner?: boolean | undefined;
}

export class AmplRepl {
  public session: AmplSession;
  private input: Readable;
  private output: Writable;
  private promptStr: string;
  private showBanner: boolean;
  private buffer: string = "";

  constructor(options?: AmplReplOptions) {
    this.session = new AmplSession({
      ...options,
      onOutput: (text) => {
        this.write(text + "\n");
        if (options?.onOutput) options.onOutput(text);
      },
    });
    this.input = options?.input ?? process.stdin;
    this.output = options?.output ?? process.stdout;
    this.promptStr = options?.prompt ?? "ampl: ";
    this.showBanner = options?.banner ?? true;
  }

  private write(text: string): void {
    this.output.write(text);
  }

  public completer(line: string): [string[], string] {
    const keywords = [
      "set",
      "param",
      "var",
      "minimize",
      "maximize",
      "subject to",
      "s.t.",
      "solve",
      "display",
      "let",
      "fix",
      "unfix",
      "drop",
      "restore",
      "reset",
      "read table",
      "write table",
      "option",
      "include",
      "model",
      "data",
      "for",
      "repeat",
      "while",
      "until",
      "if",
      "then",
      "else",
      "printf",
      "binary",
      "integer",
      "symbolic",
      "check",
      "quit",
      "exit",
      ".help",
      ".vars",
      ".cons",
      ".params",
      ".sets",
      ".obj",
      ".reset",
      ".exit",
    ];

    const modelEntities: string[] = [
      ...Array.from(this.session.model.vars.keys()),
      ...Array.from(this.session.model.params.keys()),
      ...Array.from(this.session.model.sets.keys()),
      ...Array.from(this.session.model.constraints.keys()),
    ];

    const allCandidates = Array.from(new Set([...keywords, ...modelEntities]));
    const trimmed = line.trimStart();
    const lastWord = trimmed.split(/[\s,;:({[\]})]+/).pop() ?? "";
    const hits = allCandidates.filter((c) => c.startsWith(lastWord));
    return [hits.length > 0 ? hits : allCandidates, lastWord];
  }

  public async run(): Promise<void> {
    if (this.showBanner) {
      this.write("ModelScript AMPL Interactive REPL (v1.0.0)\n");
      this.write("Type AMPL statements ending in ';' or dot commands (.help, .exit)\n\n");
    }

    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
      completer: (l: string) => this.completer(l),
      prompt: this.promptStr,
      terminal: (this.input as any).isTTY ?? false,
    });

    rl.prompt();

    return new Promise<void>((resolve) => {
      let isClosed = false;

      rl.on("line", async (line: string) => {
        if (isClosed) return;
        const trimmed = line.trim();

        // Check meta / dot commands
        if (this.buffer.trim().length === 0 && trimmed.startsWith(".")) {
          await this.handleMetaCommand(trimmed);
          if (trimmed === ".exit" || trimmed === ".quit") {
            isClosed = true;
            rl.close();
            resolve();
            return;
          }
          if (!isClosed && !(rl as any).closed) {
            rl.setPrompt(this.promptStr);
            rl.prompt();
          }
          return;
        }

        if (this.buffer.trim().length === 0 && (trimmed === "exit;" || trimmed === "quit;")) {
          isClosed = true;
          rl.close();
          resolve();
          return;
        }

        this.buffer += (this.buffer.length > 0 ? "\n" : "") + line;

        // Check if the accumulated buffer contains a complete statement ending with ';'
        const stripped = this.buffer.replace(/#.*$/gm, "").trim();
        if (stripped.endsWith(";")) {
          const commandToRun = this.buffer;
          this.buffer = "";
          rl.pause();
          try {
            await this.session.evalScript(commandToRun);
          } catch (err: any) {
            this.write(`Error: ${err?.message ?? String(err)}\n`);
          } finally {
            rl.resume();
          }
          rl.setPrompt(this.promptStr);
        } else {
          // Multi-line continuation prompt
          rl.setPrompt("  ... ");
        }

        if (!isClosed && !(rl as any).closed) {
          rl.prompt();
        }
      });

      rl.on("close", () => {
        isClosed = true;
        resolve();
      });
    });
  }

  private async handleMetaCommand(cmd: string): Promise<void> {
    const parts = cmd.split(/\s+/);
    const op = parts[0]?.toLowerCase();

    switch (op) {
      case ".help":
        this.write(
          "Available dot commands:\n" +
            "  .help         Show this help message\n" +
            "  .vars         List declared variables and values\n" +
            "  .cons         List declared constraints\n" +
            "  .params       List declared parameters\n" +
            "  .sets         List declared sets\n" +
            "  .obj          Show active objective and status\n" +
            "  .reset        Reset the entire session\n" +
            "  .exit / .quit Exit the REPL\n",
        );
        break;
      case ".vars": {
        const vars = Array.from(this.session.model.vars.entries());
        if (vars.length === 0) {
          this.write("No variables declared.\n");
        } else {
          for (const [name, decl] of vars) {
            this.write(`var ${name} (${decl.type})\n`);
          }
        }
        break;
      }
      case ".cons": {
        const cons = Array.from(this.session.model.constraints.entries());
        if (cons.length === 0) {
          this.write("No constraints declared.\n");
        } else {
          for (const [name] of cons) {
            this.write(`subject to ${name};\n`);
          }
        }
        break;
      }
      case ".params": {
        const params = Array.from(this.session.model.params.entries());
        if (params.length === 0) {
          this.write("No parameters declared.\n");
        } else {
          for (const [name] of params) {
            this.write(`param ${name};\n`);
          }
        }
        break;
      }
      case ".sets": {
        const sets = Array.from(this.session.model.sets.entries());
        if (sets.length === 0) {
          this.write("No sets declared.\n");
        } else {
          for (const [name] of sets) {
            this.write(`set ${name};\n`);
          }
        }
        break;
      }
      case ".obj": {
        const res = this.session.getLastResult();
        if (res) {
          this.write(`Objective (${res.problemName}): ${res.objectiveValue} [${res.status}]\n`);
        } else if (this.session.model.objectives.size > 0) {
          const first = this.session.model.objectives.keys().next().value;
          this.write(`Objective: ${first} (unsolved)\n`);
        } else {
          this.write("No objective declared.\n");
        }
        break;
      }
      case ".reset":
        this.session.reset("all");
        this.write("Session reset.\n");
        break;
      case ".exit":
      case ".quit":
        this.write("Exiting AMPL REPL.\n");
        break;
      default:
        this.write(`Unknown command '${cmd}'. Type .help for a list of commands.\n`);
    }
  }
}

export async function startAmplRepl(options?: AmplReplOptions): Promise<AmplRepl> {
  const repl = new AmplRepl(options);
  await repl.run();
  return repl;
}
