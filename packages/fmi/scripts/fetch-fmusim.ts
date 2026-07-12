/**
 * Fetch fmusim and Reference FMUs
 * Downloads the official Modelica Association FMI reference suite,
 * which includes the `fmusim` C-based simulators for all platforms.
 */
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);

const VERSION = "0.0.39";
const URL = `https://github.com/modelica/Reference-FMUs/releases/download/v${VERSION}/Reference-FMUs-${VERSION}.zip`;
const OUT_DIR = path.resolve("validation/reference_fmus");
const ZIP_PATH = path.join("/tmp", `Reference-FMUs-${VERSION}.zip`);

async function main() {
  console.log("Fetching official fmusim and Reference FMUs...");

  try {
    await fs.access(path.join(OUT_DIR, "fmusim-x86_64-linux", "fmusim"));
    console.log("fmusim is already downloaded. Skipping.");
    return;
  } catch (e) {
    // Needs download
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`Downloading from ${URL}...`);
  await execAsync(`curl -sL ${URL} -o ${ZIP_PATH}`);

  console.log(`Extracting to ${OUT_DIR}...`);
  await execAsync(`unzip -qo ${ZIP_PATH} -d ${OUT_DIR}`);

  // Ensure fmusim is executable
  const linuxFmusim = path.join(OUT_DIR, "fmusim-x86_64-linux", "fmusim");
  await execAsync(`chmod +x ${linuxFmusim}`);

  console.log(`Successfully downloaded fmusim to ${linuxFmusim}`);
}

main().catch((err) => {
  console.error("Failed to fetch fmusim:", err);
  process.exit(1);
});
