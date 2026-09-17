begin;
alter table public.bookings
  add column if not exists linen_count integer not null default 0 check (linen_count between 0 and 1000),
  add column if not exists towel_count integer not null default 0 check (towel_count between 0 and 1000),
  add column if not exists full_cleaning boolean not null default false,
  add column if not exists price_version text,
  add column if not exists booking_total_ore bigint;

create or replace function public.calculate_booking_price()
returns trigger language plpgsql set search_path=public as $$
declare nights integer;
begin
  -- Existing reservations retain their agreed prices; all new reservations use
  -- this explicitly versioned tariff. Clients cannot override the total.
  if tg_op = 'INSERT' then new.price_version := '2026-09-17';
  else new.price_version := old.price_version; end if;
  if new.price_version = '2026-09-17' then
    nights := new.end_date - new.start_date;
    if nights is null or nights < 1 or nights > 366 then
      raise exception 'Oppholdet må være mellom 1 og 366 netter.';
    end if;
    new.booking_total_ore := nights::bigint * 1400000 + new.linen_count::bigint * 30000
      + new.towel_count::bigint * 15000 + case when new.full_cleaning then 300000 else 0 end;
  else new.booking_total_ore := old.booking_total_ore;
  end if;
  return new;
end $$;
drop trigger if exists calculate_booking_price on public.bookings;
create trigger calculate_booking_price before insert or update on public.bookings
for each row execute function public.calculate_booking_price();

create table if not exists public.fiken_booking_exports (
  booking_id uuid primary key references public.bookings(id),
  company_slug text not null check(company_slug = 'apiskallstuggu'),
  state text not null default 'idle' check(state in ('idle','processing','ready','error','uncertain','cancelled')),
  request_id uuid,
  customer_id bigint,
  draft_id bigint,
  updated_at timestamptz not null default now()
);
alter table public.fiken_booking_exports enable row level security;
revoke all on public.fiken_booking_exports from public, anon, authenticated;
grant select, insert, update on public.fiken_booking_exports to service_role;
comment on table public.fiken_booking_exports is 'Server-only test export state; never accessible using the public admin anon key.';
create table if not exists public.fiken_test_lock (
  id integer primary key check(id=1), request_id uuid, locked_at timestamptz
);
insert into public.fiken_test_lock(id) values(1) on conflict do nothing;
alter table public.fiken_test_lock enable row level security;
revoke all on public.fiken_test_lock from public, anon, authenticated;
grant select, update on public.fiken_test_lock to service_role;
commit;
