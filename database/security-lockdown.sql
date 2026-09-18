begin;
do $$ declare p record; t text; begin
 for t in select unnest(array['bookings','booking_messages','page_views','site_content']) loop
  execute format('alter table public.%I enable row level security',t);
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated,service_role',t);
  execute format('create policy "Admin access" on public.%I for all to authenticated using(exists(select 1 from public.admin_users where user_id=(select auth.uid()))) with check(exists(select 1 from public.admin_users where user_id=(select auth.uid())))',t);
 end loop;
end $$;
grant usage,select on sequence public.booking_messages_id_seq to authenticated,service_role;
grant insert(page_name,session_id,user_agent) on public.page_views to anon;
grant usage,select on sequence public.page_views_id_seq to anon,authenticated,service_role;
create policy "Public page view insert" on public.page_views for insert to anon with check(length(page_name)<=200 and coalesce(length(user_agent),0)<=2000 and coalesce(length(session_id),0)<=200);
grant select on public.site_content to anon;
create policy "Public site content" on public.site_content for select to anon using(true);
drop policy if exists "Allow uploads oj40tp_0" on storage.objects;
drop policy if exists "Allow uploads oj40tp_1" on storage.objects;
create policy "Admin file access" on storage.objects for all to authenticated using(bucket_id in ('fakturaer','leiebetingelser') and exists(select 1 from public.admin_users where user_id=(select auth.uid()))) with check(bucket_id in ('fakturaer','leiebetingelser') and exists(select 1 from public.admin_users where user_id=(select auth.uid())));
alter function public.prevent_double_booking() set search_path=public;
commit;
