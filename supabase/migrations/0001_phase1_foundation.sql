-- Phase 1 foundation for DocumentDiff AI
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'uploaded',
  old_document_id uuid null,
  new_document_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  document_role text not null check (document_role in ('old', 'new')),
  file_name text not null,
  file_type text not null,
  file_size bigint not null,
  storage_path text not null,
  status text not null default 'uploaded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'comparisons_old_document_id_fkey'
  ) then
    alter table public.comparisons
      add constraint comparisons_old_document_id_fkey
      foreign key (old_document_id) references public.documents(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'comparisons_new_document_id_fkey'
  ) then
    alter table public.comparisons
      add constraint comparisons_new_document_id_fkey
      foreign key (new_document_id) references public.documents(id) on delete set null;
  end if;
end;
$$;

create index if not exists comparisons_user_id_idx on public.comparisons (user_id);
create index if not exists documents_user_id_idx on public.documents (user_id);
create index if not exists documents_comparison_id_idx on public.documents (comparison_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_comparisons_updated_at on public.comparisons;
create trigger set_comparisons_updated_at
  before update on public.comparisons
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.comparisons enable row level security;
alter table public.documents enable row level security;

drop policy if exists "Users can select own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

drop policy if exists "Users can select own comparisons" on public.comparisons;
drop policy if exists "Users can insert own comparisons" on public.comparisons;
drop policy if exists "Users can update own comparisons" on public.comparisons;
drop policy if exists "Users can delete own comparisons" on public.comparisons;

drop policy if exists "Users can select own documents" on public.documents;
drop policy if exists "Users can insert own documents" on public.documents;
drop policy if exists "Users can update own documents" on public.documents;
drop policy if exists "Users can delete own documents" on public.documents;

create policy "Users can select own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can select own comparisons"
  on public.comparisons
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own comparisons"
  on public.comparisons
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own comparisons"
  on public.comparisons
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own comparisons"
  on public.comparisons
  for delete
  using (auth.uid() = user_id);

create policy "Users can select own documents"
  on public.documents
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on public.documents
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own documents"
  on public.documents
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own documents"
  on public.documents
  for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('raw-documents', 'raw-documents', false)
on conflict (id) do nothing;

drop policy if exists "Users can read own files" on storage.objects;
drop policy if exists "Users can upload own files" on storage.objects;
drop policy if exists "Users can update own files" on storage.objects;
drop policy if exists "Users can delete own files" on storage.objects;

create policy "Users can read own files"
  on storage.objects
  for select
  using (
    bucket_id = 'raw-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload own files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'raw-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own files"
  on storage.objects
  for update
  using (
    bucket_id = 'raw-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'raw-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own files"
  on storage.objects
  for delete
  using (
    bucket_id = 'raw-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
