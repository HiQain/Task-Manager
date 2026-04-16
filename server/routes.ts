import type { Express, Request } from "express";
import type { Server } from "http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import crypto from "crypto";
import webpush from "web-push";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

const activeSessionByUserId = new Map<number, string>();
const pendingCallsByUserId = new Map<number, { fromUserId: number; signal: any; createdAt: number }>();
const routesDir = path.dirname(fileURLToPath(import.meta.url));

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

function getAssignedUserIds(task: any): number[] {
  const rawAssignedToIds = task?.assignedToIds;
  if (Array.isArray(rawAssignedToIds)) {
    const ids = rawAssignedToIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
    if (ids.length > 0) return ids;
  }

  if (typeof rawAssignedToIds === "string") {
    try {
      const parsed = JSON.parse(rawAssignedToIds);
      if (Array.isArray(parsed)) {
        const ids = parsed.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
        if (ids.length > 0) return ids;
      }
    } catch {
      // ignore invalid payload
    }
  }

  if (typeof task?.assignedToId === "number" && Number.isFinite(task.assignedToId)) {
    return [task.assignedToId];
  }
  return [];
}

function canUserAccessTask(user: any, task: any): boolean {
  if (!user || !task) return false;
  if (task.createdById === user.id) return true;
  return getAssignedUserIds(task).includes(user.id);
}

function isAdminUser(user: any): boolean {
  return String(user?.role || "").toLowerCase() === "admin";
}

function hasStorageFeature(user: any): boolean {
  return !!user && !!user.allowStorage;
}

function hasClientCredsFeature(user: any): boolean {
  return !!user && (isAdminUser(user) || !!user.allowClientCreds);
}

function isUserActive(user: any): boolean {
  return !!user && user.isActive !== false;
}

function isDeletedUser(user: any): boolean {
  const email = String(user?.email || "").toLowerCase();
  const password = String(user?.password || "");
  const role = String(user?.role || "").toLowerCase();
  return role === "deleted" || email.endsWith("@deleted.local") || password.startsWith("__deleted__:");
}

function getTaskParticipantIds(task: any): number[] {
  const ids = new Set<number>();
  if (typeof task?.createdById === "number" && Number.isFinite(task.createdById)) {
    ids.add(task.createdById);
  }
  getAssignedUserIds(task).forEach((id) => ids.add(id));
  return Array.from(ids);
}

async function getActiveTaskParticipants(task: any) {
  const participantIds = getTaskParticipantIds(task);
  if (participantIds.length === 0) return [];
  const allUsers = await storage.getUsers();
  return allUsers.filter((member) => participantIds.includes(member.id));
}

async function canTaskHaveGroupChat(task: any): Promise<boolean> {
  const activeParticipants = await getActiveTaskParticipants(task);
  const activeNonAdminParticipants = activeParticipants.filter((member) => !isAdminUser(member));
  return activeNonAdminParticipants.length >= 2;
}

function normalizeMentionToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function extractMentionedUserIds(
  content: string,
  users: Array<{ id: number; name?: string | null; email?: string | null }>
): number[] {
  if (!content) return [];
  const matches = Array.from(content.matchAll(/@([a-z0-9._-]+)/gi));
  if (matches.length === 0) return [];

  const tokens = new Set(matches.map((m) => normalizeMentionToken(m[1])));
  const mentionedIds = new Set<number>();

  users.forEach((member) => {
    if (!member?.id) return;
    const keys = new Set<string>();
    const name = String(member.name || "").trim();
    const email = String(member.email || "").trim();
    if (email) {
      const emailKey = email.split("@")[0] || email;
      keys.add(normalizeMentionToken(emailKey));
    }
    if (name) {
      keys.add(normalizeMentionToken(name));
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts[0]) keys.add(normalizeMentionToken(parts[0]));
      if (parts.length > 1) keys.add(normalizeMentionToken(parts[parts.length - 1]));
    }
    for (const key of Array.from(keys)) {
      if (key && tokens.has(key)) {
        mentionedIds.add(member.id);
        break;
      }
    }
  });

  return Array.from(mentionedIds);
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
      }
    } catch {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function parseStringSlots(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim());
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry || "").trim());
      }
    } catch {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }
  }
  return [];
}

