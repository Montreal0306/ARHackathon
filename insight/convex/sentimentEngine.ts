/**
 * SocialSync Sentiment Engine.
 *
 * When Hume provides BOTH language and face emotions (same taxonomy),
 * we compare them directly for incongruity — no fixed 70/30 weighting needed.
 * Falls back to lexical proxy when Hume is unavailable.
 */

// --- Types ---

export interface HumeEmotionScore {
  name: string;
  score: number;
}

export interface IngestBody {
  transcript: string;
  faceImageBase64?: string;
  humeLanguageEmotions?: HumeEmotionScore[];
  humeFaceEmotions?: HumeEmotionScore[];
  timestamp?: number;
}

export interface IngestResult {
  languageStress: number;
  faceStress: number | null;
  incongruity: boolean;
  label: string | null;
  hint: string;
  topLanguageEmotion: string | null;
  topFaceEmotion: string | null;
  languageEmotions?: HumeEmotionScore[];
  faceEmotions?: HumeEmotionScore[];
}

// --- Lexical fallback ---

const POSITIVE_PHRASES =
  /\b(fine|good|great|ok|okay|alright|well|happy|wonderful|lovely|perfect|all good|not bad)\b/i;

const NEGATIVE_PHRASES =
  /\b(bad|awful|terrible|hate|sad|angry|stressed|anxious|worried|scared|hurt|exhausted|frustrated|struggling|upset|overwhelmed|confused|annoyed|nervous|tense|uncomfortable|difficult|hard time)\b/i;

export function isLexicallyPositive(text: string): boolean {
  return POSITIVE_PHRASES.test(text.trim());
}

export function lexicalVoiceStress(transcript: string): number {
  let s = 0.3;
  if (NEGATIVE_PHRASES.test(transcript)) s += 0.35;
  if (/!{2,}/.test(transcript)) s += 0.1;
  if (/\?{2,}/.test(transcript)) s += 0.08;
  return Math.min(1, s);
}

// --- Emotion mapping ---

const STRESS_EMOTIONS = new Set([
  "anxiety", "fear", "anger", "distress", "contempt", "disgust",
  "sadness", "confusion", "disappointment", "embarrassment", "pain",
  "shame", "awkwardness", "horror", "doubt",
]);

const POSITIVE_EMOTIONS = new Set([
  "joy", "amusement", "contentment", "calmness", "satisfaction",
  "relief", "love", "admiration", "excitement", "interest",
  "pride", "triumph", "surprise (positive)",
]);

function emotionToStress(emotions: HumeEmotionScore[]): number {
  if (!emotions || emotions.length === 0) return 0.35;

  let stressW = 0, stressN = 0, calmW = 0, calmN = 0;
  for (const e of emotions) {
    const name = e.name.toLowerCase();
    if ([...STRESS_EMOTIONS].some((s) => name.includes(s))) {
      stressW += e.score; stressN++;
    }
    if ([...POSITIVE_EMOTIONS].some((c) => name.includes(c))) {
      calmW += e.score; calmN++;
    }
  }
  const avgStress = stressN > 0 ? stressW / stressN : 0;
  const avgCalm = calmN > 0 ? calmW / calmN : 0;
  return Math.min(1, Math.max(0, 0.5 + avgStress - avgCalm));
}

function topEmotion(emotions: HumeEmotionScore[]): string | null {
  if (!emotions || emotions.length === 0) return null;
  return emotions[0].name;
}

// --- Incongruity detection ---

function detectIncongruity(
  langEmotions: HumeEmotionScore[],
  faceEmotions: HumeEmotionScore[],
  transcript: string
): boolean {
  if (faceEmotions.length === 0 || langEmotions.length === 0) {
    // Can't compare — fall back to lexical check
    const langStress = emotionToStress(langEmotions);
    return isLexicallyPositive(transcript) && langStress >= 0.55;
  }

  const topLang = langEmotions[0].name.toLowerCase();
  const topFace = faceEmotions[0].name.toLowerCase();

  const langIsStress = [...STRESS_EMOTIONS].some((s) => topLang.includes(s));
  const langIsPositive = [...POSITIVE_EMOTIONS].some((p) => topLang.includes(p));
  const faceIsStress = [...STRESS_EMOTIONS].some((s) => topFace.includes(s));
  const faceIsPositive = [...POSITIVE_EMOTIONS].some((p) => topFace.includes(p));

  // Incongruity: language and face disagree on valence
  if (langIsStress && faceIsPositive) return true;
  if (langIsPositive && faceIsStress) return true;

  // Positive words but both Hume signals show stress
  if (isLexicallyPositive(transcript) && langIsStress && faceIsStress) return true;

  return false;
}

// --- Hint generation ---

function pickHint(params: {
  incongruity: boolean;
  langStress: number;
  faceStress: number | null;
  topLang: string | null;
  topFace: string | null;
}): { label: string | null; hint: string } {
  const { incongruity, langStress, faceStress, topLang, topFace } = params;

  if (incongruity) {
    const faceNote = topFace ? ` (face: ${topFace})` : "";
    const langNote = topLang ? ` (voice/text: ${topLang})` : "";
    return {
      label: "Polite inconsistency",
      hint: `Words and expression don't match${langNote}${faceNote} — ask an open question and pause.`,
    };
  }

  if (langStress >= 0.65) {
    return {
      label: "Elevated stress",
      hint: `They seem stressed${topLang ? ` (${topLang})` : ""} — validate feelings, slow your pace.`,
    };
  }

  if (faceStress !== null && faceStress >= 0.65 && langStress < 0.5) {
    return {
      label: "Face tension",
      hint: `Face looks tense${topFace ? ` (${topFace})` : ""} but words seem calm — check in gently.`,
    };
  }

  if (langStress <= 0.4 && (faceStress === null || faceStress <= 0.4)) {
    return {
      label: "Calm",
      hint: "Seems at ease — good moment to ask for their perspective.",
    };
  }

  return {
    label: null,
    hint: "Mixed signals — mirror their last point, then check what they need.",
  };
}

// --- Main engine ---

export function runIngest(body: IngestBody): IngestResult {
  const transcript = (body.transcript ?? "").trim();

  const langEmotions = body.humeLanguageEmotions ?? [];
  const faceEmotions = body.humeFaceEmotions ?? [];

  const languageStress =
    langEmotions.length > 0
      ? emotionToStress(langEmotions)
      : lexicalVoiceStress(transcript);

  const faceStress =
    faceEmotions.length > 0 ? emotionToStress(faceEmotions) : null;

  const incongruity = detectIncongruity(langEmotions, faceEmotions, transcript);

  const { label, hint } = pickHint({
    incongruity,
    langStress: languageStress,
    faceStress,
    topLang: topEmotion(langEmotions),
    topFace: topEmotion(faceEmotions),
  });

  return {
    languageStress,
    faceStress,
    incongruity,
    label,
    hint,
    topLanguageEmotion: topEmotion(langEmotions),
    topFaceEmotion: topEmotion(faceEmotions),
    languageEmotions: langEmotions.length > 0 ? langEmotions : undefined,
    faceEmotions: faceEmotions.length > 0 ? faceEmotions : undefined,
  };
}
