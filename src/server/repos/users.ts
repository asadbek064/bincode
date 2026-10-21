import { nanoid } from 'nanoid';
import type { User } from '../../shared/api.ts';
import type { Db } from '../db.ts';

export interface UserWithHash extends User {
  passwordHash: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('Email already exists');
  }
}

function isUniqueViolation(err: unknown): boolean {
  // node:sqlite reports the extended result code; 2067 = SQLITE_CONSTRAINT_UNIQUE.
  return typeof err === 'object' && err !== null && (err as { errcode?: number }).errcode === 2067;
}

export function createUsersRepo(db: Db) {
  const insert = db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
  const byEmail = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?');
  const byId = db.prepare('SELECT id, email FROM users WHERE id = ?');
  const remove = db.prepare('DELETE FROM users WHERE id = ?');

  return {
    create(email: string, passwordHash: string): User {
      const id = nanoid();
      try {
        insert.run(id, email, passwordHash, new Date().toISOString());
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateEmailError();
        throw err;
      }
      return { id, email };
    },

    findByEmail(email: string): UserWithHash | undefined {
      const row = byEmail.get(email) as UserRow | undefined;
      return row && { id: row.id, email: row.email, passwordHash: row.password_hash };
    },

    findById(id: string): User | undefined {
      const row = byId.get(id) as Pick<UserRow, 'id' | 'email'> | undefined;
      return row && { id: row.id, email: row.email };
    },

    delete(id: string): boolean {
      return remove.run(id).changes > 0;
    },
  };
}

export type UsersRepo = ReturnType<typeof createUsersRepo>;
