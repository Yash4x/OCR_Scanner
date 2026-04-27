-- Phase 2 document processing for DocumentDiff AI

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number int not null,
  image_storage_path text null,
  width int null,
  height int null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number int not null,
  line_number int not null,
  text text not null,
  normalized_text text not null,
  section_title text null,
  block_type text not null check (block_type in ('heading', 'paragraph', 'table_row', 'signature', 'footer', 'header', 'unknown')),
  bbox_top double precision null,
  bbox_left double precision null,
  bbox_width double precision null,
  bbox_height double precision null,
  confidence double precision null,
  created_at timestamptz not null default now()
);

create table if not exists public.document_outputs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  output_type text not null check (output_type in ('txt', 'markdown')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists document_pages_document_id_idx on public.document_pages (document_id);
create index if not exists document_pages_user_id_idx on public.document_pages (user_id);
create index if not exists document_lines_document_id_idx on public.document_lines (document_id);
create index if not exists document_lines_user_id_idx on public.document_lines (user_id);
create index if not exists document_outputs_document_id_idx on public.document_outputs (document_id);
create index if not exists document_outputs_user_id_idx on public.document_outputs (user_id);

drop trigger if exists set_document_pages_updated_at on public.document_pages;
create trigger set_document_pages_updated_at
  before update on public.document_pages
  for each row execute procedure public.set_updated_at();

alter table public.document_pages enable row level security;
alter table public.document_lines enable row level security;
alter table public.document_outputs enable row level security;

drop policy if exists "Users can select own document pages" on public.document_pages;
drop policy if exists "Users can insert own document pages" on public.document_pages;
drop policy if exists "Users can update own document pages" on public.document_pages;
drop policy if exists "Users can delete own document pages" on public.document_pages;

drop policy if exists "Users can select own document lines" on public.document_lines;
drop policy if exists "Users can insert own document lines" on public.document_lines;
drop policy if exists "Users can update own document lines" on public.document_lines;
drop policy if exists "Users can delete own document lines" on public.document_lines;

drop policy if exists "Users can select own document outputs" on public.document_outputs;
drop policy if exists "Users can insert own document outputs" on public.document_outputs;
drop policy if exists "Users can update own document outputs" on public.document_outputs;
drop policy if exists "Users can delete own document outputs" on public.document_outputs;

create policy "Users can select own document pages"
  on public.document_pages
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own document pages"
  on public.document_pages
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own document pages"
  on public.document_pages
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own document pages"
  on public.document_pages
  for delete
  using (auth.uid() = user_id);

create policy "Users can select own document lines"
  on public.document_lines
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own document lines"
  on public.document_lines
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own document lines"
  on public.document_lines
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own document lines"
  on public.document_lines
  for delete
  using (auth.uid() = user_id);

create policy "Users can select own document outputs"
  on public.document_outputs
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own document outputs"
  on public.document_outputs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own document outputs"
  on public.document_outputs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own document outputs"
  on public.document_outputs
  for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('extracted-text', 'extracted-text', false)
on conflict (id) do nothing;

drop policy if exists "Users can read extracted text files" on storage.objects;
drop policy if exists "Users can upload extracted text files" on storage.objects;
drop policy if exists "Users can update extracted text files" on storage.objects;
drop policy if exists "Users can delete extracted text files" on storage.objects;

create policy "Users can read extracted text files"
  on storage.objects
  for select
  using (
    bucket_id = 'extracted-text'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload extracted text files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'extracted-text'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update extracted text files"
  on storage.objects
  for update
  using (
    bucket_id = 'extracted-text'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'extracted-text'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete extracted text files"
  on storage.objects
  for delete
  using (
    bucket_id = 'extracted-text'
    and (storage.foldername(name))[1] = auth.uid()::text
  );