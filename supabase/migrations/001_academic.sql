-- Cramer Scan. Text IDs preserve legacy UUIDs and older non-UUID IDs.
begin;
create table public.students (
 owner_id uuid not null default auth.uid() references auth.users(id), id text not null,
 code text not null, first_names text not null check(length(trim(first_names))>0), last_names text not null,
 level text not null default '', grade text not null default '', section text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,id), unique(owner_id,code)
);
create table public.teachers (owner_id uuid not null default auth.uid() references auth.users(id),id text not null,name text not null, email text not null default '',primary key(owner_id,id));
create table public.courses (owner_id uuid not null default auth.uid() references auth.users(id),id text not null,name text not null,area text not null default '',subarea text not null default '',teacher_id text,primary key(owner_id,id), foreign key(owner_id,teacher_id) references public.teachers(owner_id,id));
create table public.questions (
 owner_id uuid not null default auth.uid() references auth.users(id),id text not null,
 prompt text not null,area text not null default '',topic text not null default '',difficulty text not null default 'medium',archived boolean not null default false,
 payload jsonb not null check(jsonb_typeof(payload)='object'),created_at timestamptz not null default now(),primary key(owner_id,id)
);
create table public.exams (
 owner_id uuid not null default auth.uid() references auth.users(id),id text not null,title text not null,
 area text not null default '', level text not null default '',grade text not null default '',section text not null default '',bimester text not null default '',unit text not null default '',
 teacher_id text,scale_maximum numeric not null default 20 check(scale_maximum>0 and scale_maximum<=10000),question_ids text[] not null default '{}',
 settings jsonb not null default '{}',created_at timestamptz not null default now(),primary key(owner_id,id),foreign key(owner_id,teacher_id) references public.teachers(owner_id,id)
);
create table public.versions (
 owner_id uuid not null default auth.uid() references auth.users(id),id text not null,exam_id text not null,label text not null,
 questions jsonb not null check(jsonb_typeof(questions)='array'),items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
 page_count integer not null check(page_count between 1 and 1000),scale_maximum numeric not null check(scale_maximum>0),
 created_at timestamptz not null default now(),primary key(owner_id,id),foreign key(owner_id,exam_id) references public.exams(owner_id,id)
);
create table public.scans (
 owner_id uuid not null default auth.uid() references auth.users(id),id text not null,version_id text not null,student_id text not null,
 page_number integer not null check(page_number between 1 and 1000),image_hash text not null check(image_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'ambiguous' check(status in ('pending','synced','processed','ambiguous','failed','replaced')),
 transcript text not null default '',warning text not null default '',created_at timestamptz not null default now(),
 primary key(owner_id,id),unique(owner_id,image_hash),foreign key(owner_id,version_id) references public.versions(owner_id,id),foreign key(owner_id,student_id) references public.students(owner_id,id)
);
create table public.answers (
 owner_id uuid not null default auth.uid(),scan_id text not null,question_id text not null,selected integer,
 status text not null check(status in ('answered','blank','multiple','ambiguous','manualReview')),confidence numeric not null check(confidence between 0 and 1),
 primary key(owner_id,scan_id,question_id),foreign key(owner_id,scan_id) references public.scans(owner_id,id)
);
create table public.results (
 owner_id uuid not null default auth.uid(),id text not null default gen_random_uuid()::text,version_id text not null,student_id text not null,
 automatic_score numeric not null,manual_score numeric not null,maximum_score numeric not null,grade numeric not null,pending integer not null,
 updated_at timestamptz not null default now(),primary key(owner_id,id),unique(owner_id,version_id,student_id),
 foreign key(owner_id,version_id) references public.versions(owner_id,id),foreign key(owner_id,student_id) references public.students(owner_id,id)
);
create table public.manual_grades (
 owner_id uuid not null default auth.uid(),version_id text not null,student_id text not null,question_id text not null,score numeric not null check(score>=0),rubric jsonb not null default '{}',updated_at timestamptz not null default now(),
 primary key(owner_id,version_id,student_id,question_id),foreign key(owner_id,version_id) references public.versions(owner_id,id),foreign key(owner_id,student_id) references public.students(owner_id,id)
);
-- Attachments depend on scans. Scans and results NEVER depend on attachments/Storage.
create table public.attachments (
 owner_id uuid not null default auth.uid(),id text not null,scan_id text not null,path text not null,bytes integer not null check(bytes between 1 and 8388608),mime text not null check(mime in ('image/jpeg','image/png','image/webp')),created_at timestamptz not null default now(),
 thumbnail_path text,primary key(owner_id,id),unique(owner_id,scan_id),unique(path),foreign key(owner_id,scan_id) references public.scans(owner_id,id),check(split_part(path,'/',1)=owner_id::text),check(thumbnail_path is null or split_part(thumbnail_path,'/',1)=owner_id::text)
);
create table public.settings (owner_id uuid primary key default auth.uid() references auth.users(id),institution text not null default 'COLEGIO CRAMER',device_name text not null default 'Navegador',preferences jsonb not null default '{}');

create index students_class on public.students(owner_id,grade,section,last_names);
create index students_names on public.students(owner_id,last_names,first_names);
create index questions_filters on public.questions(owner_id,area,topic,difficulty,archived);
create index exams_filters on public.exams(owner_id,area,bimester,created_at desc);
create index versions_exam on public.versions(owner_id,exam_id,created_at desc);
create index scans_student_page on public.scans(owner_id,version_id,student_id,page_number) where status <> 'replaced';
create index scans_date on public.scans(owner_id,created_at desc);
create index results_filters on public.results(owner_id,version_id,student_id,updated_at desc);

do $$ declare t text; begin
 foreach t in array array['students','teachers','courses','questions','exams','versions','scans','answers','results','manual_grades','attachments','settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy own_read on public.%I for select to authenticated using (owner_id=(select auth.uid()))',t);
 end loop;
 foreach t in array array['students','teachers','courses','questions','exams','attachments','settings'] loop
 execute format('create policy own_insert on public.%I for insert to authenticated with check (owner_id=(select auth.uid()))',t);
 execute format('create policy own_update on public.%I for update to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()))',t);
 end loop;
end $$;
create policy own_version_insert on public.versions for insert to authenticated with check(owner_id=(select auth.uid()));
create policy attachment_delete on public.attachments for delete to authenticated using(owner_id=(select auth.uid()));
-- Versions are immutable snapshots. No public deletion of academic history.

create function public.recalculate(p_version text,p_student text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); v public.versions; item jsonb; a public.answers; m numeric; automatic numeric:=0; manual numeric:=0; maximum numeric:=0; pending_count integer:=0; r public.results;
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 select * into strict v from public.versions where owner_id=uid and id=p_version;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_version||p_student,0));
 select count(*)-count(distinct page_number) into pending_count from public.scans where owner_id=uid and version_id=p_version and student_id=p_student and status<>'replaced';
 for item in select value from jsonb_array_elements(v.items) loop
  maximum:=maximum+(item->>'score')::numeric;
  select score into m from public.manual_grades where owner_id=uid and version_id=p_version and student_id=p_student and question_id=item->>'questionId';
  if found then manual:=manual+m; continue; end if;
  if item->>'type'='openResponse' then pending_count:=pending_count+1; continue; end if;
  select an.* into a from public.answers an join public.scans s on s.owner_id=an.owner_id and s.id=an.scan_id
   where s.owner_id=uid and s.version_id=p_version and s.student_id=p_student and s.status<>'replaced' and an.question_id=item->>'questionId' order by s.created_at,s.id limit 1;
  if not found or a.status in ('multiple','ambiguous','manualReview') then pending_count:=pending_count+1;
  elsif a.status='answered' and a.selected=(item->>'correctOptionIndex')::integer then automatic:=automatic+(item->>'score')::numeric; end if;
 end loop;
 if maximum<=0 then raise exception 'El puntaje máximo debe ser positivo'; end if;
 insert into public.results(owner_id,version_id,student_id,automatic_score,manual_score,maximum_score,grade,pending)
 values(uid,p_version,p_student,automatic,manual,maximum,least(maximum,automatic+manual)/maximum*v.scale_maximum,pending_count)
 on conflict(owner_id,version_id,student_id) do update set automatic_score=excluded.automatic_score,manual_score=excluded.manual_score,maximum_score=excluded.maximum_score,grade=excluded.grade,pending=excluded.pending,updated_at=now() returning * into r;
 update public.scans set status=case when pending_count=0 then 'processed' else 'ambiguous' end where owner_id=uid and version_id=p_version and student_id=p_student and status<>'replaced';
 return to_jsonb(r);
