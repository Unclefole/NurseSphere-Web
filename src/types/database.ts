// Database types for NurseSphere
// These types must match the existing Supabase schema used by the mobile app

export type UserRole = 'HOSPITAL' | 'NURSE'

export type ContractStatus = 'draft' | 'pending' | 'signed' | 'expired' | 'cancelled'

export type ShiftStatus = 'open' | 'filled' | 'in_progress' | 'completed' | 'cancelled'

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

export interface Database {
  public: {
    Tables: {
      // Users table - shared auth
      profiles: {
        Row: {
          id: string
          email: string
          role: UserRole
          full_name: string | null
          phone: string | null
          avatar_url: string | null
          hospital_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          role: UserRole
          full_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          hospital_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string
          role?: UserRole
          full_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          hospital_id?: string | null
          updated_at?: string
        }
      }
      
      // Hospitals table
      hospitals: {
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
          created_at?: string
          updated_at?: string
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
          updated_at?: string
        }
      }

      // Nurses table
      nurses: {
        Row: {
          id: string
          user_id: string
          license_number: string | null
          license_state: string | null
          license_expiry: string | null
          specialty: string | null
          years_experience: number | null
          hourly_rate: number | null
          available: boolean
          bio: string | null
          certifications: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          license_number?: string | null
          license_state?: string | null
          license_expiry?: string | null
          specialty?: string | null
          years_experience?: number | null
          hourly_rate?: number | null
          available?: boolean
          bio?: string | null
          certifications?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          license_number?: string | null
          license_state?: string | null
          license_expiry?: string | null
          specialty?: string | null
          years_experience?: number | null
          hourly_rate?: number | null
          available?: boolean
          bio?: string | null
          certifications?: string[] | null
          updated_at?: string
        }
      }

      // Shifts table
      shifts: {
        Row: {
          id: string
          hospital_id: string
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
          hospital_id: string
          title: string
          description?: string | null
          department?: string | null
          specialty_required?: string | null
          start_time: string
          end_time: string
          hourly_rate: number
          status?: ShiftStatus
          nurse_id?: string | null
          created_at?: string
          updated_at?: string
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
          updated_at?: string
        }
      }

      // Applications table
      applications: {
        Row: {
          id: string
          shift_id: string
          nurse_id: string
          hospital_id: string
          status: ApplicationStatus
          cover_letter: string | null
          applied_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          shift_id: string
          nurse_id: string
          hospital_id: string
          status?: ApplicationStatus
          cover_letter?: string | null
          applied_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          notes?: string | null
        }
        Update: {
          status?: ApplicationStatus
          reviewed_at?: string | null
          reviewed_by?: string | null
          notes?: string | null
        }
      }

      // Contracts table - synced with mobile app
      contracts: {
        Row: {
          id: string
          hospital_id: string
          nurse_id: string
          shift_id: string | null
          title: string
          content: string
          status: ContractStatus
          terms: Record<string, unknown> | null
          hospital_signed: boolean
          hospital_signed_at: string | null
          hospital_signed_by: string | null
          nurse_signed: boolean
          nurse_signed_at: string | null
          nurse_signature_data: string | null
          spheri_generated: boolean
          spheri_optimized: boolean
          created_at: string
          updated_at: string
          expires_at: string | null
        }
        Insert: {
          id?: string
          hospital_id: string
          nurse_id: string
          shift_id?: string | null
          title: string
          content: string
          status?: ContractStatus
          terms?: Record<string, unknown> | null
          hospital_signed?: boolean
          hospital_signed_at?: string | null
          hospital_signed_by?: string | null
          nurse_signed?: boolean
          nurse_signed_at?: string | null
          nurse_signature_data?: string | null
          spheri_generated?: boolean
          spheri_optimized?: boolean
          created_at?: string
          updated_at?: string
          expires_at?: string | null
        }
        Update: {
          title?: string
          content?: string
          status?: ContractStatus
          terms?: Record<string, unknown> | null
          hospital_signed?: boolean
          hospital_signed_at?: string | null
          hospital_signed_by?: string | null
          nurse_signed?: boolean
          nurse_signed_at?: string | null
          nurse_signature_data?: string | null
          spheri_optimized?: boolean
          updated_at?: string
          expires_at?: string | null
        }
      }

      // Analytics table - Spheri analytics data
      analytics: {
        Row: {
          id: string
          hospital_id: string
          metric_type: string
          metric_value: number
          period_start: string
          period_end: string
          metadata: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          hospital_id: string
          metric_type: string
          metric_value: number
          period_start: string
          period_end: string
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          metric_value?: number
          metadata?: Record<string, unknown> | null
        }
      }

      // Compliance records
      compliance_records: {
        Row: {
          id: string
          nurse_id: string
          document_type: string
          document_name: string
          status: 'valid' | 'expiring' | 'expired' | 'pending'
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
          nurse_id: string
          document_type: string
          document_name: string
          status?: 'valid' | 'expiring' | 'expired' | 'pending'
          issued_at?: string | null
          expires_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          document_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: 'valid' | 'expiring' | 'expired' | 'pending'
          verified_at?: string | null
          verified_by?: string | null
          document_url?: string | null
          updated_at?: string
        }
      }

      // Messages table
      messages: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string
          hospital_id: string | null
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
          hospital_id?: string | null
          subject?: string | null
          content: string
          read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read?: boolean
          read_at?: string | null
        }
      }

      // Incidents table
      incidents: {
        Row: {
          id: string
          hospital_id: string
          reported_by: string
          nurse_id: string | null
          shift_id: string | null
          title: string
          description: string
          severity: 'low' | 'medium' | 'high' | 'critical'
          status: 'open' | 'investigating' | 'resolved' | 'closed'
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          hospital_id: string
          reported_by: string
          nurse_id?: string | null
          shift_id?: string | null
          title: string
          description: string
          severity?: 'low' | 'medium' | 'high' | 'critical'
          status?: 'open' | 'investigating' | 'resolved' | 'closed'
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string
          severity?: 'low' | 'medium' | 'high' | 'critical'
          status?: 'open' | 'investigating' | 'resolved' | 'closed'
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
        }
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
      application_status: ApplicationStatus
    }
  }
}

// Helper types for easier use
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Hospital = Database['public']['Tables']['hospitals']['Row']
export type Nurse = Database['public']['Tables']['nurses']['Row']
export type Shift = Database['public']['Tables']['shifts']['Row']
export type Application = Database['public']['Tables']['applications']['Row']
export type Contract = Database['public']['Tables']['contracts']['Row']
export type Analytics = Database['public']['Tables']['analytics']['Row']
export type ComplianceRecord = Database['public']['Tables']['compliance_records']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type Incident = Database['public']['Tables']['incidents']['Row']

