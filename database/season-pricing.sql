begin;
create table public.booking_price_settings (
 id integer primary key check(id=1), revision integer not null default 1 check(revision>0),
 settings jsonb not null, updated_at timestamptz not null default now()
);
alter table public.booking_price_settings enable row level security;
revoke all on public.booking_price_settings from public,anon,authenticated;
grant select on public.booking_price_settings to anon,authenticated;
grant select,update on public.booking_price_settings to service_role;
create policy "Read published booking prices" on public.booking_price_settings for select to anon,authenticated using(true);
insert into public.booking_price_settings(id,settings) values(1,'{"weekday":900000,"weekend":1400000,"seasons":[{"name":"Høstferie 2026","start":"2026-10-01","end":"2026-10-18","weekday":1000000,"weekend":1500000},{"name":"Jul og nyttår 2026","start":"2026-12-20","end":"2027-01-03","weekday":1400000,"weekend":1800000},{"name":"Vinterferie 2027","start":"2027-02-15","end":"2027-03-07","weekday":1100000,"weekend":1600000},{"name":"Påske 2027","start":"2027-03-20","end":"2027-03-29","weekday":1400000,"weekend":1800000},{"name":"Sommer 2027","start":"2027-06-20","end":"2027-08-15","weekday":1100000,"weekend":1600000},{"name":"Høstferie 2027","start":"2027-10-01","end":"2027-10-17","weekday":1000000,"weekend":1500000},{"name":"Jul og nyttår 2027","start":"2027-12-20","end":"2028-01-03","weekday":1400000,"weekend":1800000}]}');
alter table public.bookings add column pricing_snapshot jsonb, add column pricing_revision integer;
create or replace function public.calculate_booking_price()
returns trigger language plpgsql set search_path=public as $$
declare nights integer; cfg jsonb; season jsonb; night date; amount bigint; rev integer;
begin
 if tg_op='INSERT' then
  select settings,revision into cfg,rev from public.booking_price_settings where id=1;
  if cfg is null then raise exception 'Prisoppsettet er ikke tilgjengelig.'; end if;
  if new.pricing_revision is not null and new.pricing_revision<>rev then raise exception 'Prisene er endret. Last bookingsiden på nytt og kontroller totalen.'; end if;
  -- Older cached forms and the legacy manual form still quote 14,000/night.
  if new.pricing_revision is null then
   new.price_version:='2026-09-17'; new.pricing_snapshot:=null;
  else
   new.price_version:='season-v1'; new.pricing_snapshot:=cfg; new.pricing_revision:=rev;
  end if;
 else
  new.price_version:=old.price_version; new.pricing_snapshot:=old.pricing_snapshot; new.pricing_revision:=old.pricing_revision;
 end if;
 if new.price_version in ('2026-09-17','season-v1') then
  nights:=new.end_date-new.start_date;
  if nights is null or nights<1 or nights>366 then raise exception 'Oppholdet må være mellom 1 og 366 netter.'; end if;
  amount:=0;
  if new.price_version='season-v1' then
   cfg:=new.pricing_snapshot;
   for i in 0..nights-1 loop
    night:=new.start_date+i;
    select value into season from jsonb_array_elements(cfg->'seasons') where night between (value->>'start')::date and (value->>'end')::date;
    amount:=amount+(coalesce(season,cfg)->>case when extract(isodow from night) in (5,6) then 'weekend' else 'weekday' end)::bigint;
   end loop;
  else amount:=nights::bigint*1400000; end if;
  new.booking_total_ore:=amount+new.linen_count::bigint*30000+new.towel_count::bigint*15000+case when new.full_cleaning then 300000 else 0 end;
 else new.booking_total_ore:=old.booking_total_ore;
 end if;
 return new;
end $$;
commit;
