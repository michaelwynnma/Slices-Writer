/**
 * dialogueImage.ts
 * Generates a scene illustration for a dialogue using Nano Banana image API.
 *
 * 1. Uses Claude to summarize dialogue lines into a vivid scene description prompt
 * 2. Calls Nano Banana (gemini-3.1-flash-image-preview) to generate the image
 * 3. Returns the image as a Buffer
 */

const CLAUDE_API_KEY  = process.env.CLAUDE_API_KEY  ?? 'sk-internal-294b0f9a658d474f91615ccd';
const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL ?? 'https://api-aigw.corp.hongsong.club/v1';
const CLAUDE_MODEL    = process.env.CLAUDE_MODEL    ?? 'glm-5.1';

const IMAGE_API_KEY   = process.env.HSAI_API_KEY    ?? 'sk-internal-294b0f9a658d474f91615ccd';
const IMAGE_BASE_URL  = 'https://api-aigw.corp.hongsong.club/v1beta/models';
const IMAGE_MODEL     = 'gemini-3.1-flash-image-preview'; // nano2

/**
 * Ask Claude to generate a vivid image prompt from dialogue lines.
 */
async function buildScenePrompt(lines: Array<{ speaker: string; eng: string }>, apiKey?: string): Promise<string> {
  const dialogueText = lines
    .map(l => `${l.speaker ? l.speaker + ': ' : ''}${l.eng}`)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(`${CLAUDE_BASE_URL}/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Based on this English dialogue, write a single vivid image generation prompt (max 80 words) describing the scene. Focus on: setting/location, characters' appearance and actions, mood/atmosphere. Make it photorealistic and suitable for an English teaching slide. Output ONLY the prompt, no explanation.\n\nDialogue:\n${dialogueText}`,
        }],
      }),
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`Claude scene prompt API error ${resp.status}, using fallback prompt`);
      return buildFallbackPrompt(lines);
    }

    const data = await resp.json() as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text?.trim();
    if (!text) return buildFallbackPrompt(lines);
    console.log(`[dialogueImage] Scene prompt: "${text.slice(0, 80)}..."`);
    return text;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[dialogueImage] Claude scene prompt failed:', e);
    return buildFallbackPrompt(lines);
  }
}

function buildFallbackPrompt(lines: Array<{ speaker: string; eng: string }>): string {
  const names = [...new Set(lines.map(l => l.speaker).filter(Boolean))];
  const firstLine = lines[0]?.eng ?? '';
  return `Two people having a conversation. ${names.length >= 2 ? names[0] + ' and ' + names[1] + ' talking. ' : ''}Scene: ${firstLine}. Photorealistic, bright lighting, natural setting.`;
}

/**
 * Call Nano Banana image API using the correct Gemini-style payload.
 * Returns the image as a Buffer, or null on failure.
 */
async function generateImageFromPrompt(prompt: string, apiKey?: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000); // 2 min for 1K image

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: '1:1',
        imageSize: '1K',
      },
    },
  };

  try {
    console.log(`[dialogueImage] Generating image with Nano Banana...`);
    const url = `${IMAGE_BASE_URL}/${IMAGE_MODEL}:generateContent`;
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? IMAGE_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.text();
      console.warn(`[dialogueImage] Image API error ${resp.status}: ${err.slice(0, 300)}`);
      return null;
    }

    const data = await resp.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inline_data?: { mime_type?: string; data?: string };
            inlineData?:  { mimeType?: string; data?: string };
          }>
        }
      }>
    };

    // Extract first image part (snake_case or camelCase)
    for (const candidate of data.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const img = part.inline_data ?? part.inlineData;
        if (img?.data) {
          console.log('[dialogueImage] Image received, decoding...');
          return Buffer.from(img.data, 'base64');
        }
      }
    }

    console.warn('[dialogueImage] No image in Nano Banana response');
    return null;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[dialogueImage] Image generation failed:', e);
    return null;
  }
}

/**
 * Main export: generate a scene image for a dialogue.
 * Retries up to 3 times on failure (handles transient 503s).
 * Returns image Buffer or null if all attempts fail.
 */
export async function generateDialogueSceneImage(
  lines: Array<{ speaker: string; eng: string }>,
  apiKey?: string,
): Promise<Buffer | null> {
  if (!lines.length) return null;
  const prompt = await buildScenePrompt(lines, apiKey);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateImageFromPrompt(prompt, apiKey);
    if (result) return result;
    if (attempt < MAX_ATTEMPTS) {
      console.log(`[dialogueImage] Attempt ${attempt} failed, retrying in 8s...`);
      await new Promise(r => setTimeout(r, 8000));
    }
  }
  console.warn('[dialogueImage] All attempts failed, skipping scene image.');
  return null;
}
