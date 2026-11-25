// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Converts Modelica `Documentation(info="<html>...</html>")` HTML into clean Markdown.
 */
export function modelicaHtmlToMarkdown(rawHtml: string): string {
  if (!rawHtml) return "";
  let html = rawHtml
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?(?:html|body)(?:\s[^>]*)?>/gi, "")
    .trim();
  if (!html) return "";

  const decodeEntities = (s: string): string =>
    s
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&Omega;/g, "Ω")
      .replace(/&omega;/g, "ω")
      .replace(/&Delta;/g, "Δ")
      .replace(/&delta;/g, "δ")
      .replace(/&alpha;/gi, "α")
      .replace(/&beta;/gi, "β")
      .replace(/&gamma;/gi, "γ")
      .replace(/&epsilon;/gi, "ε")
      .replace(/&mu;/gi, "μ")
      .replace(/&pi;/gi, "π")
      .replace(/&phi;/g, "φ")
      .replace(/&Phi;/g, "Φ")
      .replace(/&tau;/gi, "τ")
      .replace(/&theta;/gi, "θ")
      .replace(/&lambda;/gi, "λ")
      .replace(/&sigma;/gi, "σ")
      .replace(/&rho;/gi, "ρ")
      .replace(/&eta;/gi, "η")
      .replace(/&deg;/gi, "°")
      .replace(/&plusmn;/gi, "±")
      .replace(/&times;/gi, "×")
      .replace(/&middot;/gi, "·")
      .replace(/&ndash;/gi, "–")
      .replace(/&mdash;/gi, "—")
      .replace(/&le;/gi, "≤")
      .replace(/&ge;/gi, "≥")
      .replace(/&ne;/gi, "≠")
      .replace(/&infin;/gi, "∞")
      .replace(/&rarr;/gi, "→")
      .replace(/&larr;/gi, "←")
      .replace(/&harr;/gi, "↔")
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&amp;/gi, "&");

  const stripHtmlTags = (s: string): string => {
    let prev: string;
    do {
      prev = s;
      s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
    } while (s !== prev);
    return s;
  };

  const stripTagAndContent = (input: string, tagName: string): string => {
    let result = "";
    let cursor = 0;
    const lower = input.toLowerCase();
    const openPrefix = `<${tagName.toLowerCase()}`;
    const closeTag = `</${tagName.toLowerCase()}`;

    while (cursor < input.length) {
      const startIdx = lower.indexOf(openPrefix, cursor);
      if (startIdx === -1) {
        result += input.slice(cursor);
        break;
      }
      const afterPrefix = lower[startIdx + openPrefix.length];
      if (afterPrefix !== undefined && afterPrefix !== ">" && afterPrefix !== "/" && !/\s/.test(afterPrefix)) {
        result += input.slice(cursor, startIdx + openPrefix.length);
        cursor = startIdx + openPrefix.length;
        continue;
      }
      result += input.slice(cursor, startIdx);
      const openTagEnd = lower.indexOf(">", startIdx);
      if (openTagEnd === -1) {
        break;
      }
      if (lower[openTagEnd - 1] === "/") {
        cursor = openTagEnd + 1;
        continue;
      }
      const closeIdx = lower.indexOf(closeTag, openTagEnd + 1);
      if (closeIdx === -1) {
        break;
      }
      const closeTagEnd = lower.indexOf(">", closeIdx);
      if (closeTagEnd === -1) {
        break;
      }
      cursor = closeTagEnd + 1;
    }
    return result;
  };

  // 0. Strip script and style blocks completely
  html = stripTagAndContent(html, "script");
  html = stripTagAndContent(html, "style");

  // 1. Preserve <pre>...</pre> blocks as fenced code blocks
  const preBlocks: string[] = [];
  html = html.replace(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
    const cleanCode = decodeEntities(stripHtmlTags(inner)).trim();
    const idx = preBlocks.length;
    preBlocks.push(`\n\n\`\`\`modelica\n${cleanCode}\n\`\`\`\n\n`);
    return `\x00PRE_${idx}\x00`;
  });

  // 2. Strip <img> tags (e.g. modelica://.../image.png)
  html = html.replace(/<img\b[^>]*>/gi, "");

  // 3. Convert <a href="...">text</a>
  html = html.replace(/<a\s+[^>]*href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href, text) => {
    const cleanText = stripHtmlTags(text).trim();
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return `[${cleanText || href}](${href})`;
    }
    return cleanText ? `\`${cleanText}\`` : `\`${href.replace(/^modelica:\/\//i, "")}\``;
  });

  // 4. Convert <table>...</table> to Markdown tables or bullet rows
  html = html.replace(/<table(?:\s[^>]*)?>([\s\S]*?)<\/table>/gi, (_m, tableInner) => {
    const rows: string[][] = [];
    const rowRegex = /<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rowRegex.exec(tableInner)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<t[hd](?:\s[^>]*)?>([\s\S]*?)<\/t[hd]>/gi;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = cellRegex.exec(rMatch[1]!)) !== null) {
        const cellText = decodeEntities(
          stripHtmlTags(
            cMatch[1]!
              .replace(/<(?:b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
              .replace(/<(?:i|em|var)(?:\s[^>]*)?>([\s\S]*?)<\/(?:i|em|var)>/gi, "*$1*")
              .replace(/<(?:code|tt)(?:\s[^>]*)?>([\s\S]*?)<\/(?:code|tt)>/gi, "`$1`"),
          )
            .replace(/\s+/g, " ")
            .trim(),
        );
        cells.push(cellText.replace(/\\/g, "\\\\").replace(/\|/g, "\\|"));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const colCount = Math.max(...rows.map((r) => r.length));
    if (colCount >= 2 && rows.length >= 2) {
      const padRow = (r: string[]) => {
        const padded = [...r];
        while (padded.length < colCount) padded.push("");
        return `| ${padded.join(" | ")} |`;
      };
      const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
      return `\n\n${padRow(rows[0]!)}\n${sep}\n${rows.slice(1).map(padRow).join("\n")}\n\n`;
    }
    return `\n\n${rows.map((r) => `- ${r.join(" — ")}`).join("\n")}\n\n`;
  });

  // 5. Headings, inline styles, lists, paragraphs, and breaks
  html = html
    .replace(/<h[1-6](?:\s[^>]*)?>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner) => {
      const hText = stripHtmlTags(inner).replace(/\s+/g, " ").trim();
      return hText ? `\n\n**${hText}**\n\n` : "";
    })
    .replace(/<(?:b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
    .replace(/<(?:i|em|var)(?:\s[^>]*)?>([\s\S]*?)<\/(?:i|em|var)>/gi, "*$1*")
    .replace(/<(?:code|tt)(?:\s[^>]*)?>([\s\S]*?)<\/(?:code|tt)>/gi, "`$1`")
    .replace(/<sub(?:\s[^>]*)?>([\s\S]*?)<\/sub>/gi, "_$1")
    .replace(/<sup(?:\s[^>]*)?>([\s\S]*?)<\/sup>/gi, "^$1")
    .replace(/<dt(?:\s[^>]*)?>([\s\S]*?)<\/dt>/gi, (_m, inner) => `\n- **${inner.trim()}**: `)
    .replace(/<dd(?:\s[^>]*)?>([\s\S]*?)<\/dd>/gi, (_m, inner) => `${inner.trim()}\n`)
    .replace(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi, (_m, inner) => {
      const liText = inner.replace(/\s+/g, " ").trim();
      return liText ? `\n- ${liText}` : "";
    })
    .replace(/<\/?(?:ul|ol|dl)(?:\s[^>]*)?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<\/?(?:p|div|blockquote)(?:\s[^>]*)?>/gi, "\n\n");
  html = stripHtmlTags(html);

  html = decodeEntities(html);

  // Normalize line whitespace
  const lines = html.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  let md = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Restore <pre> code blocks
  for (let idx = 0; idx < preBlocks.length; idx++) {
    md = md.replace(`\x00PRE_${idx}\x00`, preBlocks[idx]!);
  }

  return md.replace(/\n{3,}/g, "\n\n").trim();
}
