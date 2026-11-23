-- Add fields for human-provided appointment clarification
-- Additive only: no existing data is modified, no columns dropped

alter table public.care_steps
  add column appointment_location text,
  add column appointment_time timestamptz,
  add column appointment_timezone text;

comment on column public.care_steps.appointment_location is
  'Human-provided hospital/clinic name for appointment steps. Distinct from AI-extracted source_quote.';

comment on column public.care_steps.appointment_time is
  'Human-provided actual appointment date/time. Distinct from due_at (family confirmation deadline).';

comment on column public.care_steps.appointment_timezone is
  'Timezone or offset for appointment_time (e.g., "America/New_York" or "-05:00") to ensure clarity.';
