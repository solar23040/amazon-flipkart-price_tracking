import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Open (creating if needed) the SQLite database with the settings the plan calls for. */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
