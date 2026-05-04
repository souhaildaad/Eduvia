export const FACE_ID_HASH_LENGTH = 256;
export const FACE_ID_MATCH_THRESHOLD = 56;
export const FACE_ID_DUPLICATE_THRESHOLD = FACE_ID_MATCH_THRESHOLD;
export const FACE_ID_AMBIGUITY_MARGIN = 12;

export function normalizeFaceIdNumber(value: unknown, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return Math.floor(numericValue);
}
