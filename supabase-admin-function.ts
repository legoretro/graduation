// Supabase Edge Function for the graduation invitation admin dashboard.
// This is safe for a shared Supabase project because it only reads/writes
// graduation_* tables and does not touch Arbolito tables.
//
// Function secrets to set in Supabase:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// GRADUATION_ADMIN_PASSWORD

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminPassword = Deno.env.get("GRADUATION_ADMIN_PASSWORD");

  if (!supabaseUrl || !serviceRoleKey || !adminPassword) {
    return json({ error: "Missing function secrets" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  if (body.password !== adminPassword) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "list") {
    const [rsvps, messages] = await Promise.all([
      supabase
        .from("graduation_rsvps")
        .select("id, guest_key, guest_name, party_count, response, contact, note, created_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("graduation_messages")
        .select("id, body, is_hidden, created_at")
        .order("created_at", { ascending: false })
    ]);

    if (rsvps.error) return json({ error: rsvps.error.message }, 500);
    if (messages.error) return json({ error: messages.error.message }, 500);
    return json({ rsvps: rsvps.data, messages: messages.data });
  }

  if (body.action === "hide_message") {
    const { error } = await supabase
      .from("graduation_messages")
      .update({ is_hidden: true })
      .eq("id", body.messageId);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
