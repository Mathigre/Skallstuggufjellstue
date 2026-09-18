begin;
create table public.admin_users(user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public,anon,authenticated;
grant select on public.admin_users to authenticated;
grant all on public.admin_users to service_role;
create policy "Admin may read own membership" on public.admin_users for select to authenticated using(user_id=(select auth.uid()));
create table public.booking_access_tokens(token_hash text primary key check(length(token_hash)=64),booking_id uuid not null references public.bookings(id) on delete cascade,email text not null,expires_at timestamptz not null);
create index on public.booking_access_tokens(booking_id);
alter table public.booking_access_tokens enable row level security;
revoke all on public.booking_access_tokens from public,anon,authenticated;
grant all on public.booking_access_tokens to service_role;
create table public.booking_request_limits(key text primary key,window_start timestamptz not null,hits integer not null);
alter table public.booking_request_limits enable row level security;
revoke all on public.booking_request_limits from public,anon,authenticated;
grant all on public.booking_request_limits to service_role;
create function public.consume_booking_limit(limit_key text,max_hits integer,seconds integer) returns boolean language plpgsql security invoker set search_path=public as $$
declare result integer;
begin
 insert into public.booking_request_limits as l values(limit_key,now(),1)
 on conflict(key) do update set hits=case when l.window_start<now()-make_interval(secs=>seconds) then 1 else l.hits+1 end,window_start=case when l.window_start<now()-make_interval(secs=>seconds) then now() else l.window_start end returning hits into result;
 return result<=max_hits;
end $$;
revoke all on function public.consume_booking_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_booking_limit(text,integer,integer) to service_role;
create function public.create_secure_booking(payload jsonb,access_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare b public.bookings;
begin
 if payload->>'name' is null or payload->>'email' is null or payload->>'pricing_revision' is null then raise exception 'Mangler bookingdata'; end if;
 insert into public.bookings(name,email,phone,start_date,end_date,message,status,linen_count,towel_count,full_cleaning,pricing_revision)
 values(payload->>'name',payload->>'email',payload->>'phone',(payload->>'start_date')::date,(payload->>'end_date')::date,payload->>'message','pending',(payload->>'linen_count')::int,(payload->>'towel_count')::int,(payload->>'full_cleaning')::boolean,(payload->>'pricing_revision')::int) returning * into b;
 insert into public.booking_access_tokens values(access_hash,b.id,b.email,now()+interval '1 year');
 return jsonb_build_object('id',b.id,'total',b.booking_total_ore);
end $$;
revoke all on function public.create_secure_booking(jsonb,text) from public,anon,authenticated;
grant execute on function public.create_secure_booking(jsonb,text) to service_role;
commit;
