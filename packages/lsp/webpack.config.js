/* eslint-disable no-undef */
//@ts-check
"use strict";

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");

/** @type WebpackConfig */
const browserServerConfig = {
  context: __dirname,
  mode: "none",
  target: "webworker",
  entry: {
    browserServerMain: "./src/browserServerMain.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
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
          },
        ],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      "process.env": JSON.stringify({}),
      "process.browser": JSON.stringify(true),
    }),
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, "");
    }),
  ],
  performance: {
    hints: false,
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          keep_classnames: true,
          keep_fnames: true,
        },
      }),
    ],
  },
  devtool: "nosources-source-map",
};

module.exports = [browserServerConfig];
