"use client";

import { useCallback, useEffect, useState } from "react";

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
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) {
        setOrgId(null);
        setError(true);
        setLoading(false);
        return;
      }
      if (!user) {
        setOrgId(null);
        setLoading(false);
        return;
      }
      const { data, error: membershipError } = await supabase
        .from("memberships")
        .select("org_id, organizations(timezone)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (membershipError) {
        setOrgId(null);
        setError(true);
        setLoading(false);
        return;
      }
      setOrgId(data?.org_id ?? null);
      const organization = data?.organizations as unknown as { timezone?: string } | null;
      setTimezone(organization?.timezone || "America/Sao_Paulo");
      setLoading(false);
    } catch {
      setOrgId(null);
      setError(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleOrganizationUpdated = () => {
      void load();
    };
    void load();
    window.addEventListener("medchina:organization-updated", handleOrganizationUpdated);
    return () => window.removeEventListener("medchina:organization-updated", handleOrganizationUpdated);
  }, [load]);

  return { orgId, timezone, loading, error, reload: load };
}
