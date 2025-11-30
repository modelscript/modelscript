// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Writer {
  write(string: string): void;
}

export class StringWriter implements Writer {
  #string = "";

  write(string: string): void {
    this.#string += string;
  }

  toString(): string {
    return this.#string;
  }
}
