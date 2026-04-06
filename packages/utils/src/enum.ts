// SPDX-License-Identifier: AGPL-3.0-or-later

export function toEnum<T extends Record<number, string | number>>(
  enumType: T,
  value: string | null | undefined,
): T[keyof T] | null {
  for (const key of Object.keys(enumType)) {
    if (enumType[key as keyof T] === value) return enumType[key as keyof T];
  }
  return null;
}
