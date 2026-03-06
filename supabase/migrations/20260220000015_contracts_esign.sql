-- Migration 015: Contract E-Signature Scaffold
-- Enhances contracts table + creates contract_templates

-- Enhance existing contracts table
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS signature_provider text DEFAULT 'stub'
    CHECK (signature_provider IN ('stub','docusign','hellosign','signnow')),
  ADD COLUMN IF NOT EXISTS signature_request_id text,
  ADD COLUMN IF NOT EXISTS nurse_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS nurse_signature_url text,
  ADD COLUMN IF NOT EXISTS admin_signature_url text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_reason text;

-- Create contract_templates table for reusable contracts
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL, -- markdown or HTML template with {{variables}}
  variables jsonb NOT NULL DEFAULT '[]', -- list of variable names
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_contract_templates" ON public.contract_templates
  FOR ALL USING (
    facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid())
  );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_contract_templates_facility ON public.contract_templates(facility_id);
CREATE INDEX IF NOT EXISTS idx_contract_templates_active ON public.contract_templates(is_active) WHERE is_active = true;

-- Update trigger for contract_templates
CREATE OR REPLACE FUNCTION public.update_contract_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contract_templates_updated_at ON public.contract_templates;
CREATE TRIGGER contract_templates_updated_at
  BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_contract_templates_updated_at();
