# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Academics4 is a volunteer tutoring platform connecting teachers with students in crisis-affected regions (Gaza, Ukraine, Syria, Afghanistan, Yemen, Sudan). Key feature: multi-match system where one student can have multiple teachers for different subjects, with admin-controlled subject assignment.

## Commands

```bash
npm run dev        # Start dev server (port 3000)
npm run build      # Production build
npm start          # Start production server
npm run lint       # ESLint check

# Database
npx prisma generate      # Generate Prisma client (run after schema changes)
npx prisma migrate dev   # Create and apply migrations (development)
npx prisma migrate deploy # Apply migrations (production)
npx prisma studio        # Visual database explorer
npx prisma db seed       # Seed database (if seed script exists)

# Docker
docker-compose up -d                           # Start PostgreSQL + app (detached)
docker-compose -f docker-compose.prod.yml up -d # Production containers
docker-compose logs -f                          # View logs
docker-compose down                             # Stop containers
```

## Architecture

### Tech Stack
- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **UI Components**: Shadcn/ui (in `src/components/ui/`)
- **State**: Zustand (`src/store/auth-store.ts`) + TanStack React Query
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT (jose) with httpOnly cookies, 15-min access + 7-day refresh tokens
- **AI/Matching**: Local embeddings (@xenova/transformers) + Ollama LLM for semantic matching
- **PDF/Excel Export**: jspdf + jspdf-autotable + xlsx

### Route Structure
```
src/app/
├── api/                    # API routes
│   ├── auth/               # login, register, me, refresh, logout
│   └── admin/              # Admin-only endpoints
│       ├── students/       # Student management + subject assignment
│       ├── volunteers/     # Volunteer + capacity management
│       ├── matches/        # Match status updates
│       └── triggers/       # Auto-matching triggers
├── admin/                  # Admin dashboard pages
├── volunteer/              # Volunteer portal pages
├── student/                # Student portal pages
├── login/
└── register/
```

### Key Files
- `src/middleware.ts` - Auth + RBAC, redirects based on role (jose for JWT verification)
- `src/lib/auth.ts` - JWT generation/verification, password hashing (bcryptjs)
- `src/lib/prisma.ts` - Prisma client singleton
- `src/lib/utils.ts` - Subject matching algorithm with synonym groups
- `src/lib/embeddings.ts` - Local embeddings with @xenova/transformers
- `src/lib/llm-matcher.ts` - Ollama LLM service for semantic matching
- `src/lib/validations.ts` - Zod schemas for form validation
- `prisma/schema.prisma` - Database models

### Database Models (Core)
- **User** → 1:1 with Volunteer or Student (cascade delete), stores auth + role
- **Volunteer** → Capacity management (currentCapacity/maxCapacity), subjects qualified
- **Student** → topicsNeedSupport stored as JSON: `[{keyword, status, assignedTo}]`
- **Match** → Links student-volunteer with assignedSubjects array, unique per pair
- **SubjectAssignment** → Append-only audit trail (assigned/unassigned/reassigned)
- **Session** → Tracks individual tutoring sessions with platform and notes
- **RefreshToken** → Stores refresh tokens with expiration (7-day lifetime)
- **EmbeddingCache** → Caches embeddings to avoid recomputation
- **MatchScoresCache** → Caches match scores with expiration

### Roles & Access
- **Admin**: Full access, manages matches and subject assignments
- **Volunteer**: Can only see assigned students (privacy-enforced)
- **Student**: Can only see assigned teachers

## Patterns

### API Endpoints
- Use Zod for request validation
- Check JWT with `verifyAccessToken()` from `src/lib/auth.ts`
- Enforce roles before processing (return 401/403 for unauthorized)
- Return `NextResponse.json()` with appropriate status codes
- API routes in `src/app/api/` follow Next.js App Router conventions

### Authentication Flow
- Login returns httpOnly cookies: `accessToken` (15min) + `refreshToken` (7d)
- Middleware (`src/middleware.ts`) verifies JWT and enforces RBAC
- Frontend uses `/api/auth/me` to get current user
- Use `/api/auth/refresh` to get new access token before expiry
- Refresh tokens stored in database, deleted on logout

### Forms
- React Hook Form + Zod resolver
- Validation schemas in `src/lib/validations.ts`
- Server-side validation mirrors client schemas

### Subject Matching
- Free-text subjects (no predefined list)
- Synonym groups in `src/lib/utils.ts` for rule-based matching
- LLM fallback via Ollama (`src/lib/llm-matcher.ts`) for semantic matching
- Embeddings cached in database to avoid recomputation
- Match scores also cached with expiration timestamps

## Environment Variables

See `.env.example` for complete list. Required variables:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/academics4"
JWT_SECRET="..."              # Generate: openssl rand -base64 32
JWT_REFRESH_SECRET="..."      # Generate: openssl rand -base64 32
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Optional - for LLM matching
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="qwen2.5:1.5b"

# Optional - for email notifications
# SENDGRID_API_KEY="..."
# EMAIL_FROM="noreply@academics4.org"
```

## Development Workflow

### Initial Setup
1. `npm install` - Install dependencies
2. Copy `.env.example` to `.env` and configure
3. `npx prisma generate` - Generate Prisma client
4. `npx prisma migrate dev` - Apply database migrations
5. `npm run dev` - Start development server

### After Changing Database Schema
1. Edit `prisma/schema.prisma`
2. `npx prisma migrate dev --name description_of_change`
3. `npx prisma generate` (auto-runs with migrate dev)

### Working with Ollama (Optional)
The app can work without Ollama, but for semantic matching:
1. Install Ollama from https://ollama.ai
2. Pull model: `ollama pull qwen2.5:1.5b`
3. Ollama runs on port 11434 by default
