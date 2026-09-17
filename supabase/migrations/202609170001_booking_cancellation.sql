begin;

-- Keep existing status values and constraints: cancelled bookings are archived
-- as rejected, with a separate timestamp distinguishing them from refusals.
alter table public.bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_email_sent_at timestamptz,
  add column if not exists cancellation_email_attempted_at timestamptz;

-- Old admin tabs must not reactivate or edit an already cancelled reservation.
create or replace function public.protect_cancelled_booking()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.cancelled_at is not null and (
    new.status is distinct from old.status or
    new.cancelled_at is distinct from old.cancelled_at or
    new.name is distinct from old.name or
    new.email is distinct from old.email or
    new.phone is distinct from old.phone or
    new.start_date is distinct from old.start_date or
    new.end_date is distinct from old.end_date
  ) then
    raise exception 'Avbestilte bookinger kan ikke endres eller godkjennes på nytt.';
  end if;
  if new.cancelled_at is not null and new.status <> 'rejected' then
    raise exception 'Avbestilte bookinger må være arkivert.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_cancelled_booking on public.bookings;
create trigger protect_cancelled_booking before update on public.bookings
for each row execute function public.protect_cancelled_booking();

-- Existing RLS and privileges are deliberately unchanged.
commit;
