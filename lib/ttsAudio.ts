/**
 * ttsAudio.ts
 * Generates English TTS audio (MP3) using the MiniMax TTS API (speech-2.8-hd).
 *
 * API: POST /v1/t2a_v2  →  returns JSON with hex-encoded MP3 in data.audio
 * Falls back to macOS `say` only if no API key is configured.
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

// ── MiniMax TTS API config ────────────────────────────────────────────────────
const TTS_API_KEY  = process.env.TTS_API_KEY  ?? 'sk-internal-294b0f9a658d474f91615ccd';
const TTS_BASE_URL = process.env.TTS_BASE_URL ?? 'https://api-aigw.corp.hongsong.club/v1';
const TTS_MODEL    = process.env.TTS_MODEL    ?? 'speech-2.8-hd';
const TTS_VOICE    = process.env.TTS_VOICE    ?? 'English_expressive_narrator';

// Audio settings
const TTS_SAMPLE_RATE = 32000;
const TTS_BITRATE     = 128000;
const TTS_FORMAT      = 'mp3';
const TTS_CHANNEL     = 1;

// ── macOS fallback config ─────────────────────────────────────────────────────
const SAY_VOICE = process.env.SAY_VOICE ?? 'Samantha';

// ── Voice pools for dialogue gender matching ──────────────────────────────────
const FEMALE_VOICES = [
  'Wise_Woman',
  'Calm_Woman',
];
const MALE_VOICES = [
  'Deep_Voice_Man',
  'Elegant_Man',
  'English_expressive_narrator',
  'Friendly_Person',
];
const ALL_VOICES = [...FEMALE_VOICES, ...MALE_VOICES];

// Common female/male name lists for gender detection
const FEMALE_NAMES = new Set([
  'alice','emma','olivia','sophia','isabella','ava','mia','charlotte','amelia','harper',
  'emily','abigail','elizabeth','ella','lily','grace','chloe','victoria','aria','scarlett',
  'jessica','sarah','jennifer','ashley','amanda','stephanie','melissa','nicole','hannah',
  'anna','mary','lucy','laura','kate','karen','helen','diana','linda','patricia','barbara',
  'susan','margaret','betty','sandra','donna','carol','ruth','sharon','lisa','nancy',
  'betty','dorothy','emily','evelyn','julia','rachel','samantha','amy','angela','brenda',
  'wendy','amy','claire','zoe','natalie','madison','aubrey','brooklyn','leah','alexa',
  'aisha','fatima','mei','yuki','sakura','ling','yan','fang','min','xiao',
]);
const MALE_NAMES = new Set([
  'robert','james','john','michael','william','david','richard','joseph','thomas','charles',
  'christopher','daniel','matthew','anthony','mark','donald','steven','paul','andrew','joshua',
  'kevin','brian','george','timothy','ronald','edward','jason','jeffrey','ryan','jacob',
  'gary','nicholas','eric','jonathan','stephen','larry','justin','scott','brandon','benjamin',
  'samuel','raymond','gregory','frank','alexander','patrick','jack','dennis','jerry','tyler',
  'aaron','jose','adam','henry','nathan','douglas','zachary','peter','kyle','walter',
  'ethan','jeremy','harold','terry','sean','arthur','christian','roger','liam','noah',
  'oliver','elijah','lucas','mason','logan','aiden','carter','owen','leo','julian',
  'wei','lei','ming','zhang','li','wang','chen','liu','yang','huang','zhao','wu',
  'tom','bob','bill','jim','joe','sam','ben','dan','dave','mike','chris','alex',
]);

// Role keyword lists for gender detection of non-name speakers
const FEMALE_ROLES = new Set([
  'waitress','hostess','stewardess','actress','empress','duchess','countess','princess',
  'queen','dame','lady','madam','madame','miss','mrs','ms',
  'nurse','midwife','nanny','maid','housekeeper','babysitter',
  'mother','mom','mum','grandmother','grandma','granny','aunt','auntie','sister','daughter',
  'girlfriend','wife','bride','widow',
  'saleswoman','businesswoman','policewoman','congresswoman','chairwoman','spokeswoman',
  'female','woman','girl',
]);
const MALE_ROLES = new Set([
  'waiter','host','steward','actor','emperor','duke','count','prince',
  'king','sir','lord','mister','mr',
  'doctor','dr','surgeon','dentist','pharmacist','professor','teacher','instructor',
  'father','dad','grandfather','grandpa','uncle','brother','son',
  'boyfriend','husband','groom','widower',
  'barber','chef','cook','baker','butcher','mechanic','plumber','carpenter','electrician',
  'driver','pilot','captain','officer','detective','agent','soldier','guard','officer',
  'policeman','fireman','salesman','businessman','congressman','chairman','spokesman',
  'male','man','boy',
  'passenger','customer','client','student','employee','worker','staff','clerk','agent',
  'receptionist','attendant','assistant','manager','supervisor','director','officer',
]);

/**
 * Detect gender from a speaker name or role keyword.
 * Checks: (1) known name lists, (2) role keyword lists.
 * Returns 'female', 'male', or 'unknown'.
 */
