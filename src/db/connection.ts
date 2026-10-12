import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

export const DEFAULT_DB_PATH = fileURLToPath(new URL("../../data/circles.db", import.meta.url));
export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../data", import.meta.url));

export function openDb(path: string = DEFAULT_DB_PATH, options: Database.Options = {}): DB {
  const db = new Database(path, options);
  db.pragma("foreign_keys = ON");
  return db;
}
