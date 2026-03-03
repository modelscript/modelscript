// SPDX-License-Identifier: AGPL-3.0-or-later

export type JSONValue = boolean | number | string | null | { [key: string]: JSONValue } | JSONValue[];

export interface Triple {
  s: string;
  p: string;
  o: string | number | boolean | null;
}
