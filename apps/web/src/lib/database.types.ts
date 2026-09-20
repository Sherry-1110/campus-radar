export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      event_sources: {
        Row: {
          event_id: string
          external_id: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          source_id: string
          source_url: string | null
        }
        Insert: {
          event_id: string
          external_id?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          source_id: string
          source_url?: string | null
        }
        Update: {
          event_id?: string
          external_id?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          source_id?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_sources_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          category: Database["public"]["Enums"]["event_category"]
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          description: string | null
          end_time: string | null
          fee_text: string | null
          id: string
          is_free: boolean
          location: string | null
          location_url: string | null
          school_id: string
          search: unknown
          source_id: string | null
          source_url: string | null
          start_time: string
          status: Database["public"]["Enums"]["event_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["event_category"]
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          description?: string | null
          end_time?: string | null
          fee_text?: string | null
          id?: string
          is_free?: boolean
          location?: string | null
          location_url?: string | null
          school_id: string
          search?: unknown
          source_id?: string | null
          source_url?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["event_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["event_category"]
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          description?: string | null
          end_time?: string | null
          fee_text?: string | null
          id?: string
          is_free?: boolean
          location?: string | null
          location_url?: string | null
          school_id?: string
          search?: unknown
          source_id?: string | null
          source_url?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["event_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      mailing_list_subscribers: {
        Row: {
          categories: Database["public"]["Enums"]["event_category"][]
          confirmed_at: string | null
          created_at: string
          email: string
          frequency: string
          id: string
          unsubscribe_token: string
        }
        Insert: {
          categories?: Database["public"]["Enums"]["event_category"][]
          confirmed_at?: string | null
          created_at?: string
          email: string
          frequency?: string
          id?: string
          unsubscribe_token?: string
        }
        Update: {
          categories?: Database["public"]["Enums"]["event_category"][]
          confirmed_at?: string | null
          created_at?: string
          email?: string
          frequency?: string
          id?: string
          unsubscribe_token?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_school_verified: boolean
          role: Database["public"]["Enums"]["user_role"]
          school_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          is_school_verified?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          school_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_school_verified?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          school_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          email_domain: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          email_domain?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          email_domain?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          created_at: string
          fetch_interval: string
          id: string
          is_active: boolean
          last_fetched_at: string | null
          name: string
          type: Database["public"]["Enums"]["source_type"]
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          fetch_interval?: string
          id?: string
          is_active?: boolean
          last_fetched_at?: string | null
          name: string
          type: Database["public"]["Enums"]["source_type"]
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          fetch_interval?: string
          id?: string
          is_active?: boolean
          last_fetched_at?: string | null
          name?: string
          type?: Database["public"]["Enums"]["source_type"]
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      submissions: {
        Row: {
          created_at: string
          event_id: string
          id: string
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          submitted_by: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          submitted_by: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      submit_event: {
        Args: {
          p_category?: Database["public"]["Enums"]["event_category"]
          p_cover_image_url?: string
          p_description?: string
          p_end_time?: string
          p_fee_text?: string
          p_is_free?: boolean
          p_location?: string
          p_location_url?: string
          p_start_time: string
          p_tags?: string[]
          p_title: string
        }
        Returns: string
      }
    }
    Enums: {
      event_category:
        | "arts"
        | "music"
        | "sports"
        | "academic"
        | "career"
        | "social"
        | "wellness"
        | "food"
        | "other"
      event_status: "draft" | "pending_review" | "published" | "rejected"
      review_status: "pending" | "approved" | "rejected"
      source_type:
        | "calendar_scrape"
        | "social_manual"
        | "user_upload"
        | "eventbrite_api"
      user_role: "student" | "curator" | "admin"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      event_category: [
        "arts",
        "music",
        "sports",
        "academic",
        "career",
        "social",
        "wellness",
        "food",
        "other",
      ],
      event_status: ["draft", "pending_review", "published", "rejected"],
      review_status: ["pending", "approved", "rejected"],
      source_type: [
        "calendar_scrape",
        "social_manual",
        "user_upload",
        "eventbrite_api",
      ],
      user_role: ["student", "curator", "admin"],
    },
  },
} as const
