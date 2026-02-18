import {
  mysqlTable,
  text,
  longtext,
  int,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
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
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 30 }).notNull().default("todo"),
  priority: varchar("priority", { length: 30 }).notNull().default("medium"),
  completed: boolean("completed").default(false),
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

export const insertUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  designation: z.string().trim().min(1, "Designation is required").max(120),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["user", "admin"]).default("user"),
});

export const insertTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  completed: z.boolean().nullable().optional(),
  assignedToId: z.number().int().nullable().optional(),
  assignedToIds: z.array(z.number().int()).optional(),
  createdById: z.number().int().optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        data: z.string(),
        type: z.string(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  dueDate: z.string().nullable().optional(),
});

export const insertMessageSchema = z.object({
  fromUserId: z.number().int().optional(),
  toUserId: z.number().int(),
  content: z.string().min(1, "Message is required").max(900000, "Message is too long"),
  readAt: z.date().nullable().optional(),
});

export const insertTaskGroupMessageSchema = z.object({
  taskId: z.number().int(),
  fromUserId: z.number().int().optional(),
  content: z.string().min(1, "Message is required").max(900000, "Message is too long"),
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

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTaskRequest = Partial<InsertTask>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type TaskGroupMessage = typeof taskGroupMessages.$inferSelect;
export type InsertTaskGroupMessage = z.infer<typeof insertTaskGroupMessageSchema>;
export type TaskChatGroup = typeof taskChatGroups.$inferSelect;
export type InsertTaskChatGroup = z.infer<typeof insertTaskChatGroupSchema>;
export type TaskGroupReadState = typeof taskGroupReadStates.$inferSelect;
export type InsertTaskGroupReadState = z.infer<typeof insertTaskGroupReadStateSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
