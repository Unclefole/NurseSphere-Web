// Database types for NurseSphere
// Must match the LIVE Supabase schema (8 tables)
//
// NOTE: supabase-js v2.47+ requires `Relationships: []` on every table
// so that each table satisfies the `GenericTable` constraint
// (Tables: Record<string, GenericTable>). Without it, the schema type
// resolves to `never` and all `.from('table').insert(...)` calls fail.

export type UserRole = 'hospital_admin' | 'nurse'

export type ContractStatus = 'draft' | 'pending' | 'signed' | 'expired' | 'cancelled' | 'pending_signature' | 'executed' | 'voided'

export type ShiftStatus = 'open' | 'filled' | 'in_progress' | 'completed' | 'cancelled'

export type CredentialStatus =
  | 'valid'
  | 'expiring'
  | 'expiring_soon'
  | 'expiring_critical'
  | 'expired'
  | 'pending'

// Legacy types for pages that reference tables not yet in the live schema
// TODO: These tables (applications, analytics, incidents) need to be created or the pages reworked
export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          role: UserRole
          email: string | null
          phone: string | null
          created_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          avatar_url?: string | null
          role: UserRole
          created_at?: string
        }
        Update: {
          full_name?: string | null
          avatar_url?: string | null
          role?: UserRole
        }
        Relationships: []
      }

      facilities: {
        Row: {
          id: string
          name: string
          address: string | null
          city: string | null
          state: string | null
          zip_code: string | null
          phone: string | null
          email: string | null
          logo_url: string | null
          stripe_customer_id: string | null
          settings: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          city?: string | null
          state?: string | null
          zip_code?: string | null
          phone?: string | null
          email?: string | null
          logo_url?: string | null
          settings?: Record<string, unknown> | null
        }
        Update: {
          name?: string
          address?: string | null
          city?: string | null
          state?: string | null
          zip_code?: string | null
          phone?: string | null
          email?: string | null
          logo_url?: string | null
          settings?: Record<string, unknown> | null
        }
        Relationships: []
      }

      shifts: {
        Row: {
          id: string
          facility_id: string
          title: string
          description: string | null
          department: string | null
          specialty_required: string | null
          start_time: string
          end_time: string
          hourly_rate: number
          status: ShiftStatus
          nurse_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          facility_id: string
          title: string
          description?: string | null
          department?: string | null
          specialty_required?: string | null
          start_time: string
          end_time: string
          hourly_rate: number
          status?: ShiftStatus
          nurse_id?: string | null
        }
        Update: {
          title?: string
          description?: string | null
          department?: string | null
          specialty_required?: string | null
          start_time?: string
          end_time?: string
          hourly_rate?: number
          status?: ShiftStatus
          nurse_id?: string | null
        }
        Relationships: []
      }

      contracts: {
        Row: {
          id: string
          facility_id: string
          nurse_id: string
          shift_id: string | null
          title: string
          content: string
          status: ContractStatus
          terms: Record<string, unknown> | null
          created_at: string
          updated_at: string
          expires_at: string | null
          // Signature-related columns (populated by signature service)
          pdf_url: string | null
          signature_request_id: string | null
          signature_provider: string | null
          nurse_signature_url: string | null
          admin_signature_url: string | null
          nurse_signed_at: string | null
          admin_signed_at: string | null
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          id?: string
          facility_id: string
          nurse_id: string
          shift_id?: string | null
          title: string
          content: string
          status?: ContractStatus
          terms?: Record<string, unknown> | null
          expires_at?: string | null
          pdf_url?: string | null
          signature_request_id?: string | null
          signature_provider?: string | null
          nurse_signature_url?: string | null
          admin_signature_url?: string | null
          nurse_signed_at?: string | null
          admin_signed_at?: string | null
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          title?: string
          content?: string
          status?: ContractStatus
          terms?: Record<string, unknown> | null
          expires_at?: string | null
          pdf_url?: string | null
          signature_request_id?: string | null
          signature_provider?: string | null
          nurse_signature_url?: string | null
          admin_signature_url?: string | null
          nurse_signed_at?: string | null
          admin_signed_at?: string | null
          voided_at?: string | null
          voided_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      credentials: {
        Row: {
          id: string
          user_id: string
          document_type: string
          document_name: string
          status: CredentialStatus
          issued_at: string | null
          expires_at: string | null
          verified_at: string | null
          verified_by: string | null
          document_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          document_type: string
          document_name: string
          status?: CredentialStatus
        }
        Update: {
          status?: CredentialStatus
          verified_at?: string | null
          verified_by?: string | null
          document_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      files: {
        Row: {
          id: string
          user_id: string
          file_name: string
          file_url: string
          file_type: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          file_name: string
          file_url: string
          file_type?: string | null
        }
        Update: {
          file_name?: string
          file_url?: string
          file_type?: string | null
        }
        Relationships: []
      }

      messages: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string
          subject: string | null
          content: string
          read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id: string
          subject?: string | null
          content: string
          read?: boolean
        }
        Update: {
          read?: boolean
          read_at?: string | null
        }
        Relationships: []
      }

      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          resource_type: string | null
          resource_id: string | null
          metadata: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          resource_type?: string | null
          resource_id?: string | null
          metadata?: Record<string, unknown> | null
        }
        Update: never
        Relationships: []
      }

      facility_admins: {
        Row: {
          id: string
          facility_id: string
          profile_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          facility_id: string
          profile_id: string
          role?: string
        }
        Update: {
          role?: string
        }
        Relationships: []
      }

      // ── Credential renewal workflow ─────────────────────────────────────────
      renewal_tasks: {
        Row: {
          id: string
          nurse_id: string
          credential_id: string
          facility_id: string | null
          status: string
          steps: Record<string, unknown> | null
          new_document_url: string | null
          submitted_at: string | null
          verified_at: string | null
          verified_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nurse_id: string
          credential_id: string
          facility_id?: string | null
          status?: string
          steps?: Record<string, unknown> | null
          new_document_url?: string | null
          notes?: string | null
        }
        Update: {
          status?: string
          steps?: Record<string, unknown> | null
          new_document_url?: string | null
          submitted_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      // ── Fraud / Identity Shield ─────────────────────────────────────────────
      suspicious_events: {
        Row: {
          id: string
          facility_id: string | null
          nurse_id: string | null
          event_type: string
          severity: string
          evidence: Record<string, unknown>
          status: string
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          facility_id?: string | null
          nurse_id?: string | null
          event_type: string
          severity: string
          evidence: Record<string, unknown>
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
        }
        Update: {
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      // ── Timecards (014) ────────────────────────────────────────────────────
      timecards: {
        Row: {
          id: string
          shift_id: string
          nurse_id: string
          facility_id: string
          clock_in_at: string | null
          clock_out_at: string | null
          break_minutes: number
          total_hours: number | null
          status: 'draft' | 'submitted' | 'approved' | 'disputed' | 'paid'
          submitted_at: string | null
          approved_at: string | null
          approved_by: string | null
          dispute_reason: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          shift_id: string
          nurse_id: string
          facility_id: string
          clock_in_at?: string | null
          clock_out_at?: string | null
          break_minutes?: number
          status?: 'draft' | 'submitted' | 'approved' | 'disputed' | 'paid'
          submitted_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          dispute_reason?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          clock_in_at?: string | null
          clock_out_at?: string | null
          break_minutes?: number
          status?: 'draft' | 'submitted' | 'approved' | 'disputed' | 'paid'
          submitted_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          dispute_reason?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      // ── Contract Templates (015) ────────────────────────────────────────────
      contract_templates: {
        Row: {
          id: string
          facility_id: string
          name: string
          content: string
          variables: unknown[]
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          facility_id: string
          name: string
          content: string
          variables?: unknown[]
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          content?: string
          variables?: unknown[]
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }

      // ── Admin Invites (016) ─────────────────────────────────────────────────
      admin_invites: {
        Row: {
          id: string
          facility_id: string
          invited_by: string
          email: string
          role: string
          token: string
          status: 'pending' | 'accepted' | 'expired' | 'revoked'
          expires_at: string
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          facility_id: string
          invited_by: string
          email: string
          role?: string
          token?: string
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
          expires_at?: string
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
        }
        Update: {
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
          accepted_at?: string | null
          accepted_by?: string | null
        }
        Relationships: []
      }

      // ── Shift Applications (019) ────────────────────────────────────────────
      shift_applications: {
        Row: {
          id: string
          shift_id: string
          nurse_id: string
          facility_id: string
          status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'
          applied_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          shift_id: string
          nurse_id: string
          facility_id: string
          status?: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'
          applied_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'
          reviewed_at?: string | null
          reviewed_by?: string | null
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      // ── Nurse Marketplace Prefs (019) ───────────────────────────────────────
      nurse_marketplace_prefs: {
        Row: {
          id: string
          nurse_id: string
          max_commute_miles: number | null
          preferred_shift_types: string[]
          preferred_units: string[]
          preferred_roles: string[]
          min_hourly_rate: number | null
          available_days: string[]
          marketplace_visible: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nurse_id: string
          max_commute_miles?: number | null
          preferred_shift_types?: string[]
          preferred_units?: string[]
          preferred_roles?: string[]
          min_hourly_rate?: number | null
          available_days?: string[]
          marketplace_visible?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          max_commute_miles?: number | null
          preferred_shift_types?: string[]
          preferred_units?: string[]
          preferred_roles?: string[]
          min_hourly_rate?: number | null
          available_days?: string[]
          marketplace_visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }

      // ── Push Tokens (020) ───────────────────────────────────────────────────
      push_tokens: {
        Row: {
          id: string
          user_id: string
          token: string
          platform: 'ios' | 'android' | 'web'
          device_id: string | null
          active: boolean
          last_used_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          token: string
          platform: 'ios' | 'android' | 'web'
          device_id?: string | null
          active?: boolean
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          token?: string
          device_id?: string | null
          active?: boolean
          last_used_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }

      // ── Compliance Sweep Log (021) ──────────────────────────────────────────
      compliance_sweep_log: {
        Row: {
          id: string
          started_at: string
          completed_at: string | null
          nurses_checked: number
          alerts_created: number
          suspensions_triggered: number
          error_count: number
          status: 'running' | 'completed' | 'failed'
          created_at: string
        }
        Insert: {
          id?: string
          started_at: string
          completed_at?: string | null
          nurses_checked?: number
          alerts_created?: number
          suspensions_triggered?: number
          error_count?: number
          status: 'running' | 'completed' | 'failed'
          created_at?: string
        }
        Update: {
          completed_at?: string | null
          nurses_checked?: number
          alerts_created?: number
          suspensions_triggered?: number
          error_count?: number
          status?: 'running' | 'completed' | 'failed'
        }
        Relationships: []
      }

      // ── Competencies (023) ──────────────────────────────────────────────────
      competencies: {
        Row: {
          id: string
          nurse_id: string
          unit_type: string
          last_worked_at: string | null
          hours_last_12mo: number | null
          verified: boolean | null
          verified_at: string | null
          verified_by: string | null
          recency_index: number | null
          competency_score: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          nurse_id: string
          unit_type: string
          last_worked_at?: string | null
          hours_last_12mo?: number | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
          recency_index?: number | null
          competency_score?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          last_worked_at?: string | null
          hours_last_12mo?: number | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
          recency_index?: number | null
          competency_score?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }

      // ── Shift Risk Certificates (024-025) ───────────────────────────────────
      shift_risk_certificates: {
        Row: {
          id: string
          shift_id: string
          nurse_id: string
          facility_id: string
          credential_status_snapshot: Record<string, unknown>
          competency_snapshot: Record<string, unknown>
          compliance_score: number
          competency_score: number
          alternative_candidates_available: number | null
          decision_basis: Record<string, unknown>
          admin_override: boolean | null
          override_justification: string | null
          override_actor_id: string | null
          certificate_hash: string | null
          issued_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          shift_id: string
          nurse_id: string
          facility_id: string
          credential_status_snapshot: Record<string, unknown>
          competency_snapshot: Record<string, unknown>
          compliance_score: number
          competency_score: number
          alternative_candidates_available?: number | null
          decision_basis: Record<string, unknown>
          admin_override?: boolean | null
          override_justification?: string | null
          override_actor_id?: string | null
          certificate_hash?: string | null
          issued_at?: string | null
          created_at?: string | null
        }
        Update: never
        Relationships: []
      }

      // ── Nurse verification history ──────────────────────────────────────────
      credential_verifications: {
        Row: {
          id: string
          nurse_id: string
          facility_id: string | null
          verification_type: string
          result: string
          verified_at: string
          expires_at: string | null
          notes: string | null
          raw_response: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          nurse_id: string
          facility_id?: string | null
          verification_type: string
          result: string
          verified_at?: string
          expires_at?: string | null
          notes?: string | null
          raw_response?: Record<string, unknown> | null
        }
        Update: {
          result?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: UserRole
      contract_status: ContractStatus
      shift_status: ShiftStatus
      credential_status: CredentialStatus
    }
  }
}

// Helper types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Facility = Database['public']['Tables']['facilities']['Row']
export type Shift = Database['public']['Tables']['shifts']['Row']
export type Contract = Database['public']['Tables']['contracts']['Row']
export type Credential = Database['public']['Tables']['credentials']['Row']
export type FileRecord = Database['public']['Tables']['files']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type AuditLog = Database['public']['Tables']['audit_logs']['Row']

export type Timecard = Database['public']['Tables']['timecards']['Row']
export type ContractTemplate = Database['public']['Tables']['contract_templates']['Row']
export type AdminInvite = Database['public']['Tables']['admin_invites']['Row']
export type ShiftApplication = Database['public']['Tables']['shift_applications']['Row']
export type NurseMarketplacePrefs = Database['public']['Tables']['nurse_marketplace_prefs']['Row']
export type PushToken = Database['public']['Tables']['push_tokens']['Row']
export type ComplianceSweepLog = Database['public']['Tables']['compliance_sweep_log']['Row']
export type Competency = Database['public']['Tables']['competencies']['Row']
export type ShiftRiskCertificate = Database['public']['Tables']['shift_risk_certificates']['Row']

// Legacy aliases (for gradual migration — remove once all references updated)
export type Hospital = Facility
