/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check
"use strict";

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

/** @type WebpackConfig */
const browserClientConfig = {
  context: __dirname,
  mode: "none",
  target: "webworker",
  entry: {
    browserClientMain: "./src/browserClientMain.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"],
    alias: {},
    fallback: {
      path: require.resolve("path-browserify"),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
  performance: {
    hints: false,
  },
  devtool: "nosources-source-map",
};

/** @type WebpackConfig */
const browserServerConfig = {
  context: path.resolve(__dirname, "..", "lsp"),
  mode: "none",
  target: "webworker",
  entry: {
    browserServerMain: "./src/browserServerMain.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "server", "dist"),
    libraryTarget: "var",
    library: "serverExportVar",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"],
    alias: {},
    fallback: {
      // Node.js built-ins needed by pino (used by @modelscript/core logger)
      assert: false,
      buffer: false,
      child_process: false,
      crypto: false,
      diagnostics_channel: false,
      events: false,
      fs: false,
      http: false,
      module: false,
      https: false,
      net: false,
      os: false,
      path: false,
      process: false,
      stream: false,
      string_decoder: false,
      tls: false,
      url: false,
      util: false,
      worker_threads: false,
      zlib: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
            options: {
              configFile: path.resolve(__dirname, "..", "lsp", "tsconfig.json"),
            },
          },
        ],
      },
    ],
  },
  plugins: [
    // Stub process.env for pino and other Node.js code
    new webpack.DefinePlugin({
      "process.env": JSON.stringify({}),
      "process.browser": JSON.stringify(true),
    }),
    // Handle node: scheme URIs used by pino and other Node.js modules
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, "");
    }),
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "..", "..", "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
          to: path.join(__dirname, "server", "dist", "tree-sitter.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "tree-sitter-modelica", "tree-sitter-modelica.wasm"),
          to: path.join(__dirname, "server", "dist", "tree-sitter-modelica.wasm"),
        },
        {
          from: path.resolve(__dirname, "..", "..", "scripts", "ModelicaStandardLibrary_v4.1.0.zip"),
          to: path.join(__dirname, "server", "dist", "ModelicaStandardLibrary_v4.1.0.zip"),
        },
      ],
    }),
  ],
  performance: {
    hints: false,
  },
  devtool: "nosources-source-map",
};

/** @type WebpackConfig */
const webviewConfig = {
  context: __dirname,
  mode: "none",
  target: "web",
  entry: {
    diagramWebview: "./src/webview/diagram.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"],
    alias: {},
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          { loader: "ts-loader", options: { configFile: path.resolve(__dirname, "src", "webview", "tsconfig.json") } },
        ],
      },
      {
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
  performance: {
    hints: false,
  },
  optimization: {
    usedExports: false,
    sideEffects: false,
  },
  devtool: "nosources-source-map",
};

module.exports = [browserClientConfig, browserServerConfig, webviewConfig];
