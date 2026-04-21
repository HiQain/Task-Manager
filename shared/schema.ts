import {
  type AnyMySqlColumn,
  mysqlTable,
  text,
  longtext,
  int,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";
import { z } from "zod";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  designation: varchar("designation", { length: 120 }).notNull().default(""),
  password: varchar("password", { length: 255 })
    .notNull()
    .default("5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  allowStorage: boolean("allow_storage").notNull().default(false),
  allowClientCreds: boolean("allow_client_creds").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 30 }).notNull().default("todo"),
  priority: varchar("priority", { length: 30 }).notNull().default("medium"),
  completed: boolean("completed").default(false),
  sortOrder: int("sort_order").notNull().default(0),
  parentTaskId: int("parent_task_id").references((): AnyMySqlColumn => tasks.id),
  assignedToId: int("assigned_to_id").references(() => users.id),
  assignedToIds: text("assigned_to_ids"),
  createdById: int("created_by_id").references(() => users.id),
  attachments: longtext("attachments"),
  dueDate: timestamp("due_date", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  fromUserId: int("from_user_id").notNull().references(() => users.id),
  toUserId: int("to_user_id").notNull().references(() => users.id),
  content: longtext("content").notNull(),
  readAt: timestamp("read_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const taskGroupMessages = mysqlTable("task_group_messages", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("task_id").notNull().references(() => tasks.id),
  fromUserId: int("from_user_id").notNull().references(() => users.id),
  content: longtext("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const taskComments = mysqlTable("task_comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("task_id").notNull().references(() => tasks.id),
  userId: int("user_id").notNull().references(() => users.id),
  content: longtext("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const taskChatGroups = mysqlTable("task_chat_groups", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("task_id").notNull().references(() => tasks.id).unique(),
  createdById: int("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const taskGroupReadStates = mysqlTable(
  "task_group_read_states",
  {
    id: int("id").autoincrement().primaryKey(),
    taskId: int("task_id").notNull().references(() => tasks.id),
    userId: int("user_id").notNull().references(() => users.id),
    lastReadAt: timestamp("last_read_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
  },
  (table) => ({
    userTaskUnique: uniqueIndex("task_group_read_states_user_task_idx").on(table.userId, table.taskId),
  })
);

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id),
  actorUserId: int("actor_user_id").references(() => users.id),
  type: varchar("type", { length: 60 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  entityType: varchar("entity_type", { length: 60 }),
  entityId: int("entity_id"),
  readAt: timestamp("read_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull().references(() => users.id),
    endpoint: varchar("endpoint", { length: 512 }).notNull(),
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    auth: varchar("auth", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
  },
  (table) => ({
    endpointUnique: uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
  }),
);

export const reminders = mysqlTable(
  "reminders",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull().references(() => users.id),
    clientId: varchar("client_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    triggerAtUtc: timestamp("trigger_at_utc", { mode: "date" }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    firedAt: timestamp("fired_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
  },
  (table) => ({
    userClientUnique: uniqueIndex("reminders_user_client_idx").on(table.userId, table.clientId),
  }),
);

export const storageProjects = mysqlTable("storage_projects", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdById: int("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const storageFiles = mysqlTable("storage_files", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull().references(() => storageProjects.id),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 255 }).notNull().default("application/octet-stream"),
  size: int("size").notNull().default(0),
  dataUrl: longtext("data_url").notNull(),
  createdById: int("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const storageProjectAccesses = mysqlTable(
  "storage_project_accesses",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id").notNull().references(() => storageProjects.id),
    userId: int("user_id").notNull().references(() => users.id),
    access: varchar("access", { length: 16 }).notNull().default("view"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => ({
    projectUserUnique: uniqueIndex("storage_project_access_project_user_idx").on(table.projectId, table.userId),
  }),
);

export const clientCredProjects = mysqlTable("client_cred_projects", {
  id: int("id").autoincrement().primaryKey(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  projectName: varchar("project_name", { length: 255 }).notNull(),
  link: text("link"),
  viaChannels: longtext("via_channels").notNull(),
  emails: longtext("emails").notNull(),
  passwords: longtext("passwords").notNull(),
  createdById: int("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
});

export const clientCredProjectAccesses = mysqlTable(
  "client_cred_project_accesses",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id").notNull(),
    userId: int("user_id").notNull(),
    access: varchar("access", { length: 16 }).notNull().default("view"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => ({
    projectFk: foreignKey({
      columns: [table.projectId],
      foreignColumns: [clientCredProjects.id],
      name: "cc_proj_access_project_fk",
    }),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "cc_proj_access_user_fk",
    }),
    projectUserUnique: uniqueIndex("client_cred_access_project_user_idx").on(table.projectId, table.userId),
  }),
);

export const todoLists = mysqlTable("todo_lists", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  createdById: int("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
});

export const todoItems = mysqlTable("todo_items", {
  id: int("id").autoincrement().primaryKey(),
  listId: int("list_id").notNull().references(() => todoLists.id),
  content: varchar("content", { length: 255 }).notNull(),
  completed: boolean("completed").notNull().default(false),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
});

export const insertUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  designation: z.string().trim().min(1, "Designation is required").max(120),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["user", "admin"]).default("user"),
  allowStorage: z.boolean().default(false),
  allowClientCreds: z.boolean().default(false),
});

export const insertTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  completed: z.boolean().nullable().optional(),
  sortOrder: z.number().int().optional(),
  parentTaskId: z.number().int().nullable().optional(),
  assignedToId: z.number().int().nullable().optional(),
  assignedToIds: z.array(z.number().int()).optional(),
  createdById: z.number().int().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        data: z.string(),
        type: z.string(),
        reason: z.string().optional(),
        inline: z.boolean().optional(),
      }),
    )
    .optional(),
  dueDate: z.string().nullable().optional(),
});

export const insertMessageSchema = z.object({
  fromUserId: z.number().int().optional(),
  toUserId: z.number().int(),
  content: z.string().min(1, "Message is required").max(60_000_000, "Message is too long"),
  readAt: z.date().nullable().optional(),
});

export const insertTaskGroupMessageSchema = z.object({
  taskId: z.number().int(),
  fromUserId: z.number().int().optional(),
  content: z.string().min(1, "Message is required").max(60_000_000, "Message is too long"),
});

export const insertTaskCommentSchema = z.object({
  taskId: z.number().int(),
  userId: z.number().int().optional(),
  content: z.string().min(1, "Comment is required").max(2000, "Comment is too long"),
});

export const insertTaskChatGroupSchema = z.object({
  taskId: z.number().int(),
  createdById: z.number().int(),
});

export const insertTaskGroupReadStateSchema = z.object({
  taskId: z.number().int(),
  userId: z.number().int(),
  lastReadAt: z.date().optional(),
});

export const insertNotificationSchema = z.object({
  userId: z.number().int(),
  actorUserId: z.number().int().nullable().optional(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  entityType: z.string().nullable().optional(),
  entityId: z.number().int().nullable().optional(),
});

export const insertPushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const reminderSyncItemSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  triggerAtUtc: z.number().int(),
  timezone: z.string().min(1),
});

export const reminderSyncSchema = z.object({
  items: z.array(reminderSyncItemSchema),
});

export const insertStorageProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(255),
  members: z
    .array(
      z.object({
        userId: z.number().int(),
        access: z.enum(["view", "edit"]),
      }),
    )
    .optional(),
});

