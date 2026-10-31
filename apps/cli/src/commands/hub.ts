// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Argv, CommandModule } from "yargs";

export type HubProfile = "standalone" | "internal" | "federated" | "federated-lite" | "corporate" | "flagship";

export interface HubInitArgs {
  profile?: string | undefined;
  dir?: string | undefined;
  port?: number | undefined;
  domain?: string | undefined;
  adminUser?: string | undefined;
  adminEmail?: string | undefined;
  adminPass?: string | undefined;
  tunnelToken?: string | undefined;
  yes?: boolean | undefined;
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
    server.unref();
    server.once("error", () => {
      try {
        server.close();
      } catch {}
      resolve(false);
    });
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
  tunnelToken?: string | undefined;
}): string {
  const lines: string[] = [
    `# ModelScript Hub Configuration (${options.profile.toUpperCase()} profile)`,
    `# Generated at ${new Date().toISOString()}`,
    ``,
    `NODE_ENV=production`,
    `PORT=${options.port}`,
    `JWT_SECRET=${options.jwtSecret}`,
    ``,
    `# Initial Instance Administrator Provisioning & Headless Preinstall`,
    `AUTO_SEED_ADMIN=true`,
    `ADMIN_INIT_USERNAME=${options.adminUser}`,
    `ADMIN_INIT_EMAIL=${options.adminEmail}`,
    `ADMIN_INIT_PASSWORD=${options.adminPass}`,
    ``,
  ];

  if (options.profile === "standalone") {
    lines.push(
      `# Standalone Sandbox Defaults`,
      `DEPLOYMENT_PRESET=tier0_local_dev`,
      `MSX_FEDERATION_MODE=disabled`,
      `FEDERATION_MODE=disabled`,
      `EMAIL_DRIVER=console`,
      `PUBLIC_URL=http://localhost:${options.port}`,
      `SEED_EXAMPLES=true`,
    );
  } else if (options.profile === "internal" || options.profile === "corporate") {
    lines.push(
      `# Corporate Intranet Defaults`,
      `DEPLOYMENT_PRESET=tier2_corporate`,
      `MSX_FEDERATION_MODE=disabled`,
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
  } else if (options.profile === "flagship") {
    lines.push(
      `# Public Flagship Hub Defaults (ansatz.social + modelscript.org)`,
      `DEPLOYMENT_PRESET=tier3_flagship`,
      `MSX_FEDERATION_MODE=open`,
      `FEDERATION_MODE=open`,
      `PUBLIC_DOMAIN=${options.domain || "ansatz.social"}`,
      `DOCS_DOMAIN=modelscript.org`,
      `PUBLIC_URL=https://${options.domain || "ansatz.social"}`,
      `EMAIL_DRIVER=smtp`,
      `# Cloudflare Zero Trust Tunnel (Zero Open Inbound Ports)`,
      options.tunnelToken ? `CLOUDFLARE_TUNNEL_TOKEN=${options.tunnelToken}` : `# CLOUDFLARE_TUNNEL_TOKEN=eyJh...`,
      `# Turnstile & SMTP`,
      `# TURNSTILE_SECRET_KEY=0x4AAAAAA...`,
      `# SENDGRID_API_KEY=SG...`,
    );
  } else if (options.profile === "federated" || options.profile === "federated-lite") {
    lines.push(
      `# Public Fediverse Node Defaults`,
      `DEPLOYMENT_PRESET=tier1_federated`,
      `MSX_FEDERATION_MODE=mesh`,
      `FEDERATION_MODE=mesh`,
      `PUBLIC_DOMAIN=${options.domain}`,
      `PUBLIC_URL=https://${options.domain}`,
      `EMAIL_DRIVER=smtp`,
      `# Cloudflare Zero Trust Tunnel (for zero open ports / homelab NAT)`,
      options.tunnelToken ? `CLOUDFLARE_TUNNEL_TOKEN=${options.tunnelToken}` : `# CLOUDFLARE_TUNNEL_TOKEN=eyJh...`,
      `# Cloudflare Turnstile bot protection`,
      `# TURNSTILE_SECRET_KEY=0x4AAAAAA...`,
      `# SMTP Outbound`,
      `# SMTP_HOST=smtp.sendgrid.net`,
      `# SMTP_PORT=587`,
    );
  } else if (options.profile === "airgap") {
    lines.push(
      `# Air-Gapped High-Assurance Appliance Defaults`,
      `DEPLOYMENT_PRESET=tier2_corporate`,
      `AIRGAP_ENFORCED=true`,
      `ENTERPRISE_APPLIANCE=true`,
      `MSX_FEDERATION_MODE=disabled`,
      `FEDERATION_MODE=disabled`,
      `EMAIL_DRIVER=console`,
      `PUBLIC_URL=http://${options.domain || "localhost"}:${options.port}`,
    );
  }

  return lines.join("\n") + "\n";
}

export const generateEnvTemplate = generateEnvConfig;

export const HubInit: CommandModule<{}, HubInitArgs> = {
  command: "init",
  describe: "Initialize a ModelScript hub node with tailored profile configurations",
  builder: (yargs) => {
    return yargs
      .option("profile", {
        alias: "p",
        description:
          "Deployment profile: 'standalone' | 'internal' | 'corporate' | 'federated' | 'federated-lite' | 'flagship'",
        choices: ["standalone", "internal", "corporate", "federated", "federated-lite", "flagship"],
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
      .option("tunnel-token", {
        description: "Cloudflare Tunnel token for zero-open-ports ingress",
        type: "string",
      })
      .option("yes", {
        alias: "y",
        description: "Skip interactive prompts and accept all defaults",
        type: "boolean",
        default: false,
      }) as unknown as Argv<HubInitArgs>;
  },
  handler: async (args) => {
    const isInteractive = !args.yes && process.stdin.isTTY;
    const targetDir = path.resolve(args.dir || ".");

    console.log("\n🚀 ModelScript Hub Node Deployment Initializer\n");

    let profile: HubProfile = (args.profile as HubProfile) || "standalone";
    if (isInteractive && !args.profile) {
      console.log("Select a deployment profile:");
      console.log("  1) standalone     - Local workstation sandbox, zero-ops SQLite, console mailer");
      console.log("  2) federated-lite - Lightweight federated node (embedded SQLite only, low RAM ~1-2GB)");
      console.log("  3) federated      - Full federated node with TimescaleDB telemetry streaming (~4GB RAM)");
      console.log("  4) corporate      - Corporate intranet appliance, OIDC/SSO, air-gapped security");
      console.log("  5) flagship       - Public flagship hub cluster for ansatz.social & modelscript.org");
      const answer = await prompt("Choose profile (1-5)", "1");
      if (answer === "2" || answer.toLowerCase() === "federated-lite") profile = "federated-lite";
      else if (answer === "3" || answer.toLowerCase() === "federated") profile = "federated";
      else if (answer === "4" || answer.toLowerCase() === "corporate" || answer.toLowerCase() === "internal")
        profile = "corporate";
      else if (answer === "5" || answer.toLowerCase() === "flagship") profile = "flagship";
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

    let domain =
      args.domain ||
      (profile === "federated" || profile === "federated-lite"
        ? "hub.example.com"
        : profile === "flagship"
          ? "ansatz.social"
          : "localhost");
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
      tunnelToken: args.tunnelToken,
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
    if (args.tunnelToken) {
      console.log(`   Cloudflare Tunnel: [Configured token-driven ingress (zero open ports)]`);
    }

    console.log("\n🚀 Next Steps to Boot Your Node:");
    if (profile === "flagship") {
      console.log("  1. Review .env and ensure Cloudflare Tunnel token and domains are configured");
      console.log(
        "  2. docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env --profile flagship up -d",
      );
      console.log("  3. Access Web Platform at https://ansatz.social (Docs at https://modelscript.org)");
    } else if (profile === "federated" || profile === "federated-lite") {
      console.log("  1. Review .env and ensure domain DNS or Cloudflare Tunnel is configured");
      console.log(`  2. docker compose --profile ${profile} up -d`);
      console.log(`  3. Access via https://${domain}`);
    } else if (profile === "corporate" || profile === "internal") {
      console.log("  1. Review .env and configure allowed email domains or OIDC parameters");
      console.log("  2. docker compose --profile corporate up -d");
      console.log(`  3. Access via http://${domain}:${port}`);
    } else {
      console.log("  1. docker compose --profile standalone up -d");
      console.log("     (or run natively: npm run start --workspace=@modelscript/api)");
      console.log(`  2. Access Web Portal at http://localhost:${port + 1 || 3001}`);
      console.log(`  3. Access API at http://localhost:${port}`);
    }
    console.log("");
  },
};

interface HubReadinessProbe {
  status?: string | undefined;
  environment?: string | undefined;
  timestamp?: string | undefined;
  checks?:
    | {
        exportControls?:
          | {
              status?: string | undefined;
              sanctionedCountriesCount?: number | undefined;
              sanctionedRegionsCount?: number | undefined;
            }
          | undefined;
        services?:
          | {
              geolocation?: { dbLoaded?: boolean | undefined } | undefined;
              mailer?: { driver?: string | undefined } | undefined;
              database?: { hasAdminUser?: boolean | undefined } | undefined;
            }
          | undefined;
        secrets?:
          | {
              jwtSecretIsSecure?: boolean | undefined;
              turnstileConfigured?: boolean | undefined;
            }
          | undefined;
      }
    | undefined;
}

export const HubStatus: CommandModule<{}, { url?: string | undefined }> = {
  command: "status [url]",
  describe: "Query the compliance and health readiness probe of a ModelScript node",
  builder: (yargs) => {
    return yargs.positional("url", {
      description: "Base URL of the ModelScript hub (defaults to http://localhost:3000)",
      type: "string",
      default: "http://localhost:3000",
    }) as unknown as Argv<{ url?: string | undefined }>;
  },
  handler: async (args) => {
    const baseUrl = (args.url || "http://localhost:3000").replace(/\/+$/, "");
    const probeUrl = `${baseUrl}/api/v1/compliance/readiness`;

    console.log(`\n🔍 Probing ModelScript Hub at ${baseUrl}...\n`);
    try {
      const response = await fetch(probeUrl);
      if (response.ok) {
        const data = (await response.json()) as HubReadinessProbe;
        if (data && data.checks) {
          console.log(
            `Status:           ${data.status === "ready" ? "🟢 READY" : "🟡 " + (data.status || "UNKNOWN").toUpperCase()}`,
          );
          console.log(`Environment:      ${data.environment || "production"}`);
          console.log(`Timestamp:        ${data.timestamp || new Date().toISOString()}`);
          console.log("\nCompliance & Controls:");
          console.log(
            `  Export Controls:   ${data.checks.exportControls?.status ?? "active"} (${data.checks.exportControls?.sanctionedCountriesCount ?? 0} countries, ${data.checks.exportControls?.sanctionedRegionsCount ?? 0} regions)`,
          );
          console.log(
            `  GeoIP Database:    ${data.checks.services?.geolocation?.dbLoaded ? "Active (.mmdb)" : "Offline Subnet Fallback"}`,
          );
          console.log(`  Mailer Transport:  ${data.checks.services?.mailer?.driver ?? "console"}`);
          console.log(`  JWT Configuration: ${data.checks.secrets?.jwtSecretIsSecure ? "Secure" : "Insecure/Default"}`);
          console.log(
            `  Bot Mitigation:    ${data.checks.secrets?.turnstileConfigured ? "Turnstile Configured" : "None/Disabled"}`,
          );
          console.log(
            `  Admin User:        ${data.checks.services?.database?.hasAdminUser ? "Provisioned" : "Missing"}`,
          );
          console.log("");
          return;
        }
      }

      // Community Edition or fallback readiness probe via /health/ready
      const readyRes = await fetch(`${baseUrl}/health/ready`);
      if (readyRes.ok || readyRes.status === 503) {
        const readyData = (await readyRes.json()) as {
          status?: string;
          ready?: boolean;
          edition?: string;
          instanceName?: string;
          federationMode?: string;
          maintenanceLevel?: string;
          database?: {
            open?: boolean;
            schemaVersion?: string | null;
            pendingMigrations?: number;
            checksumMatch?: boolean;
          };
          mqtt?: string;
          historian?: string;
          timestamp?: string;
        };

        console.log(
          `Status:             ${readyData.ready || readyData.status === "ready" ? "🟢 READY" : "🟡 " + (readyData.status || "DEGRADED").toUpperCase()}`,
        );
        console.log(`Edition:            ${(readyData.edition || "ce").toUpperCase()}`);
        console.log(`Instance:           ${readyData.instanceName || "Ansatz"}`);
        console.log(`Federation Mode:    ${readyData.federationMode || "open"}`);
        console.log(`Maintenance Mode:   ${readyData.maintenanceLevel || "off"}`);
        console.log(`Timestamp:          ${readyData.timestamp || new Date().toISOString()}`);
        console.log("\nSubsystem Readiness:");
        console.log(`  SQLite Database:  ${readyData.database?.open ? "Connected" : "Closed"}`);
        console.log(`  Schema Version:   ${readyData.database?.schemaVersion || "None"}`);
        console.log(`  Pending Migs:     ${readyData.database?.pendingMigrations ?? 0}`);
        console.log(`  Checksum Match:   ${readyData.database?.checksumMatch !== false ? "Verified" : "Mismatch"}`);
        console.log(`  MQTT Broker:      ${readyData.mqtt || "unavailable"}`);
        console.log(`  Historian Pool:   ${readyData.historian || "unavailable"}`);
        console.log("");
        return;
      }

      const healthRes = await fetch(`${baseUrl}/health`);
      const healthData = (await healthRes.json()) as {
        status?: string;
        edition?: string;
        mqtt?: string;
        historian?: string;
      };
      console.log(
        `Status:           ${healthData.status === "ok" ? "🟢 READY" : "🟡 " + (healthData.status || "UNKNOWN").toUpperCase()}`,
      );
      console.log(`Edition:          ${(healthData.edition || "ce").toUpperCase()}`);
      console.log(`MQTT Broker:      ${healthData.mqtt || "unavailable"}`);
      console.log(`Historian Pool:   ${healthData.historian || "unavailable"}`);
      console.log("");
    } catch (err: unknown) {
      console.error(`❌ Failed to connect to node at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  },
};

export interface HubUpgradeArgs {
  url?: string | undefined;
  tag?: string | undefined;
  profile?: string | undefined;
  composeDir?: string | undefined;
  dryRun?: boolean | undefined;
  token?: string | undefined;
}

export async function runHubUpgrade(args: HubUpgradeArgs): Promise<{
  success: boolean;
  rolledBack: boolean;
  previousTag: string;
  targetTag: string;
  backupFileName: string | null;
  composeCommand: string;
}> {
  const baseUrl = (args.url || process.env["MSX_HUB_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  const targetTag = (args.tag || "latest").trim();
  const profile = (args.profile || "federated-lite").trim();
  const composeDir = path.resolve(process.cwd(), args.composeDir || ".");
  const dryRun = Boolean(args.dryRun);
  const authToken = (args.token || process.env["MSX_TOKEN"] || "").trim();

  // Detect previous IMAGE_TAG from .env in composeDir or environment
  let previousTag = process.env["IMAGE_TAG"] || "latest";
  const envPath = path.join(composeDir, ".env");
  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, "utf8");
      const match = envContent.match(/^IMAGE_TAG=(.+)$/m);
      if (match?.[1]) {
        previousTag = match[1].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      // Ignore read errors
    }
  }

  console.log(`\n🚀 Ansatz / ModelScript Hub Rolling Upgrade Orchestrator`);
  console.log(`   Target Node:   ${baseUrl}`);
  console.log(`   Compose Dir:   ${composeDir}`);
  console.log(`   Profile:       ${profile}`);
  console.log(`   Version Tag:   ${previousTag} -> ${targetTag}`);
  console.log(`   Mode:          ${dryRun ? "DRY RUN (no mutations)" : "LIVE UPGRADE"}\n`);

  // Step 1: Pre-upgrade readiness probe via /health/ready
  let preUpgradeReady = false;
  try {
    const readyRes = await fetch(`${baseUrl}/health/ready`);
    if (readyRes.ok) {
      preUpgradeReady = true;
      console.log(`✅ [1/4] Pre-upgrade readiness check passed (/health/ready = 200)`);
    } else {
      const healthRes = await fetch(`${baseUrl}/health`);
      preUpgradeReady = healthRes.ok;
      console.log(`⚠️  [1/4] /health/ready returned ${readyRes.status}; fallback /health=${healthRes.status}`);
    }
  } catch (err) {
    console.warn(
      `⚠️  [1/4] Node at ${baseUrl} not reachable prior to upgrade (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // Step 2: Enter read_only maintenance mode & create pre-upgrade hot backup if token provided
  let backupFileName: string | null = null;
  let maintenanceActivated = false;
  if (authToken) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    };
    if (dryRun) {
      console.log(`🔍 [2/4] [Dry-Run] Would PATCH ${baseUrl}/api/v1/admin/settings { maintenanceLevel: "read_only" }`);
      console.log(`🔍 [2/4] [Dry-Run] Would POST  ${baseUrl}/api/v1/admin/backups  { label: "pre-upgrade" }`);
    } else {
      try {
        const maintRes = await fetch(`${baseUrl}/api/v1/admin/settings`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            maintenanceLevel: "read_only",
            maintenanceMode: true,
          }),
        });
        if (maintRes.ok) {
          maintenanceActivated = true;
          console.log(`🔒 [2/4] Activated read_only maintenance mode on ${baseUrl}`);
        } else {
          console.warn(`⚠️  [2/4] Failed to set read_only maintenance mode (HTTP ${maintRes.status})`);
        }
      } catch (err) {
        console.warn(`⚠️  [2/4] Maintenance mode request failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      try {
        const backupRes = await fetch(`${baseUrl}/api/v1/admin/backups`, {
          method: "POST",
          headers,
          body: JSON.stringify({ label: "pre-upgrade" }),
        });
        if (backupRes.ok) {
          const data = (await backupRes.json()) as {
            backup?: { fileName?: string };
            fileName?: string;
          };
          backupFileName = data.backup?.fileName || data.fileName || "pre-upgrade.db";
          console.log(`💾 [2/4] Created pre-upgrade hot backup: ${backupFileName}`);
        } else {
          console.warn(`⚠️  [2/4] Pre-upgrade backup endpoint returned HTTP ${backupRes.status}`);
        }
      } catch (err) {
        console.warn(
          `⚠️  [2/4] Pre-upgrade backup request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    console.log(`ℹ️  [2/4] No --token / MSX_TOKEN provided; skipping API maintenance lock & hot backup trigger`);
  }

  // Step 3: Docker Compose pull & rolling update
  const composeArgsBase = [
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.prod.yml",
    "--profile",
    profile,
  ];
  const composeCommand = `IMAGE_TAG=${targetTag} docker ${composeArgsBase.join(" ")} pull && IMAGE_TAG=${targetTag} docker ${composeArgsBase.join(" ")} up -d --wait`;

  let rolledBack = false;
  let upgradeSuccess = true;

  if (dryRun) {
    console.log(`🔍 [3/4] [Dry-Run] Would execute in ${composeDir}:`);
    console.log(`         ${composeCommand}`);
  } else {
    console.log(`⚙️  [3/4] Executing rolling update: ${composeCommand}`);
    const envWithTag = { ...process.env, IMAGE_TAG: targetTag };
    const pullRes = spawnSync("docker", [...composeArgsBase, "pull"], {
      cwd: composeDir,
      env: envWithTag,
      stdio: "inherit",
    });
    const upRes =
      pullRes.status === 0
        ? spawnSync("docker", [...composeArgsBase, "up", "-d", "--wait"], {
            cwd: composeDir,
            env: envWithTag,
            stdio: "inherit",
          })
        : pullRes;

    // Verify post-upgrade /health/ready
    let postHealthy = upRes.status === 0;
    if (postHealthy) {
      try {
        const postRes = await fetch(`${baseUrl}/health/ready`);
        postHealthy = postRes.ok;
      } catch {
        postHealthy = false;
      }
    }

    if (!postHealthy) {
      upgradeSuccess = false;
      rolledBack = true;
      console.error(`❌ [3/4] Post-upgrade readiness check failed! Rolling back to IMAGE_TAG=${previousTag}...`);
      const rollbackEnv = { ...process.env, IMAGE_TAG: previousTag };
      spawnSync("docker", [...composeArgsBase, "up", "-d", "--wait"], {
        cwd: composeDir,
        env: rollbackEnv,
        stdio: "inherit",
      });
    } else {
      console.log(`✅ [3/4] Containers updated and post-upgrade /health/ready verified`);
    }
  }

  // Step 4: Restore maintenance mode to off & print summary table
  if (authToken && (maintenanceActivated || dryRun)) {
    if (dryRun) {
      console.log(`🔍 [4/4] [Dry-Run] Would PATCH ${baseUrl}/api/v1/admin/settings { maintenanceLevel: "off" }`);
    } else {
      try {
        await fetch(`${baseUrl}/api/v1/admin/settings`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            maintenanceLevel: "off",
            maintenanceMode: false,
          }),
        });
        console.log(`🔓 [4/4] Restored maintenance mode to 'off'`);
      } catch (err) {
        console.warn(
          `⚠️  [4/4] Could not automatically clear maintenance mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    console.log(`✅ [4/4] Upgrade workflow finalized`);
  }

  console.log(`\n┌──────────────────────────┬────────────────────────────────────────────────┐`);
  console.log(`│ Phase                    │ Result                                         │`);
  console.log(`├──────────────────────────┼────────────────────────────────────────────────┤`);
  console.log(`│ Pre-Upgrade Readiness    │ ${(preUpgradeReady ? "READY" : "UNREACHABLE / SKIPPED").padEnd(46)} │`);
  console.log(
    `│ Hot Backup Snapshot      │ ${(backupFileName || (dryRun && authToken ? "DRY-RUN (pre-upgrade)" : "SKIPPED")).padEnd(46)} │`,
  );
  console.log(`│ Target Image Tag         │ ${targetTag.padEnd(46)} │`);
  console.log(`│ Rollback Triggered       │ ${(rolledBack ? `YES -> ${previousTag}` : "NO").padEnd(46)} │`);
  console.log(`│ Final Status             │ ${(upgradeSuccess ? "SUCCESS" : "ROLLED BACK").padEnd(46)} │`);
  console.log(`└──────────────────────────┴────────────────────────────────────────────────┘\n`);

  return {
    success: upgradeSuccess,
    rolledBack,
    previousTag,
    targetTag,
    backupFileName,
    composeCommand,
  };
}

export const HubUpgrade: CommandModule<object, HubUpgradeArgs> = {
  command: "upgrade [url]",
  describe: "Orchestrate a safe zero-downtime rolling upgrade with pre-upgrade backup and automatic rollback",
  builder: (yargs: Argv): Argv<HubUpgradeArgs> => {
    return yargs
      .positional("url", {
        type: "string",
        describe: "Base URL of the Ansatz/ModelScript hub node",
        default: "http://localhost:3000",
      })
      .option("tag", {
        type: "string",
        describe: "Target Docker IMAGE_TAG to deploy",
        default: "latest",
      })
      .option("profile", {
        type: "string",
        describe: "Docker Compose profile to run",
        default: "federated-lite",
      })
      .option("compose-dir", {
        type: "string",
        describe: "Directory containing docker-compose.yml and docker-compose.prod.yml",
        default: ".",
      })
      .option("dry-run", {
        type: "boolean",
        describe: "Print upgrade steps and compose commands without mutating state",
        default: false,
      })
      .option("token", {
        type: "string",
        describe: "Admin Bearer JWT token for maintenance lock and hot backup (or set MSX_TOKEN)",
      });
  },
  handler: async (args) => {
    const result = await runHubUpgrade(args);
    if (!result.success) {
      process.exit(1);
    }
  },
};

export interface HubAccountsArgs {
  action?: string | undefined;
  username?: string | undefined;
  userId?: number | undefined;
  role?: string | undefined;
  status?: string | undefined;
  days?: number | undefined;
  url?: string | undefined;
  token?: string | undefined;
}

export async function runHubAccounts(args: HubAccountsArgs): Promise<Record<string, unknown>> {
  const baseUrl = (args.url || process.env["MSX_HUB_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  const token = (args.token || process.env["MSX_TOKEN"] || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const action = (args.action || "list").toLowerCase();
  if (action === "prune") {
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/prune`, {
      method: "POST",
      headers,
      body: JSON.stringify({ remoteAccountDays: args.days ?? 90 }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`✅ Pruned remote accounts:`, data);
    return data;
  }

  if (action === "modify") {
    let targetId = args.userId;
    if (!targetId && args.username) {
      const listRes = await fetch(`${baseUrl}/api/v1/admin/users?q=${encodeURIComponent(args.username)}`, {
        headers,
      });
      const listData = (await listRes.json()) as { users?: Array<{ id: number; username: string }> };
      const match = listData.users?.find((u) => u.username.toLowerCase() === args.username!.toLowerCase());
      targetId = match?.id;
    }
    if (!targetId) {
      throw new Error(`Could not resolve user '${args.username || args.userId}'`);
    }
    const patchRes = await fetch(`${baseUrl}/api/v1/admin/users/${targetId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        ...(args.role ? { role: args.role } : {}),
        ...(args.status ? { status: args.status } : {}),
      }),
    });
    const data = (await patchRes.json()) as Record<string, unknown>;
    console.log(`✅ Updated account #${targetId}:`, data);
    return data;
  }

  const listRes = await fetch(
    `${baseUrl}/api/v1/admin/users${args.username ? `?q=${encodeURIComponent(args.username)}` : ""}`,
    { headers },
  );
  const data = (await listRes.json()) as Record<string, unknown>;
  console.log(`📋 Accounts on ${baseUrl}:`, data);
  return data;
}

export const HubAccounts: CommandModule<object, HubAccountsArgs> = {
  command: "accounts <action> [username]",
  describe: "Manage local and remote accounts (tootctl accounts equivalent: list, modify, prune)",
  builder: (yargs: Argv): Argv<HubAccountsArgs> => {
    return yargs
      .positional("action", {
        type: "string",
        choices: ["list", "modify", "prune"],
        describe: "Account operation to execute",
      })
      .positional("username", {
        type: "string",
        describe: "Username to inspect or modify",
      })
      .option("user-id", {
        type: "number",
        describe: "Explicit numeric user ID",
      })
      .option("role", {
        type: "string",
        choices: ["user", "moderator", "auditor", "admin"],
        describe: "Assign staff role",
      })
      .option("status", {
        type: "string",
        choices: ["active", "frozen", "suspended"],
        describe: "Assign account status",
      })
      .option("days", {
        type: "number",
        default: 90,
        describe: "Inactivity window in days when pruning unreferenced remote accounts",
      })
      .option("url", {
        type: "string",
        default: "http://localhost:3000",
        describe: "Base URL of the hub node",
      })
      .option("token", {
        type: "string",
        describe: "Admin Bearer JWT token (or set MSX_TOKEN)",
      });
  },
  handler: async (args) => {
    await runHubAccounts(args);
  },
};

export interface HubDomainsArgs {
  action?: string | undefined;
  domain?: string | undefined;
  tier?: "allow" | "silence" | "suspend" | undefined;
  reason?: string | undefined;
  rejectMedia?: boolean | undefined;
  rejectReports?: boolean | undefined;
  obfuscate?: boolean | undefined;
  url?: string | undefined;
  token?: string | undefined;
}

export async function runHubDomains(args: HubDomainsArgs): Promise<Record<string, unknown>> {
  const baseUrl = (args.url || process.env["MSX_HUB_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  const token = (args.token || process.env["MSX_TOKEN"] || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const action = (args.action || "list").toLowerCase();
  if (action === "list") {
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/domains`, { headers });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`🌐 Federation domain rules:`, data);
    return data;
  }

  if (!args.domain) {
    throw new Error("A domain argument is required for block/silence/allow/purge");
  }

  if (action === "purge") {
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/circuit-break`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        domain: args.domain,
        tier: args.tier === "silence" ? "silence" : "suspend",
        reason: args.reason || "Purged via msx hub domains CLI",
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`🛑 Circuit-broke and purged domain ${args.domain}:`, data);
    return data;
  }

  const resolvedTier: "allow" | "silence" | "suspend" =
    action === "allow" ? "allow" : action === "silence" ? "silence" : args.tier || "suspend";

  const res = await fetch(`${baseUrl}/api/v1/admin/federation/domains`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      domain: args.domain,
      tier: resolvedTier,
      reason: args.reason,
      rejectMedia: args.rejectMedia,
      rejectReports: args.rejectReports,
      obfuscate: args.obfuscate,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  console.log(`✅ Updated federation policy for ${args.domain} (${resolvedTier}):`, data);
  return data;
}

export const HubDomains: CommandModule<object, HubDomainsArgs> = {
  command: "domains <action> [domain]",
  describe: "Manage federation domain policies (list, block, silence, allow, purge)",
  builder: (yargs: Argv): Argv<HubDomainsArgs> => {
    return yargs
      .positional("action", {
        type: "string",
        choices: ["list", "block", "silence", "allow", "purge"],
        describe: "Domain policy action",
      })
      .positional("domain", {
        type: "string",
        describe: "Target remote domain hostname",
      })
      .option("tier", {
        type: "string",
        choices: ["allow", "silence", "suspend"],
        describe: "Explicit federation tier",
      })
      .option("reason", {
        type: "string",
        describe: "Public or administrative moderation comment",
      })
      .option("reject-media", {
        type: "boolean",
        describe: "Strip and refuse remote media/artifact attachments from this domain",
      })
      .option("reject-reports", {
        type: "boolean",
        describe: "Ignore incoming ActivityPub Flag reports from this domain",
      })
      .option("obfuscate", {
        type: "boolean",
        describe: "Partially obfuscate domain name on public blocklist",
      })
      .option("url", {
        type: "string",
        default: "http://localhost:3000",
        describe: "Base URL of the hub node",
      })
      .option("token", {
        type: "string",
        describe: "Admin Bearer JWT token (or set MSX_TOKEN)",
      }) as unknown as Argv<HubDomainsArgs>;
  },
  handler: async (args) => {
    await runHubDomains(args);
  },
};

export interface HubPruneRemoteArgs {
  days?: number | undefined;
  mediaDays?: number | undefined;
  accountDays?: number | undefined;
  url?: string | undefined;
  token?: string | undefined;
}

export async function runHubPruneRemote(args: HubPruneRemoteArgs): Promise<Record<string, unknown>> {
  const baseUrl = (args.url || process.env["MSX_HUB_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  const token = (args.token || process.env["MSX_TOKEN"] || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${baseUrl}/api/v1/admin/federation/prune`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      remoteContentDays: args.days ?? 90,
      mediaCacheDays: args.mediaDays ?? 14,
      remoteAccountDays: args.accountDays ?? 90,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  console.log(`🧹 Pruned remote federation cache on ${baseUrl}:`, data);
  return data;
}

export const HubPruneRemote: CommandModule<object, HubPruneRemoteArgs> = {
  command: "prune-remote",
  describe:
    "Prune unengaged remote posts, cached remote media, and stale remote actor profiles (tootctl statuses/media remove)",
  builder: (yargs: Argv): Argv<HubPruneRemoteArgs> => {
    return yargs
      .option("days", {
        type: "number",
        default: 90,
        describe: "Retain unengaged remote statuses for N days",
      })
      .option("media-days", {
        type: "number",
        default: 14,
        describe: "Retain cached remote media/artifacts for N days",
      })
      .option("account-days", {
        type: "number",
        default: 90,
        describe: "Retain unreferenced remote accounts for N days",
      })
      .option("url", {
        type: "string",
        default: "http://localhost:3000",
        describe: "Base URL of the hub node",
      })
      .option("token", {
        type: "string",
        describe: "Admin Bearer JWT token (or set MSX_TOKEN)",
      });
  },
  handler: async (args) => {
    await runHubPruneRemote(args);
  },
};

export interface HubRelayArgs {
  action?: string | undefined;
  target?: string | undefined;
  url?: string | undefined;
  token?: string | undefined;
}

export async function runHubRelay(args: HubRelayArgs): Promise<Record<string, unknown>> {
  const baseUrl = (args.url || process.env["MSX_HUB_URL"] || "http://localhost:3000").replace(/\/+$/, "");
  const token = (args.token || process.env["MSX_TOKEN"] || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const action = (args.action || "list").toLowerCase();
  if (action === "list") {
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/relays`, { headers });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`📡 ActivityPub relays:`, data);
    return data;
  }

  if (action === "add") {
    if (!args.target) throw new Error("Relay inbox URL is required");
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/relays`, {
      method: "POST",
      headers,
      body: JSON.stringify({ inboxUrl: args.target }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`✅ Subscribed to relay ${args.target}:`, data);
    return data;
  }

  if (action === "pause" || action === "resume") {
    if (!args.target) throw new Error("Relay ID is required");
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/relays/${encodeURIComponent(args.target)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: action === "pause" ? "paused" : "accepted" }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`✅ Relay ${args.target} state set to ${action === "pause" ? "paused" : "accepted"}:`, data);
    return data;
  }

  if (action === "remove") {
    if (!args.target) throw new Error("Relay ID is required");
    const res = await fetch(`${baseUrl}/api/v1/admin/federation/relays/${encodeURIComponent(args.target)}`, {
      method: "DELETE",
      headers,
    });
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`🗑️  Removed relay ${args.target}:`, data);
    return data;
  }

  throw new Error(`Unknown relay action: ${action}`);
}

export const HubRelay: CommandModule<object, HubRelayArgs> = {
  command: "relay <action> [target]",
  describe: "Manage ActivityPub relay subscriptions (list, add, pause, resume, remove)",
  builder: (yargs: Argv): Argv<HubRelayArgs> => {
    return yargs
      .positional("action", {
        type: "string",
        choices: ["list", "add", "pause", "resume", "remove"],
        describe: "Relay operation",
      })
      .positional("target", {
        type: "string",
        describe: "Relay inbox URL (for add) or numeric relay ID (for pause/resume/remove)",
      })
      .option("url", {
        type: "string",
        default: "http://localhost:3000",
        describe: "Base URL of the hub node",
      })
      .option("token", {
        type: "string",
        describe: "Admin Bearer JWT token (or set MSX_TOKEN)",
      });
  },
  handler: async (args) => {
    await runHubRelay(args);
  },
};

export const Hub: CommandModule = {
  command: "hub <command>",
  aliases: ["ansatz", "node"],
  describe: "Manage, configure, and inspect Ansatz & ModelScript hub nodes",
  builder: (yargs) => {
    return yargs
      .command(HubInit)
      .command(HubStatus)
      .command(HubUpgrade)
      .command(HubAccounts)
      .command(HubDomains)
      .command(HubPruneRemote)
      .command(HubRelay)
      .demandCommand(1, "Please specify a hub command (init, status, upgrade, accounts, domains, prune-remote, relay)");
  },
  handler: () => {},
};
