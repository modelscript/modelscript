import * as esbuild from "esbuild";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const nodeBuiltinsPlugin = {
  name: "node-builtins-ignore",
  setup(build: esbuild.PluginBuild) {
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

    build.onResolve({ filter }, (args: esbuild.OnResolveArgs) => ({ path: args.path, namespace: "ignore" }));
    build.onLoad({ filter: /.*/, namespace: "ignore" }, () => ({ contents: "", loader: "js" }));
  },
};

const buildOptions: esbuild.BuildOptions = {
  entryPoints: [
    resolve(__dirname, "src/browserServerMain.ts"),
    resolve(__dirname, "src/step-worker.ts"),
    resolve(__dirname, "src/workers/indexer.worker.ts"),
  ],
  outdir: resolve(__dirname, "dist"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: false,
  keepNames: true,
  tsconfig: resolve(__dirname, "tsconfig.json"),
  // @ts-expect-error esbuild options typings issue
  sourcemap: "inline",
  metafile: true,
  define: {
    "process.env": "{}",
    "process.browser": "true",
    "import.meta.url": "''",
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
    const result = await esbuild.build(buildOptions);
    if (result.metafile) {
      const fs = await import("fs/promises");
      await fs.writeFile("metafile.json", JSON.stringify(result.metafile));
    }
    console.log("Build complete.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
