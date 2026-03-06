// SPDX-License-Identifier: AGPL-3.0-or-later

import pino from "pino";

export default pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});
