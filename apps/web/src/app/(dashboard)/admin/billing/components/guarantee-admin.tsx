"use client";

import { Field, RowLine, RowText } from "./catalog-shared";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import { recordAudit } from "@/lib/audit";
import { GUARANTEE_MINIMUM_DAYS } from "@/lib/guarantee";
import { createClient } from "@flyee/auth/client";

const SETTING_KEY = "guarantee";

/**
 * How many days the money-back guarantee lasts.
 *
 * This key spent its life without a console, deliberately: extending a legal
 * commitment should be a deliberate act, not a slider. The console exists now
 * because the number moved from "written once at launch" to "a lever of the
 * running campaign", and the alternative was an operator running UPDATE by
 * hand against production — which is the same edit with no audit trail, no
 * floor check and no preview of what the pages would then promise.
 *
 * So the deliberateness moved into the form instead of resting on the absence
 * of one: the statutory floor is stated and REFUSED here rather than silently
 * corrected, the save is audited, and the readout says in full sentences what
 * four public pages will claim the moment it lands.
 *
 * `lib/guarantee.ts` keeps clamping anyway. A row is still editable by SQL, and
 * a promise below the legal floor would be void whether or not a form allowed
 * it — the clamp is the guarantee, this is the warning.
 */
export default function GuaranteeAdmin() {
  const [days, setDays] = useState("");
  const [rawValue, setRawValue] = useState<Record<string, unknown>>({});
  const [stored, setStored] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("platform_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
    const value = (data?.value ?? {}) as Record<string, unknown>;
    setRawValue(value);
    const configured = Number(value.days);
    setStored(Number.isFinite(configured) ? Math.floor(configured) : null);
    setDays(Number.isFinite(configured) ? String(Math.floor(configured)) : "");
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const parsed = Number(days);
  const valid = Number.isInteger(parsed) && parsed >= GUARANTEE_MINIMUM_DAYS;
  // What the pages print TODAY, which is not the stored number when the key is
  // absent or below the floor.
  const effective = stored === null ? GUARANTEE_MINIMUM_DAYS : Math.max(GUARANTEE_MINIMUM_DAYS, stored);

  const save = async () => {
    setError(null);
    setSaved(false);
    if (!valid) return;
    const supabase = createClient();
    // Merge, never replace: this form does not own every key of the row.
    const { error: saveError } = await supabase
      .from("platform_settings")
      .upsert({ key: SETTING_KEY, value: { ...rawValue, days: parsed } });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, "admin.billing.guarantee.updated", {
      entityType: "platform_setting",
      metadata: { days: parsed, previous: stored },
    });
    setSaved(true);
    refresh();
  };

  if (loading) return null;

  return (
    <Box className="flex flex-col gap-4">
      <RowLine>
        <RowText
          primary={`As páginas anunciam ${effective} dias de garantia`}
          secondary={
            stored === null
              ? `A chave não existe, então todas as páginas caem no piso legal de ${GUARANTEE_MINIMUM_DAYS} dias.`
              : stored < GUARANTEE_MINIMUM_DAYS
                ? `Está gravado ${stored}, abaixo do piso legal — as páginas mostram ${GUARANTEE_MINIMUM_DAYS} assim mesmo.`
                : "Vale para /assinar, /fundadores, a tela de pagamento e a página de termos, que leem esta mesma linha."
          }
        />
      </RowLine>

      <Field label="Dias de garantia" type="number" value={days} onChange={(value) => setDays(value)} />

      {days.trim() !== "" && !valid && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          O mínimo é {GUARANTEE_MINIMUM_DAYS} dias, inteiros. O artigo 49 do Código de Defesa do Consumidor assegura
          esse prazo para compras feitas fora do estabelecimento, então uma garantia menor seria nula de qualquer forma.
          Para cima não há limite.
        </Alert>
      )}

      {valid && stored !== null && parsed !== stored && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Salvar troca a promessa de {effective} para {parsed} dias nas quatro telas, na hora. Quem já comprou continua
          com o prazo que foi anunciado quando comprou: confira antes de encurtar.
        </Alert>
      )}

      <Box>
        <Button variant="contained" onClick={save} disabled={!valid || parsed === stored}>
          Salvar garantia
        </Button>
      </Box>

      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Salvo. As páginas públicas já estão anunciando o novo prazo.
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      <Alert severity="info" className="neutral bg-background-paper/60!">
        Isto muda só o que as páginas PROMETEM. O sistema ainda não conta a janela nem recusa um pedido fora do prazo: a
        conferência, quando alguém pedir reembolso, é manual (`refund_eligible_until` não existe — docs/FUNIL.md T1.5).
      </Alert>
    </Box>
  );
}
