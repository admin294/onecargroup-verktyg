// Saved records: tiny JSON files under a persisted data dir. 7-day TTL.
// "Link, don't store" — records hold only extracted summaries + config (a few KB).
// NEVER images or PDFs. Live lookups are cached in memory elsewhere.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from './log.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const RECORDS_DIR = path.join(DATA_DIR, 'records');
const TTL_DAYS = Number(process.env.RECORD_TTL_DAYS || 7);
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function ensureDir() {
  fsSync.mkdirSync(RECORDS_DIR, { recursive: true });
}

/** Unguessable 10-char base62 id. */
function genId(len = 10) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % 62];
  return out;
}

function recordPath(id) {
  return path.join(RECORDS_DIR, `${id}.json`);
}

// Reject anything that isn't a clean base62 id so a caller can't traverse paths.
function isSafeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9]{6,16}$/.test(id);
}

/**
 * Persist a record. Payload is small JSON (mode, regnrs, summary, offer config).
 * @param {{mode:string, payload:object}} rec
 * @returns {Promise<{id:string, createdAt:string, mode:string, payload:object}>}
 */
export async function saveRecord({ mode, payload }) {
  ensureDir();
  let id = genId();
  // Extremely unlikely collision guard.
  for (let i = 0; i < 5 && fsSync.existsSync(recordPath(id)); i++) id = genId();

  const record = { id, createdAt: new Date().toISOString(), mode, payload };
  await fs.writeFile(recordPath(id), JSON.stringify(record), 'utf8');
  log.info(`record saved: ${id} mode=${mode}`);
  return record;
}

/** Load a record by id, or null if missing/expired/corrupt. */
export async function getRecord(id) {
  if (!isSafeId(id)) return null;
  let raw;
  try {
    raw = await fs.readFile(recordPath(id), 'utf8');
  } catch {
    return null;
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    log.warn(`record ${id} corrupt JSON`);
    return null;
  }
  // Expired records are treated as gone even before the sweep removes them.
  if (isExpired(record.createdAt)) {
    log.info(`record ${id} expired (lazy)`);
    return null;
  }
  return record;
}

function isExpired(createdAt) {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > TTL_MS;
}

/**
 * Delete every record older than the TTL. Returns count removed.
 * Logs each deletion. Safe to call repeatedly (hourly sweep).
 */
export async function cleanupExpired() {
  ensureDir();
  let removed = 0;
  let entries;
  try {
    entries = await fs.readdir(RECORDS_DIR);
  } catch {
    return 0;
  }
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(RECORDS_DIR, file);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const record = JSON.parse(raw);
      if (isExpired(record.createdAt)) {
        await fs.unlink(full);
        removed++;
        log.info(`cleanup removed expired record: ${record.id} (created ${record.createdAt})`);
      }
    } catch (err) {
      // Corrupt file — remove it so it can't accumulate.
      await fs.unlink(full).catch(() => {});
      log.warn(`cleanup removed unreadable record file ${file}: ${err.message}`);
      removed++;
    }
  }
  log.info(`cleanup sweep done: ${removed} removed, TTL=${TTL_DAYS}d`);
  return removed;
}

/** Start the hourly cleanup timer. Returns the interval handle. */
export function startCleanupTimer() {
  cleanupExpired().catch((e) => log.error('initial cleanup failed:', e.message));
  const handle = setInterval(() => {
    cleanupExpired().catch((e) => log.error('cleanup failed:', e.message));
  }, 60 * 60 * 1000);
  handle.unref?.();
  log.info(`cleanup timer started (hourly, TTL=${TTL_DAYS}d, dir=${RECORDS_DIR})`);
  return handle;
}

export const _internals = { DATA_DIR, RECORDS_DIR, TTL_DAYS, TTL_MS, genId, isExpired };
