begin;
create function public.select_question_ids(p_count integer,p_area text default '',p_topic text default '',p_easy numeric default .3,p_medium numeric default .5,p_hard numeric default .2) returns text[]
language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare selected text[]:='{}';group_ids text[];difficulty_name text;target integer;easy integer;medium integer;available integer;
begin
 if p_count<1 or p_count>250 or p_easy<0 or p_medium<0 or p_hard<0 or abs(p_easy+p_medium+p_hard-1)>.001 then raise exception 'Cantidad 1–250; proporciones positivas que sumen 100 %%'; end if;
 select count(*) into available from public.questions where not archived and (p_area='' or area=p_area) and (p_topic='' or topic=p_topic);
 if available<p_count then raise exception 'No hay suficientes preguntas para los criterios seleccionados'; end if;
 easy:=round(p_count*p_easy);medium:=least(p_count-easy,round(p_count*p_medium));
 foreach difficulty_name in array array['easy','medium','hard'] loop
 target:=case difficulty_name when 'easy' then easy when 'medium' then medium else p_count-easy-medium end;
 select coalesce(array_agg(id),'{}') into group_ids from (select id from public.questions where not archived and difficulty=difficulty_name and (p_area='' or area=p_area) and (p_topic='' or topic=p_topic) order by random() limit target) q;
 selected:=selected||group_ids;
 end loop;
 if cardinality(selected)<p_count then
 select coalesce(array_agg(id),'{}') into group_ids from (select id from public.questions where not archived and (p_area='' or area=p_area) and (p_topic='' or topic=p_topic) and not(id=any(selected)) order by random() limit p_count-cardinality(selected)) q;selected:=selected||group_ids;
 end if;
 return (select array_agg(id order by random()) from unnest(selected) id);
end $$;
revoke all on function public.select_question_ids(integer,text,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.select_question_ids(integer,text,text,numeric,numeric,numeric) to authenticated;
commit;
