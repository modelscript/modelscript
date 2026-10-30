// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from "react";

let activeBrandName = "Ansatz";

export function setActiveBrandName(name: string): void {
  const clean = name.trim();
  if (clean) {
    activeBrandName = clean;
  }
}

export function getActiveBrandName(): string {
  return activeBrandName;
}

export function formatPageTitle(title?: string): string {
  return title ? `${title} | ${activeBrandName}` : activeBrandName;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = formatPageTitle(title);
    return () => {
      document.title = prevTitle;
    };
  }, [title]);
}

/**
 * Injects or updates standard oEmbed discovery `<link rel="alternate" type="application/json+oembed">`
 * for scrapers (Notion, Slack, Discord, Twitter, Reddit, Discourse).
 */
export function useOembedDiscovery(targetUrl?: string, title?: string) {
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const url = targetUrl || window.location.href;
    const host = window.location.origin;

    let link = document.querySelector('link[type="application/json+oembed"]') as HTMLLinkElement | null;
    let created = false;
    if (!link) {
      link = document.createElement("link");
      link.rel = "alternate";
      link.type = "application/json+oembed";
      document.head.appendChild(link);
      created = true;
    }

    const oembedHref = `${host}/api/v1/oembed?url=${encodeURIComponent(url)}&format=json`;
    link.href = oembedHref;
    link.title = title || `${activeBrandName} oEmbed`;

    // Synchronize canonical OpenGraph URL
    let ogUrl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null;
    if (!ogUrl) {
      ogUrl = document.createElement("meta");
      ogUrl.setAttribute("property", "og:url");
      document.head.appendChild(ogUrl);
    }
    ogUrl.content = url;

    return () => {
      if (created && link?.parentNode) {
        link.parentNode.removeChild(link);
      }
    };
  }, [targetUrl, title]);
}

/**
 * Comprehensive page metadata hook updating title, description, OpenGraph, Twitter cards, and oEmbed.
 */
export function usePageMeta(options: { title: string; description?: string; image?: string; url?: string }) {
  usePageTitle(options.title);
  useOembedDiscovery(options.url, options.title);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (options.description) {
      const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (desc) desc.content = options.description;
      const ogDesc = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
      if (ogDesc) ogDesc.content = options.description;
      const twDesc = document.querySelector('meta[name="twitter:description"]') as HTMLMetaElement | null;
      if (twDesc) twDesc.content = options.description;
    }

    if (options.title) {
      const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
      if (ogTitle) ogTitle.content = formatPageTitle(options.title);
      const twTitle = document.querySelector('meta[name="twitter:title"]') as HTMLMetaElement | null;
      if (twTitle) twTitle.content = formatPageTitle(options.title);
    }

    if (options.image) {
      const ogImg = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
      if (ogImg) ogImg.content = options.image;
      const twImg = document.querySelector('meta[name="twitter:image"]') as HTMLMetaElement | null;
      if (twImg) twImg.content = options.image;
    }
  }, [options.title, options.description, options.image]);
}