export function detectGender(name: string): 'female' | 'male' | 'unknown' {
  const lower = name.toLowerCase().trim();
  // Check name lists first (most reliable)
  if (FEMALE_NAMES.has(lower)) return 'female';
  if (MALE_NAMES.has(lower))   return 'male';
  // Check role keywords — match any word in a multi-word label (e.g. "Flight Attendant")
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (FEMALE_ROLES.has(word)) return 'female';
    if (MALE_ROLES.has(word))   return 'male';
  }
  return 'unknown';
}

/**
 * Pick a consistent voice for a speaker.
 * Female → random from FEMALE_VOICES; Male → random from MALE_VOICES.
 * Unknown → default female pool (safer assumption).
 * Uses speaker name as seed so same name always gets same voice within a session.
 */
export function pickVoiceForSpeaker(name: string): string {
  const gender = detectGender(name);
  const pool = gender === 'male' ? MALE_VOICES : FEMALE_VOICES;
  // Deterministic pick based on name hash so same speaker = same voice
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}

/** Check once at startup what audio converter is available (for fallback) */
function detectConverter(): 'lame' | 'ffmpeg' | 'none' {
  try { execSync('which lame',   { stdio: 'ignore' }); return 'lame';   } catch {}
  try { execSync('which ffmpeg', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return 'none';
}
const CONVERTER = detectConverter();

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate TTS via the MiniMax /v1/t2a_v2 endpoint using fetch.
 * Returns a Buffer containing MP3, or null on failure.
 */
async function generateTTSViaAPI(text: string, voice?: string, ttsApiKey?: string): Promise<Buffer | null> {
  const endpoint = `${TTS_BASE_URL.replace(/\/$/, '')}/t2a_v2`;
  const body = JSON.stringify({
    model: TTS_MODEL,
    text: text.trim(),
    stream: false,
    language_boost: 'English',
    output_format: 'hex',
    voice_setting: {
      voice_id: voice ?? TTS_VOICE,
      speed: 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: TTS_SAMPLE_RATE,
      bitrate: TTS_BITRATE,
      format: TTS_FORMAT,
      channel: TTS_CHANNEL,
    },
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      console.warn('TTS API request timed out after 90s');
    }, 90_000);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ttsApiKey ?? TTS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const json = await res.json() as {
      data?: { audio?: string };
      base_resp?: { status_code?: number; status_msg?: string };
    };

    if (json?.base_resp?.status_code !== 0) {
      console.warn(`TTS API error: code=${json?.base_resp?.status_code} msg=${json?.base_resp?.status_msg ?? 'unknown'}`);
      return null;
    }

    const audioHex = json?.data?.audio;
    if (!audioHex) {
      console.warn('TTS API: no audio in response, keys:', Object.keys(json?.data ?? {}));
      return null;
    }

    // MiniMax returns audio as hex-encoded string (not base64)
    return Buffer.from(audioHex, 'hex');
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('TTS API aborted (timeout)');
    } else {
      console.warn('TTS API fetch error:', err);
    }
    return null;
  }
}