end $$;

create function public.commit_scan(p_scan jsonb,p_answers jsonb,p_resolution text default 'reject') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); v public.versions; existing public.scans; item jsonb; answer jsonb; sid text:=p_scan->>'id'; vid text:=p_scan->>'version_id'; student text:=p_scan->>'student_id'; page integer:=(p_scan->>'page_number')::integer; expected integer;
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 if p_resolution not in ('reject','replace','compare') then raise exception 'Resolución inválida'; end if;
 select * into strict v from public.versions where owner_id=uid and id=vid;
 perform 1 from public.students where owner_id=uid and id=student; if not found then raise exception 'Alumno no autorizado'; end if;
 if page<1 or page>v.page_count then raise exception 'Página no pertenece a la versión'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||vid||student,0));
 select * into existing from public.scans where owner_id=uid and (id=sid or image_hash=p_scan->>'image_hash') limit 1;
 if found then return jsonb_build_object('disposition','duplicate','scanId',existing.id); end if;
 select * into existing from public.scans where owner_id=uid and version_id=vid and student_id=student and page_number=page and status<>'replaced' limit 1;
 if found and p_resolution='reject' then return jsonb_build_object('disposition','conflict','scanId',existing.id); end if;
 if found and p_resolution='replace' then update public.scans set status='replaced' where owner_id=uid and version_id=vid and student_id=student and page_number=page and status<>'replaced'; end if;
 if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)>1000 then raise exception 'Respuestas inválidas'; end if;
 select count(*) into expected from jsonb_array_elements(v.items) i where (i->>'page')::integer=page;
 if jsonb_array_length(p_answers)<>expected or (select count(distinct a->>'questionId') from jsonb_array_elements(p_answers) a)<>expected then raise exception 'Faltan respuestas o hay duplicados'; end if;
 insert into public.scans(owner_id,id,version_id,student_id,page_number,image_hash,transcript,warning,created_at)
 values(uid,sid,vid,student,page,p_scan->>'image_hash',left(coalesce(p_scan->>'transcript',''),100000),left(coalesce(p_scan->>'warning',''),4000),coalesce((p_scan->>'created_at')::timestamptz,now()));
 for answer in select value from jsonb_array_elements(p_answers) loop
  select value into item from jsonb_array_elements(v.items) where value->>'questionId'=answer->>'questionId' and (value->>'page')::integer=page;
  if not found then raise exception 'Pregunta fuera de la página'; end if;
  if answer->>'status'='answered' and ((answer->>'selected') is null or (answer->>'selected')::integer<0 or (answer->>'selected')::integer>=(item->>'optionCount')::integer) then raise exception 'Alternativa inválida'; end if;
  if item->>'type'='openResponse' and answer->>'status'<>'manualReview' then raise exception 'Respuesta abierta requiere revisión'; end if;
  insert into public.answers(owner_id,scan_id,question_id,selected,status,confidence) values(uid,sid,answer->>'questionId',(answer->>'selected')::integer,answer->>'status',(answer->>'confidence')::numeric);
 end loop;
 return jsonb_build_object('disposition','inserted','scanId',sid,'result',public.recalculate(vid,student));
