// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from "react";

export function formatPageTitle(title?: string): string {
  return title ? `${title} | ModelScript` : "ModelScript";
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
