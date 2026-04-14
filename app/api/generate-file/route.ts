import { NextRequest, NextResponse } from 'next/server';
import { parseLesson } from '@/lib/parseLesson';
import { generatePptx, KeySentenceData, DialogueLineData } from '@/lib/generatePptx';
import { generateSentencesForWords, enrichWithAlignment, alignKeySentences, alignDialogueLines } from '@/lib/aiSentences';
import { generateAllWordAudio, generateKeySentenceAudio, generateDialogueAudio, concatenateDialogueAudio } from '@/lib/ttsAudio';
import { generateDialogueSceneImage } from '@/lib/dialogueImage';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!file.name.endsWith('.md')) {
      return NextResponse.json({ error: 'Only .md files are supported' }, { status: 400 });
    }

    const markdown = await file.text();
    const showPinyin = formData.get('showPinyin') === 'true';
    const showSentences = formData.get('showSentences') === 'true';
    const generateSceneImage = formData.get('generateSceneImage') !== 'false';

    const lesson = parseLesson(markdown);

    let wordSentences: Awaited<ReturnType<typeof generateSentencesForWords>> = [];
    let sentenceWarning = '';
    let wordAudio: Awaited<ReturnType<typeof generateAllWordAudio>> = new Map();

    if (showSentences && lesson.vocabulary.length) {
      try {
        const raw = await generateSentencesForWords(lesson.vocabulary.map(v => v.word));
        wordSentences = await enrichWithAlignment(raw);
      } catch (aiErr) {
        console.warn('AI sentence generation failed:', aiErr);
        sentenceWarning = `AI sentence generation failed: ${String(aiErr)}. Placeholder slides were created instead.`;
      }

      if (wordSentences.length) {
        try {
          wordAudio = await generateAllWordAudio(
            wordSentences.map(ws => ({
              word: ws.word,
              sentence1: ws.sentence1,
              sentence2: ws.sentence2,
            })),
            undefined
          );
        } catch (ttsErr) {
          console.warn('TTS audio generation failed (slides will be generated without audio):', ttsErr);
        }
      }
    }

    // Key sentences: alignment + TTS
    let keySentences: KeySentenceData[] = [];
    if (lesson.keySentences.length) {
      const raw = lesson.keySentences.map(s => ({ eng: s.english, zh: s.chinese }));
      const [alignedArr, audioArr] = await Promise.allSettled([
        alignKeySentences(raw),
        generateKeySentenceAudio(raw, undefined),
      ]);
      const aligned = alignedArr.status === 'fulfilled' ? alignedArr.value : raw.map(() => []);
      const audios  = audioArr.status  === 'fulfilled' ? audioArr.value  : raw.map(() => null);
      keySentences = raw.map((s, i) => ({
        ...s,
        aligned: aligned[i]?.length ? aligned[i] : undefined,
        audio:   audios[i] ?? null,
      }));
    }

    // Dialogue: scene image + alignment + gender-matched TTS
    let dialogueLines: DialogueLineData[] = [];
    let dialogueSceneImage: Buffer | null = null;
    let dialogueCombinedAudio: Buffer | null = null;
    if (lesson.dialogue.length) {
      const raw = lesson.dialogue.map(d => ({ speaker: d.speaker, eng: d.eng, zh: d.zh }));
      // Stage 1: alignment + TTS audio (sequential per line, no image overlap)
      const [alignedArr, audioArr] = await Promise.allSettled([
        alignDialogueLines(raw),
        generateDialogueAudio(raw),
      ]);
      const aligned = alignedArr.status === 'fulfilled' ? alignedArr.value : raw.map(() => []);
      const audios  = audioArr.status  === 'fulfilled' ? audioArr.value  : raw.map(() => ({ audio: null, voice: '' }));
      dialogueLines = raw.map((d, i) => ({
        ...d,
        aligned: aligned[i]?.length ? aligned[i] : undefined,
        audio:   audios[i]?.audio ?? null,
        voice:   audios[i]?.voice ?? '',
      }));
      dialogueCombinedAudio = await concatenateDialogueAudio(audios.map(a => a?.audio ?? null)).catch((e) => { console.error('[dialogue] concat error:', e); return null; });
      console.log(`[dialogue] combined audio: ${dialogueCombinedAudio ? dialogueCombinedAudio.length + ' bytes' : 'null'}, per-line audios: ${audios.map(a => a?.audio ? a.audio.length : 'null').join(', ')}`);
      // Stage 2: image generation (after all TTS done to avoid API conflicts)
      if (generateSceneImage && raw.length > 0) {
        dialogueSceneImage = await generateDialogueSceneImage(raw).catch(() => null);
      }
    }

    const pptxBuffer = await generatePptx(lesson, { showPinyin, wordSentences, wordAudio, keySentences, dialogueLines, dialogueSceneImage, dialogueCombinedAudio });

    const baseName = file.name.replace(/\.md$/, '');
    const baseFilename = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _-]/g, '').replace(/\s+/g, '_').substring(0, 60);
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
