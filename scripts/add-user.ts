// Usage: pnpm add-user <email>
// The password is prompted for (hidden) on a TTY, or read from the first line of stdin.
import fs from 'node:fs';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { LIMITS } from '../src/shared/constants.ts';
import { emailSchema, newPasswordSchema } from '../src/shared/schemas.ts';
import { loadDbConfig } from '../src/server/config.ts';
import { openDb } from '../src/server/db.ts';
import { createUsersRepo, DuplicateEmailError } from '../src/server/repos/users.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (answer) => resolve(answer));
      muted = true;
    });
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}

async function readFirstLine(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readFirstLine();
  const first = await promptHidden('Password: ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) fail('Passwords do not match');
  return first;
}

async function main() {
  if (fs.existsSync('.env')) process.loadEnvFile();

  const rawEmail = process.argv[2];
  if (!rawEmail) fail('Usage: pnpm add-user <email>');
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) fail('Invalid email address');

  const password = newPasswordSchema.safeParse(await readPassword());
  if (!password.success) fail(`Password must be ${LIMITS.newPasswordMin}-${LIMITS.passwordMax} characters`);

  const config = loadDbConfig();
  const db = openDb(config.DB_FILE);
  try {
    const hash = await bcrypt.hash(password.data, config.BCRYPT_ROUNDS);
    const user = createUsersRepo(db).create(email.data, hash);
    console.log(`User created: ${user.email} (${user.id})`);
  } catch (err) {
    if (err instanceof DuplicateEmailError) fail('Email already exists');
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
