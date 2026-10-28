// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_ENTERPRISE_FEATURES,
  type EnterpriseFeature,
  type EnterpriseTier,
  generateLicenseKeyPair,
  signEnterpriseLicense,
  verifyEnterpriseLicense,
} from "../license/verifier.js";

const __filename = fileURLToPath(import.meta.url);

function parseArg(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === `--${flag}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith(`--${flag}=`)) {
      return arg.slice(flag.length + 3);
    }
  }
  return undefined;
}

export function runLicenseCli(argv: string[] = process.argv.slice(2)): number {
  const command = argv[0] ?? "help";

  if (command === "keygen") {
    const outDir = parseArg(argv, "out-dir");
    const { publicKeyPem, privateKeyPem } = generateLicenseKeyPair();
    if (outDir) {
      const resolvedDir = path.resolve(outDir);
      fs.mkdirSync(resolvedDir, { recursive: true });
      const pubPath = path.join(resolvedDir, "msx-license-public.pem");
      const privPath = path.join(resolvedDir, "msx-license-private.pem");
      fs.writeFileSync(pubPath, publicKeyPem, { encoding: "utf-8", mode: 0o644 });
      fs.writeFileSync(privPath, privateKeyPem, { encoding: "utf-8", mode: 0o600 });
      console.log(`Generated Ed25519 Enterprise license keypair:`);
      console.log(`  Public key:  ${pubPath}`);
      console.log(`  Private key: ${privPath}`);
    } else {
      console.log("# --- MSX_LICENSE_PUBLIC_KEY_PEM ---");
      console.log(publicKeyPem.trim());
      console.log("\n# --- MSX_LICENSE_PRIVATE_KEY_PEM (KEEP SECRET) ---");
      console.log(privateKeyPem.trim());
    }
    return 0;
  }

  if (command === "issue" || command === "sign") {
    const org = parseArg(argv, "org") ?? "Enterprise Customer";
    const sub =
      parseArg(argv, "sub") ??
      org
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const rawTier = (parseArg(argv, "tier") ?? "appliance") as EnterpriseTier;
    const validTiers: EnterpriseTier[] = ["appliance", "commercial-sdk", "cloud-enterprise"];
    const tier: EnterpriseTier = validTiers.includes(rawTier) ? rawTier : "appliance";
    const seats = Math.max(1, Number(parseArg(argv, "seats") ?? 25));
    const days = Math.max(1, Number(parseArg(argv, "days") ?? 365));
    const rawFeatures = parseArg(argv, "features");
    const features: EnterpriseFeature[] = rawFeatures
      ? (rawFeatures
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is EnterpriseFeature =>
            (ALL_ENTERPRISE_FEATURES as readonly string[]).includes(s),
          ) as EnterpriseFeature[])
      : [...ALL_ENTERPRISE_FEATURES];

    const privKeyFile = parseArg(argv, "private-key-file");
    const defaultVaultPrivKey = path.resolve(path.dirname(__filename), "../../../.keys/msx-license-private.pem");
    const privateKeyPem = privKeyFile
      ? fs.readFileSync(path.resolve(privKeyFile), "utf-8")
      : process.env["MSX_LICENSE_PRIVATE_KEY_PEM"] ||
        (fs.existsSync(defaultVaultPrivKey) ? fs.readFileSync(defaultVaultPrivKey, "utf-8") : undefined);

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + Math.round(days * 86400);

    const token = signEnterpriseLicense(
      {
        sub,
        org,
        tier,
        seats,
        features,
        iat: nowSec,
        exp: expSec,
      },
      privateKeyPem,
    );

    if (argv.includes("--json")) {
      console.log(
        JSON.stringify(
          {
            token,
            sub,
            org,
            tier,
            seats,
            features,
            issuedAt: new Date(nowSec * 1000).toISOString(),
            expiresAt: new Date(expSec * 1000).toISOString(),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`Issued ModelScript Enterprise Edition License:`);
      console.log(`  Organization: ${org} (${sub})`);
      console.log(`  Tier:         ${tier}`);
      console.log(`  Seats:        ${seats}`);
      console.log(`  Features:     ${features.join(", ")}`);
      console.log(`  Expires:      ${new Date(expSec * 1000).toISOString()} (${days} days)`);
      console.log(`\nMSX_LICENSE_KEY=${token}`);
    }
    return 0;
  }

  if (command === "verify") {
    const token = parseArg(argv, "key") ?? argv[1] ?? process.env["MSX_LICENSE_KEY"] ?? "";
    const pubKeyFile = parseArg(argv, "public-key-file");
    const publicKeyPem = pubKeyFile
      ? fs.readFileSync(path.resolve(pubKeyFile), "utf-8")
      : process.env["MSX_LICENSE_PUBLIC_KEY_PEM"];

    const res = verifyEnterpriseLicense(token, { publicKeyPem });
    console.log(JSON.stringify(res, null, 2));
    return res.valid ? 0 : 1;
  }

  console.log(
    [
      "ModelScript Enterprise License CLI (@modelscript/ee)",
      "",
      "Commands:",
      "  keygen [--out-dir=./keys]               Generate an offline Ed25519 license signing keypair",
      "  issue  --org=<name> [--tier=appliance]  Mint a signed offline MSX_LICENSE_KEY token",
      "         [--seats=25] [--days=365] [--features=a,b,c] [--private-key-file=path] [--json]",
      "  verify <msx_lic_...>                    Verify an offline MSX_LICENSE_KEY token",
    ].join("\n"),
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exit(runLicenseCli());
}
