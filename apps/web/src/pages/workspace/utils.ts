// SPDX-License-Identifier: AGPL-3.0-or-later

// Helper for formatting relative time
export function getRelativeTime(dateString: string) {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const daysDifference = Math.round((new Date(dateString).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  return rtf.format(daysDifference, "day");
}

export function getLanguageFromFileName(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "py":
      return "python";
    case "java":
      return "java";
    case "cpp":
    case "c":
    case "h":
    case "hpp":
      return "cpp";
    case "cs":
      return "csharp";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "sh":
    case "bash":
      return "shell";
    case "sql":
      return "sql";
    case "xml":
      return "xml";
    case "mo":
      return "modelica";
    default:
      return "plaintext";
  }
}
