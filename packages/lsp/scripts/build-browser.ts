import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgDir = path.resolve(__dirname, "..");

const builtins = [
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "diagnostics_channel",
  "events",
  "fs",
  "fs/promises",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
  "tty",
  "esbuild",
  "assemblyscript",
  "assemblyscript/asc",
  "assemblyscript/dist/asc.js",
  "binaryen",
];
const filter = new RegExp(`^(node:)?(?:${builtins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

const ignorePlugin = {
  name: "node-builtins-ignore",
  setup(build: esbuild.PluginBuild) {
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "ignore" }));
    build.onLoad({ filter: /.*/, namespace: "ignore" }, () => ({ contents: "", loader: "js" }));
  },
};

async function run() {
  console.log("Bundling browserServerMain.ts and indexer.worker.ts with esbuild...");
  await esbuild.build({
    entryPoints: [
      path.resolve(pkgDir, "src/browserServerMain.ts"),
      path.resolve(pkgDir, "src/workers/indexer.worker.ts"),
    ],
    outdir: path.join(pkgDir, "dist"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: false,
    keepNames: true,
    sourcemap: "inline",
    define: {
      "process.env": "{}",
      "process.browser": "true",
      "import.meta.url": "''",
    },
    plugins: [ignorePlugin],
  });
  console.log("Bundle completed successfully!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
