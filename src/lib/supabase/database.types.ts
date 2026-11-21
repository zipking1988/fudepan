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
      care_steps: {
        Row: {
          approval_required: boolean
          audit_event_id: string | null
          backup_owner_id: string | null
          care_category: string
          care_chain_id: string
          confidence: number | null
          created_at: string
          description: string | null
          due_at: string | null
          escalation_at: string | null
          evidence_required: string[]
          id: string
          owner_id: string | null
          risk_level: string
          source_quote: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          approval_required?: boolean
          audit_event_id?: string | null
          backup_owner_id?: string | null
          care_category: string
          care_chain_id: string
          confidence?: number | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          escalation_at?: string | null
          evidence_required?: string[]
          id?: string
          owner_id?: string | null
          risk_level: string
          source_quote?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          approval_required?: boolean
          audit_event_id?: string | null
          backup_owner_id?: string | null
          care_category?: string
          care_chain_id?: string
          confidence?: number | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          escalation_at?: string | null
          evidence_required?: string[]
          id?: string
          owner_id?: string | null
          risk_level?: string
          source_quote?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
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
            foreignKeyName: "care_steps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_note_upload_failure: {
        Args: { p_note_id: string; p_user_id: string }
        Returns: boolean
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
      expire_note_upload: {
        Args: { p_note_id: string; p_object_removed: boolean }
        Returns: boolean
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

