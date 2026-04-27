-- Phase 3 line-by-line comparison for DocumentDiff AI

create table if not exists public.comparison_lines (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  old_line_id uuid null references public.document_lines(id) on delete set null,
  new_line_id uuid null references public.document_lines(id) on delete set null,
  old_page_number int null,
  new_page_number int null,
  old_line_number int null,
  new_line_number int null,
  old_text text null,
  new_text text null,
  normalized_old_text text null,
  normalized_new_text text null,
  section_title text null,
  change_type text not null check (change_type in ('unchanged', 'modified', 'added', 'removed', 'moved', 'formatting_only')),
  similarity_score double precision null,
  created_at timestamptz not null default now()
);

create index if not exists comparison_lines_comparison_id_idx on public.comparison_lines (comparison_id);
create index if not exists comparison_lines_user_id_idx on public.comparison_lines (user_id);
create index if not exists comparison_lines_change_type_idx on public.comparison_lines (change_type);

alter table public.comparison_lines enable row level security;

drop policy if exists "Users can select own comparison lines" on public.comparison_lines;
drop policy if exists "Users can insert own comparison lines" on public.comparison_lines;
drop policy if exists "Users can update own comparison lines" on public.comparison_lines;
drop policy if exists "Users can delete own comparison lines" on public.comparison_lines;

create policy "Users can select own comparison lines"
  on public.comparison_lines
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own comparison lines"
  on public.comparison_lines
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own comparison lines"
  on public.comparison_lines
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own comparison lines"
  on public.comparison_lines
  for delete
  using (auth.uid() = user_id);