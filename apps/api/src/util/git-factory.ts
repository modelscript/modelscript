// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IGitProvider } from "../interfaces/git-provider.js";
import { GitLabProvider } from "./gitlab.js";
import { LocalGitProvider } from "./local-git.js";

const gitlabProvider = new GitLabProvider();
const localGitProvider = new LocalGitProvider();

export function getGitProvider(idOrUrl: string): IGitProvider {
  // If it's a standard URL (http, https, ssh) or ends with .git, use LocalGitProvider.
  // Otherwise, fallback to GitLabProvider which assumes it's a GitLab project ID.
  if (
    idOrUrl.startsWith("http://") ||
    idOrUrl.startsWith("https://") ||
    idOrUrl.startsWith("ssh://") ||
    idOrUrl.endsWith(".git")
  ) {
    return localGitProvider;
  }
  return gitlabProvider;
}
