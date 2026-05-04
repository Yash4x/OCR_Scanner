do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'comparison_spans'
      and c.contype = 'c'
      and c.conname = 'comparison_spans_source_type_check'
  ) then
    alter table public.comparison_spans drop constraint comparison_spans_source_type_check;
  end if;

  alter table public.comparison_spans
    add constraint comparison_spans_source_type_check
    check (source_type in ('word_diff', 'line_fallback', 'ai_aligned_span', 'estimated_line_fallback'));
end
$$;