import type { Express, Request } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import crypto from "crypto";
import session from "express-session";
import { WebSocketServer, WebSocket } from "ws";
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

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

function getTaskParticipantIds(task: any): number[] {
  const ids = new Set<number>();
  if (typeof task?.createdById === "number" && Number.isFinite(task.createdById)) {
    ids.add(task.createdById);
  }
  getAssignedUserIds(task).forEach((id) => ids.add(id));
  return Array.from(ids);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wsClientsByUserId = new Map<number, Set<WebSocket>>();
  const activeChatPairsByUserId = new Map<number, Map<number, number>>();

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

  const pushUnreadUpdate = async (userId: number) => {
    const counts = await storage.getUnreadCountsForUser(userId);
    emitToUser(userId, { type: "unread:update", payload: counts });
  };

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", async (socket, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const userId = Number(url.searchParams.get("userId"));
    let activeRoomUserId: number | null = null;
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
    wsClientsByUserId.get(userId)!.add(socket);

    await pushUnreadUpdate(userId);

    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw || "{}"));
        const type = parsed?.type;
        const payload = parsed?.payload || {};

        if (type === "webrtc:signal") {
          const toUserId = Number(payload?.toUserId);
          if (!Number.isFinite(toUserId) || toUserId === userId) return;

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
        }
      } catch {
        // ignore invalid socket payload
      }
    });

    socket.on("close", () => {
      if (activeRoomUserId !== null) {
        removeActiveChatPair(userId, activeRoomUserId);
      }
      const clients = wsClientsByUserId.get(userId);
      if (!clients) return;
      clients.delete(socket);
      if (clients.size === 0) {
        wsClientsByUserId.delete(userId);
      }
    });
  });

  // Session middleware
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "your-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    })
  );

  // Auth middleware to attach user to request
  app.use((req, res, next) => {
    if (req.session.userId) {
      storage.getUser(req.session.userId).then((user) => {
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

      if (!user || !verifyPassword(input.password, user.password)) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.session.userId = user.id;
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

  // Users API
  app.get(api.users.list.path, async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.post(api.users.create.path, async (req, res) => {
    // Only admins can create users
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can create users' });
    }

    try {
      const input = api.users.create.input.parse(req.body);
      const user = await storage.createUser(input);
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

  app.delete(api.users.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteUser(id);
    res.status(204).send();
  });

  // Tasks API
  app.get(api.tasks.list.path, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const tasks = await storage.getTasks();
    if (req.user.role === "admin") {
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
    if (req.user.role !== "admin" && !canUserAccessTask(req.user, task)) {
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
      const isAdmin = req.user.role === "admin";
      const isCreator = existing.createdById === req.user.id;
      const isParticipant = canUserAccessTask(req.user, existing);
      const updateKeys = Object.keys(input || {});
      const isStatusOnlyUpdate = updateKeys.length > 0 && updateKeys.every((key) => key === "status" || key === "completed");

      if (!isAdmin && !isCreator) {
        if (!(isParticipant && isStatusOnlyUpdate)) {
          return res.status(403).json({ message: "Only the task creator can edit this task" });
        }
      }

      const { createdById: _createdById, ...safeInput } = (input as any) || {};

      const updated = await storage.updateTask(id, safeInput);
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
    res.status(204).send();
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
      const shouldMarkReadImmediately = isUserViewingChatWith(input.toUserId, req.user.id);
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
      participantIds.forEach((participantId) => {
        emitToUser(participantId, {
          type: "task-group:new",
          payload: { taskId, fromUserId: req.user.id },
        });
      });

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

  // Seed Data
  await seedDatabase();

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
        name: "Admin User",
        email: "admin@example.com",
        password: "password",
        role: "admin"
      });
      console.log(`✅ Created admin user with ID: ${admin.id}, password hash: ${admin.password}`);
      console.log("✅ Database seeded with users and tasks!");
    } else {
      console.log("ℹ️ Users already exist; skipping seed.");
    }
  } catch (e) {
    console.error("❌ Seed failed:", e);
  }
}
