/**
 * Hume AI client — Language (text) + optional Face (image) in one batch job.
 *
 * Text-only: JSON body with { text, models: { language } }.
 * Text+Face: multipart/form-data with image file + config JSON including text + face model.
 */

import type { HumeEmotionScore } from "./sentimentEngine";

const HUME_BATCH_URL = "https://api.hume.ai/v0/batch/jobs";
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Hume response types ---

interface HumePredictionEmotion {
  name: string;
  score: number;
}

interface HumePredictionResult {
  results: {
    predictions: Array<{
      models: {
        language?: {
          grouped_predictions: Array<{
            predictions: Array<{ text: string; emotions: HumePredictionEmotion[] }>;
          }>;
        };
        face?: {
          grouped_predictions: Array<{
            predictions: Array<{ emotions: HumePredictionEmotion[] }>;
          }>;
        };
      };
    }>;
  };
}

export interface HumeAnalysisResult {
  languageEmotions: HumeEmotionScore[];
  faceEmotions: HumeEmotionScore[];
}

// --- Job submission ---

async function startTextOnlyJob(apiKey: string, transcript: string): Promise<string> {
  const res = await fetch(HUME_BATCH_URL, {
    method: "POST",
    headers: {
      "X-Hume-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [transcript],
      models: { language: {} },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hume text job failed (${res.status}): ${text}`);
  }
  return ((await res.json()) as { job_id: string }).job_id;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

async function startTextAndFaceJob(
  apiKey: string,
  transcript: string,
  faceImageBase64: string
): Promise<string> {
  const config = {
    text: [transcript],
    models: { language: {}, face: {} },
  };

  const imageBytes = base64ToUint8Array(faceImageBase64);
  const imageBlob = new Blob([imageBytes.buffer as ArrayBuffer], { type: "image/jpeg" });

  const form = new FormData();
  form.append("json", JSON.stringify(config));
  form.append("file", imageBlob, "face.jpg");

  const res = await fetch(HUME_BATCH_URL, {
    method: "POST",
    headers: { "X-Hume-Api-Key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hume text+face job failed (${res.status}): ${text}`);
  }
  return ((await res.json()) as { job_id: string }).job_id;
}

// --- Polling ---

async function pollJob(apiKey: string, jobId: string): Promise<HumePredictionResult[]> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${HUME_BATCH_URL}/${jobId}/predictions`, {
      headers: { "X-Hume-Api-Key": apiKey },
    });
    if (res.status === 400) continue;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hume poll failed (${res.status}): ${text}`);
    }
    return (await res.json()) as HumePredictionResult[];
  }
  throw new Error(`Hume job ${jobId} did not complete within polling window`);
}

// --- Extraction ---

function topEmotions(emotions: HumePredictionEmotion[], limit = 10): HumeEmotionScore[] {
  if (!emotions || emotions.length === 0) return [];
  const sorted = [...emotions].sort((a, b) => b.score - a.score);
  return sorted.slice(0, limit).map((e) => ({
    name: e.name,
    score: Math.round(e.score * 1000) / 1000,
  }));
}

function extractResults(data: HumePredictionResult[]): HumeAnalysisResult {
  const result: HumeAnalysisResult = { languageEmotions: [], faceEmotions: [] };

  try {
    for (const item of data) {
      const preds = item?.results?.predictions ?? [];
      for (const pred of preds) {
        // Language
        const langGroups = pred?.models?.language?.grouped_predictions ?? [];
        for (const g of langGroups) {
          const allLang = (g.predictions ?? []).flatMap((p) => p.emotions ?? []);
          if (allLang.length > 0 && result.languageEmotions.length === 0) {
            result.languageEmotions = topEmotions(allLang);
          }
        }
        // Face
        const faceGroups = pred?.models?.face?.grouped_predictions ?? [];
        for (const g of faceGroups) {
          const allFace = (g.predictions ?? []).flatMap((p) => p.emotions ?? []);
          if (allFace.length > 0 && result.faceEmotions.length === 0) {
            result.faceEmotions = topEmotions(allFace);
          }
        }
      }
    }
  } catch {
    // partial results are fine
  }

  return result;
}

// --- Public API ---

export async function analyzeWithHume(
  transcript: string,
  faceImageBase64?: string
): Promise<HumeAnalysisResult | null> {
  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) {
    console.log("[humeClient] No HUME_API_KEY — using lexical fallback");
    return null;
  }

  try {
    const hasFace = faceImageBase64 && faceImageBase64.length > 100;

    const jobId = hasFace
      ? await startTextAndFaceJob(apiKey, transcript, faceImageBase64)
      : await startTextOnlyJob(apiKey, transcript);

    console.log(`[humeClient] Job started (${hasFace ? "text+face" : "text"}): ${jobId}`);

    const raw = await pollJob(apiKey, jobId);
    const results = extractResults(raw);

    console.log(
      `[humeClient] Language: ${results.languageEmotions
        .slice(0, 3)
        .map((e) => `${e.name}=${e.score}`)
        .join(", ")} | Face: ${results.faceEmotions
        .slice(0, 3)
        .map((e) => `${e.name}=${e.score}`)
        .join(", ") || "none"}`
    );

    return results.languageEmotions.length > 0 || results.faceEmotions.length > 0
      ? results
      : null;
  } catch (err) {
    console.error(`[humeClient] Error: ${err}`);
    return null;
  }
}
