// SPDX-License-Identifier: AGPL-3.0-or-later

export interface BlogAuthor {
  id: string;
  name: string;
  role: string;
  handle?: string;
  twitter?: string;
  linkedin?: string;
  ansatz?: string;
}

export const AUTHORS: Record<string, BlogAuthor> = {
  omar: {
    id: "omar",
    name: "Mohamad Omar Nachawati",
    role: "Creator of ModelScript & Ansatz",
    handle: "@omar",
    ansatz: "https://ansatz.social/@omar",
    twitter: "https://x.com/modelscript",
    linkedin: "https://www.linkedin.com/company/modelscript",
  },
  modelscript: {
    id: "modelscript",
    name: "ModelScript Team",
    role: "Engineering",
    handle: "@modelscript",
    ansatz: "https://ansatz.social/@modelscript",
    twitter: "https://x.com/modelscript",
    linkedin: "https://www.linkedin.com/company/modelscript",
  },
};

export function resolveAuthor(authorKey?: string): BlogAuthor {
  if (!authorKey) return AUTHORS.modelscript!;
  const found = AUTHORS[authorKey.toLowerCase()];
  if (found) return found;
  return {
    id: authorKey,
    name: authorKey,
    role: "Contributor",
  };
}
