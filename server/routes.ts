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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wsClientsByUserId = new Map<number, Set<WebSocket>>();

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
        }
      } catch {
        // ignore invalid socket payload
      }
    });

    socket.on("close", () => {
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
    const tasks = await storage.getTasks();
    res.json(tasks);
  });

  app.get(api.tasks.get.path, async (req, res) => {
    const task = await storage.getTask(Number(req.params.id));
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json(task);
  });

  app.post(api.tasks.create.path, async (req, res) => {
    // Only admins can create tasks
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can create tasks' });
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
    try {
      const id = Number(req.params.id);
      const input = api.tasks.update.input.parse(req.body);

      const existing = await storage.getTask(id);
      if (!existing) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const updated = await storage.updateTask(id, input);
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
    const id = Number(req.params.id);
    const existing = await storage.getTask(id);
    if (!existing) {
      return res.status(404).json({ message: 'Task not found' });
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
      const message = await storage.createMessage({
        ...input,
        fromUserId: req.user.id,
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
