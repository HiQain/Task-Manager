import { z } from 'zod';
import { clientCredProjects, insertClientCredProjectSchema, insertMessageSchema, insertPushSubscriptionSchema, insertStorageFileSchema, insertStorageProjectSchema, insertTaskCommentSchema, insertTaskGroupMessageSchema, insertTaskSchema, insertTodoItemSchema, insertTodoListSchema, insertUserSchema, messages, notifications, reminderSyncSchema, storageFiles, storageProjects, taskChatGroups, taskComments, taskGroupMessages, tasks, todoItems, todoLists, updateClientCredProjectAccessSchema, updateClientCredProjectSchema, updateStorageProjectAccessSchema, updateTodoItemSchema, updateTodoListSchema, updateUserStatusSchema, users } from './schema';

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
    changePassword: {
      method: 'POST' as const,
      path: '/api/auth/change-password',
      input: z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(6, "Password must be at least 6 characters"),
      }),
      responses: {
        200: z.object({ message: z.string() }),
        400: errorSchemas.validation,
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
        designation: z.string().max(120).optional(),
        password: z.string().min(6, "Password must be at least 6 characters").optional(),
        role: z.enum(["user", "admin"]).optional(),
        allowStorage: z.boolean().optional(),
        allowClientCreds: z.boolean().optional(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    updateStatus: {
      method: 'POST' as const,
      path: '/api/users/:id/status',
      input: updateUserStatusSchema,
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
    comments: {
      list: {
        method: 'GET' as const,
        path: '/api/tasks/:id/comments',
        responses: {
          200: z.array(z.custom<typeof taskComments.$inferSelect>()),
          400: errorSchemas.validation,
          401: errorSchemas.notFound,
          404: errorSchemas.notFound,
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/tasks/:id/comments',
        input: insertTaskCommentSchema.pick({ content: true }),
        responses: {
          201: z.custom<typeof taskComments.$inferSelect>(),
          400: errorSchemas.validation,
          401: errorSchemas.notFound,
          404: errorSchemas.notFound,
        },
      },
      update: {
        method: 'PATCH' as const,
        path: '/api/tasks/:id/comments/:commentId',
        input: insertTaskCommentSchema.pick({ content: true }),
        responses: {
          200: z.custom<typeof taskComments.$inferSelect>(),
          400: errorSchemas.validation,
          401: errorSchemas.notFound,
          404: errorSchemas.notFound,
        },
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
    update: {
      method: 'PATCH' as const,
      path: '/api/chats/messages/:messageId',
      input: insertMessageSchema.pick({ content: true }),
      responses: {
        200: z.custom<typeof messages.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/chats/messages/:messageId',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
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
    groupUpdate: {
      method: 'PATCH' as const,
      path: '/api/chats/groups/task/:taskId/messages/:messageId',
      input: insertTaskGroupMessageSchema.pick({ content: true }),
      responses: {
        200: z.custom<typeof taskGroupMessages.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    groupDelete: {
      method: 'DELETE' as const,
      path: '/api/chats/groups/task/:taskId/messages/:messageId',
      responses: {
        200: z.object({ success: z.boolean() }),
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
  push: {
    vapid: {
      method: 'GET' as const,
      path: '/api/push/vapid',
      responses: {
        200: z.object({ publicKey: z.string() }),
        401: errorSchemas.notFound,
      },
    },
    subscribe: {
      method: 'POST' as const,
      path: '/api/push/subscribe',
      input: insertPushSubscriptionSchema,
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    unsubscribe: {
      method: 'POST' as const,
      path: '/api/push/unsubscribe',
      input: z.object({ endpoint: z.string().min(1) }),
      responses: {
        200: z.object({ success: z.boolean() }),
        401: errorSchemas.notFound,
      },
    },
  },
  reminders: {
    sync: {
      method: 'POST' as const,
      path: '/api/reminders/sync',
      input: reminderSyncSchema,
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
  },
  storage: {
    list: {
      method: 'GET' as const,
      path: '/api/storage/projects',
      responses: {
        200: z.object({
          projects: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              createdAt: z.any().nullable().optional(),
              files: z.array(z.custom<typeof storageFiles.$inferSelect>()),
              canEdit: z.boolean(),
              canDelete: z.boolean(),
              members: z.array(
                z.object({
                  userId: z.number(),
                  name: z.string(),
                  access: z.enum(["view", "edit"]),
                }),
              ),
            }),
          ),
          usedBytes: z.number(),
          quotaBytes: z.number(),
        }),
        401: errorSchemas.notFound,
      },
    },
    createProject: {
      method: 'POST' as const,
      path: '/api/storage/projects',
      input: insertStorageProjectSchema,
      responses: {
        201: z.custom<typeof storageProjects.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    deleteProject: {
      method: 'DELETE' as const,
      path: '/api/storage/projects/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    addFile: {
      method: 'POST' as const,
      path: '/api/storage/projects/:id/files',
      input: insertStorageFileSchema,
      responses: {
        201: z.custom<typeof storageFiles.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    deleteFile: {
      method: 'DELETE' as const,
      path: '/api/storage/files/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    updateAccess: {
      method: 'POST' as const,
      path: '/api/storage/projects/:id/access',
      input: updateStorageProjectAccessSchema,
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        403: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
  },
  clientCreds: {
    list: {
      method: 'GET' as const,
      path: '/api/client-creds/projects',
      responses: {
        200: z.object({
          projects: z.array(
            z.object({
              id: z.number(),
              clientName: z.string(),
              projectName: z.string(),
              link: z.string().nullable().optional(),
              links: z.array(z.string()).optional(),
              viaChannels: z.array(z.string()),
              emails: z.array(z.string()),
              passwords: z.array(z.string()),
              createdAt: z.any().nullable().optional(),
              updatedAt: z.any().nullable().optional(),
              canEdit: z.boolean(),
              canDelete: z.boolean(),
              members: z.array(
                z.object({
                  userId: z.number(),
                  name: z.string(),
                  access: z.enum(["view", "edit"]),
                }),
              ),
            }),
          ),
        }),
        401: errorSchemas.notFound,
      },
    },
    createProject: {
      method: 'POST' as const,
      path: '/api/client-creds/projects',
      input: insertClientCredProjectSchema,
      responses: {
        201: z.custom<typeof clientCredProjects.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    updateProject: {
      method: 'PATCH' as const,
      path: '/api/client-creds/projects/:id',
      input: updateClientCredProjectSchema,
      responses: {
        200: z.custom<typeof clientCredProjects.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    deleteProject: {
      method: 'DELETE' as const,
      path: '/api/client-creds/projects/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    updateAccess: {
      method: 'POST' as const,
      path: '/api/client-creds/projects/:id/access',
      input: updateClientCredProjectAccessSchema,
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        403: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
  },
  todos: {
    list: {
      method: 'GET' as const,
      path: '/api/todos',
      responses: {
        200: z.object({
          lists: z.array(
            z.object({
              list: z.custom<typeof todoLists.$inferSelect>(),
              items: z.array(z.custom<typeof todoItems.$inferSelect>()),
              creatorName: z.string(),
              canEdit: z.boolean(),
            }),
          ),
        }),
        401: errorSchemas.notFound,
      },
    },
    createList: {
      method: 'POST' as const,
      path: '/api/todos/lists',
      input: insertTodoListSchema,
      responses: {
        201: z.custom<typeof todoLists.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
      },
    },
    updateList: {
      method: 'PATCH' as const,
      path: '/api/todos/lists/:id',
      input: updateTodoListSchema,
      responses: {
        200: z.custom<typeof todoLists.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    deleteList: {
      method: 'DELETE' as const,
      path: '/api/todos/lists/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    createItem: {
      method: 'POST' as const,
      path: '/api/todos/lists/:id/items',
      input: insertTodoItemSchema,
      responses: {
        201: z.custom<typeof todoItems.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    updateItem: {
      method: 'PATCH' as const,
      path: '/api/todos/items/:id',
      input: updateTodoItemSchema,
      responses: {
        200: z.custom<typeof todoItems.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.notFound,
        404: errorSchemas.notFound,
      },
    },
    deleteItem: {
      method: 'DELETE' as const,
      path: '/api/todos/items/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        400: errorSchemas.validation,
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
