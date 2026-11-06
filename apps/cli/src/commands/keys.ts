// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";
import { getApiUrl, getAuthHeaders, getToken } from "../util/auth.js";
import { generateEd25519KeyPair, parseSshPublicKey, signChallengePoP } from "../util/signing.js";

interface KeysListArgs {
  user?: string | undefined;
  registry?: string | undefined;
  json?: boolean | undefined;
}

interface KeysGenerateArgs {
  path?: string | undefined;
  comment?: string | undefined;
  force?: boolean | undefined;
  json?: boolean | undefined;
}

interface KeysRegisterArgs {
  pubkey: string;
  key?: string | undefined;
  label?: string | undefined;
  registry?: string | undefined;
  json?: boolean | undefined;
}

interface KeysRevokeArgs {
  id: number;
  registry?: string | undefined;
  json?: boolean | undefined;
}

interface KeysPolicyArgs {
  mode: "strict" | "optional";
  registry?: string | undefined;
  json?: boolean | undefined;
}

export const KeysCommand: CommandModule = {
  command: "keys <action>",
  aliases: ["key"],
  describe: "Manage cryptographic signing keys and verified account identity",
  builder: (yargs) => {
    return yargs
      .command(
        "list",
        "List registered signing keys and verification status",
        (y) =>
          y
            .option("user", {
              alias: "u",
              describe: "Username to query (defaults to currently authenticated user)",
              type: "string",
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args) => {
          await handleListKeys(args as unknown as KeysListArgs);
        },
      )
      .command(
        "generate [path]",
        "Generate a new Ed25519 signing keypair",
        (y) =>
          y
            .positional("path", {
              describe: "Output file path for private key (default: ~/.ssh/id_ed25519_modelscript)",
              type: "string",
            })
            .option("comment", {
              alias: "c",
              describe: "Key comment (e.g. email or username)",
              type: "string",
              default: "modelscript",
            })
            .option("force", {
              alias: "f",
              describe: "Overwrite existing key files if they exist",
              type: "boolean",
              default: false,
            })
            .option("json", {
              describe: "Output key details as JSON",
              type: "boolean",
              default: false,
            }),
        async (args) => {
          await handleGenerateKey(args as unknown as KeysGenerateArgs);
        },
      )
      .command(
        "register <pubkey>",
        "Register an Ed25519 public key and enable Verified Account status",
        (y) =>
          y
            .positional("pubkey", {
              describe: "Path to public key file (.pub) or OpenSSH public key string",
              type: "string",
              demandOption: true,
            })
            .option("key", {
              alias: "k",
              describe: "Path to matching private key file (defaults to pubkey path without .pub)",
              type: "string",
            })
            .option("label", {
              alias: "l",
              describe: "Human-readable label for this key (e.g. 'Laptop')",
              type: "string",
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args) => {
          await handleRegisterKey(args as unknown as KeysRegisterArgs);
        },
      )
      .command(
        "revoke <id>",
        "Revoke a registered signing key",
        (y) =>
          y
            .positional("id", {
              describe: "Signing key numeric ID to revoke",
              type: "number",
              demandOption: true,
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args) => {
          await handleRevokeKey(args as unknown as KeysRevokeArgs);
        },
      )
      .command(
        "policy <mode>",
        "Set signing policy: 'strict' (reject unsigned pushes) or 'optional'",
        (y) =>
          y
            .positional("mode", {
              describe: "Policy mode: 'strict' or 'optional'",
              choices: ["strict", "optional"] as const,
              demandOption: true,
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args) => {
          await handleSetPolicy(args as unknown as KeysPolicyArgs);
        },
      )
      .command(
        "attest",
        "Sign a delegation statement with a master key to authorize a browser device key",
        (y) =>
          y
            .option("master", {
              alias: "m",
              describe: "Path to master OpenSSH private key file (e.g. ~/.ssh/id_ed25519)",
              type: "string",
              demandOption: true,
            })
            .option("device", {
              alias: "d",
              describe: "Fingerprint or multibase of the browser device key to authorize",
              type: "string",
              demandOption: true,
            })
            .option("user-id", {
              describe: "Numeric user ID",
              type: "number",
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args) => {
          await handleAttestKey(
            args as unknown as {
              master: string;
              device: string;
              userId?: number;
              registry?: string;
              json?: boolean;
            },
          );
        },
      )
      .demandCommand(1, "Please specify an action: list, generate, register, revoke, policy, or attest");
  },
  handler: () => {},
};

async function handleAttestKey(args: {
  master: string;
  device: string;
  userId?: number;
  registry?: string;
  json?: boolean;
}): Promise<void> {
  const masterPath = path.resolve(args.master.replace(/^~(?=$|\/|\\)/, homedir()));
  if (!fs.existsSync(masterPath)) {
    console.error(`Master private key file not found: ${masterPath}`);
    process.exit(1);
  }

  const pubPath = `${masterPath}.pub`;
  let masterPubOpenSsh = "";
  if (fs.existsSync(pubPath)) {
    masterPubOpenSsh = fs.readFileSync(pubPath, "utf8").trim();
  }

  let masterFingerprint = "";
  if (masterPubOpenSsh) {
    try {
      const parsed = parseSshPublicKey(masterPubOpenSsh);
      masterFingerprint = parsed.fingerprintSha256;
    } catch {}
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
  const token = getToken();

  let resolvedUserId = args.userId;
  if (!resolvedUserId && token) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/me`, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = (await res.json()) as { user?: { id?: number } };
        resolvedUserId = json.user?.id;
      }
    } catch {}
  }
  if (!resolvedUserId) {
    resolvedUserId = 1;
  }

  const statement = `delegate:${resolvedUserId}:${masterFingerprint || "master"}:${args.device}`;
  const signature = signChallengePoP(statement, masterPath);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          statement,
          signature,
          device: args.device,
          masterFingerprint,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\n✅ Delegation statement signed with master key!`);
  console.log(`Statement:  ${statement}`);
  console.log(`Signature:  ${signature}\n`);
  console.log(`Paste this signature into your browser's "Link to Master Key" dialog, or submit via API.`);
}

async function handleListKeys(args: KeysListArgs): Promise<void> {
  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
  const token = getToken();

  let targetUrl: string;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (args.user) {
    targetUrl = `${apiUrl}/api/v1/users/${encodeURIComponent(args.user)}/signing-keys`;
  } else {
    if (!token) {
      console.error("Not logged in. Provide --user <username> or log in with 'msx login'.");
      process.exit(1);
    }
    // Authenticated user inspects their own keys
    Object.assign(headers, getAuthHeaders());
    // Get current username first
    const meRes = await fetch(`${apiUrl}/api/v1/auth/me`, { headers });
    if (!meRes.ok) {
      console.error("Failed to authenticate. Run 'msx login'.");
      process.exit(1);
    }
    const meJson = (await meRes.json()) as { user?: { username: string } };
    const username = meJson.user?.username;
    if (!username) {
      console.error("Could not resolve current username.");
      process.exit(1);
    }
    targetUrl = `${apiUrl}/api/v1/users/${encodeURIComponent(username)}/signing-keys`;
  }

  const res = await fetch(targetUrl, { headers });
  if (!res.ok) {
    const errText = await res.text();
    if (args.json) {
      console.log(JSON.stringify({ error: errText }, null, 2));
    } else {
      console.error(`Failed to list keys: ${res.status} ${errText}`);
    }
    process.exit(1);
  }

  const data = (await res.json()) as {
    username: string;
    signing_verified: boolean;
    signing_policy_strict: boolean;
    keys: Array<{
      id: number;
      fingerprint_sha256: string;
      algo: string;
      label?: string | null;
      trust_level: string;
      created_at: string;
      public_key_openssh: string;
    }>;
  };

  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`\nAccount: @${data.username}`);
  console.log(`Verified Account:     ${data.signing_verified ? "YES (Badge Active)" : "NO"}`);
  console.log(`Strict Signing Policy: ${data.signing_policy_strict ? "YES (Unsigned pushes rejected)" : "NO"}\n`);

  if (data.keys.length === 0) {
    console.log("No registered signing keys.");
    console.log("Generate one with: msx keys generate");
    return;
  }

  console.log("Registered Signing Keys:");
  for (const k of data.keys) {
    console.log(`  [#${k.id}] ${k.label || "Ed25519 Key"} (${k.algo.toUpperCase()})`);
    console.log(`       Fingerprint: ${k.fingerprint_sha256}`);
    console.log(`       Trust Level: ${k.trust_level}`);
    console.log(`       Registered:  ${new Date(k.created_at).toLocaleString()}`);
    console.log(`       Public Key:  ${k.public_key_openssh.slice(0, 48)}...`);
    console.log();
  }
}

async function handleGenerateKey(args: KeysGenerateArgs): Promise<void> {
  const defaultDir = path.join(homedir(), ".ssh");
  const targetPrivPath = args.path ? path.resolve(args.path) : path.join(defaultDir, "id_ed25519_modelscript");
  const targetPubPath = `${targetPrivPath}.pub`;

  if (!args.force && (fs.existsSync(targetPrivPath) || fs.existsSync(targetPubPath))) {
    console.error(`Key file already exists at ${targetPrivPath}. Use --force to overwrite.`);
    process.exit(1);
  }

  const dir = path.dirname(targetPrivPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const { privateKeyPem, publicKeyOpenSsh, fingerprintSha256 } = generateEd25519KeyPair(args.comment);

  fs.writeFileSync(targetPrivPath, privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(targetPubPath, `${publicKeyOpenSsh}\n`, { mode: 0o644 });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          privateKeyPath: targetPrivPath,
          publicKeyPath: targetPubPath,
          publicKey: publicKeyOpenSsh,
          fingerprint: fingerprintSha256,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("\n✓ Generated new Ed25519 signing keypair:");
  console.log(`  Private key: ${targetPrivPath}`);
  console.log(`  Public key:  ${targetPubPath}`);
  console.log(`  Fingerprint: ${fingerprintSha256}\n`);
  console.log("To register this key with your account and enable Verified status, run:");
  console.log(`  msx keys register "${targetPubPath}"\n`);
}

async function handleRegisterKey(args: KeysRegisterArgs): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error("Not logged in. Run 'msx login' to authenticate before registering a key.");
    process.exit(1);
  }

  let pubKeyContent: string;
  let companionPrivPath: string | undefined = args.key;

  if (fs.existsSync(args.pubkey)) {
    pubKeyContent = fs.readFileSync(args.pubkey, "utf8").trim();
    if (!companionPrivPath) {
      // Check if file ends with .pub
      if (args.pubkey.endsWith(".pub")) {
        const candidate = args.pubkey.slice(0, -4);
        if (fs.existsSync(candidate)) companionPrivPath = candidate;
      }
    }
  } else {
    pubKeyContent = args.pubkey.trim();
  }

  // Validate public key format
  try {
    parseSshPublicKey(pubKeyContent);
  } catch (err) {
    console.error(`Invalid public key: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!companionPrivPath || !fs.existsSync(companionPrivPath)) {
    console.error(
      "Private key required to sign Proof of Possession challenge. Specify with --key <path-to-private-key>.",
    );
    process.exit(1);
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
  const authHeaders = getAuthHeaders();

  // 1. Fetch challenge
  const chalRes = await fetch(`${apiUrl}/api/v1/users/me/signing-challenge`, {
    headers: { ...authHeaders, Accept: "application/json" },
  });

  if (!chalRes.ok) {
    const errText = await chalRes.text();
    console.error(`Failed to request challenge: ${chalRes.status} ${errText}`);
    process.exit(1);
  }

  const chalData = (await chalRes.json()) as { challengeId?: string; challengeText?: string; challenge?: string };
  const challengeStr = chalData.challengeText || chalData.challenge || "";

  // 2. Sign challenge PoP
  let proofOfPossession: string;
  try {
    proofOfPossession = signChallengePoP(challengeStr, companionPrivPath);
  } catch (err) {
    console.error(`Failed to sign challenge with private key: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 3. Register key
  const regRes = await fetch(`${apiUrl}/api/v1/users/me/signing-keys`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      publicKeyOpenSsh: pubKeyContent,
      publicKeyOpenssh: pubKeyContent,
      challengeId: chalData.challengeId || challengeStr,
      challengeText: challengeStr,
      challenge: challengeStr,
      proofOfPossession,
      signature: proofOfPossession,
      label: args.label || "Ed25519 Signing Key",
      algo: "ed25519",
    }),
  });

  if (!regRes.ok) {
    const errJson = (await regRes.json().catch(() => ({ error: "Registration failed" }))) as { error?: string };
    console.error(`Key registration failed: ${errJson.error || regRes.statusText}`);
    process.exit(1);
  }

  const result = (await regRes.json()) as {
    key: { id: number; fingerprint_sha256: string; label: string };
    signing_verified: boolean;
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("\n✓ Key registered successfully!");
  console.log(`  Key ID:      #${result.key.id}`);
  console.log(`  Fingerprint: ${result.key.fingerprint_sha256}`);
  console.log(`  Status:      Verified Account Active\n`);
  console.log("Your git pushes and posts can now be cryptographically verified.");
}

async function handleRevokeKey(args: KeysRevokeArgs): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error("Not logged in. Run 'msx login' to authenticate.");
    process.exit(1);
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
  const authHeaders = getAuthHeaders();

  const res = await fetch(`${apiUrl}/api/v1/users/me/signing-keys/${args.id}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, Accept: "application/json" },
  });

  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({ error: "Revocation failed" }))) as { error?: string };
    console.error(`Revocation failed: ${errJson.error || res.statusText}`);
    process.exit(1);
  }

  const result = await res.json();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n✓ Key #${args.id} has been revoked.`);
}

async function handleSetPolicy(args: KeysPolicyArgs): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error("Not logged in. Run 'msx login' to authenticate.");
    process.exit(1);
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
  const authHeaders = getAuthHeaders();
  const strict = args.mode === "strict";

  const res = await fetch(`${apiUrl}/api/v1/users/me/signing-policy`, {
    method: "PUT",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ strict }),
  });

  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({ error: "Failed to update policy" }))) as { error?: string };
    console.error(`Policy update failed: ${errJson.error || res.statusText}`);
    process.exit(1);
  }

  const result = await res.json();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n✓ Signing policy updated: ${strict ? "STRICT (Unsigned pushes rejected)" : "OPTIONAL"}`);
}
