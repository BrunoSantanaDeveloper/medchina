export interface TranscriptSegment {
  /** "Speaker 1", "Speaker 2", ... — projects relabel afterwards. */
  speaker: string;
  /** "mm:ss" offset from the start of the recording. */
  start: string;
  text: string;
}

export interface TranscriptResult {
  /** BCP-47 language detected in the audio (e.g. "pt-BR"). */
  language: string;
  segments: TranscriptSegment[];
}
