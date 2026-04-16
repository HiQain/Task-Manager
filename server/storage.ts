import { db } from "./db";
import {
  clientCredProjectAccesses,
  clientCredProjects,
  messages,
  notifications,
  pushSubscriptions,
  reminders,
  storageFiles,
  storageProjectAccesses,
  storageProjects,
  taskChatGroups,
  taskComments,
  taskGroupReadStates,
  taskGroupMessages,
  tasks,
  users,
  type Message,
  type InsertMessage,
  type InsertClientCredProject,
  type InsertTaskGroupMessage,
  type InsertTaskComment,
  type InsertTaskChatGroup,
  type InsertTaskGroupReadState,
  type InsertNotification,
  type InsertPushSubscription,
  type ReminderSyncItem,
  type Task,
  type TaskComment,
  type TaskGroupMessage,
  type TaskChatGroup,
  type TaskGroupReadState,
  type Notification,
  type PushSubscription,
  type Reminder,
  type ClientCredProject,
  type ClientCredProjectAccess,
  type StorageFile,
  type StorageProjectAccess,
  type StorageProject,
  type User,
  type InsertStorageFile,
  type InsertStorageProject,
  type InsertTask,
  type InsertUser,
  type UpdateTaskRequest,
  type TodoList,
  type TodoItem,
  type InsertTodoList,
  type InsertTodoItem,
  todoLists,
  todoItems,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import crypto from "crypto";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDueDateOnly(raw: unknown): Date | null {
  if (!raw) return null;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 12, 0, 0));
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const match = DATE_ONLY_RE.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0));
  }

  return null;
}

