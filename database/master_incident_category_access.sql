-- Run this once against the master/auth database configured by AUTH_DATABASE_URL.
-- Grants are intentionally deny-by-default: employees need explicit category rows.
CREATE TABLE IF NOT EXISTS public.incident_category_access (
  user_id TEXT NOT NULL,
  category_key TEXT NOT NULL CHECK (category_key IN (
    'patient_related', 'icu_related', 'medication_error',
    'health_care_associated_infection', 'anesthesia_related', 'laboratory_related',
    'radiology_related', 'adverse_surgical_event', 'supply_chain_related',
    'spillage_exposure_break_down', 'employee_related', 'infusion_related'
  )),
  is_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_incident_category_access_user
  ON public.incident_category_access (user_id) WHERE is_allowed = TRUE;