function canManageTodoList(user: any, list: any): boolean {
  if (!user || !list) return false;
  return isAdminUser(user) || list.createdById === user.id;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const isProduction = process.env.NODE_ENV === "production";
  const sessionCookieSameSiteRaw = (process.env.SESSION_COOKIE_SAME_SITE || "lax").toLowerCase();
  const sessionCookieSameSite: "lax" | "strict" | "none" =
    sessionCookieSameSiteRaw === "strict" || sessionCookieSameSiteRaw === "none"
      ? (sessionCookieSameSiteRaw as "strict" | "none")
      : "lax";
  const sessionCookieSecure =
    (process.env.SESSION_COOKIE_SECURE || "").toLowerCase() === "true" ||
    (isProduction && sessionCookieSameSite === "none");

  const wsClientsByUserId = new Map<number, Set<WebSocket>>();
  const activeChatPairsByUserId = new Map<number, Map<number, number>>();
  const activeTaskGroupsByUserId = new Map<number, Map<number, number>>();
  const userPresenceByUserId = new Map<number, { isOnline: boolean; lastSeenAt: string | null }>();

  const addActiveChatPair = (userId: number, otherUserId: number) => {
    if (!activeChatPairsByUserId.has(userId)) {
      activeChatPairsByUserId.set(userId, new Map<number, number>());
    }
    const pairs = activeChatPairsByUserId.get(userId)!;
    pairs.set(otherUserId, (pairs.get(otherUserId) || 0) + 1);
  };

  const removeActiveChatPair = (userId: number, otherUserId: number) => {
    const pairs = activeChatPairsByUserId.get(userId);
    if (!pairs) return;
    const current = pairs.get(otherUserId) || 0;
    if (current <= 1) {
      pairs.delete(otherUserId);
    } else {
      pairs.set(otherUserId, current - 1);
    }
    if (pairs.size === 0) {
      activeChatPairsByUserId.delete(userId);
    }
  };

  const isUserViewingChatWith = (userId: number, otherUserId: number) => {
    const pairs = activeChatPairsByUserId.get(userId);
    return !!pairs && (pairs.get(otherUserId) || 0) > 0;
  };

  const addActiveTaskGroup = (userId: number, taskId: number) => {
    if (!activeTaskGroupsByUserId.has(userId)) {
      activeTaskGroupsByUserId.set(userId, new Map<number, number>());
    }
    const groups = activeTaskGroupsByUserId.get(userId)!;
    groups.set(taskId, (groups.get(taskId) || 0) + 1);
  };

  const removeActiveTaskGroup = (userId: number, taskId: number) => {
    const groups = activeTaskGroupsByUserId.get(userId);
    if (!groups) return;
    const current = groups.get(taskId) || 0;
    if (current <= 1) {
      groups.delete(taskId);
    } else {
      groups.set(taskId, current - 1);
    }
    if (groups.size === 0) {
      activeTaskGroupsByUserId.delete(userId);
    }
  };

  const isUserViewingTaskGroup = (userId: number, taskId: number) => {
    const groups = activeTaskGroupsByUserId.get(userId);
    return !!groups && (groups.get(taskId) || 0) > 0;
  };

  const emitToUser = (userId: number, payload: Record<string, unknown>) => {
    const clients = wsClientsByUserId.get(userId);
    if (!clients || clients.size === 0) return;
    const message = JSON.stringify(payload);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  const emitToAllConnectedUsers = (payload: Record<string, unknown>) => {
    wsClientsByUserId.forEach((_clients, connectedUserId) => {
      emitToUser(connectedUserId, payload);
    });
  };

  const pushUnreadUpdate = async (userId: number) => {
    const counts = await storage.getUnreadCountsForUser(userId);
    emitToUser(userId, { type: "unread:update", payload: counts });
  };

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@hiqain.com";
  const pushEnabled = !!vapidPublicKey && !!vapidPrivateKey;

  if (pushEnabled) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  }

  const sendPushToUser = async (
    userId: number,
    payload: { title: string; body?: string; url?: string; tag?: string },
  ) => {
    if (!pushEnabled) return;
    const subscriptions = await storage.getPushSubscriptions(userId);
    if (subscriptions.length === 0) return;
    const data = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            data,
          );
        } catch (err: any) {
          const statusCode = err?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await storage.deletePushSubscription(userId, sub.endpoint);
          }
        }
      }),
    );
  };

  const emitNotification = async (
    userIds: Iterable<number>,
    payload: {
      title: string;
      description: string;
      variant?: "default" | "destructive";
      actorUserId?: number;
      type?: string;
      entityType?: string;
      entityId?: number;
    }
  ) => {
    const uniqueUserIds = new Set<number>(userIds);
    await Promise.all(
      Array.from(uniqueUserIds).map(async (userId) => {
        const notification = await storage.createNotification({
          userId,
          actorUserId: payload.actorUserId,
          type: payload.type || "info",
          title: payload.title,
          description: payload.description,
          entityType: payload.entityType,
          entityId: payload.entityId,
        });
        emitToUser(userId, {
          type: "notify",
          payload: {
            ...payload,
            id: notification.id,
          },
        });
        await sendPushToUser(userId, {
          title: payload.title,
          body: payload.description,
          url: payload.entityType === "task" ? "/board" : "/notifications",
          tag: payload.type || "notification",
        });
      })
    );
  };

  const pushTaskUpdateToRelevantUsers = async (
    action: "created" | "updated" | "deleted",
    task: any
  ) => {
    if (!task) return;
    const recipientIds = new Set<number>();
    if (typeof task.createdById === "number" && Number.isFinite(task.createdById)) {
      recipientIds.add(task.createdById);
    }
    getAssignedUserIds(task).forEach((id) => recipientIds.add(id));

    const allUsers = await storage.getUsers();
    allUsers
      .filter((u) => isAdminUser(u))
      .forEach((admin) => recipientIds.add(admin.id));

    recipientIds.forEach((userId) => {
      emitToUser(userId, {
        type: "task:changed",
        payload: {
          action,
          taskId: task.id,
          status: task.status,
        },
      });
    });
  };

  const toStatusLabel = (status: string | null | undefined) => {
    if (!status) return "To Do";
    if (status === "in_progress") return "In Progress";
    if (status === "done") return "Done";
    return "To Do";
  };

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", async (socket, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const userId = Number(url.searchParams.get("userId"));
    let activeRoomUserId: number | null = null;
    let activeTaskGroupId: number | null = null;
    if (!Number.isFinite(userId)) {
      socket.close();
      return;
    }

    const existing = await storage.getUser(userId);
    if (!existing) {
      socket.close();
      return;
    }

    if (!wsClientsByUserId.has(userId)) {
      wsClientsByUserId.set(userId, new Set<WebSocket>());
    }
    const userSockets = wsClientsByUserId.get(userId)!;
    const wasOffline = userSockets.size === 0;
    userSockets.add(socket);

    userPresenceByUserId.set(userId, { isOnline: true, lastSeenAt: null });
    if (wasOffline) {
      emitToAllConnectedUsers({
        type: "chat:presence",
        payload: { userId, isOnline: true, lastSeenAt: null },
      });
    }

    await pushUnreadUpdate(userId);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "chat:presence-snapshot",
          payload: Array.from(userPresenceByUserId.entries()).map(([presenceUserId, presence]) => ({
            userId: presenceUserId,
            isOnline: presence.isOnline,
            lastSeenAt: presence.lastSeenAt,
          })),
        }),
      );
    }

    const pendingCall = pendingCallsByUserId.get(userId);
    if (pendingCall && socket.readyState === WebSocket.OPEN) {
      const isFresh = Date.now() - pendingCall.createdAt < 35_000;
      if (isFresh) {
        socket.send(
          JSON.stringify({
            type: "webrtc:signal",
            payload: {
              fromUserId: pendingCall.fromUserId,
              signal: pendingCall.signal,
            },
          }),
        );
      } else {
        pendingCallsByUserId.delete(userId);
      }
    }

    socket.on("message", async (raw) => {
      try {
        const parsed = JSON.parse(String(raw || "{}"));
        const type = parsed?.type;
        const payload = parsed?.payload || {};

        if (type === "webrtc:signal") {
          const toUserId = Number(payload?.toUserId);
          if (!Number.isFinite(toUserId) || toUserId === userId) return;

          const signalType = payload?.signal?.type;
          if (signalType === "offer") {
            const targetSockets = wsClientsByUserId.get(toUserId);
            const isTargetOnline = !!targetSockets && targetSockets.size > 0;
            const targetActivePairs = activeChatPairsByUserId.get(toUserId);
            const isTargetInActiveChat = !!targetActivePairs && (targetActivePairs.get(userId) || 0) > 0;
            if (!isTargetOnline || !isTargetInActiveChat) {
              const caller = await storage.getUser(userId);
              const callerName = caller?.name || "Someone";
              void sendPushToUser(toUserId, {
                title: "Incoming call",
                body: `${callerName} is calling you.`,
                url: `/chat?userId=${userId}`,
                tag: `call-${userId}`,
              });
            }
            pendingCallsByUserId.set(toUserId, {
              fromUserId: userId,
              signal: payload?.signal,
              createdAt: Date.now(),
            });
          }

          if (signalType === "answer" || signalType === "decline" || signalType === "hangup") {
            pendingCallsByUserId.delete(userId);
          }

          emitToUser(toUserId, {
            type: "webrtc:signal",
            payload: {
              fromUserId: userId,
              signal: payload?.signal,
            },
          });
          return;
        }

        if (type === "chat:active-room") {
          const rawActiveUserId = payload?.activeUserId;
          const nextActiveUserId = rawActiveUserId == null ? null : Number(rawActiveUserId);
          if (nextActiveUserId !== null && (!Number.isFinite(nextActiveUserId) || nextActiveUserId === userId)) {
            return;
          }

          if (activeRoomUserId !== null) {
            removeActiveChatPair(userId, activeRoomUserId);
          }
          activeRoomUserId = nextActiveUserId;
          if (activeRoomUserId !== null) {
            addActiveChatPair(userId, activeRoomUserId);
            void storage
              .markMessagesAsRead(userId, activeRoomUserId)
              .then(() => pushUnreadUpdate(userId))
              .catch(() => {});
          }
          return;
        }

        if (type === "chat:active-task-group") {
          const rawTaskId = payload?.activeTaskId;
          const nextTaskId = rawTaskId == null ? null : Number(rawTaskId);
          if (nextTaskId !== null && !Number.isFinite(nextTaskId)) {
            return;
          }

          if (activeTaskGroupId !== null) {
            removeActiveTaskGroup(userId, activeTaskGroupId);
          }
          activeTaskGroupId = nextTaskId;
          if (activeTaskGroupId !== null) {
            addActiveTaskGroup(userId, activeTaskGroupId);
          }
          return;
        }

        if (type === "chat:typing") {
          const toUserId = Number(payload?.toUserId);
          if (!Number.isFinite(toUserId) || toUserId === userId) {
            return;
          }
          emitToUser(toUserId, {
            type: "chat:typing",
            payload: {
              fromUserId: userId,
              isTyping: !!payload?.isTyping,
            },
          });
          return;
        }
      } catch {
        // ignore invalid socket payload
      }
    });

    socket.on("close", () => {
      if (activeRoomUserId !== null) {
        removeActiveChatPair(userId, activeRoomUserId);
      }
      if (activeTaskGroupId !== null) {
        removeActiveTaskGroup(userId, activeTaskGroupId);
      }
      const clients = wsClientsByUserId.get(userId);
      if (!clients) return;
      clients.delete(socket);
      if (clients.size === 0) {
        wsClientsByUserId.delete(userId);
        const lastSeenAt = new Date().toISOString();
        userPresenceByUserId.set(userId, { isOnline: false, lastSeenAt });
        emitToAllConnectedUsers({
          type: "chat:presence",
          payload: { userId, isOnline: false, lastSeenAt },
        });
      }
    });
  });

  // Session middleware
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "your-secret-key",
      resave: false,
      saveUninitialized: false,
      proxy: isProduction,
      cookie: {
        httpOnly: true,
        secure: sessionCookieSecure,
        sameSite: sessionCookieSameSite,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  // Auth middleware to attach user to request
  app.use((req, res, next) => {
    if (req.session.userId) {
      const activeSessionId = activeSessionByUserId.get(req.session.userId);
      if (activeSessionId && activeSessionId !== req.sessionID) {
        req.session.destroy(() => {
          // ignore destroy errors
        });
        req.user = undefined;
        return next();
      }
      storage.getUser(req.session.userId).then((user) => {
        if (user && (isDeletedUser(user) || !isUserActive(user))) {
          activeSessionByUserId.delete(req.session.userId as number);
          req.session.userId = undefined;
          req.user = undefined;
          return next();
        }
        req.user = user;
        next();
      });
    } else {
      next();
    }
  });

  // Auth Endpoints
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);
      const user = await storage.getUserByEmail(input.email);

      if (!user || isDeletedUser(user)) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      if (!isUserActive(user)) {
        return res.status(401).json({ message: "This account has been deactivated. Please contact an administrator." });
      }
      if (!verifyPassword(input.password, user.password)) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const existingSessionId = activeSessionByUserId.get(user.id);
      if (existingSessionId && existingSessionId !== req.sessionID) {
        req.sessionStore.destroy(existingSessionId, () => {
          // ignore destroy errors
        });
      }

      req.session.userId = user.id;
      activeSessionByUserId.set(user.id, req.sessionID);
      res.json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.post(api.auth.logout.path, (req, res) => {
    if (req.session.userId) {
      const activeSessionId = activeSessionByUserId.get(req.session.userId);
      if (activeSessionId === req.sessionID) {
        activeSessionByUserId.delete(req.session.userId);
      }
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json(req.user);
  });

  app.post(api.auth.changePassword.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const input = api.auth.changePassword.input.parse(req.body);
      if (!verifyPassword(input.currentPassword, req.user.password)) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      await storage.updateUser(req.user.id, { password: input.newPassword, mustChangePassword: false } as any);
      res.json({ message: "Password updated" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  // Users API
  app.get(api.users.list.path, async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.post(api.users.create.path, async (req, res) => {
    // Only admins can create users
    if (!req.user || !isAdminUser(req.user)) {
      return res.status(403).json({ message: 'Only admins can create users' });
    }

    try {
      const input = api.users.create.input.parse(req.body);
      const user = await storage.createUser({
        ...input,
        allowStorage: input.role === "admin" ? true : !!input.allowStorage,
        allowClientCreds: input.role === "admin" ? true : !!input.allowClientCreds,
      });
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.patch(api.users.update.path, async (req, res) => {
    if (!req.user || !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Only admins can update users" });
    }

    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid user id" });
      }

      const existing = await storage.getUser(id);
      if (!existing) {
        return res.status(404).json({ message: "User not found" });
      }

      const input = api.users.update.input.parse(req.body);
      const mergedRole = input.role || existing.role;
      const mergedAllowStorage =
        mergedRole === "admin"
          ? true
          : input.allowStorage !== undefined
            ? !!input.allowStorage
            : !!existing.allowStorage;
      const mergedAllowClientCreds =
        mergedRole === "admin"
          ? true
          : input.allowClientCreds !== undefined
            ? !!input.allowClientCreds
            : !!existing.allowClientCreds;
      const updatedUser = await storage.updateUser(id, {
        ...input,
        allowStorage: mergedAllowStorage,
        allowClientCreds: mergedAllowClientCreds,
      });
      res.json(updatedUser);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.post(api.users.updateStatus.path, async (req, res) => {
    if (!req.user || !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Only admins can update user status" });
    }

    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid user id" });
      }
      if (id === req.user.id) {
        return res.status(400).json({ message: "You cannot deactivate your own account" });
      }

      const existing = await storage.getUser(id);
      if (!existing) {
        return res.status(404).json({ message: "User not found" });
      }

      const input = api.users.updateStatus.input.parse(req.body);

      if (!input.isActive) {
        const updatedUser = await storage.updateUser(id, {
          isActive: false,
          mustChangePassword: false,
        } as any);

        const activeSessionId = activeSessionByUserId.get(id);
        if (activeSessionId) {
          req.sessionStore.destroy(activeSessionId, () => {
            // ignore destroy errors
          });
          activeSessionByUserId.delete(id);
        }

        const sockets = wsClientsByUserId.get(id);
        sockets?.forEach((socket) => socket.close());
        wsClientsByUserId.delete(id);

        return res.json(updatedUser);
      }

      const activationPassword = String(input.activationPassword || "").trim();
      if (!activationPassword) {
        return res.status(400).json({ message: "A temporary password is required to reactivate this account." });
      }

      const updatedUser = await storage.updateUser(id, {
        isActive: true,
        password: activationPassword,
        mustChangePassword: true,
      } as any);

      res.json(updatedUser);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.users.delete.path, async (req, res) => {
    if (!req.user || !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Only admins can delete users" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (id === req.user.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const existing = await storage.getUser(id);
    if (!existing) {
      return res.status(404).json({ message: "User not found" });
    }
    await storage.deleteUser(id);
    res.status(204).send();
  });

  // Notifications API
  app.get(api.notifications.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const notifications = await storage.getNotificationsForUser(req.user.id);
    res.json(notifications);
  });

  app.get(api.notifications.unread.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const count = await storage.getNotificationUnreadCount(req.user.id);
    res.json({ count });
  });

  app.post(api.notifications.markRead.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const existing = await storage.getNotification(id);
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ message: "Notification not found" });
    }
    await storage.markNotificationRead(id);
    res.json({ success: true });
  });

  app.post(api.notifications.markAllRead.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    await storage.markAllNotificationsRead(req.user.id);
    res.json({ success: true });
  });

  app.delete(api.notifications.delete.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const existing = await storage.getNotification(id);
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ message: "Notification not found" });
    }
    await storage.deleteNotification(id);
    res.json({ success: true });
  });

  // Todo Lists API
  app.get(api.todos.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const allLists = await storage.getTodoLists();
    const visibleLists = isAdminUser(req.user)
      ? allLists
      : allLists.filter((list) => list.createdById === req.user.id);
    const allUsers = await storage.getUsers();

    const payload = await Promise.all(
      visibleLists.map(async (list) => {
        const items = await storage.getTodoItems(list.id);
        const creator = allUsers.find((user) => user.id === list.createdById);
        return {
          list,
          items,
          creatorName: creator?.name || "Unknown user",
          canEdit: canManageTodoList(req.user, list),
        };
      }),
    );

    res.json({ lists: payload });
  });

  app.post(api.todos.createList.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const input = api.todos.createList.input.parse(req.body);
      const list = await storage.createTodoList({ ...input, createdById: req.user.id });
      res.status(201).json(list);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.patch(api.todos.updateList.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid list id" });
      }
      const existing = await storage.getTodoList(id);
      if (!existing) {
        return res.status(404).json({ message: "Todo list not found" });
      }
      if (!canManageTodoList(req.user, existing)) {
        return res.status(403).json({ message: "You do not have permission to edit this list" });
      }
      const input = api.todos.updateList.input.parse(req.body);
      const updated = await storage.updateTodoList(id, input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.todos.deleteList.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid list id" });
    }

    const existing = await storage.getTodoList(id);
    if (!existing) {
      return res.status(404).json({ message: "Todo list not found" });
    }
    if (!canManageTodoList(req.user, existing)) {
      return res.status(403).json({ message: "You do not have permission to delete this list" });
    }

    await storage.deleteTodoList(id);
    res.json({ success: true });
  });

  app.post(api.todos.createItem.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const listId = Number(req.params.id);
      if (!Number.isFinite(listId)) {
        return res.status(400).json({ message: "Invalid list id" });
      }
      const existingList = await storage.getTodoList(listId);
      if (!existingList) {
        return res.status(404).json({ message: "Todo list not found" });
      }
      if (!canManageTodoList(req.user, existingList)) {
        return res.status(403).json({ message: "You do not have permission to edit this list" });
      }
      const input = api.todos.createItem.input.parse(req.body);
      const item = await storage.createTodoItem({ ...input, listId });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.patch(api.todos.updateItem.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid item id" });
      }
      const existingItem = await storage.getTodoItem(id);
      if (!existingItem) {
        return res.status(404).json({ message: "Todo item not found" });
      }
      const existingList = await storage.getTodoList(existingItem.listId);
      if (!existingList) {
        return res.status(404).json({ message: "Todo list not found" });
      }
      if (!canManageTodoList(req.user, existingList)) {
        return res.status(403).json({ message: "You do not have permission to edit this list" });
      }
      const input = api.todos.updateItem.input.parse(req.body);
      const updated = await storage.updateTodoItem(id, input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.todos.deleteItem.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid item id" });
    }
    const existingItem = await storage.getTodoItem(id);
    if (!existingItem) {
      return res.status(404).json({ message: "Todo item not found" });
    }
    const existingList = await storage.getTodoList(existingItem.listId);
    if (!existingList) {
      return res.status(404).json({ message: "Todo list not found" });
    }
    if (!canManageTodoList(req.user, existingList)) {
      return res.status(403).json({ message: "You do not have permission to edit this list" });
    }

    await storage.deleteTodoItem(id);
    res.json({ success: true });
  });

  // Push Notifications API
  app.get(api.push.vapid.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!pushEnabled) {
      return res.status(400).json({ message: "Push is not configured" });
    }
    res.json({ publicKey: vapidPublicKey });
  });

  app.post(api.push.subscribe.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const input = api.push.subscribe.input.parse(req.body);
      await storage.upsertPushSubscription(req.user.id, input);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.post(api.push.unsubscribe.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const endpoint = String(req.body?.endpoint || "").trim();
    if (!endpoint) {
      return res.status(400).json({ message: "Missing endpoint" });
    }
    await storage.deletePushSubscription(req.user.id, endpoint);
    res.json({ success: true });
  });

  // Reminders API (sync from client)
  app.post(api.reminders.sync.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const input = api.reminders.sync.input.parse(req.body);
      await storage.syncReminders(req.user.id, input.items);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  // Shared Storage API
  app.get(api.storage.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!hasStorageFeature(req.user)) {
      return res.status(403).json({ message: "Storage access is disabled for your account" });
    }

    const allUsers = await storage.getUsers();
    const usersById = new Map(allUsers.map((u) => [u.id, u]));
    const projects = await storage.getStorageProjects();
    const resolvedProjects = await Promise.all(
      projects.map(async (project) => {
        const accesses = await storage.getStorageProjectAccesses(project.id);
        const ownAccess = accesses.find((m) => m.userId === req.user.id);
        const canDelete = isAdminUser(req.user) || project.createdById === req.user.id;
        const canEdit = canDelete || ownAccess?.access === "edit";
        const canView = canEdit || ownAccess?.access === "view";
        if (!canView) return null;

        const files = await storage.getStorageFiles(project.id);
        const members = accesses
          .map((member) => {
            const memberUser = usersById.get(member.userId);
            if (!memberUser) return null;
            return {
              userId: member.userId,
              name: memberUser.name,
              access: member.access === "edit" ? "edit" as const : "view" as const,
            };
          })
          .filter((v): v is { userId: number; name: string; access: "view" | "edit" } => !!v);

        return {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          files,
          canEdit,
          canDelete,
          members,
        };
      }),
    );

    const projectsWithFiles = resolvedProjects.filter((p): p is NonNullable<typeof p> => !!p);
    const usedBytes = projectsWithFiles.reduce(
      (sum, project) => sum + project.files.reduce((fileSum, file) => fileSum + (Number(file.size) || 0), 0),
      0,
    );
    const quotaBytes = Math.max(1, Number(process.env.STORAGE_QUOTA_BYTES || 2 * 1024 * 1024 * 1024));

    res.json({
      projects: projectsWithFiles,
      usedBytes,
      quotaBytes,
    });
  });

  app.post(api.storage.createProject.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasStorageFeature(req.user)) {
      return res.status(403).json({ message: "Storage access is disabled for your account" });
    }

    try {
      const input = api.storage.createProject.input.parse(req.body);
      const project = await storage.createStorageProject({
        name: input.name,
        createdById: req.user.id,
      });
      const allUsers = await storage.getUsers();
      const storageEnabledUserIds = new Set(
        allUsers.filter((u) => !!u.allowStorage).map((u) => u.id),
      );
      const members: Array<{ userId: number; access: "view" | "edit" }> = Array.from(
        new Map(
          (input.members || [])
            .filter((member) =>
              Number.isFinite(member.userId) &&
              member.userId !== req.user.id &&
              storageEnabledUserIds.has(member.userId),
            )
            .map((member) => [member.userId, { userId: member.userId, access: member.access === "edit" ? "edit" as const : "view" as const }]),
        ).values(),
      );
      await storage.replaceStorageProjectAccesses(project.id, members);
      if (members.length > 0) {
        await Promise.all(
          members.map((member) =>
            emitNotification([member.userId], {
              title: "Storage Access Granted",
              description: `${req.user.name} gave you ${member.access} access to project "${project.name}".`,
              actorUserId: req.user.id,
              type: "storage_access_granted",
              entityType: "storage_project",
              entityId: project.id,
            }),
          ),
        );
      }
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.storage.deleteProject.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasStorageFeature(req.user)) {
      return res.status(403).json({ message: "Storage access is disabled for your account" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid project id" });
    }
    const existing = (await storage.getStorageProjects()).find((project) => project.id === id);
    if (!existing) {
      return res.status(404).json({ message: "Project not found" });
    }
    const canDelete = isAdminUser(req.user) || existing.createdById === req.user.id;
    if (!canDelete) {
      return res.status(403).json({ message: "Only project owner/admin can delete project" });
    }
    await storage.deleteStorageProject(id);
    res.json({ success: true });
  });

  app.post(api.storage.addFile.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasStorageFeature(req.user)) {
      return res.status(403).json({ message: "Storage access is disabled for your account" });
    }
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }
    const existing = (await storage.getStorageProjects()).find((project) => project.id === projectId);
    if (!existing) {
      return res.status(404).json({ message: "Project not found" });
    }
    const accessRows = await storage.getStorageProjectAccesses(projectId);
    const ownAccess = accessRows.find((entry) => entry.userId === req.user.id);
    const canEdit = isAdminUser(req.user) || existing.createdById === req.user.id || ownAccess?.access === "edit";
    if (!canEdit) {
      return res.status(403).json({ message: "Edit access required" });
    }

    try {
      const input = api.storage.addFile.input.parse(req.body);
      const file = await storage.createStorageFile({
        projectId,
        createdById: req.user.id,
        name: input.name,
        type: input.type || "application/octet-stream",
        size: input.size,
        dataUrl: input.dataUrl,
      });
      res.status(201).json(file);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.storage.deleteFile.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasStorageFeature(req.user)) {
      return res.status(403).json({ message: "Storage access is disabled for your account" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "Invalid file id" });
    }
    const existing = await storage.getStorageFile(id);
    if (!existing) {
      return res.status(404).json({ message: "File not found" });
    }
    const project = (await storage.getStorageProjects()).find((p) => p.id === existing.projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const accessRows = await storage.getStorageProjectAccesses(project.id);
    const ownAccess = accessRows.find((entry) => entry.userId === req.user.id);
    const canEdit = isAdminUser(req.user) || project.createdById === req.user.id || ownAccess?.access === "edit";
    if (!canEdit) {
      return res.status(403).json({ message: "Edit access required" });
    }
    await storage.deleteStorageFile(id);
    res.json({ success: true });
  });

  app.post(api.storage.updateAccess.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasStorageFeature(req.user)) {
      return res.status(403).json({ message: "Storage access is disabled for your account" });
    }
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }
    const project = (await storage.getStorageProjects()).find((p) => p.id === projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const canManage = isAdminUser(req.user) || project.createdById === req.user.id;
    if (!canManage) {
      return res.status(403).json({ message: "Only project owner/admin can manage access" });
    }

    try {
      const input = api.storage.updateAccess.input.parse(req.body);
      const allUsers = await storage.getUsers();
      const storageEnabledUserIds = new Set(
        allUsers.filter((u) => !!u.allowStorage).map((u) => u.id),
      );
      const previousAccessRows = await storage.getStorageProjectAccesses(project.id);
      const previousByUserId = new Map(previousAccessRows.map((row) => [row.userId, row.access]));
      const members: Array<{ userId: number; access: "view" | "edit" }> = Array.from(
        new Map(
          (input.members || [])
            .filter((member) =>
              Number.isFinite(member.userId) &&
              member.userId !== project.createdById &&
              storageEnabledUserIds.has(member.userId),
            )
            .map((member) => [member.userId, { userId: member.userId, access: member.access === "edit" ? "edit" as const : "view" as const }]),
        ).values(),
      );
      await storage.replaceStorageProjectAccesses(project.id, members);
      const newlyGranted = members.filter((member) => {
        const prevAccess = previousByUserId.get(member.userId);
        return !prevAccess || prevAccess !== member.access;
      });
      if (newlyGranted.length > 0) {
        await Promise.all(
          newlyGranted.map((member) =>
            emitNotification([member.userId], {
              title: "Storage Access Updated",
              description: `${req.user.name} gave you ${member.access} access to project "${project.name}".`,
              actorUserId: req.user.id,
              type: "storage_access_granted",
              entityType: "storage_project",
              entityId: project.id,
            }),
          ),
        );
      }
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  // Client Creds API
  app.get(api.clientCreds.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasClientCredsFeature(req.user)) {
      return res.status(403).json({ message: "Client creds access is disabled for your account" });
    }

    const allUsers = await storage.getUsers();
    const usersById = new Map(allUsers.map((u) => [u.id, u]));
    const projects = await storage.getClientCredProjects();
    const resolvedProjects = await Promise.all(
      projects.map(async (project) => {
        const accesses = await storage.getClientCredProjectAccesses(project.id);
        const ownAccess = accesses.find((entry) => entry.userId === req.user.id);
        const canDelete = isAdminUser(req.user) || project.createdById === req.user.id;
        const canEdit = canDelete || ownAccess?.access === "edit";
        const canView = canEdit || ownAccess?.access === "view";
        if (!canView) return null;

        const members = accesses
          .map((member) => {
            const memberUser = usersById.get(member.userId);
            if (!memberUser) return null;
            return {
              userId: member.userId,
              name: memberUser.name,
              access: member.access === "edit" ? "edit" as const : "view" as const,
            };
          })
          .filter((value): value is { userId: number; name: string; access: "view" | "edit" } => !!value);

        const viaChannels = parseStringList(project.viaChannels);
        const emails = parseStringList(project.emails);
        const passwords = parseStringList(project.passwords);
        const rawLinks = parseStringSlots(project.link);
        const rowCount = Math.max(viaChannels.length, emails.length, passwords.length, rawLinks.length, 1);
        const links = Array.from({ length: rowCount }, (_, index) => rawLinks[index] || "");

        return {
          id: project.id,
          clientName: project.clientName,
          projectName: project.projectName,
          link: links.find((entry) => entry) || null,
          links,
          viaChannels,
          emails,
          passwords,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          canEdit,
          canDelete,
          members,
        };
      }),
    );

    res.json({
      projects: resolvedProjects.filter((project): project is NonNullable<typeof project> => !!project),
    });
  });

  app.post(api.clientCreds.createProject.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasClientCredsFeature(req.user)) {
      return res.status(403).json({ message: "Client creds access is disabled for your account" });
    }

    try {
      const input = api.clientCreds.createProject.input.parse(req.body);
      const project = await storage.createClientCredProject({
        clientName: input.clientName,
        projectName: input.projectName,
        links: input.links,
        link: input.link,
        viaChannels: input.viaChannels,
        emails: input.emails,
        passwords: input.passwords,
        members: input.members,
        createdById: req.user.id,
      });
      const allUsers = await storage.getUsers();
      const allowedUserIds = new Set(
        allUsers
          .filter((member) => member.role === "admin" || !!member.allowClientCreds)
          .map((member) => member.id),
      );
      const members: Array<{ userId: number; access: "view" | "edit" }> = Array.from(
        new Map(
          (input.members || [])
            .filter((member) =>
              Number.isFinite(member.userId) &&
              member.userId !== req.user.id &&
              allowedUserIds.has(member.userId),
            )
            .map((member) => [member.userId, { userId: member.userId, access: member.access === "edit" ? "edit" as const : "view" as const }]),
        ).values(),
      );
      await storage.replaceClientCredProjectAccesses(project.id, members);
      if (members.length > 0) {
        await Promise.all(
          members.map((member) =>
            emitNotification([member.userId], {
              title: "Client Creds Access Granted",
              description: `${req.user.name} gave you ${member.access} access to client creds "${project.clientName} / ${project.projectName}".`,
              actorUserId: req.user.id,
              type: "client_creds_access_granted",
              entityType: "client_cred_project",
              entityId: project.id,
            }),
          ),
        );
      }
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.patch(api.clientCreds.updateProject.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasClientCredsFeature(req.user)) {
      return res.status(403).json({ message: "Client creds access is disabled for your account" });
    }
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    const project = await storage.getClientCredProject(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const accessRows = await storage.getClientCredProjectAccesses(projectId);
    const ownAccess = accessRows.find((entry) => entry.userId === req.user.id);
    const canEdit = isAdminUser(req.user) || project.createdById === req.user.id || ownAccess?.access === "edit";
    if (!canEdit) {
      return res.status(403).json({ message: "Edit access required" });
    }

    try {
      const input = api.clientCreds.updateProject.input.parse(req.body);
      const updated = await storage.updateClientCredProject(projectId, input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.clientCreds.deleteProject.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasClientCredsFeature(req.user)) {
      return res.status(403).json({ message: "Client creds access is disabled for your account" });
    }
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    const project = await storage.getClientCredProject(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const canDelete = isAdminUser(req.user) || project.createdById === req.user.id;
    if (!canDelete) {
      return res.status(403).json({ message: "Only project owner/admin can delete project" });
    }

    await storage.deleteClientCredProject(projectId);
    res.json({ success: true });
  });

  app.post(api.clientCreds.updateAccess.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!hasClientCredsFeature(req.user)) {
      return res.status(403).json({ message: "Client creds access is disabled for your account" });
    }
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    const project = await storage.getClientCredProject(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const canManage = isAdminUser(req.user) || project.createdById === req.user.id;
    if (!canManage) {
      return res.status(403).json({ message: "Only project owner/admin can manage access" });
    }

    try {
      const input = api.clientCreds.updateAccess.input.parse(req.body);
      const allUsers = await storage.getUsers();
      const allowedUserIds = new Set(
        allUsers
          .filter((member) => member.role === "admin" || !!member.allowClientCreds)
          .map((member) => member.id),
      );
      const previousAccessRows = await storage.getClientCredProjectAccesses(project.id);
      const previousByUserId = new Map(previousAccessRows.map((row) => [row.userId, row.access]));
      const members: Array<{ userId: number; access: "view" | "edit" }> = Array.from(
        new Map(
          (input.members || [])
            .filter((member) =>
              Number.isFinite(member.userId) &&
              member.userId !== project.createdById &&
              allowedUserIds.has(member.userId),
            )
            .map((member) => [member.userId, { userId: member.userId, access: member.access === "edit" ? "edit" as const : "view" as const }]),
        ).values(),
      );
      await storage.replaceClientCredProjectAccesses(project.id, members);
      const newlyGranted = members.filter((member) => {
        const previousAccess = previousByUserId.get(member.userId);
        return !previousAccess || previousAccess !== member.access;
      });
      if (newlyGranted.length > 0) {
        await Promise.all(
          newlyGranted.map((member) =>
            emitNotification([member.userId], {
              title: "Client Creds Access Updated",
              description: `${req.user.name} gave you ${member.access} access to client creds "${project.clientName} / ${project.projectName}".`,
              actorUserId: req.user.id,
              type: "client_creds_access_granted",
              entityType: "client_cred_project",
              entityId: project.id,
            }),
          ),
        );
      }
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  // Tasks API
  app.get(api.tasks.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const tasks = await storage.getTasks();
    if (isAdminUser(req.user)) {
      return res.json(tasks);
    }

    const visibleTasks = tasks.filter((task) => canUserAccessTask(req.user, task));
    res.json(visibleTasks);
  });

  app.get(api.tasks.get.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const task = await storage.getTask(Number(req.params.id));
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    if (!isAdminUser(req.user) && !canUserAccessTask(req.user, task)) {
      return res.status(403).json({ message: "Not authorized to view this task" });
    }
    res.json(task);
  });

  app.post(api.tasks.create.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const input = api.tasks.create.input.parse(req.body);
      const task = await storage.createTask({
        ...input,
        createdById: req.user.id,
      });
      if (task.status !== "done" && await canTaskHaveGroupChat(task)) {
        await storage.ensureTaskChatGroup(task.id, req.user.id);
      }
      await pushTaskUpdateToRelevantUsers("created", task);
      const assignedUserIds = getAssignedUserIds(task).filter((id) => id !== req.user.id);
      if (assignedUserIds.length > 0) {
        await emitNotification(assignedUserIds, {
          title: "New Task Assigned",
          description: `${req.user.name} assigned "${task.title}" to you.`,
          actorUserId: req.user.id,
          type: "task_assigned",
          entityType: "task",
          entityId: task.id,
        });
      }
      res.status(201).json(task);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.patch(api.tasks.update.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const id = Number(req.params.id);
      const input = api.tasks.update.input.parse(req.body);

      const existing = await storage.getTask(id);
      if (!existing) {
        return res.status(404).json({ message: 'Task not found' });
      }
      const isAdmin = isAdminUser(req.user);
      const isCreator = existing.createdById === req.user.id;
      const isParticipant = canUserAccessTask(req.user, existing);
      const updateKeys = Object.keys(input || {});
      const participantEditableKeys = new Set(["status", "completed", "parentTaskId", "sortOrder"]);
      const isParticipantStructureUpdate =
        updateKeys.length > 0 && updateKeys.every((key) => participantEditableKeys.has(key));

      if (!isAdmin && !isCreator) {
        if (!(isParticipant && isParticipantStructureUpdate)) {
          return res.status(403).json({ message: "Only the task creator can edit this task" });
        }
      }

      const { createdById: _createdById, ...safeInput } = (input as any) || {};

      const updated = await storage.updateTask(id, safeInput);
      if (updated.status !== "done" && await canTaskHaveGroupChat(updated)) {
        await storage.ensureTaskChatGroup(updated.id, req.user.id);
      }
      await pushTaskUpdateToRelevantUsers("updated", updated);

      const prevAssigned = new Set<number>(getAssignedUserIds(existing));
      const nextAssigned = new Set<number>(getAssignedUserIds(updated));
      const addedAssignees = Array.from(nextAssigned).filter((id) => !prevAssigned.has(id) && id !== req.user.id);
      const removedAssignees = Array.from(prevAssigned).filter((id) => !nextAssigned.has(id) && id !== req.user.id);

      if (addedAssignees.length > 0) {
        await emitNotification(addedAssignees, {
          title: "Task Assignment",
          description: `${req.user.name} assigned "${updated.title}" to you.`,
          actorUserId: req.user.id,
          type: "task_assigned",
          entityType: "task",
          entityId: updated.id,
        });
      }

      if (removedAssignees.length > 0) {
        await emitNotification(removedAssignees, {
          title: "Task Unassigned",
          description: `${req.user.name} removed you from "${updated.title}".`,
          actorUserId: req.user.id,
          type: "task_unassigned",
          entityType: "task",
          entityId: updated.id,
        });
      }

      if (safeInput.status && safeInput.status !== existing.status) {
        const notifyUserIds = new Set<number>(
          [existing.createdById, ...getAssignedUserIds(updated)].filter(
            (id): id is number => typeof id === "number" && Number.isFinite(id)
          )
        );
        notifyUserIds.delete(req.user.id);
        await emitNotification(notifyUserIds, {
          title: "Task Status Updated",
          description: `${req.user.name} moved "${updated.title}" to ${toStatusLabel(updated.status)}.`,
          actorUserId: req.user.id,
          type: "task_status",
          entityType: "task",
          entityId: updated.id,
        });
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.tasks.delete.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const id = Number(req.params.id);
    const existing = await storage.getTask(id);
    if (!existing) {
      return res.status(404).json({ message: 'Task not found' });
    }
    if (existing.createdById !== req.user.id) {
      return res.status(403).json({ message: "Only the task creator can delete this task" });
    }
    await storage.deleteTask(id);
    await pushTaskUpdateToRelevantUsers("deleted", existing);
    res.status(204).send();
  });

  app.get(api.tasks.comments.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.id);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (!canUserAccessTask(req.user, task) && !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Not authorized to view comments" });
    }
    const comments = await storage.getTaskComments(taskId);
    res.json(comments);
  });

  app.post(api.tasks.comments.create.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.id);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (!canUserAccessTask(req.user, task) && !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Not authorized to comment" });
    }
    try {
      const input = api.tasks.comments.create.input.parse(req.body);
      const comment = await storage.createTaskComment({
        taskId,
        userId: req.user.id,
        content: input.content,
      });
      const allUsers = await storage.getUsers();
      const participantIds = getTaskParticipantIds(task);
      const mentionedIds = extractMentionedUserIds(input.content, allUsers);

      const mentionRecipients = new Set<number>();
      mentionedIds.forEach((id) => {
        const mentionedUser = allUsers.find((u) => u.id === id);
        if (!mentionedUser) return;
        if (isAdminUser(mentionedUser) || participantIds.includes(id)) {
          mentionRecipients.add(id);
        }
      });
      mentionRecipients.delete(req.user.id);

      const participantRecipients = new Set<number>(
        participantIds.filter((id) => id !== req.user.id),
      );
      mentionRecipients.forEach((id) => participantRecipients.delete(id));

      if (participantRecipients.size > 0) {
        await emitNotification(participantRecipients, {
          title: "New comment",
          description: `${req.user.name} commented on "${task.title}".`,
          actorUserId: req.user.id,
          type: "task_comment",
          entityType: "task",
          entityId: taskId,
        });
      }
      if (mentionRecipients.size > 0) {
        await emitNotification(mentionRecipients, {
          title: "You were mentioned",
          description: `${req.user.name} mentioned you in "${task.title}".`,
          actorUserId: req.user.id,
          type: "task_comment_mention",
          entityType: "task",
          entityId: taskId,
        });
      }
      res.status(201).json(comment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.patch(api.tasks.comments.update.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(taskId) || !Number.isFinite(commentId)) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (!canUserAccessTask(req.user, task) && !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Not authorized to edit comments" });
    }

    const existingComment = await storage.getTaskComment(commentId);
    if (!existingComment || existingComment.taskId !== taskId) {
      return res.status(404).json({ message: "Comment not found" });
    }
    if (existingComment.userId !== req.user.id && !isAdminUser(req.user)) {
      return res.status(403).json({ message: "Only the comment author can edit this comment" });
    }

    try {
      const input = api.tasks.comments.update.input.parse(req.body);
      const updatedComment = await storage.updateTaskComment(commentId, input.content);
      res.json(updatedComment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  // Chat API
  app.get(api.chats.users.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const chatUsers = await storage.getChatUsers(req.user.id);
    res.json(chatUsers);
  });

  app.get(api.chats.unread.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const counts = await storage.getUnreadCountsForUser(req.user.id);
    res.json(counts);
  });

  app.get(api.chats.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const otherUserId = Number(req.params.userId);
    if (!Number.isFinite(otherUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (otherUserId === req.user.id) {
      return res.status(400).json({ message: "Cannot open chat with yourself" });
    }
    const otherUser = await storage.getUser(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }
    const messages = await storage.getMessagesBetweenUsers(req.user.id, otherUserId);
    res.json(messages);
  });

  app.post(api.chats.markRead.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const otherUserId = Number(req.params.userId);
    if (!Number.isFinite(otherUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (otherUserId === req.user.id) {
      return res.status(400).json({ message: "Cannot mark self chat as read" });
    }
    const otherUser = await storage.getUser(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }
    await storage.markMessagesAsRead(req.user.id, otherUserId);
    await pushUnreadUpdate(req.user.id);
    await pushUnreadUpdate(otherUserId);
    emitToUser(otherUserId, {
      type: "chat:read",
      payload: { userId: req.user.id },
    });
    res.json({ success: true });
  });

  app.post(api.chats.send.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const input = api.chats.send.input.parse(req.body);
      if (input.toUserId === req.user.id) {
        return res.status(400).json({ message: "Cannot send message to yourself" });
      }
      const recipient = await storage.getUser(input.toUserId);
      if (!recipient) {
        return res.status(404).json({ message: "User not found" });
      }
      if (isDeletedUser(recipient)) {
        return res.status(400).json({ message: "Cannot send message to deleted user" });
      }
      const shouldMarkReadImmediately = isUserViewingChatWith(input.toUserId, req.user.id);
      const shouldSuppressDirectNotification = shouldMarkReadImmediately;
      const message = await storage.createMessage({
        ...input,
        fromUserId: req.user.id,
        readAt: shouldMarkReadImmediately ? new Date() : null,
      });
      emitToUser(input.toUserId, {
        type: "message:new",
        payload: { fromUserId: req.user.id, toUserId: input.toUserId },
      });
      emitToUser(req.user.id, {
        type: "message:new",
        payload: { fromUserId: req.user.id, toUserId: input.toUserId },
      });
      await pushUnreadUpdate(req.user.id);
      await pushUnreadUpdate(input.toUserId);
      if (!shouldSuppressDirectNotification) {
        await emitNotification([input.toUserId], {
          title: "New Message",
          description: `${req.user.name} sent you a message.`,
          actorUserId: req.user.id,
          type: "chat_message",
          entityType: "chat",
          entityId: req.user.id,
        });
      }
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.get(api.chats.groups.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const groups = await storage.getTaskChatGroups();
    const result: Array<{ group: any; task: any; participantIds: number[] }> = [];

    for (const group of groups) {
      const task = await storage.getTask(group.taskId);
      if (!task) continue;
      if (task.status === "done") continue;
      if (!(await canTaskHaveGroupChat(task))) continue;
      const participantIds = getTaskParticipantIds(task);
      if (!participantIds.includes(req.user.id)) continue;
      result.push({ group, task, participantIds });
    }

    res.json(result);
  });

  app.get(api.chats.groupsUnread.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const groups = await storage.getTaskChatGroups();
    const byTask: Record<string, number> = {};
    let total = 0;

    for (const group of groups) {
      const task = await storage.getTask(group.taskId);
      if (!task) continue;
      if (task.status === "done") continue;
      if (!(await canTaskHaveGroupChat(task))) continue;
      const participantIds = getTaskParticipantIds(task);
      if (!participantIds.includes(req.user.id)) continue;

      const messages = await storage.getTaskGroupMessages(group.taskId);
      const readState = await storage.getTaskGroupReadState(req.user.id, group.taskId);
      const unreadCount = messages.filter((m) => {
        if (m.fromUserId === req.user.id) return false;
        if (!readState?.lastReadAt) return true;
        return !!m.createdAt && new Date(m.createdAt) > new Date(readState.lastReadAt);
      }).length;

      byTask[String(group.taskId)] = unreadCount;
      total += unreadCount;
    }

    res.json({ total, byTask });
  });

  app.post(api.chats.groupCreate.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (task.status === "done") {
      return res.status(400).json({ message: "Task group chat is unavailable for done tasks" });
    }
    if (!(await canTaskHaveGroupChat(task))) {
      return res.status(400).json({ message: "Task group chat requires at least 3 active participants" });
    }
    if (!canUserAccessTask(req.user, task)) {
      return res.status(403).json({ message: "Not authorized to create this task group" });
    }

    const group = await storage.ensureTaskChatGroup(taskId, req.user.id);
    const existingMessages = await storage.getTaskGroupMessages(taskId);
    const latestMessageAt = existingMessages.length > 0
      ? new Date(existingMessages[existingMessages.length - 1].createdAt as any)
      : new Date();
    await storage.upsertTaskGroupReadState(req.user.id, taskId, latestMessageAt);
    getTaskParticipantIds(task).forEach((participantId) => {
      emitToUser(participantId, {
        type: "task-group:created",
        payload: { taskId },
      });
    });
    res.status(201).json(group);
  });

  app.get(api.chats.groupList.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (task.status === "done") {
      return res.status(404).json({ message: "Task group not available for done tasks" });
    }
    if (!(await canTaskHaveGroupChat(task))) {
      return res.status(404).json({ message: "Task group not available for tasks with fewer than 3 active participants" });
    }
    if (!canUserAccessTask(req.user, task)) {
      return res.status(403).json({ message: "Not authorized to access this task group" });
    }
    const existingGroup = await storage.getTaskChatGroup(taskId);
    if (!existingGroup) {
      return res.status(404).json({ message: "Task group not found" });
    }
    const groupMessages = await storage.getTaskGroupMessages(taskId);
    res.json(groupMessages);
  });

  app.post(api.chats.groupSend.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (task.status === "done") {
      return res.status(400).json({ message: "Task group chat is unavailable for done tasks" });
    }
    if (!(await canTaskHaveGroupChat(task))) {
      return res.status(400).json({ message: "Task group chat requires at least 3 active participants" });
    }
    if (!canUserAccessTask(req.user, task)) {
      return res.status(403).json({ message: "Not authorized to message this task group" });
    }
    await storage.ensureTaskChatGroup(taskId, req.user.id);

    try {
      const input = api.chats.groupSend.input.parse(req.body);
      const message = await storage.createTaskGroupMessage({
        taskId,
        content: input.content,
        fromUserId: req.user.id,
      });

      const participantIds = getTaskParticipantIds(task);
      const assignedUserIds = getAssignedUserIds(task);
      const allUsers = await storage.getUsers();
      const mentionedIds = extractMentionedUserIds(input.content, allUsers);
      const mentionRecipients = new Set<number>();

      mentionedIds.forEach((id) => {
        if (assignedUserIds.includes(id) && !isUserViewingTaskGroup(id, taskId)) {
          mentionRecipients.add(id);
        }
      });
      mentionRecipients.delete(req.user.id);

      participantIds.forEach((participantId) => {
        emitToUser(participantId, {
          type: "task-group:new",
          payload: { taskId, fromUserId: req.user.id },
        });
      });

      const notificationRecipients = participantIds.filter((participantId) => {
        if (participantId === req.user.id) return false;
        if (mentionRecipients.has(participantId)) return false;
        return !isUserViewingTaskGroup(participantId, taskId);
      });
      if (notificationRecipients.length > 0) {
        await emitNotification(notificationRecipients, {
          title: "New Group Message",
          description: `${req.user.name} sent a message in "${task.title}".`,
          actorUserId: req.user.id,
          type: "task_group_message",
          entityType: "task",
          entityId: taskId,
        });
      }
      if (mentionRecipients.size > 0) {
        await emitNotification(mentionRecipients, {
          title: "You were mentioned",
          description: `${req.user.name} mentioned you in "${task.title}".`,
          actorUserId: req.user.id,
          type: "task_group_mention",
          entityType: "task",
          entityId: taskId,
        });
      }

      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.post(api.chats.groupMarkRead.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: "Invalid task id" });
    }
    const task = await storage.getTask(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (task.status === "done") {
      return res.status(404).json({ message: "Task group not available for done tasks" });
    }
    if (!canUserAccessTask(req.user, task)) {
      return res.status(403).json({ message: "Not authorized to mark this group as read" });
    }
    const existingGroup = await storage.getTaskChatGroup(taskId);
    if (!existingGroup) {
      return res.status(404).json({ message: "Task group not found" });
    }
    const groupMessages = await storage.getTaskGroupMessages(taskId);
    const latestMessageAt = groupMessages.length > 0
      ? new Date(groupMessages[groupMessages.length - 1].createdAt as any)
      : new Date();
    await storage.upsertTaskGroupReadState(req.user.id, taskId, latestMessageAt);
    emitToUser(req.user.id, {
      type: "task-group:read",
      payload: { taskId },
    });
    res.json({ success: true });
  });

  // Ensure schema changes exist before any startup reads or seed logic runs.
  await applyPendingMigrations();

  // Seed Data
  await seedDatabase();

  const reminderIntervalMs = 30_000;
  if (pushEnabled) {
    setInterval(async () => {
      try {
        const now = new Date();
        const dueReminders = await storage.getDueReminders(now);
        if (dueReminders.length === 0) return;
        await Promise.all(
          dueReminders.map(async (reminder) => {
            await sendPushToUser(reminder.userId, {
              title: `Reminder: ${reminder.title}`,
              body: reminder.description || "Reminder due",
              url: "/reminder",
              tag: `reminder-${reminder.id}`,
            });
            await storage.markReminderFired(reminder.id, new Date());
          }),
        );
      } catch (err) {
        console.error("❌ Reminder push failed:", err);
      }
    }, reminderIntervalMs);
  }

  return httpServer;
}

