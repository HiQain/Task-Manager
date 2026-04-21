import session from "express-session";
import type { Pool } from "mysql2/promise";
import { pool } from "./db";

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function getSessionUserId(sess: session.SessionData): number | null {
  const userId = Number(sess?.userId);
  return Number.isFinite(userId) ? userId : null;
}

function getSessionExpiry(sess: session.SessionData): Date {
  const cookie = sess?.cookie as { expires?: string | Date | null; maxAge?: number | null } | undefined;

  if (cookie?.expires) {
    const parsed = cookie.expires instanceof Date ? cookie.expires : new Date(cookie.expires);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const maxAge = Number(cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    return new Date(Date.now() + maxAge);
  }

  return new Date(Date.now() + DEFAULT_SESSION_TTL_MS);
}

export class MySqlSessionStore extends session.Store {
  private readonly pool: Pool;

  constructor(dbPool: Pool = pool) {
    super();
    this.pool = dbPool;

    const pruneTimer = setInterval(() => {
      void this.pruneExpiredSessions();
    }, 1000 * 60 * 30);
    pruneTimer.unref();
  }

  override get(
    sid: string,
    callback: (err: unknown, session?: session.SessionData | null) => void,
  ): void {
    void this.getSession(sid)
      .then((currentSession) => callback(null, currentSession))
      .catch((error) => callback(error));
  }

  override set(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    void this.saveSession(sid, sess)
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    void this.pool
      .execute("DELETE FROM user_sessions WHERE sid = ?", [sid])
      .then(() => callback?.())
      .catch((error) => callback?.(error));
  }

  override touch(
    sid: string,
    sess: session.SessionData,
    callback?: () => void,
  ): void {
    const expiresAt = getSessionExpiry(sess);
    const userId = getSessionUserId(sess);

    void this.pool
      .execute(
        `
          UPDATE user_sessions
          SET expires_at = ?, user_id = ?
          WHERE sid = ?
        `,
        [expiresAt, userId, sid],
      )
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  async getActiveSessionIdForUser(userId: number, excludeSid?: string): Promise<string | null> {
    const sql = excludeSid
      ? `
          SELECT sid
          FROM user_sessions
          WHERE user_id = ?
            AND sid <> ?
            AND expires_at > UTC_TIMESTAMP()
          ORDER BY updated_at DESC
          LIMIT 1
        `
      : `
          SELECT sid
          FROM user_sessions
          WHERE user_id = ?
            AND expires_at > UTC_TIMESTAMP()
          ORDER BY updated_at DESC
          LIMIT 1
        `;
    const params = excludeSid ? [userId, excludeSid] : [userId];
    const [rows] = await this.pool.execute(sql, params);
    const firstRow = Array.isArray(rows) ? (rows[0] as { sid?: unknown } | undefined) : undefined;
    return typeof firstRow?.sid === "string" ? firstRow.sid : null;
  }

  async destroyUserSessions(userId: number, excludeSid?: string): Promise<void> {
    if (excludeSid) {
      await this.pool.execute("DELETE FROM user_sessions WHERE user_id = ? AND sid <> ?", [userId, excludeSid]);
      return;
    }

    await this.pool.execute("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
  }

  private async getSession(sid: string): Promise<session.SessionData | null> {
    const [rows] = await this.pool.execute(
      `
        SELECT sess, expires_at
        FROM user_sessions
        WHERE sid = ?
        LIMIT 1
      `,
      [sid],
    );

    const firstRow = Array.isArray(rows)
      ? (rows[0] as { sess?: unknown; expires_at?: unknown } | undefined)
      : undefined;

    if (!firstRow) {
      return null;
    }

    const expiresAt = new Date(String(firstRow.expires_at || ""));
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      await this.pool.execute("DELETE FROM user_sessions WHERE sid = ?", [sid]);
      return null;
    }

    if (typeof firstRow.sess !== "string") {
      return null;
    }

    return JSON.parse(firstRow.sess) as session.SessionData;
  }

  private async saveSession(sid: string, sess: session.SessionData): Promise<void> {
    const serializedSession = JSON.stringify(sess);
    const expiresAt = getSessionExpiry(sess);
    const userId = getSessionUserId(sess);

    await this.pool.execute(
      `
        INSERT INTO user_sessions (sid, user_id, sess, expires_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          user_id = VALUES(user_id),
          sess = VALUES(sess),
          expires_at = VALUES(expires_at)
      `,
      [sid, userId, serializedSession, expiresAt],
    );
  }

  private async pruneExpiredSessions(): Promise<void> {
    await this.pool.execute("DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP()");
  }
}
