create extension if not exists pgcrypto;

create table if not exists public.comparison_spans (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  comparison_line_id uuid null references public.comparison_lines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  side text not null check (side in ('old', 'new')),
  page_number int not null,
  line_id uuid null references public.document_lines(id) on delete cascade,
  word_ids uuid[] null,
  change_type text not null,
  span_text text not null,
  bbox_left double precision not null,
  bbox_top double precision not null,
  bbox_width double precision not null,
  bbox_height double precision not null,
  source_type text not null check (source_type in ('word_diff', 'line_fallback', 'ai_aligned_span', 'estimated_line_fallback')),
  linked_span_group text null,
  confidence double precision not null default 0.75,
  created_at timestamptz not null default now()
);

create index if not exists comparison_spans_comparison_id_idx on public.comparison_spans (comparison_id);
create index if not exists comparison_spans_user_id_idx on public.comparison_spans (user_id);
create index if not exists comparison_spans_comparison_line_id_idx on public.comparison_spans (comparison_line_id);
create index if not exists comparison_spans_page_number_idx on public.comparison_spans (page_number);

alter table public.comparison_spans enable row level security;

drop policy if exists "Users can select own comparison spans" on public.comparison_spans;
drop policy if exists "Users can insert own comparison spans" on public.comparison_spans;
drop policy if exists "Users can update own comparison spans" on public.comparison_spans;
drop policy if exists "Users can delete own comparison spans" on public.comparison_spans;

create policy "Users can select own comparison spans"
  on public.comparison_spans
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own comparison spans"
  on public.comparison_spans
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own comparison spans"
  on public.comparison_spans
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own comparison spans"
  on public.comparison_spans
  for delete
  using (auth.uid() = user_id);