async function seedDatabase() {
  try {
    // Clear tasks first (due to foreign keys), then users
    console.log("🌱 Starting database seed...");
    const { db } = await import("./db");
    const { tasks } = await import("@shared/schema");

    // Only seed default admin if there are no users yet
    const existingUsers = await storage.getUsers();
    if (existingUsers.length === 0) {
      const admin = await storage.createUser({
        name: "Admin",
        email: "admin@hiqain.com",
        designation: "Administrator",
        password: "password",
        role: "admin",
        allowStorage: true,
        allowClientCreds: true,
      });
      console.log(`✅ Created admin user with ID: ${admin.id}, password hash: ${admin.password}`);
      console.log("✅ Database seeded with users and tasks!");
    } else {
      await Promise.all(
        existingUsers
          .filter((member) => member.role === "admin" && (!member.allowStorage || !member.allowClientCreds))
          .map((member) =>
            storage.updateUser(member.id, {
              allowStorage: true,
              allowClientCreds: true,
            }),
          ),
      );

      const legacyAdmin = existingUsers.find(
        (member) =>
          member.role === "admin" && member.email.trim().toLowerCase() === "admin@example.com",
      );
      if (legacyAdmin) {
        await storage.updateUser(legacyAdmin.id, { email: "admin@hiqain.com" });
        console.log("✅ Updated legacy admin email to admin@hiqain.com");
      }

      const legacyAdminName = existingUsers.find(
        (member) => member.role === "admin" && (member.name.trim() === "Admin User" || member.name.trim() === "admin"),
      );
      if (legacyAdminName) {
        await storage.updateUser(legacyAdminName.id, { name: "Admin" });
        console.log("✅ Updated legacy admin name to Admin");
      }

      if (!legacyAdmin && !legacyAdminName) {
        console.log("ℹ️ Users already exist; skipping seed.");
      }
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ECONNREFUSED") {
      console.error("❌ Seed failed: Database connection refused.");
      console.error(
        "   Check DATABASE_URL host/port and ensure MySQL is running (example: 127.0.0.1:3306).",
      );
      return;
    }
    console.error("❌ Seed failed:", e);
  }
}

