-- MODULE 5: Credential Expiration Auto-Recovery
-- Creates renewal_tasks table for tracking credential renewal workflows

CREATE TABLE IF NOT EXISTS public.renewal_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nurse_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES public.credentials(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','in_progress','submitted','under_review','verified','expired_without_renewal'
  )),
  steps jsonb NOT NULL DEFAULT '[]', -- array of {step, label, completed_at}
  new_document_url text,
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renewal_tasks_nurse ON public.renewal_tasks(nurse_id);
CREATE INDEX IF NOT EXISTS idx_renewal_tasks_credential ON public.renewal_tasks(credential_id);
CREATE INDEX IF NOT EXISTS idx_renewal_tasks_status ON public.renewal_tasks(status);

ALTER TABLE public.renewal_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nurses_own_renewal_tasks" ON public.renewal_tasks
  FOR ALL USING (auth.uid() = nurse_id);

CREATE POLICY "admins_facility_renewal_tasks" ON public.renewal_tasks
  FOR ALL USING (
    facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid())
  );

CREATE TRIGGER update_renewal_tasks_updated_at BEFORE UPDATE ON public.renewal_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
