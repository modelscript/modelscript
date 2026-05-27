import * as esbuild from "esbuild";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const nodeBuiltinsPlugin = {
  name: "node-builtins-ignore",
  setup(build) {
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
      "assemblyscript/dist/asc.js",
    ];

    const filter = new RegExp(`^(node:)?(?:${builtins.join("|")})$`);

    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "ignore" }));
    build.onLoad({ filter: /.*/, namespace: "ignore" }, () => ({ contents: "", loader: "js" }));
  },
};

const buildOptions = {
  entryPoints: [
    resolve(__dirname, "src/browserServerMain.ts"),
    resolve(__dirname, "src/step-worker.ts"),
    resolve(__dirname, "src/workers/indexer.worker.ts"),
  ],
  outdir: resolve(__dirname, "dist"),
  bundle: true,
  format: "iife", // Use classic scripts for VS Code Web worker polyfill compatibility
  platform: "browser",
  target: "es2022",
  minify: false,
  keepNames: true,
  sourcemap: "inline",
  define: {
    "process.env": "{}",
    "process.browser": "true",
    "import.meta.url": "self.location.href",
  },
  plugins: [nodeBuiltinsPlugin],
  logLevel: "info",
};

const isWatch = process.argv.includes("--watch");

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log("Build complete.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
