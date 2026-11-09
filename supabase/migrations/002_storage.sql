begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('scans','scans',false,8388608,array['image/jpeg','image/png','image/webp']),
 ('questions','questions',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy cramer_files_read on storage.objects for select to authenticated using(bucket_id in ('scans','questions') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy cramer_files_insert on storage.objects for insert to authenticated with check(bucket_id in ('scans','questions') and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Never overwrite a referenced question asset. New edits get a new path.
create policy cramer_scan_delete on storage.objects for delete to authenticated using(bucket_id='scans' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Question assets can be deleted only after every live/snapshotted reference is gone.
create policy cramer_unused_question_delete on storage.objects for delete to authenticated using(
 bucket_id='questions' and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists(select 1 from public.questions q where q.owner_id=(select auth.uid()) and q.payload->>'imagePath'=name)
 and not exists(select 1 from public.versions v cross join lateral jsonb_array_elements(v.questions) q where v.owner_id=(select auth.uid()) and q->>'imagePath'=name)
 and not exists(select 1 from public.settings s where s.owner_id=(select auth.uid()) and (s.preferences->>'logoLeft'=name or s.preferences->>'logoRight'=name or s.preferences->>'centralImage'=name or s.preferences->>'watermark'=name))
);
commit;
