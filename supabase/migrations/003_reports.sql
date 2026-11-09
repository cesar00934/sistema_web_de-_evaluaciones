begin;
create function public.results_by_dates(p_from timestamptz default null,p_until timestamptz default null) returns setof public.results
language sql stable security invoker set search_path=public,pg_temp as $$
 select r.* from public.results r where exists(select 1 from public.scans s where s.owner_id=r.owner_id and s.version_id=r.version_id and s.student_id=r.student_id and s.status<>'replaced' and (p_from is null or s.created_at>=p_from) and (p_until is null or s.created_at<=p_until))
$$;
revoke all on function public.results_by_dates(timestamptz,timestamptz) from public,anon;
grant execute on function public.results_by_dates(timestamptz,timestamptz) to authenticated;
create function public.academic_summary(p_area text default '',p_bimester text default '',p_grade text default '',p_section text default '',p_student text default '',p_from timestamptz default null,p_until timestamptz default null,p_version text default '',p_pending boolean default false) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with filtered as (
 select r.*,e.area,e.bimester from public.results r
 join public.versions v on v.owner_id=r.owner_id and v.id=r.version_id
 join public.exams e on e.owner_id=v.owner_id and e.id=v.exam_id
 join public.students s on s.owner_id=r.owner_id and s.id=r.student_id
 where (p_area='' or e.area=p_area) and (p_bimester='' or e.bimester=p_bimester)
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
create function public.update_transcript(p_scan text,p_text text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 update public.scans set transcript=left(p_text,100000) where owner_id=auth.uid() and id=p_scan;
 if not found then raise exception 'Escaneo no autorizado'; end if;
end $$;
revoke all on function public.academic_summary(text,text,text,text,text,timestamptz,timestamptz,text,boolean), public.update_transcript(text,text) from public,anon;
grant execute on function public.academic_summary(text,text,text,text,text,timestamptz,timestamptz,text,boolean),public.update_transcript(text,text) to authenticated;
commit;
