begin;
-- Audit copy of legacy records: preserves unknown fields and original IDs/grades.
create table public.legacy_archive (
 owner_id uuid not null default auth.uid() references auth.users(id),kind text not null,id text not null,payload jsonb not null,
 imported_at timestamptz not null default now(),primary key(owner_id,kind,id)
);
alter table public.legacy_archive enable row level security;
create policy own_legacy_read on public.legacy_archive for select to authenticated using(owner_id=(select auth.uid()));
create policy own_legacy_insert on public.legacy_archive for insert to authenticated with check(owner_id=(select auth.uid()));
grant select,insert on public.legacy_archive to authenticated;

-- Reprocessing only changes automatic readings; manual_grades are independent.
create function public.reprocess_scan(p_scan text,p_answers jsonb,p_warning text default '') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();s public.scans;v public.versions;answer jsonb;item jsonb;expected integer;
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 select * into strict s from public.scans where owner_id=uid and id=p_scan;
 select * into strict v from public.versions where owner_id=uid and id=s.version_id;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||s.version_id||s.student_id,0));
 select count(*) into expected from jsonb_array_elements(v.items) i where (i->>'page')::integer=s.page_number;
 if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)<>expected or (select count(distinct a->>'questionId') from jsonb_array_elements(p_answers) a)<>expected then raise exception 'Respuestas incompletas'; end if;
 for answer in select value from jsonb_array_elements(p_answers) loop
  select value into item from jsonb_array_elements(v.items) where value->>'questionId'=answer->>'questionId' and (value->>'page')::integer=s.page_number;
  if not found then raise exception 'Pregunta fuera de página'; end if;
  if item->>'type'='openResponse' and answer->>'status'<>'manualReview' then raise exception 'Respuesta abierta requiere revisión'; end if;
  if answer->>'status'='answered' and ((answer->>'selected') is null or (answer->>'selected')::integer<0 or (answer->>'selected')::integer>=(item->>'optionCount')::integer) then raise exception 'Alternativa inválida'; end if;
  insert into public.answers(owner_id,scan_id,question_id,selected,status,confidence) values(uid,s.id,answer->>'questionId',(answer->>'selected')::integer,answer->>'status',(answer->>'confidence')::numeric)
  on conflict(owner_id,scan_id,question_id) do update set selected=excluded.selected,status=excluded.status,confidence=excluded.confidence;
 end loop;
 update public.scans set warning=left(p_warning,4000) where owner_id=uid and id=s.id;
 return public.recalculate(s.version_id,s.student_id);
end $$;
revoke all on function public.reprocess_scan(text,jsonb,text) from public,anon;
grant execute on function public.reprocess_scan(text,jsonb,text) to authenticated;
create function public.restore_result_identity(p_legacy_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_record jsonb;uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 select (payload->>'payload')::jsonb into strict old_record from public.legacy_archive where owner_id=uid and kind='results' and id=p_legacy_id;
 update public.results set id=p_legacy_id where owner_id=uid and version_id=old_record->>'examVersionId' and student_id=old_record->>'studentId';
 if not found then raise exception 'Resultado todavía no migrado'; end if;
end $$;
revoke all on function public.restore_result_identity(text) from public,anon;
grant execute on function public.restore_result_identity(text) to authenticated;
commit;
