// SPDX-License-Identifier: AGPL-3.0-or-later

import { createInterface } from "node:readline";
import type { CommandModule } from "yargs";
import { getApiUrl, saveApiUrl, saveToken } from "../util/auth.js";

interface LoginArgs {
  email?: string;
  password?: string;
  token?: string;
  otp?: string;
  registry?: string;
}

function prompt(question: string, hidden = false): Promise<string> {
  if (hidden && process.stdin.isTTY) {
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
          process.exit(1);
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
      resolve(answer.trim());
    });
  });
}

export const Login: CommandModule<{}, LoginArgs> = {
  command: "login",
  describe: "Log in to the ModelScript Registry",
  builder: (yargs) => {
    return yargs
      .option("email", {
        alias: "e",
        description: "Email address or username",
        type: "string",
      })
      .option("password", {
        alias: "p",
        description: "Password (recommended only in non-interactive/automated environments)",
        type: "string",
      })
      .option("token", {
        alias: "t",
        description: "Authenticate directly with a personal access token or API token",
        type: "string",
      })
      .option("otp", {
        description: "Two-factor authentication code (TOTP or backup recovery code)",
        type: "string",
      })
      .option("registry", {
        alias: "r",
        description: "Registry API URL",
        type: "string",
      }) as any;
  },
  handler: async (args) => {
    const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
    if (args.registry) {
      saveApiUrl(apiUrl);
    }

    // Direct token authentication
    if (args.token) {
      try {
        const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
          headers: {
            Authorization: `Bearer ${args.token}`,
            Accept: "application/json",
          },
        });

        if (!res.ok) {
          console.error(`Invalid token: ${res.statusText}`);
          process.exit(1);
        }

        const data = (await res.json()) as any;
        saveToken(args.token);
        console.log(`✅ Logged in as ${data.user.username} (${data.user.email})`);
        console.log(`🌐 Registry: ${apiUrl}`);
        return;
      } catch (e) {
        console.error(`Error connecting to registry at ${apiUrl}: ${(e as Error).message}`);
        process.exit(1);
      }
    }

    // Interactive credentials prompt
    const email = args.email || (await prompt("Email: "));
    const password = args.password || (await prompt("Password: ", true));

    if (!email || !password) {
      console.error("Email and password are required.");
      process.exit(1);
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        console.error(`Login failed: ${data.error || res.statusText}`);
        process.exit(1);
      }

      const data = (await res.json()) as any;

      // Handle 2FA challenge if required
      if (data.requires2FA) {
        console.log("🔐 Two-Factor Authentication required.");
        const code = args.otp || (await prompt("Enter 6-digit authenticator or backup recovery code: "));
        if (!code) {
          console.error("Authentication code required.");
          process.exit(1);
        }

        const challengeRes = await fetch(`${apiUrl}/api/v1/auth/2fa/challenge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tempToken: data.tempToken, code }),
        });

        if (!challengeRes.ok) {
          const challengeData = (await challengeRes.json().catch(() => ({}))) as any;
          console.error(`Verification failed: ${challengeData.error || challengeRes.statusText}`);
          process.exit(1);
        }

        const sessionData = (await challengeRes.json()) as any;
        saveToken(sessionData.token);
        console.log(`✅ Logged in as ${sessionData.user.username} (${sessionData.user.email})`);
        console.log(`🌐 Registry: ${apiUrl}`);
        return;
      }

      saveToken(data.token);
      console.log(`✅ Logged in as ${data.user.username} (${data.user.email})`);
      console.log(`🌐 Registry: ${apiUrl}`);
    } catch (e) {
      console.error(`Error connecting to registry at ${apiUrl}: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};