async function applyPendingMigrations() {
  let connection: mysql.Connection | null = null;
  try {
    const candidateDirs = [
      path.resolve(process.cwd(), "migrations"),
      path.resolve(process.cwd(), "../migrations"),
      path.resolve(routesDir, "../migrations"),
    ];
    let migrationsDir: string | null = null;

    for (const candidate of candidateDirs) {
      try {
        const stats = await fs.stat(candidate);
        if (stats.isDirectory()) {
          migrationsDir = candidate;
          break;
        }
      } catch {
        // Try the next likely deployment path.
      }
    }

    if (!migrationsDir) {
      console.log("ℹ️ No migrations directory found; skipping migration bootstrap.");
      return;
    }

    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    if (migrationFiles.length === 0) {
      return;
    }

    console.log("🛠️ Applying database migrations...");
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set.");
    }

    connection = await mysql.createConnection({
      uri: databaseUrl,
      multipleStatements: true,
    });

    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(migrationsDir, migrationFile);
      const sql = await fs.readFile(migrationPath, "utf8");
      try {
        await connection.query(sql);
        console.log(`✅ Migration applied: ${migrationFile}`);
      } catch (error: any) {
        const code = error?.code;
        if (
          code === "ER_DUP_KEYNAME" ||
          code === "ER_TABLE_EXISTS_ERROR" ||
          code === "ER_DUP_FIELDNAME"
        ) {
          console.log(`ℹ️ Migration already satisfied: ${migrationFile} (${code})`);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error("❌ Migration bootstrap failed:", error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
