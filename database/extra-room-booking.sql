alter table public.bookings add column if not exists basement_rooms boolean not null default false;
alter table public.bookings add column if not exists garage_rooms boolean not null default false;

update public.booking_price_settings set settings=jsonb_set(settings,'{extraRooms}',coalesce(settings->'extraRooms','{"basement":400000,"garage":300000}'::jsonb)),revision=revision+1,updated_at=now() where id=1 and not(settings ? 'extraRooms');

create or replace function public.calculate_booking_price() returns trigger language plpgsql set search_path to public as $function$
declare nights integer; cfg jsonb; season jsonb; night date; amount bigint; rev integer; fee bigint;
begin
 if tg_op='INSERT' then
  select settings,revision into cfg,rev from public.booking_price_settings where id=1;
  if cfg is null then raise exception 'Prisoppsettet er ikke tilgjengelig.'; end if;
  if new.pricing_revision is not null and new.pricing_revision<>rev then raise exception 'Prisene er endret. Last bookingsiden på nytt og kontroller totalen.'; end if;
  if new.pricing_revision is null then new.price_version:='2026-09-17';new.pricing_snapshot:=null;
  else new.price_version:='season-v1';new.pricing_snapshot:=cfg;new.pricing_revision:=rev;end if;
 else
  new.price_version:=old.price_version;new.pricing_snapshot:=old.pricing_snapshot;new.pricing_revision:=old.pricing_revision;
 end if;
 if new.price_version in ('2026-09-17','season-v1') then
  nights:=new.end_date-new.start_date;
  if nights is null or nights<1 or nights>366 then raise exception 'Oppholdet må være mellom 1 og 366 netter.';end if;
  amount:=0;
  if new.price_version='season-v1' then
   cfg:=new.pricing_snapshot;
   for i in 0..nights-1 loop
    night:=new.start_date+i;
    select value into season from jsonb_array_elements(cfg->'seasons') where night between (value->>'start')::date and (value->>'end')::date;
    amount:=amount+(coalesce(season,cfg)->>case when extract(isodow from night) in (5,6) then 'weekend' else 'weekday' end)::bigint;
   end loop;
  else amount:=nights::bigint*1400000;end if;
  if new.basement_rooms or new.garage_rooms then
   if new.price_version<>'season-v1' or not(cfg ? 'extraRooms') then raise exception 'Prisavtalen mangler priser for tilleggsrom.';end if;
   if new.basement_rooms then
    fee:=(cfg#>>'{extraRooms,basement}')::bigint;
    if fee is null or fee<100 or fee>100000000 or fee%100<>0 then raise exception 'Ugyldig pris for kjellerrom.';end if;
    amount:=amount+fee;
   end if;
   if new.garage_rooms then
    fee:=(cfg#>>'{extraRooms,garage}')::bigint;
    if fee is null or fee<100 or fee>100000000 or fee%100<>0 then raise exception 'Ugyldig pris for garasjerom.';end if;
    amount:=amount+fee;
   end if;
  end if;
  new.booking_total_ore:=amount+new.linen_count::bigint*30000+new.towel_count::bigint*15000+case when new.full_cleaning then 300000 else 0 end;
 else
  if new.basement_rooms or new.garage_rooms then raise exception 'Eldre booking mangler prisavtale for tilleggsrom.';end if;
  new.booking_total_ore:=old.booking_total_ore;
 end if;
 return new;
end $function$;

create or replace function public.create_secure_booking(payload jsonb,access_hash text) returns jsonb language plpgsql set search_path to public as $function$
declare b public.bookings;
begin
 if payload->>'name' is null or payload->>'email' is null or payload->>'pricing_revision' is null then raise exception 'Mangler bookingdata';end if;
 insert into public.bookings(name,email,phone,start_date,end_date,message,status,linen_count,towel_count,full_cleaning,basement_rooms,garage_rooms,pricing_revision)
 values(payload->>'name',payload->>'email',payload->>'phone',(payload->>'start_date')::date,(payload->>'end_date')::date,payload->>'message','pending',(payload->>'linen_count')::int,(payload->>'towel_count')::int,(payload->>'full_cleaning')::boolean,coalesce((payload->>'basement_rooms')::boolean,false),coalesce((payload->>'garage_rooms')::boolean,false),(payload->>'pricing_revision')::int) returning * into b;
 insert into public.booking_access_tokens values(access_hash,b.id,b.email,now()+interval '1 year');
 return jsonb_build_object('id',b.id,'total',b.booking_total_ore);
end $function$;
