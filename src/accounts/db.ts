import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveStateDir } from "../config/paths.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";

const ACCOUNTS_DIR_MODE = 0o700;
const ACCOUNTS_FILE_MODE = 0o600;

export const PLATFORMCLAW_SQLITE_FILENAME = "platformclaw.sqlite";

type CachedDb = {
  db: DatabaseSync;
  path: string;
};

let cachedDb: CachedDb | null = null;

export function resolvePlatformClawSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), PLATFORMCLAW_SQLITE_FILENAME);
}

function ensureParentDir(pathname: string) {
  const dir = path.dirname(pathname);
  mkdirSync(dir, { recursive: true, mode: ACCOUNTS_DIR_MODE });
  try {
    chmodSync(dir, ACCOUNTS_DIR_MODE);
  } catch {
    // best-effort only
  }
}

function hardenDbFile(pathname: string) {
  if (!existsSync(pathname)) {
    return;
  }
  try {
    chmodSync(pathname, ACCOUNTS_FILE_MODE);
  } catch {
    // best-effort only
  }
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS account_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      external_provider TEXT NOT NULL,
      external_subject TEXT NOT NULL,
      employee_id TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      global_role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS account_aliases (
      account_id TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      alias_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (alias_type, alias_value),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      last_seen_at TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by_account_id TEXT NOT NULL,
      owner_account_id TEXT NOT NULL,
      parent_group_id TEXT,
      group_level INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      FOREIGN KEY (created_by_account_id) REFERENCES accounts(id),
      FOREIGN KEY (owner_account_id) REFERENCES accounts(id),
      FOREIGN KEY (parent_group_id) REFERENCES groups(id)
    );

    CREATE TABLE IF NOT EXISTS group_memberships (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      group_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, account_id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS skill_events (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      account_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_account_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_account_id) REFERENCES accounts(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS groups_level1_name_uq
      ON groups(name)
      WHERE group_level = 1;

    CREATE UNIQUE INDEX IF NOT EXISTS groups_level2_parent_name_uq
      ON groups(parent_group_id, name)
      WHERE group_level = 2;
  `);
}

export function getPlatformClawDatabase(
  env: NodeJS.ProcessEnv = process.env,
): { db: DatabaseSync; path: string } {
  const pathname = resolvePlatformClawSqlitePath(env);
  if (cachedDb && cachedDb.path === pathname) {
    return cachedDb;
  }
  if (cachedDb) {
    try {
      cachedDb.db.close();
    } catch {
      // best-effort only
    }
  }
  ensureParentDir(pathname);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);
  ensureSchema(db);
  hardenDbFile(pathname);
  cachedDb = { db, path: pathname };
  return cachedDb;
}

export function resetPlatformClawDatabaseForTests() {
  if (!cachedDb) {
    return;
  }
  try {
    cachedDb.db.close();
  } catch {
    // best-effort only
  }
  cachedDb = null;
}
