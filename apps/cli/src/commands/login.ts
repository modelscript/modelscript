// SPDX-License-Identifier: AGPL-3.0-or-later

import { createInterface } from "node:readline";
import type { CommandModule } from "yargs";
import { saveToken } from "../util/auth.js";

interface LoginArgs {
  email?: string;
}

function prompt(question: string, hidden = false): Promise<string> {
  if (hidden && process.stdin.isTTY) {
    // Handle hidden input without readline (which would echo characters)
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    return new Promise((resolve) => {
      let input = "";
      const onData = (ch: string) => {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input);
        } else if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.exit();
        } else if (ch === "\u007f" || ch === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += ch;
          process.stdout.write("*");
        }
      };
      stdin.on("data", onData);
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Login: CommandModule<{}, LoginArgs> = {
  command: "login",
  describe: "Log in to the ModelScript Registry",
  builder: (yargs) => {
    return yargs.option("email", {
      alias: "e",
      description: "Email address",
      type: "string",

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  },
  handler: async (args) => {
    const email = args.email || (await prompt("Email: "));
    const password = await prompt("Password: ", true);

    if (!email || !password) {
      console.error("Email and password are required.");
      process.exit(1);
    }

    const API_URL = process.env.MODELSCRIPT_API_URL || "http://localhost:3000";

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json().catch(() => ({}))) as any;
        console.error(`Login failed: ${data.error || res.statusText}`);
        process.exit(1);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      saveToken(data.token);
      console.log(`✅ Logged in as ${data.user.username}`);
    } catch (e) {
      console.error(`Error connecting to registry: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};
