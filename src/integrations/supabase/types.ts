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
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          attempts: number | null
          context: Json
          created_at: string
          error: string | null
          id: string
          order_id: string | null
          permanent: boolean | null
          success: boolean | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          attempts?: number | null
          context?: Json
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          permanent?: boolean | null
          success?: boolean | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          attempts?: number | null
          context?: Json
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string | null
          permanent?: boolean | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          message: string
          sent_at: string | null
          sent_count: number
          status: string
          target: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          message: string
          sent_at?: string | null
          sent_count?: number
          status?: string
          target?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          message?: string
          sent_at?: string | null
          sent_count?: number
          status?: string
          target?: string
          updated_at?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          added_at: string
          product_id: string
          quantity: number
          telegram_id: number
        }
        Insert: {
          added_at?: string
          product_id: string
          quantity?: number
          telegram_id: number
        }
        Update: {
          added_at?: string
          product_id?: string
          quantity?: number
          telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_telegram_id_fkey"
            columns: ["telegram_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          max_uses: number | null
          updated_at: string
          used_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          discount_type: string
          discount_value: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          updated_at?: string
          used_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          updated_at?: string
          used_count?: number
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          delivered_at: string
          digital_asset_id: string | null
          id: string
          order_id: string
          order_item_id: string
          payload_snapshot: string
          product_id: string
        }
        Insert: {
          delivered_at?: string
          digital_asset_id?: string | null
          id?: string
          order_id: string
          order_item_id: string
          payload_snapshot: string
          product_id: string
        }
        Update: {
          delivered_at?: string
          digital_asset_id?: string | null
          id?: string
          order_id?: string
          order_item_id?: string
          payload_snapshot?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_digital_asset_id_fkey"
            columns: ["digital_asset_id"]
            isOneToOne: false
            referencedRelation: "digital_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_assets: {
        Row: {
          claimed: boolean
          claimed_at: string | null
          created_at: string
          id: string
          order_item_id: string | null
          payload: string
          product_id: string
        }
        Insert: {
          claimed?: boolean
          claimed_at?: string | null
          created_at?: string
          id?: string
          order_item_id?: string | null
          payload: string
          product_id: string
        }
        Update: {
          claimed?: boolean
          claimed_at?: string | null
          created_at?: string
          id?: string
          order_item_id?: string | null
          payload?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_assets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          unit_price_cents: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          product_name_snapshot: string
          quantity?: number
          unit_price_cents: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          chat_id: number | null
          created_at: string
          currency: string
          delivered_at: string | null
          delivery_attempts: number
          environment: string
          id: string
          last_delivery_error: string | null
          notified_at: string | null
          paid_at: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          telegram_id: number | null
          total_cents: number
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          delivery_attempts?: number
          environment?: string
          id?: string
          last_delivery_error?: string | null
          notified_at?: string | null
          paid_at?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          telegram_id?: number | null
          total_cents: number
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          delivery_attempts?: number
          environment?: string
          id?: string
          last_delivery_error?: string | null
          notified_at?: string | null
          paid_at?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          telegram_id?: number | null
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_telegram_id_fkey"
            columns: ["telegram_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      payment_claims: {
        Row: {
          amount_cents: number
          chat_id: number | null
          created_at: string
          currency: string
          id: string
          method: string
          normalized_reference: string
          order_id: string
          provider: string | null
          provider_payload: Json
          reference: string
          rejected_reason: string | null
          status: string
          telegram_id: number | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          amount_cents: number
          chat_id?: number | null
          created_at?: string
          currency?: string
          id?: string
          method: string
          normalized_reference: string
          order_id: string
          provider?: string | null
          provider_payload?: Json
          reference: string
          rejected_reason?: string | null
          status?: string
          telegram_id?: number | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          amount_cents?: number
          chat_id?: number | null
          created_at?: string
          currency?: string
          id?: string
          method?: string
          normalized_reference?: string
          order_id?: string
          provider?: string | null
          provider_payload?: Json
          reference?: string
          rejected_reason?: string | null
          status?: string
          telegram_id?: number | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_claims_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_claims_telegram_id_fkey"
            columns: ["telegram_id"]
            isOneToOne: false
            referencedRelation: "telegram_users"
            referencedColumns: ["telegram_id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          bulk_tiers: Json
          created_at: string
          currency: string
          custom_emoji_id: string | null
          delivery_type: string
          description: string | null
          emoji: string | null
          featured: boolean
          id: string
          image_url: string | null
          name: string
          price_cents: number
          short_description: string | null
          slug: string
          stripe_price_lookup_key: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          bulk_tiers?: Json
          created_at?: string
          currency?: string
          custom_emoji_id?: string | null
          delivery_type?: string
          description?: string | null
          emoji?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          name: string
          price_cents: number
          short_description?: string | null
          slug: string
          stripe_price_lookup_key?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          bulk_tiers?: Json
          created_at?: string
          currency?: string
          custom_emoji_id?: string | null
          delivery_type?: string
          description?: string | null
          emoji?: string | null
          featured?: boolean
          id?: string
          image_url?: string | null
          name?: string
          price_cents?: number
          short_description?: string | null
          slug?: string
          stripe_price_lookup_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          environment: string
          event_id: string
          received_at: string
          type: string
        }
        Insert: {
          environment: string
          event_id: string
          received_at?: string
          type: string
        }
        Update: {
          environment?: string
          event_id?: string
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      telegram_users: {
        Row: {
          chat_id: number
          created_at: string
          first_name: string | null
          language_code: string | null
          last_name: string | null
          linked_user_id: string | null
          telegram_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          first_name?: string | null
          language_code?: string | null
          last_name?: string | null
          linked_user_id?: string | null
          telegram_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          first_name?: string | null
          language_code?: string | null
          last_name?: string | null
          linked_user_id?: string | null
          telegram_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "customer"
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
    Enums: {
      app_role: ["admin", "customer"],
    },
  },
} as const
