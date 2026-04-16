import { NextRequest, NextResponse } from 'next/server';
import { recordGeneration } from '@/lib/stats';
import { randomUUID } from 'crypto';
import { parseLesson } from '@/lib/parseLesson';
import { generatePptx, KeySentenceData, DialogueLineData } from '@/lib/generatePptx';
import { generateSentencesForWords, enrichWithAlignment, alignKeySentences, alignDialogueLines } from '@/lib/aiSentences';
import { generateAllWordAudio, generateKeySentenceAudio, generateDialogueAudio, concatenateDialogueAudio } from '@/lib/ttsAudio';
import { generateDialogueSceneImage, determineSpeakerGenders } from '@/lib/dialogueImage';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const genId = randomUUID();
  try {
    const { markdown, showPinyin, showSentences, generateSceneImage = true } = await req.json();
    const claudeApiKey = req.headers.get('x-claude-key') || undefined;
    const ttsApiKey    = req.headers.get('x-tts-key')    || undefined;
    if (!markdown || typeof markdown !== 'string') {
      return NextResponse.json({ error: 'Missing markdown content' }, { status: 400 });
    }

    const lesson = parseLesson(markdown);
    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    let wordSentences: Awaited<ReturnType<typeof generateSentencesForWords>> = [];
    let sentenceWarning = '';
    let wordAudio: Awaited<ReturnType<typeof generateAllWordAudio>> = new Map();
    let keySentences: KeySentenceData[] = [];
    let dialogueLines: DialogueLineData[] = [];
    let dialogueSceneImage: Buffer | null = null;
    let dialogueCombinedAudio: Buffer | null = null;

    // Run vocab, key sentences, and dialogue all in parallel
    const vocabTask = (async () => {
      if (!showSentences || !lesson.vocabulary.length) return;
      try {
        const raw = await generateSentencesForWords(lesson.vocabulary.map(v => v.word), claudeApiKey);
        wordSentences = await enrichWithAlignment(raw, claudeApiKey);
      } catch (aiErr) {
        console.warn('AI sentence generation failed:', aiErr);
        sentenceWarning = `AI sentence generation failed: ${String(aiErr)}. Placeholder slides were created instead.`;
        return;
      }
      if (wordSentences.length) {
        try {
          wordAudio = await generateAllWordAudio(
            wordSentences.map(ws => ({ word: ws.word, sentence1: ws.sentence1, sentence2: ws.sentence2 })),
            undefined,
            ttsApiKey,
          );
        } catch (ttsErr) {
          console.warn('TTS audio generation failed (slides will be generated without audio):', ttsErr);
        }
      }
    })();

    const keySentenceTask = (async () => {
      if (!lesson.keySentences.length) return;
      const raw = lesson.keySentences.map(s => ({ eng: s.english, zh: s.chinese }));
      const [alignedArr, audioArr] = await Promise.allSettled([
        alignKeySentences(raw, claudeApiKey),
        generateKeySentenceAudio(raw, undefined, ttsApiKey),
      ]);
      const aligned = alignedArr.status === 'fulfilled' ? alignedArr.value : raw.map(() => []);
      const audios  = audioArr.status  === 'fulfilled' ? audioArr.value  : raw.map(() => null);
      keySentences = raw.map((s, i) => ({
        ...s,
        aligned: aligned[i]?.length ? aligned[i] : undefined,
        audio:   audios[i] ?? null,
      }));
    })();

    const dialogueTask = (async () => {
      if (!lesson.dialogue.length) return;
      const raw = lesson.dialogue.map(d => ({ speaker: d.speaker, eng: d.eng, zh: d.zh }));

      // Step 1: Ask GLM to determine speaker genders from dialogue context.
      // This single source of truth is shared with image generation AND TTS so
      // the character depicted in the image always matches the TTS voice gender.
      const speakerGenders = await determineSpeakerGenders(raw, claudeApiKey).catch(() => new Map<string, 'male' | 'female'>());

      // Step 2: Run alignment, audio, and image all in parallel using the same genders.
      const [alignedArr, audioArr, imageResult] = await Promise.allSettled([
        alignDialogueLines(raw, claudeApiKey),
        generateDialogueAudio(raw, undefined, ttsApiKey, speakerGenders),
        generateSceneImage && raw.length > 0
          ? generateDialogueSceneImage(raw, claudeApiKey, speakerGenders)
          : Promise.resolve(null),
      ]);
      const aligned = alignedArr.status === 'fulfilled' ? alignedArr.value : raw.map(() => []);
      const audios  = audioArr.status  === 'fulfilled' ? audioArr.value  : raw.map(() => ({ audio: null, voice: '' }));
      dialogueSceneImage = imageResult.status === 'fulfilled' ? (imageResult.value ?? null) : null;

      dialogueLines = raw.map((d, i) => ({
        ...d,
        aligned: aligned[i]?.length ? aligned[i] : undefined,
        audio:   audios[i]?.audio ?? null,
        voice:   audios[i]?.voice ?? '',
      }));
      dialogueCombinedAudio = await concatenateDialogueAudio(audios.map(a => a?.audio ?? null)).catch((e) => { console.error('[dialogue] concat error:', e); return null; });
    })();

    // Wait for all three pipelines to complete
    await Promise.allSettled([vocabTask, keySentenceTask, dialogueTask]);
    console.log(`[generate] All pipelines done in ${elapsed()}`);

    const pptxBuffer = await generatePptx(lesson, { showPinyin: !!showPinyin, wordSentences, wordAudio, keySentences, dialogueLines, dialogueSceneImage, dialogueCombinedAudio });
    console.log(`[generate] PPTX built in ${elapsed()} total`);

    const baseFilename = lesson.title
      ? lesson.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _-]/g, '').replace(/\s+/g, '_').substring(0, 60)
      : 'lesson';

    const encodedFilename = encodeURIComponent(`${baseFilename}.pptx`);
    const body = new Uint8Array(pptxBuffer.buffer, pptxBuffer.byteOffset, pptxBuffer.byteLength);
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="lesson.pptx"; filename*=UTF-8''${encodedFilename}`,
    };
    if (sentenceWarning) {
      headers['X-Sentence-Warning'] = sentenceWarning;
    }
    return new NextResponse(body as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('PPT generation error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
