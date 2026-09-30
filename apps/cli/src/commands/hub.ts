// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CommandModule } from "yargs";

export type HubProfile = "standalone" | "internal" | "federated";

export interface HubInitArgs {
  profile?: string;
  dir?: string;
  port?: number;
  domain?: string;
  adminUser?: string;
  adminEmail?: string;
  adminPass?: string;
  yes?: boolean;
}

function prompt(question: string, defaultValue = ""): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const displayPrompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(displayPrompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

export function generateEnvConfig(options: {
  profile: HubProfile;
  port: number;
  domain: string;
  adminUser: string;
  adminEmail: string;
  adminPass: string;
  jwtSecret: string;
}): string {
  const lines: string[] = [
    `# ModelScript Hub Configuration (${options.profile.toUpperCase()} profile)`,
    `# Generated at ${new Date().toISOString()}`,
    ``,
    `NODE_ENV=production`,
    `PORT=${options.port}`,
    `JWT_SECRET=${options.jwtSecret}`,
    ``,
    `# Initial Instance Administrator Provisioning`,
    `ADMIN_INIT_USERNAME=${options.adminUser}`,
    `ADMIN_INIT_EMAIL=${options.adminEmail}`,
    `ADMIN_INIT_PASSWORD=${options.adminPass}`,
    ``,
  ];

  if (options.profile === "standalone") {
    lines.push(
      `# Standalone Sandbox Defaults`,
      `FEDERATION_MODE=disabled`,
      `EMAIL_DRIVER=console`,
      `PUBLIC_URL=http://localhost:${options.port}`,
      `SEED_EXAMPLES=true`,
    );
  } else if (options.profile === "internal") {
    lines.push(
      `# Corporate Intranet Defaults`,
      `FEDERATION_MODE=disabled`,
      `EMAIL_DRIVER=smtp`,
      `PUBLIC_URL=http://${options.domain || "modelscript.internal"}:${options.port}`,
      `# OIDC / SAML SSO Integration`,
      `# OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0`,
      `# OIDC_CLIENT_ID=your-oidc-client-id`,
      `# OIDC_CLIENT_SECRET=your-oidc-client-secret`,
      `# OIDC_ADMIN_GROUP=Engineering-Admins`,
      `# SMTP Relay`,
      `# SMTP_HOST=smtp.internal.company.com`,
      `# SMTP_PORT=587`,
    );
  } else if (options.profile === "federated") {
    lines.push(
      `# Public Fediverse Node Defaults`,
      `FEDERATION_MODE=mesh`,
      `PUBLIC_DOMAIN=${options.domain}`,
      `PUBLIC_URL=https://${options.domain}`,
      `EMAIL_DRIVER=smtp`,
      `# Cloudflare Turnstile bot protection`,
      `# TURNSTILE_SECRET_KEY=0x4AAAAAA...`,
      `# SMTP Outbound`,
      `# SMTP_HOST=smtp.sendgrid.net`,
      `# SMTP_PORT=587`,
    );
  }

  return lines.join("\n") + "\n";
}

export const HubInit: CommandModule<{}, HubInitArgs> = {
  command: "init",
  describe: "Initialize a ModelScript hub node with tailored profile configurations",
  builder: (yargs) => {
    return yargs
      .option("profile", {
        alias: "p",
        description: "Deployment profile: 'standalone' | 'internal' | 'federated'",
        choices: ["standalone", "internal", "federated"],
        type: "string",
      })
      .option("dir", {
        alias: "d",
        description: "Target directory to write configuration files into",
        type: "string",
        default: ".",
      })
      .option("port", {
        description: "API server port",
        type: "number",
        default: 3000,
      })
      .option("domain", {
        description: "Public domain for federated or internal node",
        type: "string",
      })
      .option("admin-user", {
        description: "Initial administrator username",
        type: "string",
        default: "admin",
      })
      .option("admin-email", {
        description: "Initial administrator email address",
        type: "string",
        default: "admin@modelscript.local",
      })
      .option("admin-pass", {
        description: "Initial administrator password",
        type: "string",
      })
      .option("yes", {
        alias: "y",
        description: "Skip interactive prompts and accept all defaults",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const isInteractive = !args.yes && process.stdin.isTTY;
    const targetDir = path.resolve(args.dir || ".");

    console.log("\n🚀 ModelScript Hub Node Deployment Initializer\n");

    let profile: HubProfile = (args.profile as HubProfile) || "standalone";
    if (isInteractive && !args.profile) {
      console.log("Select a deployment profile:");
      console.log("  1) standalone - Local workstation sandbox, zero-ops SQLite, console mailer");
      console.log("  2) internal   - Corporate intranet, OIDC/SSO integration, air-gapped security");
      console.log("  3) federated  - Public Fediverse node, auto-TLS Caddy, ActivityPub S2S federation");
      const answer = await prompt("Choose profile (1-3)", "1");
      if (answer === "2" || answer.toLowerCase() === "internal") profile = "internal";
      else if (answer === "3" || answer.toLowerCase() === "federated") profile = "federated";
      else profile = "standalone";
    }

    let port = args.port || 3000;
    if (isInteractive) {
      const portInput = await prompt("API server port", String(port));
      port = parseInt(portInput, 10) || 3000;
    }

    // Check port availability
    const portFree = await checkPortFree(port);
    if (!portFree) {
      console.warn(`⚠️  Warning: Port ${port} is currently in use by another process.`);
    }

    let domain = args.domain || (profile === "federated" ? "hub.example.com" : "localhost");
    if (isInteractive && profile !== "standalone" && !args.domain) {
      domain = await prompt("Node domain name", domain);
    }

    const adminUser = args.adminUser || "admin";
    let adminEmail = args.adminEmail || `admin@${domain}`;
    if (isInteractive && !args.adminEmail) {
      adminEmail = await prompt("Administrator email", adminEmail);
    }

    let adminPass = args.adminPass;
    if (!adminPass) {
      adminPass = isInteractive ? await prompt("Administrator password (leave blank to auto-generate)", "") : "";
      if (!adminPass) {
        adminPass = crypto.randomBytes(12).toString("base64url");
      }
    }

    const jwtSecret = crypto.randomBytes(32).toString("hex");

    const envContent = generateEnvConfig({
      profile,
      port,
      domain,
      adminUser,
      adminEmail,
      adminPass,
      jwtSecret,
    });

    const envPath = path.join(targetDir, ".env");
    if (existsSync(envPath) && !args.yes) {
      if (isInteractive) {
        const overwrite = await prompt(".env already exists. Overwrite? (y/N)", "N");
        if (overwrite.toLowerCase() !== "y") {
          console.log("Initialization aborted.");
          return;
        }
      }
    }

    writeFileSync(envPath, envContent, "utf-8");
    console.log(`\n✅ Generated configuration in ${envPath}`);
    console.log(`   Profile:           ${profile}`);
    console.log(`   Admin User:        ${adminUser}`);
    console.log(`   Admin Email:       ${adminEmail}`);
    console.log(`   Admin Password:    ${adminPass}`);
    console.log(`   JWT Secret:        [Configured securely: 256-bit]`);

    console.log("\n🚀 Next Steps to Boot Your Node:");
    if (profile === "federated") {
      console.log("  1. Review .env and configure DNS pointing to this server");
      console.log(`  2. docker compose --profile ${profile} up -d`);
      console.log(`  3. Access via https://${domain}`);
    } else {
      console.log(`  1. docker compose --profile ${profile} up -d`);
      console.log(`     (or run natively: npm run start --workspace=@modelscript/api)`);
      console.log(`  2. Access Web Portal at http://localhost:${port + 1 || 3001}`);
      console.log(`  3. Access API at http://localhost:${port}`);
    }
    console.log("");
  },
};

export const HubStatus: CommandModule<{}, { url?: string }> = {
  command: "status [url]",
  describe: "Query the compliance and health readiness probe of a ModelScript node",
  builder: (yargs) => {
    return yargs.positional("url", {
      description: "Base URL of the ModelScript hub (defaults to http://localhost:3000)",
      type: "string",
      default: "http://localhost:3000",
    }) as any;
  },
  handler: async (args) => {
    const baseUrl = (args.url || "http://localhost:3000").replace(/\/+$/, "");
    const probeUrl = `${baseUrl}/api/v1/compliance/readiness`;

    console.log(`\n🔍 Probing ModelScript Hub at ${probeUrl}...\n`);
    try {
      const response = await fetch(probeUrl);
      const data = (await response.json()) as any;

      console.log(
        `Status:           ${data.status === "ready" ? "🟢 READY" : "🟡 " + (data.status || "UNKNOWN").toUpperCase()}`,
      );
      console.log(`Environment:      ${data.environment}`);
      console.log(`Timestamp:        ${data.timestamp}`);
      console.log("\nCompliance & Controls:");
      console.log(
        `  Export Controls:   ${data.checks?.exportControls?.status} (${data.checks?.exportControls?.sanctionedCountriesCount} countries, ${data.checks?.exportControls?.sanctionedRegionsCount} regions)`,
      );
      console.log(
        `  GeoIP Database:    ${data.checks?.services?.geolocation?.dbLoaded ? "Active (.mmdb)" : "Offline Subnet Fallback"}`,
      );
      console.log(`  Mailer Transport:  ${data.checks?.services?.mailer?.driver}`);
      console.log(`  JWT Configuration: ${data.checks?.secrets?.jwtSecretIsSecure ? "Secure" : "Insecure/Default"}`);
      console.log(
        `  Bot Mitigation:    ${data.checks?.secrets?.turnstileConfigured ? "Turnstile Configured" : "None/Disabled"}`,
      );
      console.log(`  Admin User:        ${data.checks?.services?.database?.hasAdminUser ? "Provisioned" : "Missing"}`);
      console.log("");
    } catch (err: any) {
      console.error(`❌ Failed to connect to node at ${baseUrl}: ${err.message}`);
      process.exit(1);
    }
  },
};

export const Hub: CommandModule = {
  command: "hub <command>",
  describe: "Manage, configure, and inspect ModelScript hub nodes",
  builder: (yargs) => {
    return yargs
      .command(HubInit)
      .command(HubStatus)
      .demandCommand(1, "Please specify a hub command (init, status)") as any;
  },
  handler: () => {},
};
