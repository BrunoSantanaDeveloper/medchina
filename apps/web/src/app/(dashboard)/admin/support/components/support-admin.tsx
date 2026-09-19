"use client";

import { useEffect, useState } from "react";

import { Alert, Button, TextField, Typography } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

/**
 * Quick-support channel configuration (platform_settings, 'support' key).
 * The floating widget on the marketing site AND the dashboard reads these
 * values; leaving both empty hides the widget entirely. Values are PUBLIC
 * (rendered on the public site) — never store secrets here.
 */
export default function SupportAdmin() {
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("platform_settings").select("value").eq("key", "support").maybeSingle();
      const value = (data?.value ?? {}) as { whatsapp?: string; email?: string };
      setWhatsapp(value.whatsapp ?? "");
      setEmail(value.email ?? "");
      setLoading(false);
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const supabase = createClient();
    const cleanWhatsapp = whatsapp.replace(/\D/g, "");
    const cleanEmail = email.trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Informe um e-mail de suporte válido.");
      setSaving(false);
      return;
    }
    const { error: writeError } = await supabase
      .from("platform_settings")
      .upsert({ key: "support", value: { whatsapp: cleanWhatsapp, email: cleanEmail } });
    if (writeError) {
      setError(writeError.message);
      setSaving(false);
      return;
    }
    recordAudit(supabase, "admin.support.updated", {
      entityType: "platform_settings",
      entityId: "support",
      metadata: { whatsapp: Boolean(cleanWhatsapp), email: Boolean(cleanEmail) },
    });
    setWhatsapp(cleanWhatsapp);
    setSaving(false);
    setSaved(true);
  };

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Typography variant="body1" className="text-text-secondary">
        Canais do botão flutuante de suporte rápido (site público + área logada). Deixe os dois em branco para esconder
        o widget. Esses valores são públicos.
      </Typography>

      <TextField
        label="Número do WhatsApp"
        placeholder="5511999998888"
        helperText="Somente dígitos, com código do país — vira um link wa.me."
        value={whatsapp}
        onChange={(event) => setWhatsapp(event.target.value)}
        disabled={loading}
        fullWidth
      />
      <TextField
        label="E-mail de suporte"
        placeholder="suporte@medchina.com.br"
        helperText="Exibido como canal mailto:."
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={loading}
        fullWidth
      />

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Canais de suporte salvos. O widget atualiza no próximo carregamento da página.
        </Alert>
      )}

      <div>
        <Button variant="contained" color="primary" onClick={save} disabled={loading || saving}>
          {saving ? "Salvando…" : "Salvar canais"}
        </Button>
      </div>
    </div>
  );
}
