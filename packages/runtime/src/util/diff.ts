// SPDX-License-Identifier: AGPL-3.0-or-later

export interface EditRange {
  startByte: number;
  endByte: number;
  delta: number;
}

export function isIdentChar(ch: number): boolean {
  return (
    (ch >= 48 && ch <= 57) || // 0-9
    (ch >= 65 && ch <= 90) || // A-Z
    (ch >= 97 && ch <= 122) || // a-z
    ch === 95 // _
  );
}

/**
 * Computes the minimal edit range between prevText and newText using
 * Tree-sitter-style prefix/suffix scanning without string splitting or array allocations.
 */
export function computeEditRanges(prevText: string, newText: string): EditRange[] {
  if (prevText === newText) return [];

  let prefixLen = 0;
  const minLen = Math.min(prevText.length, newText.length);
  while (prefixLen < minLen && prevText.charCodeAt(prefixLen) === newText.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  // If prefixLen lands inside or immediately adjacent to an identifier in either
  // prevText or newText, expand backwards to the start of the identifier to avoid splitting tokens.
  if (
    prefixLen > 0 &&
    isIdentChar(prevText.charCodeAt(prefixLen - 1)) &&
    ((prefixLen < prevText.length && isIdentChar(prevText.charCodeAt(prefixLen))) ||
      (prefixLen < newText.length && isIdentChar(newText.charCodeAt(prefixLen))))
  ) {
    while (prefixLen > 0 && isIdentChar(prevText.charCodeAt(prefixLen - 1))) {
      prefixLen--;
    }
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    prevText.charCodeAt(prevText.length - 1 - suffixLen) === newText.charCodeAt(newText.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  // If suffixLen lands inside or immediately adjacent to an identifier in either
  // prevText or newText, shrink suffixLen to avoid splitting tokens.
  if (
    suffixLen > 0 &&
    isIdentChar(prevText.charCodeAt(prevText.length - suffixLen)) &&
    ((prevText.length - suffixLen > 0 && isIdentChar(prevText.charCodeAt(prevText.length - suffixLen - 1))) ||
      (newText.length - suffixLen > 0 && isIdentChar(newText.charCodeAt(newText.length - suffixLen - 1))))
  ) {
    while (suffixLen > 0 && isIdentChar(prevText.charCodeAt(prevText.length - suffixLen))) {
      suffixLen--;
    }
  }

  const prevDiffLen = prevText.length - prefixLen - suffixLen;
  const newDiffLen = newText.length - prefixLen - suffixLen;
  if (prevDiffLen > 5000 || newDiffLen > 5000) {
    const editStart = prefixLen;
    const editEnd = newText.length - suffixLen;
    return [
      {
        startByte: editStart,
        endByte: Math.max(editStart, editEnd),
        delta: newText.length - prevText.length,
      },
    ];
  }

  const prevMiddle = prevText.slice(prefixLen, prevText.length - suffixLen);
  const newMiddle = newText.slice(prefixLen, newText.length - suffixLen);

  if (
    !prevMiddle.includes("\n") ||
    !newMiddle.includes("\n") ||
    prevMiddle.length > 10000 ||
    newMiddle.length > 10000
  ) {
    const editStart = prefixLen;
    const editEnd = newText.length - suffixLen;
    return [
      {
        startByte: editStart,
        endByte: Math.max(editStart, editEnd),
        delta: newText.length - prevText.length,
      },
    ];
  }

  const prevLines = prevMiddle.split("\n");
  const newLines = newMiddle.split("\n");
  if (prevLines.length > 50 || newLines.length > 50) {
    const editStart = prefixLen;
    const editEnd = newText.length - suffixLen;
    return [
      {
        startByte: editStart,
        endByte: Math.max(editStart, editEnd),
        delta: newText.length - prevText.length,
      },
    ];
  }

  const hunks: EditRange[] = [];
  let pIdx = 0;
  let nIdx = 0;
  let pOffset = prefixLen;
  let nOffset = prefixLen;

  while (pIdx < prevLines.length || nIdx < newLines.length) {
    while (pIdx < prevLines.length && nIdx < newLines.length && prevLines[pIdx] === newLines[nIdx]) {
      const lineLen = newLines[nIdx].length + 1;
      pOffset += lineLen;
      nOffset += lineLen;
      pIdx++;
      nIdx++;
    }

    if (pIdx >= prevLines.length && nIdx >= newLines.length) break;

    const hunkStartInNew = nOffset;
    let foundP = -1;
    let foundN = -1;

    searchAnchor: for (let d = 1; d <= 20; d++) {
      for (let di = 0; di <= d; di++) {
        const checkP = pIdx + di;
        const checkN = nIdx + (d - di);
        if (
          checkP < prevLines.length &&
          checkN < newLines.length &&
          prevLines[checkP].trim() !== "" &&
          prevLines[checkP] === newLines[checkN]
        ) {
          foundP = checkP;
          foundN = checkN;
          break searchAnchor;
        }
      }
    }

    if (foundP !== -1 && foundN !== -1) {
      let pLen = 0;
      for (let i = pIdx; i < foundP; i++) {
        pLen += prevLines[i].length + (i < prevLines.length - 1 ? 1 : 0);
      }
      let nLen = 0;
      for (let i = nIdx; i < foundN; i++) {
        nLen += newLines[i].length + (i < newLines.length - 1 ? 1 : 0);
      }
      hunks.push({
        startByte: hunkStartInNew,
        endByte: hunkStartInNew + nLen,
        delta: nLen - pLen,
      });
      pOffset += pLen;
      nOffset += nLen;
      pIdx = foundP;
      nIdx = foundN;
    } else {
      let pLen = 0;
      for (let i = pIdx; i < prevLines.length; i++) {
        pLen += prevLines[i].length + (i < prevLines.length - 1 ? 1 : 0);
      }
      let nLen = 0;
      for (let i = nIdx; i < newLines.length; i++) {
        nLen += newLines[i].length + (i < newLines.length - 1 ? 1 : 0);
      }
      hunks.push({
        startByte: hunkStartInNew,
        endByte: hunkStartInNew + nLen,
        delta: nLen - pLen,
      });
      break;
    }
  }

  return hunks.length > 0
    ? hunks
    : [
        {
          startByte: prefixLen,
          endByte: Math.max(prefixLen, newText.length - suffixLen),
          delta: newText.length - prevText.length,
        },
      ];
}
