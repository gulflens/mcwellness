-- 901_service_session_settings.sql
-- Needs: 040 (service_type)
--
-- The two settings the session runner reads from the catalogue rather than
-- from code (docs/SPEC/session-capture.md sections 3.2, 3.5 and 6, which name
-- both of these as "change request to core"; docs/SPEC/00-data-model.md
-- section 2).
--
-- Pre-flight is a checklist the practitioner ticks at the door before a
-- session starts, and the questions are the 0-to-10 ratings asked before and
-- again after it. Neither is the same for every service — a consultation has
-- no electrodes to check and no bands to rate — so both belong to the
-- service_type row, editable by the practice, never a list in a component.
--
-- Both are jsonb arrays, defaulting to empty so every existing row is valid
-- the moment this runs and a service that asks nothing simply asks nothing:
--
--   preflight_checklist  [{ "key": "identity", "label_en": "...", "label_ar": "..." }, ...]
--   rating_questions     [{ "key": "sleep", "label_en": "...", "label_ar": "...",
--                           "min": 0, "max": 10 }, ...]
--
-- The check constraint here proves only that each column holds a JSON array:
-- the shape of an item is the session module's to validate at the edge
-- (domain/session), where a bad item can be refused with a sentence rather
-- than a constraint violation. `key` is what an answer is recorded against,
-- so it is stable while a label is free to be reworded; the practice may
-- reword a label at any time and old answers keep their meaning.
--
-- service_type is already audited (080_audit_triggers.sql attaches audit_row
-- to it) and already carries its grants and row security (090). A column
-- added to an audited table is audited with it: nothing here changes any
-- table's classification, and no grant is altered.

alter table service_type
  add column preflight_checklist jsonb not null default '[]'::jsonb,
  add column rating_questions    jsonb not null default '[]'::jsonb;

alter table service_type
  add constraint service_type_preflight_checklist_is_array
    check (jsonb_typeof(preflight_checklist) = 'array'),
  add constraint service_type_rating_questions_is_array
    check (jsonb_typeof(rating_questions) = 'array');

comment on column service_type.preflight_checklist is
  'What the practitioner confirms before this service starts: [{key, label_en, label_ar}]. Data, not code (session-capture.md 3.2).';
comment on column service_type.rating_questions is
  'The 0-10 questions asked before and after this service: [{key, label_en, label_ar, min, max}]. Answers are recorded against key, so a label may be reworded.';

-- rollback:
--   alter table service_type drop constraint if exists service_type_rating_questions_is_array;
--   alter table service_type drop constraint if exists service_type_preflight_checklist_is_array;
--   alter table service_type drop column if exists rating_questions;
--   alter table service_type drop column if exists preflight_checklist;
