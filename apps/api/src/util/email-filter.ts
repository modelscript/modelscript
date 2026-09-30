// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Known disposable, temporary, and burner email domains used for botnet registration,
 * Sybil attacks, and credit farming.
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minutemail.net",
  "burnermail.io",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "inboxkitten.com",
  "maildrop.cc",
  "mailinator.com",
  "mohmal.com",
  "nada.ltd",
  "pokemail.net",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/**
 * Extracts and normalizes the domain from an email address.
 */
export function extractEmailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length < 2) return "";
  return parts[parts.length - 1]!;
}

/**
 * Checks whether an email address belongs to a disposable or throwaway provider.
 */
export function isDisposableEmail(email: string, customBlacklist?: Set<string>): boolean {
  const domain = extractEmailDomain(email);
  if (!domain) return true; // Malformed domain is untrusted

  if (customBlacklist && customBlacklist.has(domain)) {
    return true;
  }

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return true;
  }

  // Check subdomains (e.g. sub.mailinator.com)
  for (const blacklisted of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${blacklisted}`)) {
      return true;
    }
  }

  return false;
}
