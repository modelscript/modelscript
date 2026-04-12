// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GitHub FileSystemProvider extension entry point.
// Registers a FileSystemProvider for the "github://" URI scheme.

import * as vscode from "vscode";
import { GitHubFileSystemProvider } from "./github-fs-provider";

export function activate(context: vscode.ExtensionContext) {
  console.log("[github-fs] Extension activating...");

  const githubFs = new GitHubFileSystemProvider();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("github", githubFs, {
      isCaseSensitive: true,
      isReadonly: true,
    }),
  );

  console.log("[github-fs] FileSystemProvider registered for github:// scheme");
}

export function deactivate() {
  // no-op
}
