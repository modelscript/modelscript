// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseRepository } from "./base.js";

export class BillingRepository extends BaseRepository {
  getUserCreditBalance(userId: number): number {
    const row = this.get<{ credit_balance: number }>(`SELECT credit_balance FROM users WHERE id = ?`, userId);
    return row?.credit_balance ?? 0;
  }

  adjustUserCredits(userId: number, delta: number, description = "Credit balance adjustment"): boolean {
    return this.facade.adjustUserCreditsForAdmin(userId, delta, description).success;
  }
}
