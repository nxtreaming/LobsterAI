import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => '/tmp',
  },
}));

import { DB_FILENAME } from './appConstants';
import { SqliteStore } from './sqliteStore';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

const createTempUserDataPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-sqlite-store-'));
  tempDirs.push(dir);
  return dir;
};

const createLegacyDatabase = (userDataPath: string): void => {
  const db = new Database(path.join(userDataPath, DB_FILENAME));
  const now = Date.now();

  db.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE cowork_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'custom',
      preset_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.prepare('INSERT INTO cowork_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run('workingDirectory', '/repo/legacy', now);
  db.prepare(
    `INSERT INTO agents (
      id, name, description, system_prompt, identity, model, icon, skill_ids,
      enabled, is_default, source, preset_id, created_at, updated_at
    ) VALUES (?, ?, '', '', '', '', '', '[]', 1, ?, 'custom', '', ?, ?)`,
  ).run('main', 'main', 1, now, now);
  db.prepare(
    `INSERT INTO agents (
      id, name, description, system_prompt, identity, model, icon, skill_ids,
      enabled, is_default, source, preset_id, created_at, updated_at
    ) VALUES (?, ?, '', '', '', '', '', '[]', 1, ?, 'custom', '', ?, ?)`,
  ).run('docs', 'Docs', 0, now, now);

  db.close();
};

test('backfills agent working directories from legacy cowork config only once', async () => {
  const userDataPath = createTempUserDataPath();
  createLegacyDatabase(userDataPath);

  const store = await SqliteStore.create(userDataPath);
  const db = store.getDatabase();
  const rows = db.prepare('SELECT id, working_directory FROM agents ORDER BY id')
    .all() as Array<{ id: string; working_directory: string }>;

  expect(rows).toEqual([
    { id: 'docs', working_directory: '/repo/legacy' },
    { id: 'main', working_directory: '/repo/legacy' },
  ]);

  db.prepare("UPDATE agents SET working_directory = '' WHERE id = 'docs'").run();
  store.close();

  const reopenedStore = await SqliteStore.create(userDataPath);
  const reopenedRows = reopenedStore.getDatabase()
    .prepare('SELECT id, working_directory FROM agents ORDER BY id')
    .all() as Array<{ id: string; working_directory: string }>;

  expect(reopenedRows).toEqual([
    { id: 'docs', working_directory: '' },
    { id: 'main', working_directory: '/repo/legacy' },
  ]);

  reopenedStore.close();
});
