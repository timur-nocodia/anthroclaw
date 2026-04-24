#!/usr/bin/env tsx
/**
 * Interactive CLI tool to reset the admin password.
 * Usage: pnpm reset-password
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";
import { hash } from "bcrypt";

interface AuthData {
  email: string;
  passwordHash: string;
  apiKey?: string;
  resetToken?: string;
  resetTokenExpiry?: string;
  updatedAt: string;
}

const AUTH_PATH = resolve(process.cwd(), "data", "auth.json");
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8; // keep in sync with ui/lib/auth.ts

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  console.log("\n--- AnthroClaw Password Reset ---\n");

  if (!existsSync(AUTH_PATH)) {
    console.error(`Error: ${AUTH_PATH} not found.`);
    console.error("Run the UI server at least once to initialise auth.");
    process.exit(1);
  }

  const data: AuthData = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
  console.log(`Admin email: ${data.email}\n`);

  const password = await prompt(`New password (min ${MIN_PASSWORD_LENGTH} chars): `);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  const confirm = await prompt("Confirm password: ");
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }

  data.passwordHash = await hash(password, BCRYPT_ROUNDS);
  data.resetToken = undefined;
  data.resetTokenExpiry = undefined;
  data.updatedAt = new Date().toISOString();

  writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log("\nPassword updated successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
