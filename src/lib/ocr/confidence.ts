/** Below this average confidence the user must verify the extracted text (safety policy item 6). */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

/** Unknown confidence counts as low. */
export function isLowConfidence(confidence: number | null | undefined): boolean {
  return confidence == null || confidence < LOW_CONFIDENCE_THRESHOLD;
}

export function confidencePercent(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}
