export function getAvatarUrl(username: string, originalUrl?: string): string {
  if (originalUrl && !originalUrl.includes("ui-avatars.com")) {
    return originalUrl;
  }

  const initials = (username || "?").substring(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < (username || "").length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const bgColor = `hsl(${h}, 70%, 80%)`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="50" fill="${bgColor}" />
    <text x="50" y="50" dy=".35em" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="45" font-weight="500" fill="#000">${initials}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
