// SPDX-License-Identifier: AGPL-3.0-or-later

import { INDUSTRIES } from "../.vitepress/theme/data/industries";

export default {
  paths() {
    return INDUSTRIES.map((i) => ({
      params: { slug: i.slug, title: i.name, description: i.summary },
    }));
  },
};
