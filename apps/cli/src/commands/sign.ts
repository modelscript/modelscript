// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";
import { createPostProof, parseSshPublicKey, type PostProofDocument, verifyPostProof } from "../util/signing.js";

interface SignArgs {
  file: string;
  key?: string | undefined;
  pubkey?: string | undefined;
  out?: string | undefined;
  verify?: boolean | undefined;
  json?: boolean | undefined;
}

export const SignCommand: CommandModule<{}, SignArgs> = {
  command: "sign <file>",
  describe: "Cryptographically sign a post or verify a W3C Data Integrity proof",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        describe: "Path to post markdown file to sign or verify",
        type: "string",
        demandOption: true,
      })
      .option("key", {
        alias: "k",
        describe: "Path to Ed25519 private key file (defaults to ~/.ssh/id_ed25519_modelscript)",
        type: "string",
      })
      .option("pubkey", {
        alias: "p",
        describe: "Path to matching public key file (.pub)",
        type: "string",
      })
      .option("out", {
        alias: "o",
        describe: "Output path for the .proof.json file (default: <file>.proof.json)",
        type: "string",
      })
      .option("verify", {
        alias: "v",
        describe: "Verify an existing proof file instead of generating one",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "Output result as JSON",
        type: "boolean",
        default: false,
      });
  },
  handler: async (args) => {
    const postFilePath = path.resolve(args.file);
    if (!fs.existsSync(postFilePath)) {
      console.error(`Post file not found: ${postFilePath}`);
      process.exit(1);
    }

    const postContent = fs.readFileSync(postFilePath, "utf8");
    const proofPath = args.out ? path.resolve(args.out) : `${postFilePath}.proof.json`;

    // Parse simple frontmatter if present
    let postId = path.basename(postFilePath, path.extname(postFilePath));
    let createdAt = new Date().toISOString();
    let bodyContent = postContent;

    const fmMatch = postContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (fmMatch) {
      const header = fmMatch[1]!;
      bodyContent = fmMatch[2]!;
      const idMatch = header.match(/^id:\s*([^\r\n]+)/m);
      if (idMatch) postId = idMatch[1]!.trim().replace(/^['"]|['"]$/g, "");
      const dateMatch = header.match(/^date:\s*([^\r\n]+)/m);
      if (dateMatch) createdAt = dateMatch[1]!.trim().replace(/^['"]|['"]$/g, "");
    }

    if (args.verify) {
      // Verification mode
      if (!fs.existsSync(proofPath)) {
        console.error(`Proof file not found: ${proofPath}`);
        process.exit(1);
      }
      const proofDoc = JSON.parse(fs.readFileSync(proofPath, "utf8")) as PostProofDocument;

      // Determine public key
      let pubKeyStr: string | undefined;
      if (args.pubkey && fs.existsSync(args.pubkey)) {
        pubKeyStr = fs.readFileSync(args.pubkey, "utf8");
      } else {
        const defaultPub = path.join(homedir(), ".ssh", "id_ed25519_modelscript.pub");
        if (fs.existsSync(defaultPub)) {
          pubKeyStr = fs.readFileSync(defaultPub, "utf8");
        }
      }

      if (!pubKeyStr) {
        console.error("Public key required for verification. Specify with --pubkey <path>.");
        process.exit(1);
      }

      const parsedKey = parseSshPublicKey(pubKeyStr);
      const isValid = verifyPostProof(bodyContent, postId, createdAt, proofDoc, parsedKey.rawPubkey);

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              valid: isValid,
              postFile: postFilePath,
              proofFile: proofPath,
              verificationMethod: proofDoc.proof.verificationMethod,
              cryptosuite: proofDoc.proof.cryptosuite,
            },
            null,
            2,
          ),
        );
      } else if (isValid) {
        console.log("\n✓ Signature verification: VALID");
        console.log(`  Post:                ${postFilePath}`);
        console.log(`  Proof:               ${proofPath}`);
        console.log(`  Verification Method: ${proofDoc.proof.verificationMethod}`);
        console.log(`  Cryptosuite:         ${proofDoc.proof.cryptosuite}`);
      } else {
        console.error("\n✗ Signature verification: INVALID (Signature does not match post content)");
        process.exit(1);
      }
      return;
    }

    // Signing mode
    const defaultPriv = path.join(homedir(), ".ssh", "id_ed25519_modelscript");
    const privKeyPath = args.key ? path.resolve(args.key) : defaultPriv;

    if (!fs.existsSync(privKeyPath)) {
      console.error(
        `Private key not found at ${privKeyPath}. Generate one with 'msx keys generate' or pass --key <path>.`,
      );
      process.exit(1);
    }

    const pubKeyPath = args.pubkey ? path.resolve(args.pubkey) : `${privKeyPath}.pub`;
    if (!fs.existsSync(pubKeyPath)) {
      console.error(`Public key not found at ${pubKeyPath}. Pass --pubkey <path>.`);
      process.exit(1);
    }

    const pubKeyStr = fs.readFileSync(pubKeyPath, "utf8");
    const { payload, proofDoc } = createPostProof(postId, bodyContent, createdAt, privKeyPath, pubKeyStr);

    fs.writeFileSync(proofPath, JSON.stringify(proofDoc, null, 2) + "\n", { mode: 0o644 });

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            postFile: postFilePath,
            proofFile: proofPath,
            payload,
            proofDoc,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log("\n✓ Post signed successfully!");
    console.log(`  Proof file:          ${proofPath}`);
    console.log(`  Post ID:             ${postId}`);
    console.log(`  Verification Method: ${proofDoc.proof.verificationMethod}`);
    console.log(`  Cryptosuite:         ${proofDoc.proof.cryptosuite}\n`);
    console.log("When pushing to git, commit both the post file and its companion .proof.json file.");
  },
};
