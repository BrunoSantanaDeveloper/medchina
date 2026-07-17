export type TranscriptSegment = {
  speaker: string;
  start: string;
  text: string;
};

export function parseTranscriptResult(result: unknown): { language: string; segments: TranscriptSegment[] } {
  if (!result || typeof result !== "object") return { language: "", segments: [] };
  const value = result as { language?: unknown; segments?: unknown };
  const segments = Array.isArray(value.segments)
    ? value.segments.flatMap((segment) => {
        if (!segment || typeof segment !== "object") return [];
        const candidate = segment as { speaker?: unknown; start?: unknown; text?: unknown };
        if (
          typeof candidate.speaker !== "string" ||
          typeof candidate.start !== "string" ||
          typeof candidate.text !== "string" ||
          !candidate.text.trim()
        )
          return [];
        return [{ speaker: candidate.speaker, start: candidate.start, text: candidate.text }];
      })
    : [];
  return { language: typeof value.language === "string" ? value.language : "", segments };
}

export function transcriptTimestampSeconds(value: string) {
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
