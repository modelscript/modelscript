import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";

const URL = "https://github.com/modelica/Reference-FMUs/releases/download/v0.0.39/Reference-FMUs-0.0.39.zip";
const OUT_DIR = path.resolve("packages/fmi/validation/reference_fmus");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`Downloading Reference FMUs to ${OUT_DIR}...`);
  execSync(`curl -sL ${URL} -o /tmp/ref_fmus.zip`);

  console.log(`Unzipping...`);
  execSync(`unzip -qo /tmp/ref_fmus.zip -d ${OUT_DIR}`);
  console.log(`Done!`);
}
main().catch(console.error);
