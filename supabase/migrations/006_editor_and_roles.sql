begin;
-- Existing accounts become teachers. Admin status is never taken from user_metadata.
create table public.profiles(
 id uuid primary key references auth.users(id),email text not null default '',display_name text not null default '',
 role text not null default 'teacher' check(role in ('teacher','admin')),created_at timestamptz not null default now()
);
insert into public.profiles(id,email) select id,coalesce(email,'') from auth.users on conflict(id) do nothing;
create function public.create_teacher_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,display_name) values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'display_name','')) on conflict(id) do update set email=excluded.email;
 return new;
end $$;
create trigger cramer_profile_created after insert or update of email on auth.users for each row execute function public.create_teacher_profile();
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
$$;
revoke all on function public.is_admin(),public.create_teacher_profile() from public,anon;
grant execute on function public.is_admin() to authenticated;
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select public.is_admin()));
grant select on public.profiles to authenticated;
revoke insert,update,delete on public.profiles from anon,authenticated;
create function public.admin_set_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Solo el administrador puede cambiar roles'; end if;
 if p_role not in ('teacher','admin') then raise exception 'Rol inválido'; end if;
 perform pg_advisory_xact_lock(63745282);
 if p_role='teacher' and exists(select 1 from public.profiles where id=p_user and role='admin') and (select count(*) from public.profiles where role='admin')<=1 then raise exception 'Debe conservarse al menos un administrador'; end if;
 update public.profiles set role=p_role where id=p_user;
 if not found then raise exception 'Usuario no encontrado'; end if;
end $$;
revoke all on function public.admin_set_role(uuid,text) from public,anon;
grant execute on function public.admin_set_role(uuid,text) to authenticated;

-- Teachers retain own read/write policies. Admin receives cross-account READ only.
do $$ declare t text;begin
 foreach t in array array['students','teachers','courses','questions','exams','versions','scans','answers','results','manual_grades','attachments','settings','legacy_archive'] loop
 execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
 end loop;
end $$;
create policy admin_file_read on storage.objects for select to authenticated using(bucket_id in ('questions','scans') and (select public.is_admin()));

create table public.catalog_options(
 owner_id uuid not null default auth.uid() references auth.users(id),kind text not null check(kind in ('area','subarea','topic','competency','teacher','level','grade','section','bimester','unit','institution')),
 value text not null check(length(trim(value)) between 1 and 200),created_at timestamptz not null default now(),primary key(owner_id,kind,value)
);
create table public.design_assets(
 owner_id uuid not null default auth.uid() references auth.users(id),id text not null,label text not null check(length(trim(label)) between 1 and 120),
 kind text not null check(kind in ('headerFirst','headerFollowing','centralImage','watermark','logoLeft','logoRight')),path text not null unique,
 created_at timestamptz not null default now(),primary key(owner_id,id),check(split_part(path,'/',1)=owner_id::text)
);
alter table public.catalog_options enable row level security;
alter table public.design_assets enable row level security;
create policy own_catalog_read on public.catalog_options for select to authenticated using(owner_id=(select auth.uid()));
create policy own_catalog_insert on public.catalog_options for insert to authenticated with check(owner_id=(select auth.uid()));
create policy own_catalog_delete on public.catalog_options for delete to authenticated using(owner_id=(select auth.uid()));
create policy own_asset_read on public.design_assets for select to authenticated using(owner_id=(select auth.uid()));
create policy own_asset_insert on public.design_assets for insert to authenticated with check(owner_id=(select auth.uid()));
grant select,insert,delete on public.catalog_options to authenticated;
grant select,insert on public.design_assets to authenticated;
-- Preserve dropdown values from the entire existing bank, not only its first page.
insert into public.catalog_options(owner_id,kind,value)
select distinct q.owner_id,k.kind,trim(q.payload->>k.kind)
from public.questions q cross join (values('area'),('subarea'),('topic'),('competency')) k(kind)
where length(trim(coalesce(q.payload->>k.kind,''))) between 1 and 200 on conflict do nothing;
insert into public.catalog_options(owner_id,kind,value)
select distinct e.owner_id,k.kind,trim(to_jsonb(e)->>k.kind)
from public.exams e cross join (values('area'),('level'),('grade'),('section'),('bimester'),('unit')) k(kind)
where length(trim(coalesce(to_jsonb(e)->>k.kind,''))) between 1 and 200 on conflict do nothing;
create index catalog_kind on public.catalog_options(owner_id,kind,value);
create index assets_kind on public.design_assets(owner_id,kind,created_at desc);
-- A reusable header/library image cannot be removed behind a saved evaluation.
alter table public.versions add column exam_snapshot jsonb;
drop policy cramer_unused_question_delete on storage.objects;
create policy cramer_unused_question_delete on storage.objects for delete to authenticated using(
 bucket_id='questions' and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists(select 1 from public.questions q where q.owner_id=(select auth.uid()) and q.payload->>'imagePath'=name)
 and not exists(select 1 from public.versions v cross join lateral jsonb_array_elements(v.questions) q where v.owner_id=(select auth.uid()) and q->>'imagePath'=name)
 and not exists(select 1 from public.versions v where v.owner_id=(select auth.uid()) and position(name in v.exam_snapshot::text)>0)
 and not exists(select 1 from public.design_assets a where a.owner_id=(select auth.uid()) and a.path=name)
 and not exists(select 1 from public.exams e where e.owner_id=(select auth.uid()) and position(name in e.settings::text)>0)
 and not exists(select 1 from public.settings s where s.owner_id=(select auth.uid()) and position(name in s.preferences::text)>0)
);

