import { httpRouter, httpActionGeneric } from "convex/server";
import { runIngest, type IngestBody } from "./sentimentEngine";
import { analyzeWithHume } from "./humeClient";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const http = httpRouter();

http.route({
  path: "/socialsync/ingest",
  method: "OPTIONS",
  handler: httpActionGeneric(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

http.route({
  path: "/socialsync/ingest",
  method: "POST",
  handler: httpActionGeneric(async (_ctx, request) => {
    let body: IngestBody;
    try {
      body = (await request.json()) as IngestBody;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!body.transcript || typeof body.transcript !== "string") {
      return json({ error: "transcript is required" }, 400);
    }

    // Call Hume with text + optional face image
    const hume = await analyzeWithHume(body.transcript, body.faceImageBase64);
    if (hume) {
      body.humeLanguageEmotions = hume.languageEmotions;
      body.humeFaceEmotions = hume.faceEmotions;
    }

    // Don't send the big base64 string through to the result
    delete body.faceImageBase64;

    const result = runIngest(body);
    return json({ ok: true, ...result });
  }),
});

export default http;
