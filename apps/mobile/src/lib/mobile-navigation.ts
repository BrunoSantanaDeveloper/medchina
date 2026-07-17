const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MobileDestination = `/consulta/${string}`;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID.test(value));
}

export function destinationFromUrl(value: string, configuredWebUrl = process.env.EXPO_PUBLIC_WEB_URL): MobileDestination | null {
  try {
    const url = new URL(value);
    const webHost = configuredWebUrl ? new URL(configuredWebUrl).host : null;
    const acceptedScheme = url.protocol === "medchina:";
    const acceptedWeb = url.protocol === "https:" && Boolean(webHost) && url.host === webHost;
    if (!acceptedScheme && !acceptedWeb) return null;

    const parts = acceptedScheme
      ? [url.host, ...url.pathname.split("/")].filter(Boolean)
      : url.pathname.split("/").filter(Boolean);
    const consultationIndex = parts.findIndex((part) => part === "consulta" || part === "consultas");
    const id = consultationIndex >= 0 ? parts[consultationIndex + 1] : null;
    return isUuid(id) ? `/consulta/${id}` : null;
  } catch {
    return null;
  }
}

export function buildWebHandoff(
  action: "consent" | "review",
  input: { patientId?: string; consultationId?: string },
  configuredWebUrl = process.env.EXPO_PUBLIC_WEB_URL,
): string | null {
  if (!configuredWebUrl) return null;
  const base = new URL(configuredWebUrl);
  if (action === "consent" && isUuid(input.patientId)) {
    base.pathname = `/pacientes/${input.patientId}/consentimentos`;
  } else if (action === "review" && isUuid(input.consultationId)) {
    base.pathname = `/consultas/${input.consultationId}`;
  } else {
    return null;
  }
  base.search = "?source=mobile";
  return base.toString();
}
