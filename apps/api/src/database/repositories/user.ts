// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserRow } from "../types.js";
import { BaseRepository } from "./base.js";

export class UserRepository extends BaseRepository {
  getUserById(id: number): UserRow | undefined {
    return this.get<UserRow>(`SELECT * FROM users WHERE id = ?`, id);
  }

  getUserByUsername(username: string): UserRow | undefined {
    return this.get<UserRow>(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`, username.trim());
  }

  getUserByEmail(email: string): UserRow | undefined {
    return this.get<UserRow>(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`, email.trim());
  }

  getUserCount(): number {
    const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM users`);
    return row?.count ?? 0;
  }

  updateUserPersona(userId: number, persona: string): boolean {
    const res = this.run(`UPDATE users SET engineering_persona = ? WHERE id = ?`, persona, userId);
    return res.changes > 0;
  }

  updateUserBio(userId: number, bio: string): boolean {
    const res = this.run(`UPDATE users SET bio = ? WHERE id = ?`, bio, userId);
    return res.changes > 0;
  }

  setUserEmailVerified(userId: number, verified = true): boolean {
    const res = this.run(`UPDATE users SET email_verified = ? WHERE id = ?`, verified ? 1 : 0, userId);
    return res.changes > 0;
  }
}
