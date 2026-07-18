import { DatabaseSync } from "node:sqlite";
import type { FiredEvent, Listener } from "@companion/shared";
import { DB_PATH } from "./config.js";

// Node 25's built-in SQLite — no native build step required.
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS listeners (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS seen (
    listener_id TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    PRIMARY KEY (listener_id, dedup_key)
  );
  CREATE TABLE IF NOT EXISTS fired_events (
    id TEXT PRIMARY KEY,
    listener_id TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

export function upsertListener(listener: Listener): void {
  db.prepare(
    `INSERT INTO listeners (id, data, created_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  ).run(listener.id, JSON.stringify(listener), listener.createdAt);
}

export function getListener(id: string): Listener | undefined {
  const row = db.prepare(`SELECT data FROM listeners WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  if (!row) return undefined;
  return JSON.parse(row.data) as Listener;
}

export function listListeners(): Listener[] {
  const rows = db
    .prepare(`SELECT data FROM listeners ORDER BY created_at ASC`)
    .all() as { data: string }[];
  return rows.map((row) => JSON.parse(row.data) as Listener);
}

export function deleteListener(id: string): void {
  db.prepare(`DELETE FROM listeners WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM seen WHERE listener_id = ?`).run(id);
  db.prepare(`DELETE FROM fired_events WHERE listener_id = ?`).run(id);
}

// Returns true if this (listener, key) pair was newly inserted (i.e. not seen
// before). The UNIQUE constraint makes dedup atomic and deterministic.
export function markSeen(listenerId: string, dedupKey: string, now: number): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO seen (listener_id, dedup_key, first_seen) VALUES (?, ?, ?)`
    )
    .run(listenerId, dedupKey, now);
  return result.changes === 1;
}

export function insertFiredEvent(event: FiredEvent): void {
  db.prepare(
    `INSERT INTO fired_events (id, listener_id, data, timestamp) VALUES (?, ?, ?, ?)`
  ).run(event.id, event.listenerId, JSON.stringify(event), event.timestamp);
}

export function getFiredEvents(listenerId: string, limit = 50): FiredEvent[] {
  const rows = db
    .prepare(
      `SELECT data FROM fired_events WHERE listener_id = ? ORDER BY timestamp DESC LIMIT ?`
    )
    .all(listenerId, limit) as { data: string }[];
  return rows.map((row) => JSON.parse(row.data) as FiredEvent);
}

export function getAllFiredEvents(limit = 100): FiredEvent[] {
  const rows = db
    .prepare(`SELECT data FROM fired_events ORDER BY timestamp DESC LIMIT ?`)
    .all(limit) as { data: string }[];
  return rows.map((row) => JSON.parse(row.data) as FiredEvent);
}