export const insertStorageFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(255).optional(),
  size: z.number().int().min(0),
  dataUrl: z.string().min(1),
});

export const updateStorageProjectAccessSchema = z.object({
  members: z.array(
    z.object({
      userId: z.number().int(),
      access: z.enum(["view", "edit"]),
    }),
  ),
});

const clientCredListFieldSchema = z
  .array(z.string().trim().min(1))
  .min(1, "At least one value is required");

export const insertClientCredProjectSchema = z.object({
  clientName: z.string().trim().min(1, "Client name is required").max(255),
  projectName: z.string().trim().min(1, "Project name is required").max(255),
  viaChannels: clientCredListFieldSchema,
  emails: clientCredListFieldSchema,
  passwords: clientCredListFieldSchema,
  links: z.array(z.string().trim().max(2048, "Link is too long")).min(1, "At least one link slot is required"),
  link: z.string().trim().max(2048, "Link is too long").optional(),
  members: z
    .array(
      z.object({
        userId: z.number().int(),
        access: z.enum(["view", "edit"]),
      }),
    )
    .optional(),
});

export const updateClientCredProjectSchema = insertClientCredProjectSchema.omit({ members: true });

export const updateClientCredProjectAccessSchema = z.object({
  members: z.array(
    z.object({
      userId: z.number().int(),
      access: z.enum(["view", "edit"]),
    }),
  ),
});

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
  activationPassword: z.string().min(6, "Temporary password must be at least 6 characters").optional(),
});

export const insertTodoListSchema = z.object({
  title: z.string().trim().min(1, "List title is required").max(255),
});

export const updateTodoListSchema = insertTodoListSchema;

export const insertTodoItemSchema = z.object({
  content: z.string().trim().min(1, "Item title is required").max(255),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateTodoItemSchema = z.object({
  content: z.string().trim().min(1, "Item title is required").max(255).optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTaskRequest = Partial<InsertTask>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type TaskGroupMessage = typeof taskGroupMessages.$inferSelect;
export type InsertTaskGroupMessage = z.infer<typeof insertTaskGroupMessageSchema>;
export type TaskComment = typeof taskComments.$inferSelect;
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;
export type TaskChatGroup = typeof taskChatGroups.$inferSelect;
export type InsertTaskChatGroup = z.infer<typeof insertTaskChatGroupSchema>;
export type TaskGroupReadState = typeof taskGroupReadStates.$inferSelect;
export type InsertTaskGroupReadState = z.infer<typeof insertTaskGroupReadStateSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type Reminder = typeof reminders.$inferSelect;
export type ReminderSyncItem = z.infer<typeof reminderSyncItemSchema>;
export type StorageProject = typeof storageProjects.$inferSelect;
export type InsertStorageProject = z.infer<typeof insertStorageProjectSchema>;
export type StorageFile = typeof storageFiles.$inferSelect;
export type InsertStorageFile = z.infer<typeof insertStorageFileSchema>;
export type StorageProjectAccess = typeof storageProjectAccesses.$inferSelect;
export type UpdateStorageProjectAccess = z.infer<typeof updateStorageProjectAccessSchema>;
export type ClientCredProject = typeof clientCredProjects.$inferSelect;
export type InsertClientCredProject = z.infer<typeof insertClientCredProjectSchema>;
export type UpdateClientCredProject = z.infer<typeof updateClientCredProjectSchema>;
export type ClientCredProjectAccess = typeof clientCredProjectAccesses.$inferSelect;
export type UpdateClientCredProjectAccess = z.infer<typeof updateClientCredProjectAccessSchema>;
export type UpdateUserStatus = z.infer<typeof updateUserStatusSchema>;
export type TodoList = typeof todoLists.$inferSelect;
export type InsertTodoList = z.infer<typeof insertTodoListSchema>;
export type UpdateTodoList = z.infer<typeof updateTodoListSchema>;
export type TodoItem = typeof todoItems.$inferSelect;
export type InsertTodoItem = z.infer<typeof insertTodoItemSchema>;
export type UpdateTodoItem = z.infer<typeof updateTodoItemSchema>;
