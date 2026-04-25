# DocumentDiff AI - Phase 1

Phase 1 provides the app foundation:

- Auth (sign up, log in, log out)
- Protected dashboard
- Create comparison flow
- Upload old/new documents to Supabase Storage
- Save comparison and document metadata to Supabase Postgres
- View comparison history and detail page

## Tech Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- shadcn-style UI components
- Supabase Auth, Postgres, Storage, RLS

## 1) Environment Variables

Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2) Create Supabase Schema and Policies

Run the SQL in:

- `supabase/migrations/0001_phase1_foundation.sql`

This SQL creates:

- `profiles`, `comparisons`, `documents` tables
- RLS policies for user-owned data
- Private storage bucket `raw-documents`
- Storage policies restricting file access to each user's folder

## 3) Install and Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Phase 1 Acceptance Flow

1. Sign up and log in.
2. Go to dashboard.
3. Click "New Comparison".
4. Enter title and upload old/new files (`pdf`, `png`, `jpg`, `jpeg`).
5. Submit and confirm redirect to comparison detail.
6. Refresh dashboard and confirm history remains visible.
