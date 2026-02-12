import { db } from "./db";
import {
  tasks,
  users,
  type Task,
  type User,
  type InsertTask,
  type InsertUser,
  type UpdateTaskRequest
} from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  deleteUser(id: number): Promise<void>;
  clearAllUsers(): Promise<void>;

  // Tasks
  getTasks(): Promise<Task[]>;
  getTask(id: number): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, updates: UpdateTaskRequest): Promise<Task>;
  deleteTask(id: number): Promise<void>;
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export class DatabaseStorage implements IStorage {
  // Users Implementation
  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
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
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
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
      let dueDate: string | null = null;
      if (r.dueDate instanceof Date) {
        dueDate = r.dueDate.toISOString();
      } else if (typeof r.dueDate === 'string' && r.dueDate.length) {
        dueDate = r.dueDate;
      } else {
        dueDate = null;
      }
      return { ...r, attachments, dueDate } as any;
    });
  }

  async getTask(id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!task) return undefined;
    try {
      // attachments stored as JSON string in DB; parse for API consumers
      return { ...task, attachments: JSON.parse(task.attachments || "[]") } as any;
    } catch (e) {
      return { ...task, attachments: [] } as any;
    }
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const attachmentsJson = JSON.stringify((insertTask as any).attachments || []);
    const rawDue = (insertTask as any).dueDate;
    let dueDateVal: Date | null = null;
    if (rawDue) {
      const d = rawDue instanceof Date ? rawDue : new Date(rawDue);
      if (!isNaN(d.getTime())) dueDateVal = d;
      else dueDateVal = null;
    }
    const toInsert: any = {
      ...insertTask,
      attachments: attachmentsJson,
      dueDate: dueDateVal,
    };
    const [task] = await db.insert(tasks).values(toInsert).returning();
    try {
      const attachments = JSON.parse(task.attachments || "[]");
      const dueDate = task.dueDate instanceof Date ? task.dueDate.toISOString() : (typeof task.dueDate === 'string' ? task.dueDate : null);
      return { ...task, attachments, dueDate } as any;
    } catch (e) {
      const dueDate = task.dueDate instanceof Date ? task.dueDate.toISOString() : (typeof task.dueDate === 'string' ? task.dueDate : null);
      return { ...task, attachments: [], dueDate } as any;
    }
  }

  async updateTask(id: number, updates: UpdateTaskRequest): Promise<Task> {
    const toUpdate = { ...updates } as any;
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
    const [updated] = await db
      .update(tasks)
      .set(toUpdate)
      .where(eq(tasks.id, id))
      .returning();
    try {
      const attachments = JSON.parse(updated.attachments || "[]");
      const dueDate = updated.dueDate instanceof Date ? updated.dueDate.toISOString() : (typeof updated.dueDate === 'string' ? updated.dueDate : null);
      return { ...updated, attachments, dueDate } as any;
    } catch (e) {
      const dueDate = updated.dueDate instanceof Date ? updated.dueDate.toISOString() : (typeof updated.dueDate === 'string' ? updated.dueDate : null);
      return { ...updated, attachments: [], dueDate } as any;
    }
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }
}

export const storage = new DatabaseStorage();
