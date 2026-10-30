// SPDX-License-Identifier: AGPL-3.0-or-later

export function getAvatarUrl(username?: string | null, originalUrl?: string | null): string {
  const candidateUrl =
    originalUrl && (originalUrl.startsWith("http") || originalUrl.startsWith("/") || originalUrl.startsWith("data:"))
      ? originalUrl
      : username && (username.startsWith("http") || username.startsWith("/") || username.startsWith("data:"))
        ? username
        : undefined;
  if (candidateUrl) {
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
      const hostname = new URL(candidateUrl, baseUrl).hostname;
      if (hostname !== "ui-avatars.com" && !hostname.endsWith(".ui-avatars.com")) {
        return candidateUrl;
      }
    } catch {
      // Invalid URL, continue to generated avatar
    }
  }

  const effectiveUsername =
    username && !username.startsWith("http") && !username.startsWith("/") && !username.startsWith("data:")
      ? username
      : originalUrl &&
          !originalUrl.startsWith("http") &&
          !originalUrl.startsWith("/") &&
          !originalUrl.startsWith("data:")
        ? originalUrl
        : "?";

  const initials = effectiveUsername.substring(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < effectiveUsername.length; i++) {
    hash = effectiveUsername.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const bgColor = `hsl(${h}, 70%, 80%)`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="50" fill="${bgColor}" />
    <text x="50" y="50" dy=".35em" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="45" font-weight="500" fill="#000">${initials}</text>
  </svg>`;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function getBannerUrl(username: string, originalUrl?: string | null): string {
  if (originalUrl && originalUrl.trim().length > 0) {
    return originalUrl.trim();
  }

  let hash = 0;
  const cleanName = username || "ansatz";
  for (let i = 0; i < cleanName.length; i++) {
    hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 45) % 360;
  const accent = `hsl(${(h1 + 180) % 360}, 85%, 65%)`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 240" width="900" height="240">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${h1}, 65%, 18%)"/>
        <stop offset="50%" stop-color="hsl(${h2}, 60%, 14%)"/>
        <stop offset="100%" stop-color="hsl(${h1}, 70%, 10%)"/>
      </linearGradient>
      <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M 36 0 L 0 0 0 36" fill="none" stroke="${accent}" stroke-width="0.7" stroke-opacity="0.22"/>
      </pattern>
    </defs>
    <rect width="900" height="240" fill="url(#bg)"/>
    <rect width="900" height="240" fill="url(#grid)"/>
    <path d="M 0 175 Q 220 95 450 160 T 900 115" fill="none" stroke="${accent}" stroke-width="2.5" stroke-opacity="0.55"/>
    <path d="M 0 205 Q 260 140 510 190 T 900 155" fill="none" stroke="${accent}" stroke-width="1.4" stroke-opacity="0.32"/>
  </svg>`;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
