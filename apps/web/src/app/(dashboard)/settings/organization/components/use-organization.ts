"use client";

import { useCallback, useEffect, useState } from "react";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

export type OrgRole = "owner" | "admin" | "member";
export type AudioRetentionPolicy = "after_validation" | "thirty_days" | "manual";

/**
 * The clinic's own identity (migration 0121). Deliberately NOT the billing
 * profile: that one exists for the payment provider and may carry a different
 * document — see the migration's header.
 *
 * Every field is nullable because the columns are: accounts created before this
 * screen have none of it, and the requirement lives in the save, not in the row.
 */
export interface PracticeIdentity {
  document: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
}

export interface OrgSummary extends PracticeIdentity {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  audioRetention: AudioRetentionPolicy;
  role: OrgRole;
}

export interface OrgMember {
  membershipId: string;
  userId: string;
  role: OrgRole;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Loads the current user's organizations and, for the selected one, its
 * members and pending invites. All queries run through the browser Supabase
 * client, so RLS is the gatekeeper: members see the roster, only
 * owners/admins see invites (others silently get an empty list).
 */
export function useOrganization() {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);

  const refreshOrgs = useCallback(async () => {
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
    setUserId(user.id);

    const { data } = await supabase
      .from("memberships")
      .select(
        "role, organizations(id, name, slug, timezone, audio_retention, practice_document, practice_phone, practice_email, practice_postal_code, practice_street, practice_number, practice_complement, practice_district, practice_city, practice_state)",
      )
      .eq("user_id", user.id)
      .order("created_at");

    const list: OrgSummary[] = (data ?? [])
      .filter((row) => row.organizations)
      .map((row) => {
        const org = row.organizations as unknown as {
          id: string;
          name: string;
          slug: string;
          timezone: string;
          audio_retention: AudioRetentionPolicy;
          practice_document: string | null;
          practice_phone: string | null;
          practice_email: string | null;
          practice_postal_code: string | null;
          practice_street: string | null;
          practice_number: string | null;
          practice_complement: string | null;
          practice_district: string | null;
          practice_city: string | null;
          practice_state: string | null;
        };
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          timezone: org.timezone || "America/Sao_Paulo",
          audioRetention: org.audio_retention ?? "after_validation",
          role: row.role as OrgRole,
          document: org.practice_document,
          phone: org.practice_phone,
          email: org.practice_email,
          postalCode: org.practice_postal_code,
          street: org.practice_street,
          number: org.practice_number,
          complement: org.practice_complement,
          district: org.practice_district,
          city: org.practice_city,
          state: org.practice_state,
        };
      });

    setOrgs(list);
    setCurrentOrgId((current) => current ?? list[0]?.id ?? null);
    setLoading(false);
  }, []);

  const refreshOrgDetails = useCallback(async () => {
    if (!isSupabaseConfigured || !currentOrgId) {
      setMembers([]);
      setInvites([]);
      return;
    }
    const supabase = createClient();

    const [membersResult, invitesResult] = await Promise.all([
      supabase
        .from("memberships")
        .select("id, user_id, role, created_at, profiles(display_name, avatar_url)")
        .eq("org_id", currentOrgId)
        .order("created_at"),
      supabase
        .from("invites")
        .select("id, email, role, token, expires_at, created_at")
        .eq("org_id", currentOrgId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);

    setMembers(
      (membersResult.data ?? []).map((row) => {
        const profile = row.profiles as unknown as { display_name: string | null; avatar_url: string | null } | null;
        return {
          membershipId: row.id,
          userId: row.user_id,
          role: row.role as OrgRole,
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          createdAt: row.created_at,
        };
      }),
    );

    setInvites(
      (invitesResult.data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role as OrgRole,
        token: row.token,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      })),
    );
  }, [currentOrgId]);

  useEffect(() => {
    refreshOrgs();
  }, [refreshOrgs]);

  useEffect(() => {
    refreshOrgDetails();
  }, [refreshOrgDetails]);

  const currentOrg = orgs.find((org) => org.id === currentOrgId) ?? null;

  return {
    configured: isSupabaseConfigured,
    loading,
    userId,
    orgs,
    currentOrg,
    setCurrentOrgId,
    members,
    invites,
    refreshOrgs,
    refreshOrgDetails,
  };
}
