# TaskFlow

## Overview

TaskFlow is a task management application with a Kanban board interface. It allows users to create, organize, and track tasks across different stages (todo, in progress, done) with drag-and-drop functionality. The application supports team management with user assignment to tasks and provides multiple views including a Kanban board, list view, and overview dashboard with statistics.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, local React state for UI
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **Drag and Drop**: @hello-pangea/dnd for Kanban board functionality
- **Forms**: React Hook Form with Zod validation
- **Build Tool**: Vite

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: REST API with typed route definitions in shared folder
- **Validation**: Zod schemas shared between frontend and backend

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema-to-validation integration
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Migrations**: Drizzle Kit for database migrations (`drizzle-kit push`)

### Project Structure
- `client/` - React frontend application
- `server/` - Express backend with API routes
- `shared/` - Shared types, schemas, and route definitions used by both frontend and backend
- `migrations/` - Database migration files

### Key Design Patterns
- **Shared Schema**: Database schema in `shared/schema.ts` generates both TypeScript types and Zod validation schemas
- **Typed API Routes**: Route definitions in `shared/routes.ts` define paths, methods, input schemas, and response types
- **Storage Abstraction**: `server/storage.ts` provides a database storage class implementing the `IStorage` interface

## External Dependencies

### Database
- PostgreSQL database (connection via `DATABASE_URL` environment variable)
- Drizzle ORM for database operations
- connect-pg-simple for session storage capability

### UI Libraries
- Radix UI primitives (dialogs, dropdowns, forms, etc.)
- Lucide React for icons
- Recharts for dashboard charts
- Embla Carousel for carousel components

### Development Tools
- Vite development server with HMR
- Replit-specific plugins for development experience (@replit/vite-plugin-runtime-error-modal, @replit/vite-plugin-cartographer)