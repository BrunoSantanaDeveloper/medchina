"use client";

import { useEffect, useState } from "react";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * The signed-in professional's workspace. One workspace per professional in the
 * MVP (root CLAUDE.md), so the first membership IS the workspace; multi-clinic
 * selection is post-MVP and would replace this hook, not extend its callers.
 */
export function useCurrentOrg() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("memberships")
        .select("org_id, organizations(timezone)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      setOrgId(data?.org_id ?? null);
      const organization = data?.organizations as unknown as { timezone?: string } | null;
      setTimezone(organization?.timezone || "America/Sao_Paulo");
      setLoading(false);
    };
    load();
  }, []);

  return { orgId, timezone, loading };
}
