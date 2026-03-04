// SPDX-License-Identifier: AGPL-3.0-or-later

import { createApp } from "./app.js";

const port = parseInt(process.env["PORT"] ?? "3000", 10);
const app = createApp();

app.listen(port, () => {
  console.log(`ModelScript API server listening on port ${port}`);
});
