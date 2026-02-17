import { z } from 'zod';
import { insertMessageSchema, insertTaskGroupMessageSchema, insertTaskSchema, insertUserSchema, messages, notifications, taskChatGroups, taskGroupMessages, tasks, users } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/auth/login',
      input: z.object({
        email: z.string().email(),
        password: z.string(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.notFound,
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout',
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/auth/me',
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.notFound,
      },
    },
  },
  users: {
    list: {
      method: 'GET' as const,
      path: '/api/users',
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/users',
      input: insertUserSchema,
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/users/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/users/:id',
      input: z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        password: z.string().min(6, "Password must be at least 6 characters").optional(),
        role: z.enum(["user", "admin"]).optional(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
  },
  tasks: {
    list: {
      method: 'GET' as const,
      path: '/api/tasks',
      responses: {
        200: z.array(z.custom<typeof tasks.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/tasks/:id',
      responses: {
        200: z.custom<typeof tasks.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/tasks',
      input: insertTaskSchema,
      responses: {
        201: z.custom<typeof tasks.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/tasks/:id',
      input: insertTaskSchema.partial(),
      responses: {
        200: z.custom<typeof tasks.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/tasks/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  chats: {
    users: {
      method: 'GET' as const,
      path: '/api/chats/users',
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    unread: {
      method: 'GET' as const,
      path: '/api/chats/unread',
      responses: {
        200: z.object({
          total: z.number(),
          byUser: z.record(z.string(), z.number()),
        }),
        401: errorSchemas.notFound,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/chats/messages/:userId',
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    send: {
      method: 'POST' as const,
      path: '/api/chats/messages',
      input: insertMessageSchema.pick({ toUserId: true, content: true }),
      responses: {
        201: z.custom<typeof messages.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    markRead: {
      method: 'POST' as const,
      path: '/api/chats/read/:userId',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    groups: {
      method: 'GET' as const,
      path: '/api/chats/groups',
      responses: {
        200: z.array(
          z.object({
            group: z.custom<typeof taskChatGroups.$inferSelect>(),
            task: z.custom<typeof tasks.$inferSelect>(),
            participantIds: z.array(z.number()),
          })
        ),
        401: errorSchemas.notFound,
      },
    },
    groupsUnread: {
      method: 'GET' as const,
      path: '/api/chats/groups/unread',
      responses: {
        200: z.object({
          total: z.number(),
          byTask: z.record(z.string(), z.number()),
        }),
        401: errorSchemas.notFound,
      },
    },
    groupCreate: {
      method: 'POST' as const,
      path: '/api/chats/groups/task/:taskId',
      responses: {
        201: z.custom<typeof taskChatGroups.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    groupMarkRead: {
      method: 'POST' as const,
      path: '/api/chats/groups/task/:taskId/read',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    groupList: {
      method: 'GET' as const,
      path: '/api/chats/groups/task/:taskId',
      responses: {
        200: z.array(z.custom<typeof taskGroupMessages.$inferSelect>()),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    groupSend: {
      method: 'POST' as const,
      path: '/api/chats/groups/task/:taskId/messages',
      input: insertTaskGroupMessageSchema.pick({ content: true }),
      responses: {
        201: z.custom<typeof taskGroupMessages.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
  },
  notifications: {
    list: {
      method: 'GET' as const,
      path: '/api/notifications',
      responses: {
        200: z.array(z.custom<typeof notifications.$inferSelect>()),
        401: errorSchemas.notFound,
      },
    },
    unread: {
      method: 'GET' as const,
      path: '/api/notifications/unread',
      responses: {
        200: z.object({ count: z.number() }),
        401: errorSchemas.notFound,
      },
    },
    markRead: {
      method: 'POST' as const,
      path: '/api/notifications/:id/read',
      responses: {
        200: z.object({ success: z.boolean() }),
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    markAllRead: {
      method: 'POST' as const,
      path: '/api/notifications/read-all',
      responses: {
        200: z.object({ success: z.boolean() }),
        401: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/notifications/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type UserResponse = z.infer<typeof api.users.create.responses[201]>;
export type TaskInput = z.infer<typeof api.tasks.create.input>;
export type TaskResponse = z.infer<typeof api.tasks.create.responses[201]>;