end $$;

create function public.review_answer(p_version text,p_student text,p_question text,p_score numeric,p_rubric jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare maximum numeric; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 select (i->>'score')::numeric into maximum from public.versions v cross join lateral jsonb_array_elements(v.items) i where v.owner_id=uid and v.id=p_version and i->>'questionId'=p_question;
 if maximum is null or p_score is null or p_score<0 or p_score>maximum or p_score::text in ('NaN','Infinity','-Infinity') then raise exception 'Puntaje fuera de rango'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_version||p_student,0));
 insert into public.manual_grades(owner_id,version_id,student_id,question_id,score,rubric) values(uid,p_version,p_student,p_question,p_score,p_rubric)
 on conflict(owner_id,version_id,student_id,question_id) do update set score=excluded.score,rubric=excluded.rubric,updated_at=now();
 return public.recalculate(p_version,p_student);
end $$;

create function public.resolve_scan(p_scan text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.scans; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 select * into strict s from public.scans where owner_id=uid and id=p_scan;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||s.version_id||s.student_id,0));
 update public.scans set status='replaced' where owner_id=uid and version_id=s.version_id and student_id=s.student_id and page_number=s.page_number and id<>s.id;
 update public.scans set status='ambiguous' where owner_id=uid and id=s.id;
 return public.recalculate(s.version_id,s.student_id);
end $$;

revoke all on function public.recalculate(text,text),public.commit_scan(jsonb,jsonb,text),public.review_answer(text,text,text,numeric,jsonb),public.resolve_scan(text) from public,anon;
grant execute on function public.recalculate(text,text),public.commit_scan(jsonb,jsonb,text),public.review_answer(text,text,text,numeric,jsonb),public.resolve_scan(text) to authenticated;
grant select,insert,update on public.students,public.teachers,public.courses,public.questions,public.exams,public.settings to authenticated;
grant select,insert on public.versions to authenticated;
grant select on public.scans,public.answers,public.results,public.manual_grades to authenticated;
grant select,insert,update,delete on public.attachments to authenticated;
-- Supabase defaults may grant more; RLS still denies operations without policies.
commit;
