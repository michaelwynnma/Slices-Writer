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

/** Extract text from either Anthropic or OpenAI/GLM response format */
function extractText(data: unknown): string {
  const d = data as Record<string, unknown>;
  const anthropic = (d.content as Array<{ text?: string }>)?.[0]?.text;
  if (anthropic) return anthropic;
  const openai = (d.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content;
  return openai ?? '';
}

/**
 * Ask GLM to assign a gender (male/female) to each unique speaker based on
 * the dialogue context. Returns a Map of speaker → gender.
 * Used to keep image visuals and TTS voices consistent.
 */
export async function determineSpeakerGenders(
  lines: Array<{ speaker: string; eng: string }>,
  apiKey?: string,
): Promise<Map<string, 'male' | 'female'>> {
  const uniqueSpeakers = [...new Set(lines.map(l => l.speaker).filter(Boolean))];
  if (!uniqueSpeakers.length) return new Map();

  const dialogueText = lines.slice(0, 12).map(l => `${l.speaker}: ${l.eng}`).join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

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
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `Read this dialogue and decide whether each speaker is male or female. Use context clues (role, name, conversation). Output ONLY valid JSON, no explanation: {"Speaker1": "male", "Speaker2": "female"}\n\nSpeakers to classify: ${uniqueSpeakers.join(', ')}\n\nDialogue:\n${dialogueText}`,
        }],
      }),
    });
    clearTimeout(timer);

    const data = await resp.json();
    const text = extractText(data).trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return new Map();
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
    const result = new Map<string, 'male' | 'female'>();
    for (const [speaker, gender] of Object.entries(parsed)) {
      if (gender === 'male' || gender === 'female') result.set(speaker, gender);
    }
    console.log('[dialogueGenders] GLM assigned:', Object.fromEntries(result));
    return result;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[dialogueGenders] GLM call failed, falling back to local detection:', e);
    return new Map();
  }
}

/**
 * Ask Claude to generate a vivid image prompt from dialogue lines.
 * Accepts pre-determined speaker genders so the prompt explicitly uses
 * the correct gender for each character (ensuring image matches TTS voices).
 */
async function buildScenePrompt(
  lines: Array<{ speaker: string; eng: string }>,
  apiKey?: string,
  speakerGenders?: Map<string, 'male' | 'female'>,
): Promise<string> {
  const dialogueText = lines
    .map(l => `${l.speaker ? l.speaker + ': ' : ''}${l.eng}`)
    .join('\n');

  // Build a gender hint string so the image prompt uses correct pronouns
  let genderHint = '';
  if (speakerGenders && speakerGenders.size > 0) {
    const hints = [...speakerGenders.entries()].map(([s, g]) => `${s} is ${g}`).join(', ');
    genderHint = `\n\nCharacter genders: ${hints}. Make sure the image reflects these genders accurately.`;
  }

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
          content: `Based on this English dialogue, write a single vivid image generation prompt (max 80 words) describing the scene. Focus on: setting/location, characters' appearance and actions, mood/atmosphere. Make it photorealistic and suitable for an English teaching slide. Output ONLY the prompt, no explanation.\n\nDialogue:\n${dialogueText}${genderHint}`,
        }],
      }),
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.warn(`Claude scene prompt API error ${resp.status}, using fallback prompt`);
      return buildFallbackPrompt(lines);
    }

    const data = await resp.json();
    const text = extractText(data).trim();
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
 * Accepts pre-determined speaker genders so the scene prompt reflects them.
 * Retries up to 3 times on failure (handles transient 503s).
 * Returns image Buffer or null if all attempts fail.
 */
export async function generateDialogueSceneImage(
  lines: Array<{ speaker: string; eng: string }>,
  apiKey?: string,
  speakerGenders?: Map<string, 'male' | 'female'>,
): Promise<Buffer | null> {
  if (!lines.length) return null;
  const prompt = await buildScenePrompt(lines, apiKey, speakerGenders);
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