-- Each evaluation embeds its own editable question copies; bank save is explicit.
alter table public.exams add column revision integer not null default 0;
create function public.save_evaluation(p_exam jsonb,p_bank_ids text[] default '{}',p_revision integer default 0) returns integer
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();eid text:=p_exam->>'id';q jsonb;kind text;value text;next_revision integer;current_revision integer;
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 if eid is null or length(eid)>128 then raise exception 'ID inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||eid,0));
 select revision into current_revision from public.exams where owner_id=uid and id=eid;
 if found and current_revision<>p_revision then raise exception 'Esta evaluación cambió en otra pestaña. Recarga antes de guardar para no sobrescribir cambios.'; end if;
 if jsonb_typeof(p_exam->'settings'->'localQuestions') is distinct from 'array' or jsonb_array_length(p_exam->'settings'->'localQuestions')>250 then raise exception 'Preguntas inválidas'; end if;
 if exists(select 1 from jsonb_array_elements(p_exam->'settings'->'localQuestions') x where coalesce(x->>'prompt','')='' or (x->>'score')::numeric<0) then raise exception 'Enunciado o puntaje inválido'; end if;
 if (select count(*) from jsonb_array_elements(p_exam->'settings'->'localQuestions'))<>(select count(distinct x->>'id') from jsonb_array_elements(p_exam->'settings'->'localQuestions') x) then raise exception 'Preguntas duplicadas'; end if;
 insert into public.exams(owner_id,id,title,area,level,grade,section,bimester,unit,teacher_id,scale_maximum,question_ids,settings,revision)
 values(uid,eid,p_exam->>'title',coalesce(p_exam->>'area',''),coalesce(p_exam->>'level',''),coalesce(p_exam->>'grade',''),coalesce(p_exam->>'section',''),coalesce(p_exam->>'bimester',''),coalesce(p_exam->>'unit',''),nullif(p_exam->>'teacher_id',''),(p_exam->>'scale_maximum')::numeric,
 array(select x->>'id' from jsonb_array_elements(p_exam->'settings'->'localQuestions') x),p_exam->'settings',coalesce(current_revision,0)+1)
 on conflict(owner_id,id) do update set title=excluded.title,area=excluded.area,level=excluded.level,grade=excluded.grade,section=excluded.section,bimester=excluded.bimester,unit=excluded.unit,teacher_id=excluded.teacher_id,scale_maximum=excluded.scale_maximum,question_ids=excluded.question_ids,settings=excluded.settings,revision=excluded.revision returning revision into next_revision;
 for q in select x from jsonb_array_elements(p_exam->'settings'->'localQuestions') x where x->>'id'=any(p_bank_ids) loop
 insert into public.questions(owner_id,id,prompt,area,topic,difficulty,archived,payload) values(uid,q->>'id',q->>'prompt',coalesce(q->>'area',''),coalesce(q->>'topic',''),q->>'difficulty',false,q)
 on conflict(owner_id,id) do update set prompt=excluded.prompt,area=excluded.area,topic=excluded.topic,difficulty=excluded.difficulty,archived=false,payload=excluded.payload;
 end loop;
 foreach kind in array array['area','subarea','topic','competency','teacher','level','grade','section','bimester','unit','institution'] loop
 value:=case when kind='teacher' then p_exam->'settings'->>'teacherName' when kind='institution' then p_exam->'settings'->>'institution' when kind='subarea' then p_exam->'settings'->>'subarea' else p_exam->>kind end;
 if length(trim(coalesce(value,''))) between 1 and 200 then insert into public.catalog_options(owner_id,kind,value) values(uid,kind,trim(value)) on conflict do nothing; end if;
 for q in select x from jsonb_array_elements(p_exam->'settings'->'localQuestions') x loop
 value:=q->>kind;if length(trim(coalesce(value,''))) between 1 and 200 then insert into public.catalog_options(owner_id,kind,value) values(uid,kind,trim(value)) on conflict do nothing; end if;
 end loop;
 end loop;
 return next_revision;
