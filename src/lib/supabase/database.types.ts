export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          care_chain_id: string | null
          care_step_id: string | null
          created_at: string
          event_type: string
          household_id: string
          id: string
          note_id: string | null
          payload: Json
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          care_chain_id?: string | null
          care_step_id?: string | null
          created_at?: string
          event_type: string
          household_id: string
          id?: string
          note_id?: string | null
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          care_chain_id?: string | null
          care_step_id?: string | null
          created_at?: string
          event_type?: string
          household_id?: string
          id?: string
          note_id?: string | null
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "audit_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_note_same_household"
            columns: ["note_id", "household_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "audit_events_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
        ]
      }
      care_chains: {
        Row: {
          created_at: string
          created_by_ai: boolean
          household_id: string
          id: string
          note_id: string
          risk_level: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_ai?: boolean
          household_id: string
          id?: string
          note_id: string
          risk_level: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_ai?: boolean
          household_id?: string
          id?: string
          note_id?: string
          risk_level?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_chains_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_chains_note_same_household"
            columns: ["note_id", "household_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      care_requests: {
        Row: {
          care_chain_id: string
          care_step_id: string
          created_at: string
          expires_at: string
          expiry_rule: string
          from_member_id: string
          helper_role: string | null
          household_id: string
          id: string
          kind: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          to_member_id: string
        }
        Insert: {
          care_chain_id: string
          care_step_id: string
          created_at?: string
          expires_at: string
          expiry_rule: string
          from_member_id: string
          helper_role?: string | null
          household_id: string
          id?: string
          kind: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          to_member_id: string
        }
        Update: {
          care_chain_id?: string
          care_step_id?: string
          created_at?: string
          expires_at?: string
          expiry_rule?: string
          from_member_id?: string
          helper_role?: string | null
          household_id?: string
          id?: string
          kind?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          to_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_requests_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "care_requests_from_same_household"
            columns: ["from_member_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "care_requests_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_requests_resolved_by_same_household"
            columns: ["resolved_by", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "care_requests_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
          {
            foreignKeyName: "care_requests_to_same_household"
            columns: ["to_member_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      care_steps: {
        Row: {
          amount_currency: string | null
          appointment_location: string | null
          appointment_time: string | null
          appointment_timezone: string | null
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_required: boolean
          approval_state: string | null
          audit_event_id: string | null
          backup_owner_id: string | null
          care_category: string
          care_chain_id: string
          companion_id: string | null
          confidence: number | null
          created_at: string
          description: string | null
          driver_id: string | null
          due_at: string | null
          escalation_at: string | null
          evidence_required: string[]
          id: string
          owner_id: string | null
          person_to_ask: string | null
          plan_version: number
          rejected_at_plan_version: number | null
          required_amount_minor: number | null
          respond_by_at: string | null
          respond_by_provenance: string | null
          respond_by_set_by: string | null
          respond_by_timezone: string | null
          risk_level: string
          source_quote: string | null
          status: string
          suggested_role: string | null
          task_due_at: string | null
          task_due_provenance: string | null
          task_due_set_by: string | null
          task_due_timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount_currency?: string | null
          appointment_location?: string | null
          appointment_time?: string | null
          appointment_timezone?: string | null
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_required?: boolean
          approval_state?: string | null
          audit_event_id?: string | null
          backup_owner_id?: string | null
          care_category: string
          care_chain_id: string
          companion_id?: string | null
          confidence?: number | null
          created_at?: string
          description?: string | null
          driver_id?: string | null
          due_at?: string | null
          escalation_at?: string | null
          evidence_required?: string[]
          id?: string
          owner_id?: string | null
          person_to_ask?: string | null
          plan_version?: number
          rejected_at_plan_version?: number | null
          required_amount_minor?: number | null
          respond_by_at?: string | null
          respond_by_provenance?: string | null
          respond_by_set_by?: string | null
          respond_by_timezone?: string | null
          risk_level: string
          source_quote?: string | null
          status?: string
          suggested_role?: string | null
          task_due_at?: string | null
          task_due_provenance?: string | null
          task_due_set_by?: string | null
          task_due_timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount_currency?: string | null
          appointment_location?: string | null
          appointment_time?: string | null
          appointment_timezone?: string | null
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_required?: boolean
          approval_state?: string | null
          audit_event_id?: string | null
          backup_owner_id?: string | null
          care_category?: string
          care_chain_id?: string
          companion_id?: string | null
          confidence?: number | null
          created_at?: string
          description?: string | null
          driver_id?: string | null
          due_at?: string | null
          escalation_at?: string | null
          evidence_required?: string[]
          id?: string
          owner_id?: string | null
          person_to_ask?: string | null
          plan_version?: number
          rejected_at_plan_version?: number | null
          required_amount_minor?: number | null
          respond_by_at?: string | null
          respond_by_provenance?: string | null
          respond_by_set_by?: string | null
          respond_by_timezone?: string | null
          risk_level?: string
          source_quote?: string | null
          status?: string
          suggested_role?: string | null
          task_due_at?: string | null
          task_due_provenance?: string | null
          task_due_set_by?: string | null
          task_due_timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_steps_approval_decided_by_fkey"
            columns: ["approval_decided_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_audit_event_id_fkey"
            columns: ["audit_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_backup_owner_id_fkey"
            columns: ["backup_owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_care_chain_id_fkey"
            columns: ["care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_companion_id_fkey"
            columns: ["companion_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_respond_by_set_by_fkey"
            columns: ["respond_by_set_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_steps_task_due_set_by_fkey"
            columns: ["task_due_set_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_items: {
        Row: {
          actor_member_id: string | null
          audit_event_id: string
          care_chain_id: string | null
          care_step_id: string | null
          created_at: string
          household_id: string
          id: string
          kind: string
          note_id: string | null
          params: Json
          recipient_member_id: string | null
          seen_at: string | null
        }
        Insert: {
          actor_member_id?: string | null
          audit_event_id: string
          care_chain_id?: string | null
          care_step_id?: string | null
          created_at?: string
          household_id: string
          id?: string
          kind: string
          note_id?: string | null
          params?: Json
          recipient_member_id?: string | null
          seen_at?: string | null
        }
        Update: {
          actor_member_id?: string | null
          audit_event_id?: string
          care_chain_id?: string | null
          care_step_id?: string | null
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          note_id?: string | null
          params?: Json
          recipient_member_id?: string | null
          seen_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feed_items_actor_same_household"
            columns: ["actor_member_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "feed_items_audit_event_id_fkey"
            columns: ["audit_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_items_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "feed_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_items_note_same_household"
            columns: ["note_id", "household_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "feed_items_recipient_same_household"
            columns: ["recipient_member_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "feed_items_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          display_name: string
          household_id: string
          id: string
          is_active: boolean
          responsibilities: string[]
          role: string
          ui_language: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          household_id: string
          id?: string
          is_active?: boolean
          responsibilities?: string[]
          role: string
          ui_language?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          household_id?: string
          id?: string
          is_active?: boolean
          responsibilities?: string[]
          role?: string
          ui_language?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_sweeps: {
        Row: {
          household_id: string
          last_run_at: string
        }
        Insert: {
          household_id: string
          last_run_at?: string
        }
        Update: {
          household_id?: string
          last_run_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_sweeps_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      member_feed_state: {
        Row: {
          household_id: string
          last_seen_at: string
          member_id: string
        }
        Insert: {
          household_id: string
          last_seen_at?: string
          member_id: string
        }
        Update: {
          household_id?: string
          last_seen_at?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_feed_state_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_feed_state_member_same_household"
            columns: ["member_id", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      note_uploads: {
        Row: {
          completed_at: string | null
          content_type: string
          created_at: string
          expires_at: string
          household_id: string
          note_id: string
          object_path: string
          size_bytes: number
          status: string
          uploaded_by: string
        }
        Insert: {
          completed_at?: string | null
          content_type: string
          created_at?: string
          expires_at?: string
          household_id: string
          note_id: string
          object_path: string
          size_bytes: number
          status?: string
          uploaded_by: string
        }
        Update: {
          completed_at?: string | null
          content_type?: string
          created_at?: string
          expires_at?: string
          household_id?: string
          note_id?: string
          object_path?: string
          size_bytes?: number
          status?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_uploads_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          created_at: string
          household_id: string
          id: string
          image_path: string
          original_text: string | null
          status: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          image_path: string
          original_text?: string | null
          status?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          image_path?: string
          original_text?: string | null
          status?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      part_evidence: {
        Row: {
          added_by: string
          care_chain_id: string
          care_step_id: string
          created_at: string
          household_id: string
          id: string
          kind: string
          label: string
          storage_path: string | null
          text_body: string | null
        }
        Insert: {
          added_by: string
          care_chain_id: string
          care_step_id: string
          created_at?: string
          household_id: string
          id?: string
          kind: string
          label: string
          storage_path?: string | null
          text_body?: string | null
        }
        Update: {
          added_by?: string
          care_chain_id?: string
          care_step_id?: string
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          label?: string
          storage_path?: string | null
          text_body?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_evidence_added_by_same_household"
            columns: ["added_by", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "part_evidence_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "part_evidence_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_evidence_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
        ]
      }
      part_missing_details: {
        Row: {
          ai_question: string | null
          answer: string | null
          care_chain_id: string
          care_step_id: string
          created_at: string
          household_id: string
          id: string
          kind: string
          question_code: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          ai_question?: string | null
          answer?: string | null
          care_chain_id: string
          care_step_id: string
          created_at?: string
          household_id: string
          id?: string
          kind: string
          question_code: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          ai_question?: string | null
          answer?: string | null
          care_chain_id?: string
          care_step_id?: string
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          question_code?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_missing_details_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "part_missing_details_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_missing_details_resolved_by_same_household"
            columns: ["resolved_by", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "part_missing_details_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
        ]
      }
      part_resubmissions: {
        Row: {
          care_chain_id: string
          care_step_id: string
          created_at: string
          evidence_ids: string[]
          explanation: string | null
          household_id: string
          id: string
          plan_changed: boolean
          submitted_by: string
        }
        Insert: {
          care_chain_id: string
          care_step_id: string
          created_at?: string
          evidence_ids?: string[]
          explanation?: string | null
          household_id: string
          id?: string
          plan_changed?: boolean
          submitted_by: string
        }
        Update: {
          care_chain_id?: string
          care_step_id?: string
          created_at?: string
          evidence_ids?: string[]
          explanation?: string | null
          household_id?: string
          id?: string
          plan_changed?: boolean
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_resubmissions_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "part_resubmissions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_resubmissions_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
          {
            foreignKeyName: "part_resubmissions_submitted_by_same_household"
            columns: ["submitted_by", "household_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      recognition_runs: {
        Row: {
          attempt: number
          care_chain_id: string | null
          created_at: string
          failure_reason: string | null
          household_id: string
          id: string
          lease_expires_at: string | null
          note_id: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          care_chain_id?: string | null
          created_at?: string
          failure_reason?: string | null
          household_id: string
          id?: string
          lease_expires_at?: string | null
          note_id: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          care_chain_id?: string | null
          created_at?: string
          failure_reason?: string | null
          household_id?: string
          id?: string
          lease_expires_at?: string | null
          note_id?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recognition_runs_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "recognition_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recognition_runs_note_same_household"
            columns: ["note_id", "household_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      step_escalations: {
        Row: {
          audit_event_id: string
          care_chain_id: string
          care_step_id: string
          created_at: string
          deadline_at: string
          deadline_kind: string
          household_id: string
          id: string
        }
        Insert: {
          audit_event_id: string
          care_chain_id: string
          care_step_id: string
          created_at?: string
          deadline_at: string
          deadline_kind: string
          household_id: string
          id?: string
        }
        Update: {
          audit_event_id?: string
          care_chain_id?: string
          care_step_id?: string
          created_at?: string
          deadline_at?: string
          deadline_kind?: string
          household_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_escalations_audit_event_id_fkey"
            columns: ["audit_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_escalations_chain_same_household"
            columns: ["care_chain_id", "household_id"]
            isOneToOne: false
            referencedRelation: "care_chains"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "step_escalations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_escalations_step_same_chain"
            columns: ["care_step_id", "care_chain_id"]
            isOneToOne: false
            referencedRelation: "care_steps"
            referencedColumns: ["id", "care_chain_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_note_upload_failure: {
        Args: { p_note_id: string; p_user_id: string }
        Returns: boolean
      }
      claim_part: {
        Args: { p_role: string; p_step_id: string; p_user_id: string }
        Returns: Json
      }
      complete_note_upload: {
        Args: {
          p_content_type: string
          p_note_id: string
          p_size_bytes: number
          p_user_id: string
        }
        Returns: string
      }
      complete_part: {
        Args: { p_step_id: string; p_user_id: string }
        Returns: Json
      }
      confirm_part_time: {
        Args: {
          p_at: string
          p_kind: string
          p_step_id: string
          p_timezone: string
          p_user_id: string
        }
        Returns: Json
      }
      decide_approval: {
        Args: { p_decision: string; p_step_id: string; p_user_id: string }
        Returns: Json
      }
      escalate_due_parts: {
        Args: { p_household_id?: string; p_now?: string }
        Returns: Json
      }
      expire_care_requests: {
        Args: { p_household_id?: string; p_now?: string }
        Returns: number
      }
      expire_note_upload: {
        Args: { p_note_id: string; p_object_removed: boolean }
        Returns: boolean
      }
      fail_recognition_run: {
        Args: { p_reason_code: string; p_retryable?: boolean; p_run_id: string }
        Returns: Json
      }
      mark_feed_seen: {
        Args: { p_household_id: string; p_seen_at?: string; p_user_id: string }
        Returns: undefined
      }
      record_evidence: {
        Args: {
          p_kind: string
          p_label: string
          p_step_id: string
          p_storage_path?: string
          p_text?: string
          p_user_id: string
        }
        Returns: Json
      }
      record_note_upload_failure: {
        Args: {
          p_note_id: string
          p_object_removed: boolean
          p_reason: string
          p_stage: string
          p_user_id: string
        }
        Returns: string
      }
      record_note_upload_rejection: {
        Args: {
          p_household_id: string
          p_reason: string
          p_stage: string
          p_user_id: string
        }
        Returns: string
      }
      release_part: {
        Args: { p_role: string; p_step_id: string; p_user_id: string }
        Returns: Json
      }
      reopen_part: {
        Args: { p_step_id: string; p_user_id: string }
        Returns: Json
      }
      report_part_failed: {
        Args: { p_reason_code: string; p_step_id: string; p_user_id: string }
        Returns: Json
      }
      request_assignment: {
        Args: { p_step_id: string; p_to_member_id: string; p_user_id: string }
        Returns: Json
      }
      request_backup: {
        Args: { p_step_id: string; p_to_member_id: string; p_user_id: string }
        Returns: Json
      }
      request_handover: {
        Args: {
          p_role: string
          p_step_id: string
          p_to_member_id: string
          p_user_id: string
        }
        Returns: Json
      }
      reserve_note_upload: {
        Args: {
          p_content_type: string
          p_household_id: string
          p_note_id: string
          p_object_path: string
          p_size_bytes: number
          p_user_id: string
        }
        Returns: string
      }
      resolve_missing_detail: {
        Args: { p_answer: string; p_detail_id: string; p_user_id: string }
        Returns: Json
      }
      respond_to_request: {
        Args: { p_accept: boolean; p_request_id: string; p_user_id: string }
        Returns: Json
      }
      resubmit_part: {
        Args: {
          p_evidence_ids?: string[]
          p_explanation?: string
          p_step_id: string
          p_user_id: string
        }
        Returns: Json
      }
      resume_stale_recognition_runs: {
        Args: { p_household_id?: string; p_limit?: number; p_now?: string }
        Returns: Json[]
      }
      save_appointment_clarification: {
        Args: {
          p_appointment_time: string
          p_location: string
          p_step_id: string
          p_timezone: string
          p_user_id: string
        }
        Returns: Json
      }
      save_care_chain_draft: {
        Args: { p_draft: Json; p_run_id: string }
        Returns: Json
      }
      save_part_amount: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_step_id: string
          p_user_id: string
        }
        Returns: Json
      }
      send_recipient_reply: {
        Args: { p_note_id: string; p_reply: string; p_user_id: string }
        Returns: Json
      }
      set_member_language: {
        Args: { p_household_id: string; p_language: string; p_user_id: string }
        Returns: undefined
      }
      start_recognition_run: {
        Args: { p_lease_seconds?: number; p_note_id: string; p_user_id: string }
        Returns: Json
      }
      volunteer_backup: {
        Args: { p_step_id: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