function serializeDueDateOnly(raw: unknown): string | null {
  if (!raw) return null;
  const parsed = parseDueDateOnly(raw);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

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
  getTaskComments(taskId: number): Promise<TaskComment[]>;
  getTaskComment(id: number): Promise<TaskComment | undefined>;
  createTaskComment(data: Pick<InsertTaskComment, "taskId" | "content"> & { userId: number }): Promise<TaskComment>;
  updateTaskComment(id: number, content: string): Promise<TaskComment>;
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

  // Push subscriptions
  getPushSubscriptions(userId: number): Promise<PushSubscription[]>;
  upsertPushSubscription(userId: number, subscription: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(userId: number, endpoint: string): Promise<void>;

  // Reminders
  syncReminders(userId: number, items: ReminderSyncItem[], now?: Date): Promise<void>;
  getDueReminders(now: Date, limit?: number): Promise<Reminder[]>;
  markReminderFired(id: number, firedAt: Date): Promise<void>;
  markMessagesAsRead(userId: number, otherUserId: number): Promise<void>;
  getUnreadCountsForUser(userId: number): Promise<{ total: number; byUser: Record<string, number> }>;

  // Shared Storage
  getStorageProjects(): Promise<StorageProject[]>;
  createStorageProject(data: InsertStorageProject & { createdById: number }): Promise<StorageProject>;
  deleteStorageProject(id: number): Promise<void>;
  getStorageFiles(projectId: number): Promise<StorageFile[]>;
  getStorageFile(id: number): Promise<StorageFile | undefined>;
  createStorageFile(data: InsertStorageFile & { projectId: number; createdById: number }): Promise<StorageFile>;
  deleteStorageFile(id: number): Promise<void>;
  getStorageProjectAccesses(projectId: number): Promise<StorageProjectAccess[]>;
  replaceStorageProjectAccesses(projectId: number, members: Array<{ userId: number; access: "view" | "edit" }>): Promise<void>;

  // Client creds
  getClientCredProjects(): Promise<ClientCredProject[]>;
  getClientCredProject(id: number): Promise<ClientCredProject | undefined>;
  createClientCredProject(data: InsertClientCredProject & { createdById: number }): Promise<ClientCredProject>;
  updateClientCredProject(
    id: number,
    data: Pick<InsertClientCredProject, "clientName" | "projectName" | "links" | "link" | "viaChannels" | "emails" | "passwords">
  ): Promise<ClientCredProject>;
  deleteClientCredProject(id: number): Promise<void>;
  getClientCredProjectAccesses(projectId: number): Promise<ClientCredProjectAccess[]>;
  replaceClientCredProjectAccesses(projectId: number, members: Array<{ userId: number; access: "view" | "edit" }>): Promise<void>;

  // Todo lists
  getTodoLists(): Promise<TodoList[]>;
  getTodoList(id: number): Promise<TodoList | undefined>;
  createTodoList(data: InsertTodoList & { createdById: number }): Promise<TodoList>;
  updateTodoList(id: number, data: InsertTodoList): Promise<TodoList>;
  deleteTodoList(id: number): Promise<void>;
  getTodoItems(listId: number): Promise<TodoItem[]>;
  getTodoItem(id: number): Promise<TodoItem | undefined>;
  createTodoItem(data: InsertTodoItem & { listId: number }): Promise<TodoItem>;
  updateTodoItem(id: number, data: Partial<InsertTodoItem>): Promise<TodoItem>;
  deleteTodoItem(id: number): Promise<void>;
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

const DELETED_PASSWORD_PREFIX = "__deleted__:";

function buildDeletedPassword(email: string): string {
  const encodedEmail = Buffer.from(email.toLowerCase(), "utf8").toString("base64url");
  const randomSuffix = crypto.randomBytes(16).toString("hex");
  return `${DELETED_PASSWORD_PREFIX}${encodedEmail}:${randomSuffix}`;
}

function getDeletedOriginalEmail(password: string | null | undefined): string | null {
  if (!password || !password.startsWith(DELETED_PASSWORD_PREFIX)) return null;
  const payload = password.slice(DELETED_PASSWORD_PREFIX.length);
  const encodedEmail = payload.split(":")[0] || "";
  if (!encodedEmail) return null;
  try {
    return Buffer.from(encodedEmail, "base64url").toString("utf8").toLowerCase();
  } catch {
    return null;
  }
}

function isDeletedUserRecord(record: Pick<User, "email" | "password">): boolean {
  const role = String((record as any)?.role || "").toLowerCase();
  return role === "deleted" || isDeletedUserEmail(record.email) || !!getDeletedOriginalEmail(record.password);
}

function serializeStringList(values: string[]): string {
  return JSON.stringify(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
}

function serializeStringSlots(values: string[]): string | null {
  const normalized = values.map((value) => String(value || "").trim());
  return normalized.some(Boolean) ? JSON.stringify(normalized) : null;
}

export class DatabaseStorage implements IStorage {
  // Users Implementation
  async getUsers(): Promise<User[]> {
    const rows = await db.select().from(users);
    return rows.filter((row) => !isDeletedUserRecord(row));
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
    const normalizedEmail = insertUser.email.toLowerCase();
    const allUsers = await db.select().from(users);

    const activeWithSameEmail = allUsers.find(
      (u) => u.email.toLowerCase() === normalizedEmail && !isDeletedUserRecord(u),
    );
    if (activeWithSameEmail) {
      throw new Error("Email already exists");
    }

    const deletedWithSameEmail = allUsers.find((u) => {
      if (!isDeletedUserRecord(u)) return false;
      const directEmailMatch = u.email.toLowerCase() === normalizedEmail;
      const deletedOriginalEmail = getDeletedOriginalEmail(u.password);
      return directEmailMatch || deletedOriginalEmail === normalizedEmail;
    });

    if (deletedWithSameEmail) {
      await db
        .update(users)
        .set({
          name: insertUser.name,
          email: insertUser.email,
          designation: insertUser.designation,
          password: hashPassword(insertUser.password),
          role: insertUser.role,
          allowStorage: insertUser.allowStorage ?? false,
          allowClientCreds: insertUser.allowClientCreds ?? false,
        })
        .where(eq(users.id, deletedWithSameEmail.id));

      const [restoredUser] = await db.select().from(users).where(eq(users.id, deletedWithSameEmail.id));
      if (!restoredUser) {
        throw new Error("Failed to restore user");
      }
      return restoredUser;
    }

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

    const allTasks = await db.select().from(tasks);
    const affectedTasks = allTasks.filter((task) => {
      if (task.createdById === id) return true;
      return normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId).includes(id);
    });

    for (const task of affectedTasks) {
      const nextAssignedToIds = normalizeAssignedToIds(
        (task as any).assignedToIds,
        (task as any).assignedToId,
      ).filter((assignedUserId) => assignedUserId !== id);

      await db
        .update(tasks)
        .set({
          createdById: task.createdById === id ? null : task.createdById,
          assignedToId: nextAssignedToIds[0] ?? null,
          assignedToIds: JSON.stringify(nextAssignedToIds),
        })
        .where(eq(tasks.id, task.id));
    }

    await db
      .update(users)
      .set({
        // Keep original display name so old conversations still show who it was.
        name: existing.name,
        // Keep original email so re-create with same email restores this exact user.
        email: existing.email,
        password: buildDeletedPassword(existing.email),
        role: "deleted",
      })
      .where(eq(users.id, id));
  }

  async clearAllUsers(): Promise<void> {
    await db.delete(users);
  }

  // Tasks Implementation
  async getTasks(): Promise<Task[]> {
    const rows = await db.select().from(tasks).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
    return rows.map((r: any) => {
      let attachments = [];
      try { attachments = JSON.parse(r.attachments || '[]'); } catch { attachments = []; }
      const assignedToIds = normalizeAssignedToIds(r.assignedToIds, r.assignedToId);
      const dueDate = serializeDueDateOnly(r.dueDate);
      return { ...r, attachments, assignedToIds, dueDate } as any;
    });
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) return undefined;
    try {
      // attachments stored as JSON string in DB; parse for API consumers
      const assignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      const dueDate = serializeDueDateOnly(task.dueDate);
      return { ...task, attachments: JSON.parse(task.attachments || "[]"), assignedToIds, dueDate } as any;
    } catch (e) {
      const assignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      const dueDate = serializeDueDateOnly(task.dueDate);
      return { ...task, attachments: [], assignedToIds, dueDate } as any;
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
    const dueDateVal = parseDueDateOnly(rawDue);
    const [lastTask] = await db
      .select()
      .from(tasks)
      .orderBy(desc(tasks.sortOrder), desc(tasks.createdAt))
      .limit(1);
    const nextSortOrder = typeof (insertTask as any).sortOrder === "number"
      ? (insertTask as any).sortOrder
      : ((lastTask as any)?.sortOrder ?? 0) + 1024;

    const toInsert: any = {
      ...insertTask,
      sortOrder: nextSortOrder,
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
      const dueDate = serializeDueDateOnly(task.dueDate);
      return { ...task, attachments, assignedToIds: parsedAssignedToIds, dueDate } as any;
    } catch (e) {
      const parsedAssignedToIds = normalizeAssignedToIds((task as any).assignedToIds, (task as any).assignedToId);
      const dueDate = serializeDueDateOnly(task.dueDate);
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
    if ((updates as any).attachments !== undefined) {
      toUpdate.attachments = JSON.stringify((updates as any).attachments);
    }
    if ((updates as any).dueDate !== undefined) {
      const rawDue = (updates as any).dueDate;
      if (rawDue) {
        toUpdate.dueDate = parseDueDateOnly(rawDue);
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
      const dueDate = serializeDueDateOnly(updated.dueDate);
      return { ...updated, attachments, assignedToIds: parsedAssignedToIds, dueDate } as any;
    } catch (e) {
      const parsedAssignedToIds = normalizeAssignedToIds((updated as any).assignedToIds, (updated as any).assignedToId);
      const dueDate = serializeDueDateOnly(updated.dueDate);
      return { ...updated, attachments: [], assignedToIds: parsedAssignedToIds, dueDate } as any;
    }
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(taskGroupMessages).where(eq(taskGroupMessages.taskId, id));
    await db.delete(taskGroupReadStates).where(eq(taskGroupReadStates.taskId, id));
    await db.delete(taskChatGroups).where(eq(taskChatGroups.taskId, id));
    await db.delete(taskComments).where(eq(taskComments.taskId, id));
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  // Chat Implementation
  async getChatUsers(currentUserId: number): Promise<User[]> {
    const allUsers = await db.select().from(users).where(ne(users.id, currentUserId));
    return allUsers.filter((u) => !isDeletedUserRecord(u));
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

  async getTaskComments(taskId: number): Promise<TaskComment[]> {
    return await db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt));
  }

  async getTaskComment(id: number): Promise<TaskComment | undefined> {
    const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, id));
    return comment;
  }

  async createTaskComment(
    data: Pick<InsertTaskComment, "taskId" | "content"> & { userId: number }
  ): Promise<TaskComment> {
    const insertResult = await db
      .insert(taskComments)
      .values({
        taskId: data.taskId,
        userId: data.userId,
        content: data.content,
      });
    const id = extractInsertId(insertResult);
    const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, id));
    if (!comment) {
      throw new Error("Failed to create task comment");
    }
    return comment;
  }

  async updateTaskComment(id: number, content: string): Promise<TaskComment> {
    await db.update(taskComments).set({ content }).where(eq(taskComments.id, id));
    const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, id));
    if (!comment) {
      throw new Error("Failed to update task comment");
    }
    return comment;
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

  // Push Subscriptions
  async getPushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async upsertPushSubscription(userId: number, subscription: InsertPushSubscription): Promise<PushSubscription> {
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));

    if (existing.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({
          userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
    } else {
      await db.insert(pushSubscriptions).values({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      });
    }

    const [record] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
    if (!record) {
      throw new Error("Failed to store push subscription");
    }
    return record;
  }

  async deletePushSubscription(userId: number, endpoint: string): Promise<void> {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  // Reminders
  async syncReminders(userId: number, items: ReminderSyncItem[], now: Date = new Date()): Promise<void> {
    const existing = await db.select().from(reminders).where(eq(reminders.userId, userId));
    const existingByClient = new Map(existing.map((item) => [item.clientId, item]));
    const incomingIds = new Set(items.map((item) => item.clientId));

    const toDelete = existing.filter((item) => !incomingIds.has(item.clientId)).map((item) => item.id);
    if (toDelete.length > 0) {
      await db.delete(reminders).where(inArray(reminders.id, toDelete));
    }

    for (const item of items) {
      const existingItem = existingByClient.get(item.clientId);
      const triggerDate = new Date(item.triggerAtUtc);
      if (existingItem) {
        const shouldResetFired =
          existingItem.triggerAtUtc &&
          new Date(existingItem.triggerAtUtc).getTime() !== triggerDate.getTime() &&
          triggerDate.getTime() > now.getTime();

        await db
          .update(reminders)
          .set({
            title: item.title,
            description: item.description ?? null,
            triggerAtUtc: triggerDate,
            timezone: item.timezone,
            firedAt: shouldResetFired ? null : existingItem.firedAt,
            updatedAt: new Date(),
          })
          .where(eq(reminders.id, existingItem.id));
      } else {
        await db.insert(reminders).values({
          userId,
          clientId: item.clientId,
          title: item.title,
          description: item.description ?? null,
          triggerAtUtc: triggerDate,
          timezone: item.timezone,
        });
      }
    }
  }

  async getDueReminders(now: Date, limit = 50): Promise<Reminder[]> {
    return await db
      .select()
      .from(reminders)
      .where(and(isNull(reminders.firedAt), lte(reminders.triggerAtUtc, now)))
      .orderBy(asc(reminders.triggerAtUtc))
      .limit(limit);
  }

  async markReminderFired(id: number, firedAt: Date): Promise<void> {
    await db.update(reminders).set({ firedAt }).where(eq(reminders.id, id));
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

  async getStorageProjects(): Promise<StorageProject[]> {
    return await db.select().from(storageProjects).orderBy(desc(storageProjects.createdAt));
  }

  async createStorageProject(data: InsertStorageProject & { createdById: number }): Promise<StorageProject> {
    const insertResult = await db.insert(storageProjects).values({
      name: data.name,
      createdById: data.createdById,
    });
    const id = extractInsertId(insertResult);
    const [project] = await db.select().from(storageProjects).where(eq(storageProjects.id, id));
    if (!project) {
      throw new Error("Failed to create storage project");
    }
    return project;
  }

  async deleteStorageProject(id: number): Promise<void> {
    await db.delete(storageFiles).where(eq(storageFiles.projectId, id));
    await db.delete(storageProjects).where(eq(storageProjects.id, id));
  }

  async getStorageFiles(projectId: number): Promise<StorageFile[]> {
    return await db
      .select()
      .from(storageFiles)
      .where(eq(storageFiles.projectId, projectId))
      .orderBy(desc(storageFiles.createdAt));
  }

  async getStorageFile(id: number): Promise<StorageFile | undefined> {
    const [file] = await db.select().from(storageFiles).where(eq(storageFiles.id, id));
    return file;
  }

  async createStorageFile(data: InsertStorageFile & { projectId: number; createdById: number }): Promise<StorageFile> {
    const insertResult = await db.insert(storageFiles).values({
      projectId: data.projectId,
      name: data.name,
      type: data.type || "application/octet-stream",
      size: data.size,
      dataUrl: data.dataUrl,
      createdById: data.createdById,
    });
    const id = extractInsertId(insertResult);
    const [file] = await db.select().from(storageFiles).where(eq(storageFiles.id, id));
    if (!file) {
      throw new Error("Failed to create storage file");
    }
    return file;
  }

  async deleteStorageFile(id: number): Promise<void> {
    await db.delete(storageFiles).where(eq(storageFiles.id, id));
  }

  async getStorageProjectAccesses(projectId: number): Promise<StorageProjectAccess[]> {
    return await db
      .select()
      .from(storageProjectAccesses)
      .where(eq(storageProjectAccesses.projectId, projectId))
      .orderBy(asc(storageProjectAccesses.id));
  }

  async replaceStorageProjectAccesses(
    projectId: number,
    members: Array<{ userId: number; access: "view" | "edit" }>
  ): Promise<void> {
    await db.delete(storageProjectAccesses).where(eq(storageProjectAccesses.projectId, projectId));
    if (members.length === 0) return;
    await db.insert(storageProjectAccesses).values(
      members.map((member) => ({
        projectId,
        userId: member.userId,
        access: member.access,
      })),
    );
  }

  async getClientCredProjects(): Promise<ClientCredProject[]> {
    return await db.select().from(clientCredProjects).orderBy(desc(clientCredProjects.updatedAt), desc(clientCredProjects.createdAt));
  }

  async getClientCredProject(id: number): Promise<ClientCredProject | undefined> {
    const [project] = await db.select().from(clientCredProjects).where(eq(clientCredProjects.id, id));
    return project;
  }

  async createClientCredProject(data: InsertClientCredProject & { createdById: number }): Promise<ClientCredProject> {
    const insertResult = await db.insert(clientCredProjects).values({
      clientName: data.clientName,
      projectName: data.projectName,
      link: serializeStringSlots(data.links),
      viaChannels: serializeStringList(data.viaChannels),
      emails: serializeStringList(data.emails),
      passwords: serializeStringList(data.passwords),
      createdById: data.createdById,
      updatedAt: new Date(),
    });
    const id = extractInsertId(insertResult);
    const [project] = await db.select().from(clientCredProjects).where(eq(clientCredProjects.id, id));
    if (!project) {
      throw new Error("Failed to create client creds project");
    }
    return project;
  }

  async updateClientCredProject(
    id: number,
    data: Pick<InsertClientCredProject, "clientName" | "projectName" | "links" | "link" | "viaChannels" | "emails" | "passwords">
  ): Promise<ClientCredProject> {
    await db
      .update(clientCredProjects)
      .set({
        clientName: data.clientName,
        projectName: data.projectName,
        link: serializeStringSlots(data.links),
        viaChannels: serializeStringList(data.viaChannels),
        emails: serializeStringList(data.emails),
        passwords: serializeStringList(data.passwords),
        updatedAt: new Date(),
      })
      .where(eq(clientCredProjects.id, id));

    const [project] = await db.select().from(clientCredProjects).where(eq(clientCredProjects.id, id));
    if (!project) {
      throw new Error("Failed to update client creds project");
    }
    return project;
  }

  async deleteClientCredProject(id: number): Promise<void> {
    await db.delete(clientCredProjectAccesses).where(eq(clientCredProjectAccesses.projectId, id));
    await db.delete(clientCredProjects).where(eq(clientCredProjects.id, id));
  }

  async getClientCredProjectAccesses(projectId: number): Promise<ClientCredProjectAccess[]> {
    return await db
      .select()
      .from(clientCredProjectAccesses)
      .where(eq(clientCredProjectAccesses.projectId, projectId))
      .orderBy(asc(clientCredProjectAccesses.id));
  }

  async replaceClientCredProjectAccesses(
    projectId: number,
    members: Array<{ userId: number; access: "view" | "edit" }>
  ): Promise<void> {
    await db.delete(clientCredProjectAccesses).where(eq(clientCredProjectAccesses.projectId, projectId));
    if (members.length === 0) return;
    await db.insert(clientCredProjectAccesses).values(
      members.map((member) => ({
        projectId,
        userId: member.userId,
        access: member.access,
      })),
    );
  }

  async getTodoLists(): Promise<TodoList[]> {
    return await db.select().from(todoLists).orderBy(desc(todoLists.updatedAt), desc(todoLists.createdAt));
  }

  async getTodoList(id: number): Promise<TodoList | undefined> {
    const [list] = await db.select().from(todoLists).where(eq(todoLists.id, id));
    return list;
  }

  async createTodoList(data: InsertTodoList & { createdById: number }): Promise<TodoList> {
    const insertResult = await db.insert(todoLists).values({
      title: data.title,
      createdById: data.createdById,
      updatedAt: new Date(),
    });
    const id = extractInsertId(insertResult);
    const [list] = await db.select().from(todoLists).where(eq(todoLists.id, id));
    if (!list) {
      throw new Error("Failed to create todo list");
    }
    return list;
  }

  async updateTodoList(id: number, data: InsertTodoList): Promise<TodoList> {
    await db
      .update(todoLists)
      .set({
        title: data.title,
        updatedAt: new Date(),
      })
      .where(eq(todoLists.id, id));

    const [list] = await db.select().from(todoLists).where(eq(todoLists.id, id));
    if (!list) {
      throw new Error("Todo list not found");
    }
    return list;
  }

  async deleteTodoList(id: number): Promise<void> {
    await db.delete(todoItems).where(eq(todoItems.listId, id));
    await db.delete(todoLists).where(eq(todoLists.id, id));
  }

  async getTodoItems(listId: number): Promise<TodoItem[]> {
    return await db
      .select()
      .from(todoItems)
      .where(eq(todoItems.listId, listId))
      .orderBy(asc(todoItems.sortOrder), asc(todoItems.id));
  }

  async getTodoItem(id: number): Promise<TodoItem | undefined> {
    const [item] = await db.select().from(todoItems).where(eq(todoItems.id, id));
    return item;
  }

  async createTodoItem(data: InsertTodoItem & { listId: number }): Promise<TodoItem> {
    const existingItems = await this.getTodoItems(data.listId);
    const fallbackSortOrder =
      existingItems.length > 0
        ? (existingItems[existingItems.length - 1]?.sortOrder || 0) + 1024
        : 1024;
    const insertResult = await db.insert(todoItems).values({
      listId: data.listId,
      content: data.content,
      completed: !!data.completed,
      sortOrder: data.sortOrder ?? fallbackSortOrder,
      updatedAt: new Date(),
    });
    const id = extractInsertId(insertResult);
    const [item] = await db.select().from(todoItems).where(eq(todoItems.id, id));
    if (!item) {
      throw new Error("Failed to create todo item");
    }
    await db.update(todoLists).set({ updatedAt: new Date() }).where(eq(todoLists.id, data.listId));
    return item;
  }

  async updateTodoItem(id: number, data: Partial<InsertTodoItem>): Promise<TodoItem> {
    const existing = await this.getTodoItem(id);
    if (!existing) {
      throw new Error("Todo item not found");
    }

    await db
      .update(todoItems)
      .set({
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.completed !== undefined ? { completed: !!data.completed } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(todoItems.id, id));

    await db.update(todoLists).set({ updatedAt: new Date() }).where(eq(todoLists.id, existing.listId));

    const [item] = await db.select().from(todoItems).where(eq(todoItems.id, id));
    if (!item) {
      throw new Error("Todo item not found");
    }
    return item;
  }

  async deleteTodoItem(id: number): Promise<void> {
    const existing = await this.getTodoItem(id);
    if (!existing) return;
    await db.delete(todoItems).where(eq(todoItems.id, id));
    await db.update(todoLists).set({ updatedAt: new Date() }).where(eq(todoLists.id, existing.listId));
  }
}

export const storage = new DatabaseStorage();