end $$;
revoke all on function public.save_evaluation(jsonb,text[],integer) from public,anon;
grant execute on function public.save_evaluation(jsonb,text[],integer) to authenticated;
-- Freeze the complete institutional layout with each issued version.
create or replace function public.academic_summary(p_area text default '',p_bimester text default '',p_grade text default '',p_section text default '',p_student text default '',p_from timestamptz default null,p_until timestamptz default null,p_version text default '',p_pending boolean default false) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with filtered as (
 select r.*,e.area,e.bimester from public.results r
 join public.versions v on v.owner_id=r.owner_id and v.id=r.version_id
 join public.exams e on e.owner_id=v.owner_id and e.id=v.exam_id
 join public.students s on s.owner_id=r.owner_id and s.id=r.student_id
 where r.owner_id=auth.uid() and (p_area='' or e.area=p_area) and (p_bimester='' or e.bimester=p_bimester)
 and (p_version='' or r.version_id=p_version) and (not p_pending or r.pending>0) and (p_grade='' or s.grade=p_grade) and (p_section='' or s.section=p_section) and (p_student='' or s.id=p_student)
 and ((p_from is null and p_until is null) or exists(select 1 from public.scans sc where sc.owner_id=r.owner_id and sc.version_id=r.version_id and sc.student_id=r.student_id and sc.status<>'replaced' and (p_from is null or sc.created_at>=p_from) and (p_until is null or sc.created_at<p_until)))
), courses as (
 select area,count(*) as count,avg(grade) as average from filtered where pending=0 group by area order by avg(grade)
), topics as (
 select coalesce(nullif(i->>'topic',''),'Sin tema') as topic,
 sum(case when mg.score is not null then mg.score else case when a.status='answered' and a.selected=(i->>'correctOptionIndex')::int then (i->>'score')::numeric else 0 end end) as obtained,
 sum((i->>'score')::numeric) as maximum
 from filtered f join public.versions v on v.owner_id=f.owner_id and v.id=f.version_id
 cross join lateral jsonb_array_elements(v.items) i
 left join public.manual_grades mg on mg.owner_id=f.owner_id and mg.version_id=f.version_id and mg.student_id=f.student_id and mg.question_id=i->>'questionId'
 left join lateral (select an.* from public.answers an join public.scans sc on sc.owner_id=an.owner_id and sc.id=an.scan_id where sc.owner_id=f.owner_id and sc.version_id=f.version_id and sc.student_id=f.student_id and sc.status<>'replaced' and an.question_id=i->>'questionId' order by sc.created_at,sc.id limit 1) a on true
 where mg.score is not null or (i->>'type'<>'openResponse' and a.status in ('answered','blank'))
 group by coalesce(nullif(i->>'topic',''),'Sin tema')
)
select jsonb_build_object('total',(select count(*) from filtered),'pending',(select count(*) from filtered where pending>0),
 'average',(select avg(grade) from filtered where pending=0),'maximum',(select max(grade) from filtered where pending=0),'minimum',(select min(grade) from filtered where pending=0),
 'passed',(select count(*) from filtered f where f.pending=0 and f.grade>=11),
 'courses',coalesce((select jsonb_agg(to_jsonb(courses)) from courses),'[]'),
 'topics',coalesce((select jsonb_agg(to_jsonb(topics)||jsonb_build_object('percentage',case when maximum>0 then obtained/maximum*100 else 0 end)) from topics),'[]'),
 'distribution',(select jsonb_agg(jsonb_build_object('label',bucket,'count',n)) from (select floor(f.grade/v.scale_maximum*4)::int as bucket,count(*) as n from filtered f join public.versions v on v.owner_id=f.owner_id and v.id=f.version_id where pending=0 group by bucket order by bucket) d));
$$;

commit;
