import { db } from "./db";
import {
  messages,
  notifications,
  taskChatGroups,
  taskGroupReadStates,
  taskGroupMessages,
  tasks,
  users,
  type Message,
  type InsertMessage,
  type InsertTaskGroupMessage,
  type InsertTaskChatGroup,
  type InsertTaskGroupReadState,
  type InsertNotification,
  type Task,
  type TaskGroupMessage,
  type TaskChatGroup,
  type TaskGroupReadState,
  type Notification,
  type User,
  type InsertTask,
  type InsertUser,
  type UpdateTaskRequest
} from "@shared/schema";
import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import crypto from "crypto";

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  clearAllUsers(): Promise<void>;

  // Tasks
  getTasks(): Promise<Task[]>;
  getTask(id: number): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, updates: UpdateTaskRequest): Promise<Task>;
  deleteTask(id: number): Promise<void>;

  // Chats
  getChatUsers(currentUserId: number): Promise<User[]>;
  getMessagesBetweenUsers(userId: number, otherUserId: number): Promise<Message[]>;
  createMessage(data: InsertMessage & { fromUserId: number }): Promise<Message>;
  getTaskChatGroup(taskId: number): Promise<TaskChatGroup | undefined>;
  ensureTaskChatGroup(taskId: number, createdById: number): Promise<TaskChatGroup>;
  getTaskChatGroups(): Promise<TaskChatGroup[]>;
  getTaskGroupMessages(taskId: number): Promise<TaskGroupMessage[]>;
  createTaskGroupMessage(data: Pick<InsertTaskGroupMessage, "taskId" | "content"> & { fromUserId: number }): Promise<TaskGroupMessage>;
  getTaskGroupReadState(userId: number, taskId: number): Promise<TaskGroupReadState | undefined>;
  upsertTaskGroupReadState(userId: number, taskId: number, lastReadAt?: Date): Promise<void>;
  createNotification(data: InsertNotification): Promise<Notification>;
  getNotificationsForUser(userId: number): Promise<Notification[]>;
  getNotification(id: number): Promise<Notification | undefined>;
  markNotificationRead(id: number): Promise<void>;
  markAllNotificationsRead(userId: number): Promise<void>;
  deleteNotification(id: number): Promise<void>;
  getNotificationUnreadCount(userId: number): Promise<number>;
  markMessagesAsRead(userId: number, otherUserId: number): Promise<void>;
  getUnreadCountsForUser(userId: number): Promise<{ total: number; byUser: Record<string, number> }>;
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function extractInsertId(result: unknown): number {
  if (typeof result !== "object" || result === null) return NaN;
  const maybeSingle = result as { insertId?: unknown };
  if (typeof maybeSingle.insertId === "number") return maybeSingle.insertId;
  if (Array.isArray(result) && result.length > 0) {
    const first = result[0] as { insertId?: unknown };
    if (typeof first?.insertId === "number") return first.insertId;
  }
  return NaN;
}

function normalizeAssignedToIds(rawIds: unknown, fallbackId?: unknown): number[] {
  const coerceArray = (arr: unknown[]): number[] =>
    arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));

  if (Array.isArray(rawIds)) return coerceArray(rawIds);

  if (typeof rawIds === "string") {
    const trimmed = rawIds.trim();
    if (!trimmed) return typeof fallbackId === "number" ? [fallbackId] : [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return coerceArray(parsed);
      if (typeof parsed === "number" && Number.isFinite(parsed)) return [parsed];
      if (typeof parsed === "string") {
        return parsed
          .split(",")
          .map((v) => Number(v.trim()))
          .filter((v) => Number.isFinite(v));
      }
    } catch {
      return trimmed
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v));
    }
  }

  if (typeof rawIds === "number" && Number.isFinite(rawIds)) return [rawIds];
  if (typeof fallbackId === "number" && Number.isFinite(fallbackId)) return [fallbackId];
  return [];
}

function isDeletedUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith("@deleted.local");
}

function buildDeletedUserEmail(id: number): string {
  return `deleted+${id}@deleted.local`;
}

export class DatabaseStorage implements IStorage {
  // Users Implementation
  async getUsers(): Promise<User[]> {
    const rows = await db.select().from(users);
    return rows.filter((row) => !isDeletedUserEmail(row.email));
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const userData = {
      ...insertUser,
      password: hashPassword(insertUser.password),
    };
    const insertResult = await db.insert(users).values(userData);
    const id = extractInsertId(insertResult);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) {
      throw new Error("Failed to create user");
    }
    return user;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const toUpdate = { ...updates } as Partial<InsertUser> & { password?: string };
    if (typeof toUpdate.password === "string") {
      toUpdate.password = hashPassword(toUpdate.password);
    } else {
      delete toUpdate.password;
    }

    await db.update(users).set(toUpdate).where(eq(users.id, id));
    const [updatedUser] = await db.select().from(users).where(eq(users.id, id));
    if (!updatedUser) {
      throw new Error("User not found");
    }
    return updatedUser;
  }

  async deleteUser(id: number): Promise<void> {
    const [existing] = await db.select().from(users).where(eq(users.id, id));
    if (!existing) return;

    await db
      .update(users)
      .set({
        // Keep original display name so old conversations still show who it was.
        name: existing.name,
        email: buildDeletedUserEmail(id),
        password: crypto.randomBytes(32).toString("hex"),
        role: "user",
      })
      .where(eq(users.id, id));
  }

  async clearAllUsers(): Promise<void> {
    await db.delete(users);
  }

  // Tasks Implementation
  async getTasks(): Promise<Task[]> {
    const rows = await db.select().from(tasks).orderBy(tasks.createdAt);
    return rows.map((r: any) => {
      let attachments = [];
      try { attachments = JSON.parse(r.attachments || '[]'); } catch { attachments = []; }
      const assignedToIds = normalizeAssignedToIds(r.assignedToIds, r.assignedToId);
      let dueDate: string | null = null;
      if (r.dueDate instanceof Date) {
        dueDate = r.dueDate.toISOString();
      } else if (typeof r.dueDate === 'string' && r.dueDate.length) {
        dueDate = r.dueDate;
      } else {
        dueDate = null;
      }
      return { ...r, attachments, assignedToIds, dueDate } as any;
    });
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) return undefined;
    try {
      // attachments stored as JSON string in DB; parse for API consumers
      const assignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      return { ...task, attachments: JSON.parse(task.attachments || "[]"), assignedToIds } as any;
    } catch (e) {
      const assignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      return { ...task, attachments: [], assignedToIds } as any;
    }
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const attachmentsJson = JSON.stringify((insertTask as any).attachments || []);
    const assignedToIds = normalizeAssignedToIds(
      (insertTask as any).assignedToIds,
      (insertTask as any).assignedToId
    );
    const assignedToId = assignedToIds.length > 0 ? assignedToIds[0] : ((insertTask as any).assignedToId || null);
    const rawDue = (insertTask as any).dueDate;
    let dueDateVal: Date | null = null;
    if (rawDue) {
      const d = rawDue instanceof Date ? rawDue : new Date(rawDue);
      if (!isNaN(d.getTime())) dueDateVal = d;
      else dueDateVal = null;
    }
    const toInsert: any = {
      ...insertTask,
      assignedToId,
      assignedToIds: JSON.stringify(assignedToIds),
      attachments: attachmentsJson,
      dueDate: dueDateVal,
    };
    const insertResult = await db.insert(tasks).values(toInsert);
    const id = extractInsertId(insertResult);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) {
      throw new Error("Failed to create task");
    }
    try {
      const attachments = JSON.parse(task.attachments || "[]");
      const parsedAssignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      const dueDate = task.dueDate instanceof Date ? task.dueDate.toISOString() : (typeof task.dueDate === 'string' ? task.dueDate : null);
      return { ...task, attachments, assignedToIds: parsedAssignedToIds, dueDate } as any;
    } catch (e) {
      const parsedAssignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      const dueDate = task.dueDate instanceof Date ? task.dueDate.toISOString() : (typeof task.dueDate === 'string' ? task.dueDate : null);
      return { ...task, attachments: [], assignedToIds: parsedAssignedToIds, dueDate } as any;
    }
  }

  async updateTask(id: number, updates: UpdateTaskRequest): Promise<Task> {
    const toUpdate = { ...updates } as any;
    if ((updates as any).assignedToIds !== undefined) {
      const assignedToIds = normalizeAssignedToIds(
        (updates as any).assignedToIds,
        (updates as any).assignedToId
      );
      toUpdate.assignedToIds = JSON.stringify(assignedToIds);
      toUpdate.assignedToId = assignedToIds.length > 0 ? assignedToIds[0] : null;
    }
    if ((updates as any).attachments) {
      toUpdate.attachments = JSON.stringify((updates as any).attachments);
    }
    if ((updates as any).dueDate !== undefined) {
      const rawDue = (updates as any).dueDate;
      if (rawDue) {
        const d = rawDue instanceof Date ? rawDue : new Date(rawDue);
        toUpdate.dueDate = !isNaN(d.getTime()) ? d : null;
      } else {
        toUpdate.dueDate = null;
      }
    }
    await db
      .update(tasks)
      .set(toUpdate)
      .where(eq(tasks.id, id));
    const [updated] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!updated) {
      throw new Error("Task not found");
    }
    try {
      const attachments = JSON.parse(updated.attachments || "[]");
      const parsedAssignedToIds = normalizeAssignedToIds((updated as any).assignedToIds, (updated as any).assignedToId);
      const dueDate = updated.dueDate instanceof Date ? updated.dueDate.toISOString() : (typeof updated.dueDate === 'string' ? updated.dueDate : null);
      return { ...updated, attachments, assignedToIds: parsedAssignedToIds, dueDate } as any;
    } catch (e) {
      const parsedAssignedToIds = normalizeAssignedToIds((updated as any).assignedToIds, (updated as any).assignedToId);
      const dueDate = updated.dueDate instanceof Date ? updated.dueDate.toISOString() : (typeof updated.dueDate === 'string' ? updated.dueDate : null);
      return { ...updated, attachments: [], assignedToIds: parsedAssignedToIds, dueDate } as any;
    }
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  // Chat Implementation
  async getChatUsers(currentUserId: number): Promise<User[]> {
    const allUsers = await db.select().from(users).where(ne(users.id, currentUserId));
    const incoming = await db.select().from(messages).where(eq(messages.toUserId, currentUserId));
    const outgoing = await db.select().from(messages).where(eq(messages.fromUserId, currentUserId));
    const chattedUserIds = new Set<number>();
    incoming.forEach((row) => chattedUserIds.add(row.fromUserId));
    outgoing.forEach((row) => chattedUserIds.add(row.toUserId));

    return allUsers.filter((u) => !isDeletedUserEmail(u.email) || chattedUserIds.has(u.id));
  }

  async getMessagesBetweenUsers(userId: number, otherUserId: number): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(
        or(
          and(eq(messages.fromUserId, userId), eq(messages.toUserId, otherUserId)),
          and(eq(messages.fromUserId, otherUserId), eq(messages.toUserId, userId))
        )
      )
      .orderBy(asc(messages.createdAt));
  }

  async createMessage(data: InsertMessage & { fromUserId: number; readAt?: Date | null }): Promise<Message> {
    const insertResult = await db
      .insert(messages)
      .values({
        fromUserId: data.fromUserId,
        toUserId: data.toUserId,
        content: data.content,
        readAt: data.readAt ?? null,
      });
    const id = extractInsertId(insertResult);
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    if (!message) {
      throw new Error("Failed to create message");
    }
    return message;
  }

  async getTaskChatGroup(taskId: number): Promise<TaskChatGroup | undefined> {
    const [group] = await db.select().from(taskChatGroups).where(eq(taskChatGroups.taskId, taskId));
    return group;
  }

  async ensureTaskChatGroup(taskId: number, createdById: number): Promise<TaskChatGroup> {
    const existing = await this.getTaskChatGroup(taskId);
    if (existing) return existing;
    const toInsert: InsertTaskChatGroup = { taskId, createdById };
    const insertResult = await db.insert(taskChatGroups).values(toInsert);
    const id = extractInsertId(insertResult);
    const [group] = await db.select().from(taskChatGroups).where(eq(taskChatGroups.id, id));
    if (!group) {
      throw new Error("Failed to create task chat group");
    }
    return group;
  }

  async getTaskChatGroups(): Promise<TaskChatGroup[]> {
    return await db.select().from(taskChatGroups).orderBy(asc(taskChatGroups.createdAt));
  }

  async getTaskGroupMessages(taskId: number): Promise<TaskGroupMessage[]> {
    return await db
      .select()
      .from(taskGroupMessages)
      .where(eq(taskGroupMessages.taskId, taskId))
      .orderBy(asc(taskGroupMessages.createdAt));
  }

  async createTaskGroupMessage(
    data: Pick<InsertTaskGroupMessage, "taskId" | "content"> & { fromUserId: number }
  ): Promise<TaskGroupMessage> {
    const insertResult = await db
      .insert(taskGroupMessages)
      .values({
        taskId: data.taskId,
        fromUserId: data.fromUserId,
        content: data.content,
      });
    const id = extractInsertId(insertResult);
    const [message] = await db.select().from(taskGroupMessages).where(eq(taskGroupMessages.id, id));
    if (!message) {
      throw new Error("Failed to create task group message");
    }
    return message;
  }

  async getTaskGroupReadState(userId: number, taskId: number): Promise<TaskGroupReadState | undefined> {
    const [state] = await db
      .select()
      .from(taskGroupReadStates)
      .where(and(eq(taskGroupReadStates.userId, userId), eq(taskGroupReadStates.taskId, taskId)));
    return state;
  }

  async upsertTaskGroupReadState(userId: number, taskId: number, lastReadAt: Date = new Date()): Promise<void> {
    const toInsert: InsertTaskGroupReadState = { userId, taskId, lastReadAt };
    await db
      .insert(taskGroupReadStates)
      .values(toInsert)
      .onDuplicateKeyUpdate({
        set: { lastReadAt, updatedAt: new Date() },
      });
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const insertResult = await db.insert(notifications).values(data);
    const id = extractInsertId(insertResult);
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    if (!notification) {
      throw new Error("Failed to create notification");
    }
    return notification;
  }

  async getNotificationsForUser(userId: number): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
  }

  async getNotification(id: number): Promise<Notification | undefined> {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    return notification;
  }

  async markNotificationRead(id: number): Promise<void> {
    await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  async deleteNotification(id: number): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  async getNotificationUnreadCount(userId: number): Promise<number> {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return rows.length;
  }

  async markMessagesAsRead(userId: number, otherUserId: number): Promise<void> {
    await db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.fromUserId, otherUserId),
          eq(messages.toUserId, userId),
          isNull(messages.readAt)
        )
      );
  }

  async getUnreadCountsForUser(userId: number): Promise<{ total: number; byUser: Record<string, number> }> {
    const incomingUnread = await db
      .select()
      .from(messages)
      .where(and(eq(messages.toUserId, userId), isNull(messages.readAt)));

    const byUser: Record<string, number> = {};
    for (const row of incomingUnread) {
      const key = String(row.fromUserId);
      byUser[key] = (byUser[key] || 0) + 1;
    }

    return { total: incomingUnread.length, byUser };
  }
}

export const storage = new DatabaseStorage();
