-- Serialize all changes that create or modify approved stays before checking ranges.
-- This makes the overlap check safe when two admins approve at the same time.
CREATE OR REPLACE FUNCTION public.prevent_double_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- One advisory transaction lock for the single rentable property.
  PERFORM pg_advisory_xact_lock(86573302, 1);

  IF EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE status = 'approved'
      AND cancelled_at IS NULL
      AND id <> NEW.id
      AND NEW.start_date < end_date
      AND NEW.end_date > start_date
  ) THEN
    RAISE EXCEPTION 'Datoene er allerede opptatt';
  END IF;

  RETURN NEW;
END;
$function$;
