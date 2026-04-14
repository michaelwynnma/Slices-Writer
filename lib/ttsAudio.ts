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

/**
 * Detect gender from a speaker name.
 * Returns 'female', 'male', or 'unknown'.
 */
export function detectGender(name: string): 'female' | 'male' | 'unknown' {
  const lower = name.toLowerCase().trim();
  if (FEMALE_NAMES.has(lower)) return 'female';
  if (MALE_NAMES.has(lower))   return 'male';
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
async function generateTTSViaAPI(text: string, voice?: string): Promise<Buffer | null> {
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
          'Authorization': `Bearer ${TTS_API_KEY}`,
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
export async function generateTTS(text: string, voice?: string): Promise<Buffer | null> {
  if (!text || !text.trim()) return null;

  if (TTS_API_KEY) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        const delay = 3000 * (attempt - 1);
        console.warn(`TTS retry ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      const result = await generateTTSViaAPI(text, voice);
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
): Promise<SentenceAudio> {
  const [s1, s2] = await Promise.all([
    generateTTS(sentence1, voice),
    generateTTS(sentence2, voice),
  ]);
  return { sentence1: s1, sentence2: s2 };
}

/**
 * Generate TTS for all word sentences. Returns map: word → SentenceAudio.
 * Each word gets a RANDOM voice from the full pool.
 * Sequential with delay between words to avoid RPM rate limiting.
 */
export async function generateAllWordAudio(
  wordSentences: Array<{ word: string; sentence1: string; sentence2: string }>,
  _voice?: string, // ignored — random voice used per word
): Promise<Map<string, SentenceAudio>> {
  const result = new Map<string, SentenceAudio>();

  for (let i = 0; i < wordSentences.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 3000)); // 3s gap — reliable over fast
    const ws = wordSentences[i];
    // Pick a random voice from the full pool for each word
    const randomVoice = ALL_VOICES[Math.floor(Math.random() * ALL_VOICES.length)];
    const audio = await generateWordAudio(ws.sentence1, ws.sentence2, randomVoice);
    result.set(ws.word.toLowerCase(), audio);
  }

  return result;
}

/**
 * Generate TTS audio for key sentences. Returns array of Buffer | null (one per sentence).
 * Each sentence gets a RANDOM voice from the full pool.
 * Adds a 3s delay between each call to avoid RPM rate limiting.
 */
export async function generateKeySentenceAudio(
  sentences: Array<{ eng: string }>,
  _voice?: string, // ignored — random voice used per sentence
): Promise<Array<Buffer | null>> {
  const results: Array<Buffer | null> = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 3000)); // 3s gap — reliable over fast
    // Pick a random voice from the full pool for each sentence
    const randomVoice = ALL_VOICES[Math.floor(Math.random() * ALL_VOICES.length)];
    const audio = await generateTTS(sentences[i].eng, randomVoice);
    results.push(audio ?? null);
  }
  return results;
}

/**
 * Generate TTS audio for dialogue lines.
 * Each speaker gets a consistent gender-matched voice (female pool / male pool).
 * Sequential with 3s gap between calls to avoid RPM rate limiting.
 * TTS reads only the English sentence — NOT the speaker name.
 */
export async function generateDialogueAudio(
  lines: Array<{ speaker: string; eng: string }>,
  userVoice?: string,
): Promise<Array<{ audio: Buffer | null; voice: string }>> {
  const results: Array<{ audio: Buffer | null; voice: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 3000)); // 3s gap
    const line = lines[i];
    const gender = detectGender(line.speaker);

    let voice: string;
    if (gender === 'male') {
      // Known male speaker → male voice pool
      const pool = MALE_VOICES;
      let hash = 0;
      for (let c = 0; c < line.speaker.length; c++) hash = (hash * 31 + line.speaker.charCodeAt(c)) >>> 0;
      voice = pool[hash % pool.length];
    } else if (gender === 'female') {
      // Known female speaker → female voice pool
      const pool = FEMALE_VOICES;
      let hash = 0;
      for (let c = 0; c < line.speaker.length; c++) hash = (hash * 31 + line.speaker.charCodeAt(c)) >>> 0;
      voice = pool[hash % pool.length];
    } else {
      // Unknown gender → use user-selected voice if provided, else fallback to female pool
      if (userVoice && ALL_VOICES.includes(userVoice)) {
        voice = userVoice;
      } else {
        const pool = FEMALE_VOICES;
        let hash = 0;
        for (let c = 0; c < line.speaker.length; c++) hash = (hash * 31 + line.speaker.charCodeAt(c)) >>> 0;
        voice = pool[hash % pool.length];
      }
    }
    // console.log(`[TTS] Speaker: "${line.speaker}" → gender: ${gender} → voice: ${voice}`);

    const audio = await generateTTS(line.eng, voice);
    results.push({ audio: audio ?? null, voice });
  }
  return results;
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
