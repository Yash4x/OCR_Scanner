-- Phase 4 AI summaries and explanations for DocumentDiff AI

create table if not exists public.comparison_summaries (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  executive_summary text not null,
  major_changes jsonb not null default '[]'::jsonb,
  risk_level text null check (risk_level in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comparison_id)
);

create table if not exists public.change_summaries (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  comparison_line_id uuid not null references public.comparison_lines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section_title text null,
  change_type text not null check (change_type in ('modified', 'added', 'removed', 'moved', 'formatting_only')),
  short_summary text not null,
  old_meaning text null,
  new_meaning text null,
  practical_impact text null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  confidence double precision null,
  created_at timestamptz not null default now(),
  unique (comparison_line_id)
);

create index if not exists comparison_summaries_comparison_id_idx on public.comparison_summaries (comparison_id);
create index if not exists comparison_summaries_user_id_idx on public.comparison_summaries (user_id);
create index if not exists comparison_summaries_risk_level_idx on public.comparison_summaries (risk_level);

create index if not exists change_summaries_comparison_id_idx on public.change_summaries (comparison_id);
create index if not exists change_summaries_user_id_idx on public.change_summaries (user_id);
create index if not exists change_summaries_comparison_line_id_idx on public.change_summaries (comparison_line_id);
create index if not exists change_summaries_risk_level_idx on public.change_summaries (risk_level);

drop trigger if exists set_comparison_summaries_updated_at on public.comparison_summaries;
create trigger set_comparison_summaries_updated_at
  before update on public.comparison_summaries
  for each row execute procedure public.set_updated_at();

alter table public.comparison_summaries enable row level security;
alter table public.change_summaries enable row level security;

drop policy if exists "Users can select own comparison summaries" on public.comparison_summaries;
drop policy if exists "Users can insert own comparison summaries" on public.comparison_summaries;
drop policy if exists "Users can update own comparison summaries" on public.comparison_summaries;
drop policy if exists "Users can delete own comparison summaries" on public.comparison_summaries;

drop policy if exists "Users can select own change summaries" on public.change_summaries;
drop policy if exists "Users can insert own change summaries" on public.change_summaries;
drop policy if exists "Users can update own change summaries" on public.change_summaries;
drop policy if exists "Users can delete own change summaries" on public.change_summaries;

create policy "Users can select own comparison summaries"
  on public.comparison_summaries
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own comparison summaries"
  on public.comparison_summaries
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own comparison summaries"
  on public.comparison_summaries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own comparison summaries"
  on public.comparison_summaries
  for delete
  using (auth.uid() = user_id);

create policy "Users can select own change summaries"
  on public.change_summaries
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own change summaries"
  on public.change_summaries
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own change summaries"
  on public.change_summaries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own change summaries"
  on public.change_summaries
  for delete
  using (auth.uid() = user_id);