/**
 * Fallback: generate TTS using macOS `say` command.
 */
async function generateTTSViaSay(text: string): Promise<Buffer | null> {
  const id = crypto.randomBytes(6).toString('hex');
  const tmpDir = os.tmpdir();
  const aiffPath = path.join(tmpDir, `tts_${id}.aiff`);
  const mp3Path  = path.join(tmpDir, `tts_${id}.mp3`);

  try {
    const sayResult = spawnSync('say', [
      '-v', SAY_VOICE,
      '-r', '175',
      '-o', aiffPath,
      text.trim(),
    ], { timeout: 15000 });

    if (sayResult.status !== 0 || !fs.existsSync(aiffPath)) {
      console.warn(`TTS say failed for: "${text.substring(0, 50)}"`);
      return null;
    }

    if (CONVERTER === 'lame') {
      spawnSync('lame', ['--quiet', aiffPath, mp3Path], { timeout: 10000 });
    } else if (CONVERTER === 'ffmpeg') {
      spawnSync('ffmpeg', ['-y', '-i', aiffPath, '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path], { timeout: 10000 });
    }

    const outputPath = (CONVERTER !== 'none' && fs.existsSync(mp3Path)) ? mp3Path : aiffPath;
    return fs.readFileSync(outputPath);
  } catch (err) {
    console.warn(`TTS say generation failed for "${text.substring(0, 50)}":`, err);
    return null;
  } finally {
    try { if (fs.existsSync(aiffPath)) fs.unlinkSync(aiffPath); } catch {}
    try { if (fs.existsSync(mp3Path))  fs.unlinkSync(mp3Path);  } catch {}
  }
}

/**
 * Generate TTS audio for a single sentence.
 * Retries up to 3 times with 3s/6s/9s delays on failure.
 * Falls back to macOS `say` only if no API key configured.
 */
export async function generateTTS(text: string, voice?: string, ttsApiKey?: string): Promise<Buffer | null> {
  if (!text || !text.trim()) return null;

  if (ttsApiKey || TTS_API_KEY) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        const delay = 3000 * (attempt - 1);
        console.warn(`TTS retry ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      const result = await generateTTSViaAPI(text, voice, ttsApiKey);
      if (result && result.length > 0) return result;
    }
    console.warn('TTS API failed after all retries, skipping audio for this sentence');
    return null;
  }

  // No API key — fallback to local say
  return generateTTSViaSay(text);
}

export interface SentenceAudio {
  sentence1: Buffer | null;
  sentence2: Buffer | null;
}

/**
 * Generate TTS audio for both sentences of a vocabulary word.
 */
export async function generateWordAudio(
  sentence1: string,
  sentence2: string,
  voice?: string,
  ttsApiKey?: string,
): Promise<SentenceAudio> {
  const [s1, s2] = await Promise.all([
    generateTTS(sentence1, voice, ttsApiKey),
    generateTTS(sentence2, voice, ttsApiKey),
  ]);
  return { sentence1: s1, sentence2: s2 };
}

/**
 * Generate TTS for all word sentences. Returns map: word → SentenceAudio.
 * Each word gets a RANDOM voice from the full pool.
 * All words are processed concurrently via Promise.allSettled.
 */
export async function generateAllWordAudio(
  wordSentences: Array<{ word: string; sentence1: string; sentence2: string }>,
  _voice?: string, // ignored — random voice used per word
  ttsApiKey?: string,
): Promise<Map<string, SentenceAudio>> {
  const result = new Map<string, SentenceAudio>();

  const settled = await Promise.allSettled(
    wordSentences.map((ws) => {
      const randomVoice = ALL_VOICES[Math.floor(Math.random() * ALL_VOICES.length)];
      return generateWordAudio(ws.sentence1, ws.sentence2, randomVoice, ttsApiKey);
    }),
  );

  settled.forEach((outcome, i) => {
    const ws = wordSentences[i];
    if (outcome.status === 'fulfilled') {
      result.set(ws.word.toLowerCase(), outcome.value);
    } else {
      console.warn(`TTS failed for word "${ws.word}":`, outcome.reason);
      result.set(ws.word.toLowerCase(), { sentence1: null, sentence2: null });
    }
  });

  return result;
}

/**
 * Generate TTS audio for key sentences. Returns array of Buffer | null (one per sentence).
 * Each sentence gets a RANDOM voice from the full pool.
 * All sentences are processed concurrently via Promise.allSettled.
 */
export async function generateKeySentenceAudio(
  sentences: Array<{ eng: string }>,
  _voice?: string, // ignored — random voice used per sentence
  ttsApiKey?: string,
): Promise<Array<Buffer | null>> {
  const settled = await Promise.allSettled(
    sentences.map((s) => {
      // Strip leading "Speaker: " prefix (e.g. "Passenger: Hello" → "Hello")
      const text = s.eng.replace(/^[A-Za-z][A-Za-z ]{0,30}:\s*/, '');
      console.log(`[keySentenceAudio] eng="${s.eng}" → tts="${text}"`);
      const randomVoice = ALL_VOICES[Math.floor(Math.random() * ALL_VOICES.length)];
      return generateTTS(text, randomVoice, ttsApiKey);
    }),
  );

  return settled.map((outcome) => {
    if (outcome.status === 'fulfilled') return outcome.value ?? null;
    console.warn('TTS failed for key sentence:', outcome.reason);
    return null;
  });
}

/**
 * Generate TTS audio for dialogue lines.
 * Voice assignment priority:
 *   1. AI-determined genders (speakerGenders, shared with scene image) — highest authority
 *   2. Known name (FEMALE_NAMES / MALE_NAMES) or role keyword (FEMALE_ROLES / MALE_ROLES)
 *   3. Truly unknown → alternate male/female by first-appearance order
 * Same speaker name always gets the same voice within a dialogue.
 * All lines are processed concurrently via Promise.allSettled.
 * TTS reads only the English sentence — NOT the speaker name.
 */
export async function generateDialogueAudio(
  lines: Array<{ speaker: string; eng: string }>,
  userVoice?: string,
  ttsApiKey?: string,
  speakerGenders?: Map<string, 'male' | 'female'>,
): Promise<Array<{ audio: Buffer | null; voice: string }>> {
  // Pre-compute voices deterministically so they are stable before fan-out.
  // Priority: AI-assigned > name/role detection > alternating fallback.
  const unknownSpeakerOrder: string[] = [];   // insertion-ordered unique unknown speakers
  const speakerVoiceCache = new Map<string, string>(); // speaker → assigned voice

  function hashVoice(name: string, pool: string[]): string {
    let hash = 0;
    for (let c = 0; c < name.length; c++) hash = (hash * 31 + name.charCodeAt(c)) >>> 0;
    return pool[hash % pool.length];
  }

  // Resolve effective gender: AI-assigned > local detection
  function resolveGender(speaker: string): 'male' | 'female' | 'unknown' {
    if (speakerGenders?.has(speaker)) return speakerGenders.get(speaker)!;
    return detectGender(speaker);
  }

  // First pass: collect truly-unknown speakers (unknown after AI + local detection)
  for (const line of lines) {
    const gender = resolveGender(line.speaker);
    if (gender === 'unknown' && !speakerVoiceCache.has(line.speaker) && !unknownSpeakerOrder.includes(line.speaker)) {
      unknownSpeakerOrder.push(line.speaker);
    }
  }

  // Assign alternating genders to truly-unknown speakers (0→female, 1→male, 2→female, …)
  unknownSpeakerOrder.forEach((speaker, idx) => {
    const pool = idx % 2 === 0 ? FEMALE_VOICES : MALE_VOICES;
    speakerVoiceCache.set(speaker, hashVoice(speaker, pool));
  });

  // Second pass: assign final voice per line
  const voices: string[] = lines.map((line) => {
    if (speakerVoiceCache.has(line.speaker)) {
      return speakerVoiceCache.get(line.speaker)!;
    }
    const gender = resolveGender(line.speaker);
    const voice = gender === 'male'
      ? hashVoice(line.speaker, MALE_VOICES)
      : hashVoice(line.speaker, FEMALE_VOICES);
    speakerVoiceCache.set(line.speaker, voice);
    return voice;
  });

  console.log('[dialogueAudio] speaker→voice map:', Object.fromEntries(speakerVoiceCache));

  const settled = await Promise.allSettled(
    lines.map((line, i) => {
      // Strip any accidental "Speaker: " prefix from the English text
      const text = line.eng.replace(/^[A-Za-z][A-Za-z ]{0,30}:\s*/, '');
      console.log(`[dialogueAudio] line ${i}: speaker="${line.speaker}" eng="${line.eng}" → tts="${text}"`);
      return generateTTS(text, voices[i], ttsApiKey);
    }),
  );

  return settled.map((outcome, i) => ({
    audio: outcome.status === 'fulfilled' ? (outcome.value ?? null) : null,
    voice: voices[i],
  }));
}

/**
 * Concatenate multiple MP3 buffers into a single MP3 using ffmpeg.
 * Adds a short silence (0.5s) between each line for natural pacing.
 * Returns null if ffmpeg is unavailable or all inputs are null.
 */
export async function concatenateDialogueAudio(
  audioBuffers: Array<Buffer | null>,
): Promise<Buffer | null> {
  const valid = audioBuffers.filter((b): b is Buffer => b !== null && b.length > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const tmpDir = os.tmpdir();
  const tag = crypto.randomBytes(6).toString('hex');
  const inputFiles: string[] = [];
  const listFile = path.join(tmpDir, `dlg_list_${tag}.txt`);
  const outFile  = path.join(tmpDir, `dlg_combined_${tag}.mp3`);

  // Generate a 0.5s silence MP3 to insert between lines
  const silencePath = path.join(tmpDir, `silence_${tag}.mp3`);
  spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'anullsrc=r=32000:cl=mono',
    '-t', '0.5', '-codec:a', 'libmp3lame', '-q:a', '4', silencePath,
  ], { timeout: 10000 });

  let listContent = '';
  for (let i = 0; i < valid.length; i++) {
    const f = path.join(tmpDir, `dlg_line_${tag}_${i}.mp3`);
    fs.writeFileSync(f, valid[i]);
    inputFiles.push(f);
    listContent += `file '${f}'\n`;
    if (i < valid.length - 1 && fs.existsSync(silencePath)) {
      listContent += `file '${silencePath}'\n`;
    }
  }

  fs.writeFileSync(listFile, listContent);

  const result = spawnSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-codec:a', 'libmp3lame', '-q:a', '4', outFile,
  ], { timeout: 30000 });

  // Cleanup input temp files
  for (const f of inputFiles) { try { fs.unlinkSync(f); } catch {} }
  try { fs.unlinkSync(listFile); } catch {}
  try { fs.unlinkSync(silencePath); } catch {}

  if (!fs.existsSync(outFile)) {
    console.error('ffmpeg concat failed:', result.stderr?.toString());
    return null;
  }

  const combined = fs.readFileSync(outFile);
  try { fs.unlinkSync(outFile); } catch {}
  return combined;
}
