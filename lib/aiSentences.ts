/**
 * aiSentences.ts
 * Calls Claude via the Anthropic Messages API to generate 2 example sentences
 * per vocabulary word, each with a Chinese translation, plus word-level
 * color alignment between English tokens and their Chinese equivalents.
 */

/** One aligned pair: an English token + its Chinese equivalent */
export interface AlignedPair {
  en: string;   // English token (word or punctuation chunk)
  zh: string;   // Corresponding Chinese token(s)
  color: string; // Hex color (no #), assigned after alignment
}

export interface WordSentences {
  word: string;
  sentence1: string;
  sentence1_zh: string;
  sentence2: string;
  sentence2_zh: string;
  /** Word-level color alignment for sentence 1 (populated by alignSentences) */
  sentence1_aligned?: AlignedPair[];
  /** Word-level color alignment for sentence 2 */
  sentence2_aligned?: AlignedPair[];
}

const API_KEY  = process.env.CLAUDE_API_KEY  ?? 'sk-internal-294b0f9a658d474f91615ccd';
const BASE_URL = process.env.CLAUDE_BASE_URL ?? 'https://api-aigw.corp.hongsong.club/v1';
const MODEL    = process.env.CLAUDE_MODEL    ?? 'glm-5.1';

/** Extract text from either Anthropic or OpenAI/GLM response format */
function extractText(data: unknown): string {
  const d = data as Record<string, unknown>;
  // Anthropic format: { content: [{ text: "..." }] }
  const anthropic = (d.content as Array<{ text?: string }>)?.[0]?.text;
  if (anthropic) return anthropic;
  // OpenAI / GLM format: { choices: [{ message: { content: "..." } }] }
  const openai = (d.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content;
  return openai ?? '';
}

function buildPrompt(words: string[]): string {
  const list = words.map((w, i) => `${i + 1}. ${w}`).join('\n');
  return `You are an ESL material writer for Chinese adult learners at CEFR A2-B1 level.

For each word below, write exactly 2 short, natural English example sentences. For each sentence, also provide a natural Chinese translation.

Rules:
- Each English sentence MUST contain the target word or a regular inflection (plural, -ing, -ed, -s). Do NOT use a synonym.
- Sentences should be simple and about everyday topics.
- Chinese translations should be natural, not word-for-word.
- Output ONLY valid JSON — an array of objects. No markdown, no extra text.

Words:
${list}

Output format (exactly this structure):
[
  {
    "word": "barber",
    "sentence1": "My barber always gives me a great haircut.",
    "sentence1_zh": "我的理发师总是给我剪出很棒的发型。",
    "sentence2": "There are two barbers working at that shop.",
    "sentence2_zh": "那家店里有两位理发师在工作。"
  }
]`;
}

export async function generateSentencesForWords(words: string[], apiKey?: string): Promise<WordSentences[]> {
  if (!words.length) return [];

  const BATCH = 10;
  const key = apiKey ?? API_KEY;

  // Build all batch slices
  const batches: string[][] = [];
  for (let i = 0; i < words.length; i += BATCH) {
    batches.push(words.slice(i, i + BATCH));
  }

  // Fire all batches in parallel
  const settled = await Promise.allSettled(
    batches.map(async batch => {
      const prompt = buildPrompt(batch);
      const response = await fetch(`${BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const raw = extractText(data);
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error(`Unexpected Claude response (no JSON array found): ${raw.substring(0, 200)}`);
      }
      return JSON.parse(jsonMatch[0]) as WordSentences[];
    })
  );

  const results: WordSentences[] = [];
  settled.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      results.push(...r.value);
    } else {
      console.warn(`Sentence generation batch ${idx + 1} failed:`, r.reason);
    }
  });

  return results;
}

// ─── Word-level color alignment ────────────────────────────────────────────────

/** Full color pool (no #) */
const ALIGN_COLORS = [
  'FF6247', 'FE9A2E', 'FAC006',
  '32CD32', '00D643', '2E8B57', '749258',
  '00CED1', '1E90FE', '6A5ACD',
  'A676FE', 'CA27FF', 'FF1493', 'E85A66',
  'FE8666', 'FD3E01', 'B0B673', '12B0B5', '8A2BE2',
];

/**
 * Local fallback alignment: splits English by spaces and distributes
 * Chinese characters evenly. Always produces rainbow colors even when
 * the API is unavailable.
 */
function localFallbackAlignment(pairs: Array<{ eng: string; zh: string }>): AlignedPair[][] {
  return pairs.map(({ eng, zh }) => {
    const enTokens = eng.trim().split(/\s+/).filter(Boolean);
    if (!enTokens.length) return [];
    const zhChars = [...zh]; // split into Unicode characters
    const chunkSize = Math.ceil(zhChars.length / enTokens.length);
    let lastColor = '';
    return enTokens.map((token, i) => {
      let color: string;
      do {
        color = ALIGN_COLORS[Math.floor(Math.random() * ALIGN_COLORS.length)];
      } while (color === lastColor && ALIGN_COLORS.length > 1);
      lastColor = color;
      return {
        en: token,
        zh: zhChars.slice(i * chunkSize, (i + 1) * chunkSize).join(''),
        color,
      };
    });
  });
}

function buildAlignPrompt(pairs: Array<{ eng: string; zh: string }>): string {
  const items = pairs
    .map((p, i) => `${i + 1}. English: "${p.eng}" | Chinese: "${p.zh}"`)
    .join('\n');

  return `You are a bilingual NLP assistant. For each English-Chinese sentence pair below, produce a word-level alignment: split the English into meaningful tokens (words, keeping punctuation attached to the preceding word) and match each token to its Chinese equivalent chunk.

Rules:
- Cover the ENTIRE English sentence — every word/token must appear in exactly one pair.
- Cover the ENTIRE Chinese sentence — every Chinese character/word must appear in exactly one pair.
- Keep tokens as granular as possible (one English word → its Chinese equivalent).
- For function words with no direct Chinese equivalent, pair them with the nearest related Chinese chunk or use "" for zh.
- Output ONLY valid JSON — an array of arrays (one array per sentence pair). No markdown, no extra text.

Sentence pairs:
${items}

Output format (example for "I have a cat." / "我有一只猫。"):
[
  [
    {"en": "I", "zh": "我"},
    {"en": "have", "zh": "有"},
    {"en": "a", "zh": "一只"},
    {"en": "cat.", "zh": "猫。"}
  ]
]`;
}

/**
 * Calls Claude to produce word-level alignment for an array of sentence pairs,
 * then assigns sequential colors from the pool to each aligned pair.
 */
export async function alignSentences(
  pairs: Array<{ eng: string; zh: string }>,
  apiKey?: string,
): Promise<AlignedPair[][]> {
  if (!pairs.length) return [];

  const key = apiKey ?? API_KEY;
  const prompt = buildAlignPrompt(pairs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000); // 20s timeout

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude align API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const raw = extractText(data);
  console.log(`[alignSentences] Input pairs: ${pairs.length}, raw response length: ${raw.length}`);
  console.log(`[alignSentences] Raw preview: ${raw.substring(0, 300)}`);

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Unexpected alignment response: ${raw.substring(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as Array<Array<{ en: string; zh: string }>>;
  console.log(`[alignSentences] Parsed alignment arrays: ${parsed.length} (expected ${pairs.length})`);

  // Assign colors randomly, ensuring no two adjacent tokens share the same color
  return parsed.map(tokens => {
    let lastColor = '';
    return tokens.map(t => {
      let color: string;
      do {
        color = ALIGN_COLORS[Math.floor(Math.random() * ALIGN_COLORS.length)];
      } while (color === lastColor && ALIGN_COLORS.length > 1);
      lastColor = color;
      return { en: t.en, zh: t.zh, color };
    });
  });
}

/**
 * Attempt alignSentences with up to `retries` retries on failure.
 */
async function alignSentencesWithRetry(
  pairs: Array<{ eng: string; zh: string }>,
  retries = 3,
  apiKey?: string,
): Promise<AlignedPair[][]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await alignSentences(pairs, apiKey);
      return result;
    } catch (e) {
      lastError = e;
      console.warn(`Alignment attempt ${attempt}/${retries} failed:`, e);
      if (attempt < retries) {
        // Short delay before retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  // All retries exhausted — use local word-split fallback so rainbow colors always render
  console.warn(`Alignment API failed after ${retries} retries, using local fallback for ${pairs.length} pairs`);
  return localFallbackAlignment(pairs);
}

/**
 * Enriches WordSentences with alignment data for both sentences.
 * Makes a SINGLE batched Claude API call for ALL words at once to avoid
 * rate-limiting from sequential per-word calls.
 * Retries up to 2 times on failure, then falls back gracefully per-word.
 */
export async function enrichWithAlignment(
  items: WordSentences[],
  apiKey?: string,
): Promise<WordSentences[]> {
  if (!items.length) return items;

  // Build a flat list of all sentence pairs: [s1_word0, s2_word0, s1_word1, s2_word1, ...]
  const allPairs: Array<{ eng: string; zh: string }> = [];
  for (const ws of items) {
    allPairs.push({ eng: ws.sentence1, zh: ws.sentence1_zh });
    allPairs.push({ eng: ws.sentence2, zh: ws.sentence2_zh });
  }

  const expectedCount = items.length * 2;
  let allAligned: AlignedPair[][] = [];

  try {
    allAligned = await alignSentencesWithRetry(allPairs, 2, apiKey);
  } catch (e) {
    console.warn(`Bulk alignment failed after retries, falling back to plain colors:`, e);
    return items;
  }

  // Validate: if Claude returned fewer arrays than expected, some words got cut off.
  if (allAligned.length < expectedCount) {
    console.warn(
      `Alignment returned ${allAligned.length} arrays, expected ${expectedCount}. ` +
      `Some words will use fallback colors.`
    );
  }

  // Map results back: every 2 entries → one word's sentence1 + sentence2
  return items.map((ws, i) => ({
    ...ws,
    sentence1_aligned: allAligned[i * 2]?.length ? allAligned[i * 2] : undefined,
    sentence2_aligned: allAligned[i * 2 + 1]?.length ? allAligned[i * 2 + 1] : undefined,
  }));
}

/**
 * Align dialogue lines in batches of 2 to avoid token limit issues.
 * Returns array of AlignedPair[] (one per line), or empty array on failure.
 */
export async function alignDialogueLines(
  lines: Array<{ eng: string; zh: string }>,
  apiKey?: string,
): Promise<AlignedPair[][]> {
  if (!lines.length) return [];

  const BATCH = 2;

  // Build all batch slices
  const batches: Array<Array<{ eng: string; zh: string }>> = [];
  for (let i = 0; i < lines.length; i += BATCH) {
    batches.push(lines.slice(i, i + BATCH));
  }

  // Fire all batches in parallel
  const settled = await Promise.allSettled(
    batches.map((batch, idx) =>
      alignSentencesWithRetry(batch, 3, apiKey).catch(e => {
        console.warn(`Dialogue alignment batch ${idx + 1} failed:`, e);
        return batch.map(() => []) as AlignedPair[][];
      })
    )
  );

  const results: AlignedPair[][] = [];
  settled.forEach((r, idx) => {
    const aligned = r.status === 'fulfilled' ? r.value : batches[idx].map(() => [] as AlignedPair[]);
    while (aligned.length < batches[idx].length) aligned.push([]);
    results.push(...aligned);
  });

  return results;
}

/**
 * Align key sentences in batches of 2 to avoid token limit issues.
 * Returns array of AlignedPair[] (one per sentence), or empty array on failure.
 */
export async function alignKeySentences(
  sentences: Array<{ eng: string; zh: string }>,
  apiKey?: string,
): Promise<AlignedPair[][]> {
  if (!sentences.length) return [];

  const BATCH = 2;

  // Build all batch slices
  const batches: Array<Array<{ eng: string; zh: string }>> = [];
  for (let i = 0; i < sentences.length; i += BATCH) {
    batches.push(sentences.slice(i, i + BATCH));
  }

  // Fire all batches in parallel
  const settled = await Promise.allSettled(
    batches.map((batch, idx) =>
      alignSentencesWithRetry(batch, 3, apiKey).catch(e => {
        console.warn(`Key sentence alignment batch ${idx + 1} failed:`, e);
        return batch.map(() => []) as AlignedPair[][];
      })
    )
  );

  const results: AlignedPair[][] = [];
  settled.forEach((r, idx) => {
    const aligned = r.status === 'fulfilled' ? r.value : batches[idx].map(() => [] as AlignedPair[]);
    while (aligned.length < batches[idx].length) aligned.push([]);
    results.push(...aligned);
  });

  return results;
}
