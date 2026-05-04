-- Document words for tight word-level bounding boxes on scanned pages

create table if not exists public.document_words (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  document_line_id uuid not null references public.document_lines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number int not null,
  line_number int not null,
  word_index int not null,
  text text not null,
  normalized_text text not null,
  bbox_left double precision null,
  bbox_top double precision null,
  bbox_width double precision null,
  bbox_height double precision null,
  confidence double precision null,
  created_at timestamptz not null default now()
);

create index if not exists document_words_document_id_idx on public.document_words (document_id);
create index if not exists document_words_document_line_id_idx on public.document_words (document_line_id);
create index if not exists document_words_user_id_idx on public.document_words (user_id);

alter table public.document_words enable row level security;

drop policy if exists "Users can select own document words" on public.document_words;
drop policy if exists "Users can insert own document words" on public.document_words;
drop policy if exists "Users can update own document words" on public.document_words;
drop policy if exists "Users can delete own document words" on public.document_words;

create policy "Users can select own document words"
  on public.document_words
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own document words"
  on public.document_words
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own document words"
  on public.document_words
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own document words"
  on public.document_words
  for delete
  using (auth.uid() = user_id);
