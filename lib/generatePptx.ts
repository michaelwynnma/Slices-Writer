import PptxGenJS from 'pptxgenjs';
import { LessonData } from './parseLesson';
import { WordSentences, AlignedPair } from './aiSentences';
import { SentenceAudio } from './ttsAudio';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import JSZip from 'jszip';

// ── Play button cover image (amber circle + white triangle) ───────────────────
// Generated once at module load; used as pptxgenjs `cover` for audio media objects.
// This makes the audio element itself the visible, clickable play button —
// no overlapping shapes needed (which would block clicks in WPS/PowerPoint).
let PLAY_BUTTON_COVER: string | null = null;

async function getPlayButtonCover(): Promise<string> {
  if (PLAY_BUTTON_COVER) return PLAY_BUTTON_COVER;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <circle cx="100" cy="100" r="95" fill="#E8A020" stroke="#C8880A" stroke-width="6"/>
    <polygon points="75,55 75,145 150,100" fill="white"/>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  PLAY_BUTTON_COVER = 'data:image/png;base64,' + buf.toString('base64');
  return PLAY_BUTTON_COVER;
}

// ── Post-process PPTX buffer: fix pptxgenjs audio XML bug ────────────────────
// pptxgenjs hardcodes <a:videoFile> even when type='audio'.
// The correct element is <a:audioFile>. We patch every slide XML in the zip.
// Also adds isNarration="1" so WPS/PowerPoint treat it as background audio.
async function fixAudioXml(pptxBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptxBuffer);
  const slideFiles = Object.keys(zip.files).filter(
    (f) => f.match(/^ppt\/slides\/slide\d+\.xml$/)
  );
  for (const filePath of slideFiles) {
    let xml = await zip.files[filePath].async('string');
    let changed = false;

    // 1. Replace <a:videoFile> → <a:audioFile> (pptxgenjs hardcodes video even for audio type)
    if (xml.includes('<a:videoFile') && xml.includes('ppaction://media')) {
      xml = xml.replace(/<a:videoFile\b/g, '<a:audioFile');
      xml = xml.replace(/<\/a:videoFile>/g, '</a:audioFile>');
      changed = true;
    }

    // 2. Fix empty hlinkClick r:id="" — WPS/PowerPoint need this to know what to play on click.
    //    Each audio pic element has: <a:hlinkClick r:id="" action="ppaction://media"/> 
    //    and <a:audioFile r:link="rIdN"/>. We copy rIdN into hlinkClick's r:id.
    //    Match the enclosing <p:pic>...</p:pic> blocks and fix each one individually.
    if (xml.includes('ppaction://media') && xml.includes('r:id=""')) {
      xml = xml.replace(
        /(<p:pic\b[\s\S]*?<\/p:pic>)/g,
        (picBlock) => {
          // Only touch blocks that have an empty hlinkClick
          if (!picBlock.includes('r:id=""') || !picBlock.includes('ppaction://media')) {
            return picBlock;
          }
          // Extract the r:link value from <a:audioFile r:link="rIdN"/>
          const linkMatch = picBlock.match(/r:link="([^"]+)"/);
          if (!linkMatch) return picBlock;
          const rId = linkMatch[1];
          // Fill in the empty r:id on hlinkClick
          return picBlock.replace(
            /(<a:hlinkClick\s[^>]*?)r:id=""([^>]*action="ppaction:\/\/media")/,
            `$1r:id="${rId}"$2`
          );
        }
      );
      changed = true;
    }

    if (changed) {
      zip.file(filePath, xml);
    }
  }
  const fixed = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return fixed;
}

// Slide dimensions: 32.15 cm × 33.87 cm (converted to inches)
const SLIDE_W = 32.15 / 2.54; // ~12.657 in
const SLIDE_H = 33.87 / 2.54; // ~13.335 in

// Color palette — clean, educational feel
const COLORS = {
  primary: '1E3A5F',      // Deep navy
  accent: 'E8A020',       // Warm amber
  accentLight: 'FFF3D6',  // Light amber bg
  white: 'FFFFFF',
  lightGray: 'F5F7FA',
  darkText: '1A1A2E',
  mutedText: '6B7280',
  textSecondary: '6B7280', // alias for mutedText — used on clean-bg slides
  tableAlt: 'EEF2FF',
  dialogueA: 'DBEAFE',    // Light blue for Customer
  dialogueB: 'D1FAE5',    // Light green for Barber
};

function addTitleSlide(prs: PptxGenJS, lesson: LessonData) {
  const slide = prs.addSlide();

  // Fixed Chinese title
  slide.addText('实用英语速成', {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fontSize: 115,
    bold: true,
    color: '0D52A7',
    fontFace: 'Microsoft YaHei',
    align: 'center',
    valign: 'middle',
    isTextBox: true,
    autoFit: false,
    shrinkText: false,
  });
}

// Strip emoji and non-BMP characters that pptxgenjs cannot encode
function safe(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[\u2600-\u27BF]/g, '').trim();
}

function addSectionHeader(prs: PptxGenJS, title: string, subtitle?: string) {
  const slide = prs.addSlide();

  slide.addText(title, {
    x: 0.8, y: 2.0, w: 11.5, h: 1.2,
    fontSize: 48,
    bold: true,
    color: COLORS.primary,
    fontFace: 'Arial',
    align: 'left',
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.8, y: 3.3, w: 11.5, h: 0.7,
      fontSize: 22,
      color: COLORS.mutedText,
      fontFace: 'Arial',
      align: 'left',
    });
  }
}

function addObjectivesSlide(prs: PptxGenJS, objectives: string[]) {
  if (!objectives.length) return;

  const slide = prs.addSlide();
  addSlideHeader(slide, prs, 'Learning Objectives', '学习目标');

  const rows = objectives.map((obj, i) => ({
    text: [
      { text: `${i + 1}`, options: { bold: true, color: COLORS.accent, fontSize: 20, w: 0.5 } },
      { text: `  ${obj}`, options: { color: COLORS.darkText, fontSize: 18 } },
    ],
  }));

  objectives.forEach((obj, i) => {
    slide.addText(`${i + 1}.  ${obj}`, {
      x: 0.8, y: 1.8 + i * 0.75, w: 11.5, h: 0.65,
      fontSize: 20,
      color: COLORS.darkText,
      fontFace: 'Arial',
      bullet: false,
    });
  });
}

function addTextSlide(prs: PptxGenJS, heading: string, subheading: string, body: string) {
  if (!body.trim()) return;

  const slide = prs.addSlide();
  addSlideHeader(slide, prs, heading, subheading);

  slide.addText(body, {
    x: 0.8, y: 1.8, w: 11.5, h: 5,
    fontSize: 18,
    color: COLORS.darkText,
    fontFace: 'Arial',
    align: 'left',
    valign: 'top',
    wrap: true,
  });
}

function addVocabularySlides(prs: PptxGenJS, vocab: LessonData['vocabulary'], showPinyin = false) {
  if (!vocab.length) return;

  // Exactly 4 words per slide, one per row — no header, no color bars, plain white
  const CHUNK = 4;

  const MARGIN_TOP = 0.1;
  const MARGIN_BOTTOM = 0.1;
  const CONTENT_H = SLIDE_H - MARGIN_TOP - MARGIN_BOTTOM;
  const ROW_H = CONTENT_H / CHUNK;

  // Left side: English + IPA — starts at x=0.5
  const LEFT_X = 0.5;
  const LEFT_W = 5.8;
  // Right side: Chinese — starts at x=6.5
  const RIGHT_X = 6.5;
  const RIGHT_W = SLIDE_W - RIGHT_X - 0.4;

  for (let start = 0; start < vocab.length; start += CHUNK) {
    const chunk = vocab.slice(start, start + CHUNK);
    const slide = prs.addSlide();

    // Pure white background, nothing else
    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fill: { color: 'FFFFFF' },
      line: { color: 'FFFFFF', width: 0 },
    });

    chunk.forEach((v, i) => {
      const rowY = MARGIN_TOP + i * ROW_H;
      // Tight stacking: word box immediately above IPA box, no gap
      const WORD_PT = 80;
      const IPA_PT  = 65;
      const PT_TO_IN = 1 / 72;

      const wordTextH = WORD_PT * PT_TO_IN * 1.15; // tight line-height
      const ipaTextH  = IPA_PT  * PT_TO_IN * 1.15;

      // When 辅助发音 is shown, stack word → IPA → pinyin; otherwise just word → IPA
      const AUX_PT  = 60;
      const auxTextH = showPinyin && v.aux ? AUX_PT * PT_TO_IN * 1.15 : 0;

      const stackH = wordTextH + ipaTextH + auxTextH;
      const wordY  = rowY + (ROW_H - stackH) / 2;
      const ipaY   = wordY + wordTextH;
      const auxY   = ipaY + ipaTextH;

      // English word — Arial Black, bold, black, 80pt
      slide.addText(safe(v.word), {
        x: LEFT_X,
        y: wordY,
        w: LEFT_W,
        h: wordTextH,
        fontSize: WORD_PT,
        bold: true,
        color: '000000',
        fontFace: 'Arial Black',
        align: 'left',
        valign: 'top',
      });

      // IPA — Arial, gray #9CA3AF, 65pt
      if (v.ipa) {
        slide.addText(safe(v.ipa), {
          x: LEFT_X,
          y: ipaY,
          w: LEFT_W,
          h: ipaTextH,
          fontSize: IPA_PT,
          color: '9CA3AF',
          fontFace: 'Arial',
          align: 'left',
          valign: 'top',
        });
      }

      // 辅助发音 — Microsoft YaHei, RGB(237,125,49)=#ED7D31, 60pt (only when showPinyin)
      if (showPinyin && v.aux) {
        slide.addText(v.aux, {
          x: LEFT_X,
          y: auxY,
          w: LEFT_W,
          h: auxTextH,
          fontSize: AUX_PT,
          color: 'ED7D31',
          fontFace: 'Microsoft YaHei',
          align: 'left',
          valign: 'top',
        });
      }

      // Chinese — Microsoft YaHei Bold, RGB(0,112,192) = 0070C0, 80pt
      // Aligned to word baseline: same y as the word box so they sit at the same height
      if (v.chinese) {
        slide.addText(v.chinese, {
          x: RIGHT_X,
          y: wordY,
          w: RIGHT_W,
          h: wordTextH,
          fontSize: 80,
          bold: true,
          color: '0070C0',
          fontFace: 'Microsoft YaHei',
          align: 'left',
          valign: 'top',
        });
      }
    });
  }
}

/**
 * One word per slide — reference layout:
 *
 *  TOP (≈28%):  "Word  中文翻译"  — word in black, Chinese in blue, same line
 *  ─────────── thin amber divider ───────────────────────────────────────────
 *  SENTENCE 1 block (≈33%):
 *    English sentence  — bold, PURPLE (#7030A0), large, letter-spaced
 *    Chinese sentence  — bold, GREEN  (#70AD47), slightly smaller
 *  ─────────── thin gray divider ────────────────────────────────────────────
 *  SENTENCE 2 block (≈33%):
 *    English sentence  — bold, ORANGE (#ED7D31)
 *    Chinese sentence  — bold, GOLD   (#FFC000)
 */

// Color pool — randomly pick one English color + one Chinese color per sentence block
const COLOR_POOL: Record<string, string[]> = {
  redOrange: ['FF6247', 'FE8666', 'FD3E01', 'FE9A2E'],
  yellow:    ['FAC006'],
  green:     ['B0B673', '749258', '32CD32', '00D643', '2E8B57'],
  blueTeal:  ['00CED1', '12B0B5', '1E90FE', '6A5ACD'],
  purplePink:['A676FE', '8A2BE2', 'CA27FF', 'FF1493', 'E85A66'],
};

const ALL_COLORS: string[] = Object.values(COLOR_POOL).flat();

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick two distinct colors from the pool for a sentence block (English + Chinese). */
function pickSentenceColors(): [string, string] {
  const eng = pickRandom(ALL_COLORS);
  // Chinese color must differ from English color
  let zh: string;
  do { zh = pickRandom(ALL_COLORS); } while (zh === eng);
  return [eng, zh];
}

function addWordDetailSlides(
  prs: PptxGenJS,
  vocab: LessonData['vocabulary'],
  sentenceMap: Map<string, WordSentences>,
  showPinyin: boolean,
  wordAudio: Map<string, SentenceAudio> = new Map(),
): string[] {
  if (!vocab.length) return [];

  const PT_IN = 1 / 72;
  const MARGIN_X = 0.5;
  const CONTENT_W = SLIDE_W - MARGIN_X * 2;
  const tempFiles: string[] = []; // temp MP3 files to clean up after PPTX write

  for (const v of vocab) {
    const ws = sentenceMap.get(v.word.toLowerCase());
    const audio = wordAudio.get(v.word.toLowerCase());
    const slide = prs.addSlide();

    // Pure white bg
    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fill: { color: 'FFFFFF' },
      line: { color: 'FFFFFF', width: 0 },
    });

    // ── TOP BAND: Word + Chinese ──────────────────────────────────
    const WORD_PT = 80;
    const wordH = WORD_PT * PT_IN * 1.1;   // single-line height for 80pt
    const wordY = 0.18;                     // small top margin

    // Pick one random color — English word and Chinese share the same color
    const wordColor = pickRandom(ALL_COLORS);

    // English word (left, bold, random color)
    slide.addText(safe(v.word), {
      x: MARGIN_X, y: wordY, w: SLIDE_W * 0.48, h: wordH,
      fontSize: WORD_PT, bold: true, color: wordColor,
      fontFace: 'Arial Black', align: 'left', valign: 'middle',
    });

    // Chinese (right, bold, same color as English)
    if (v.chinese) {
      slide.addText(v.chinese, {
        x: SLIDE_W * 0.5, y: wordY, w: SLIDE_W * 0.46, h: wordH,
        fontSize: WORD_PT, bold: true, color: wordColor,
        fontFace: 'Microsoft YaHei', align: 'left', valign: 'middle',
      });
    }

    // ── SENTENCE BLOCKS ───────────────────────────────────────────
    const ENG_PT  = 80;                      // sentence font size (English)
    const ZH_PT   = 80;                      // sentence font size (Chinese)
    // At 80pt, 2.2× gives enough height for 2 wrapped lines and still fits on slide
    const engH = (ENG_PT * PT_IN) * 2.2;    // ≈ 2.44 in
    const zhH  = (ZH_PT  * PT_IN) * 2.2;    // ≈ 2.44 in
    const BLOCK_GAP = 0.3;                   // gap between sentence 1 and sentence 2 block
    const BLOCK_H = engH + zhH + BLOCK_GAP; // ≈ 5.19 in total per block

    // Anchor sentence 2 bottom edge 0.5 cm (≈ 0.197 in) from slide bottom
    const BOTTOM_MARGIN = 0.5 / 2.54;       // 0.5 cm → inches
    const sent2Bottom = SLIDE_H - BOTTOM_MARGIN;
    const sent2Y = sent2Bottom - BLOCK_H;   // top of sentence 2 block
    const sent1Y = sent2Y - BLOCK_GAP - BLOCK_H; // top of sentence 1 block

    const SENT_AREA_Y = sent1Y; // kept for reference — not used directly below

    const sentPairs = ws
      ? [
          { eng: ws.sentence1, zh: ws.sentence1_zh },
          { eng: ws.sentence2, zh: ws.sentence2_zh },
        ]
      : [
          { eng: null, zh: null },
          { eng: null, zh: null },
        ];

    // ── Speaker icon dimensions ───────────────────────────────────
    // A small triangle "play" shape used as clickable audio trigger
    const ICON_SIZE = 0.55;  // inches — square bounding box
    const ICON_X = SLIDE_W - MARGIN_X - ICON_SIZE;  // right-aligned
    const TEXT_W = CONTENT_W - ICON_SIZE - 0.15;    // sentence text narrowed to leave room for icon

    sentPairs.forEach((pair, idx) => {
      const blockY = idx === 0 ? sent1Y : sent2Y;
      // English starts at top of block; Chinese immediately below — no gap
      const startY = blockY;

      // ── Embed TTS audio for this sentence ────────────────────────
      const audioBuffer = idx === 0 ? audio?.sentence1 : audio?.sentence2;
      const audioRelId = audioBuffer
        ? `snd_${v.word.replace(/[^a-zA-Z0-9]/g, '')}_${idx + 1}`
        : null;

      if (audioBuffer && audioRelId) {
        // Write MP3 to a temp file — pptxgenjs embeds audio correctly via path:
        // Using data: URI causes it to be treated as video (known pptxgenjs bug)
        const tmpFile = path.join(os.tmpdir(), `${audioRelId}_${Date.now()}.mp3`);
        fs.writeFileSync(tmpFile, audioBuffer);
        tempFiles.push(tmpFile);
        // Use the amber play-button PNG as the cover image so the audio object
        // IS the visible button. Do NOT draw separate shapes on top — they sit
        // above the media object in z-order and intercept all click events,
        // preventing audio playback in WPS and PowerPoint.
        const cover = PLAY_BUTTON_COVER ?? undefined;
        // Vertically center the play button with the English sentence line
        const iconY = startY + (engH / 2) - (ICON_SIZE / 2);
        slide.addMedia({
          type: 'audio',
          extn: 'mp3',
          path: tmpFile,
          x: ICON_X,
          y: iconY,
          w: ICON_SIZE,
          h: ICON_SIZE,
          ...(cover ? { cover } : {}),
        });
      }

      if (pair.eng) {
        const aligned = idx === 0 ? ws?.sentence1_aligned : ws?.sentence2_aligned;

        if (aligned && aligned.length > 0) {
          // ── Aligned rich-text rendering ──────────────────────────
          // English: each token gets its assigned color
          const engParts: PptxGenJS.TextProps[] = aligned.map(ap => ({
            text: ap.en + ' ',
            options: {
              bold: true,
              color: ap.color,
              fontSize: ENG_PT,
              fontFace: 'Arial Black',
              charSpacing: 0,
            },
          }));
          slide.addText(engParts, {
            x: MARGIN_X, y: startY, w: TEXT_W, h: engH,
            align: 'left', valign: 'top', wrap: true,
          });

          // Chinese: each token gets the same color as its English pair
          const zhParts: PptxGenJS.TextProps[] = aligned
            .filter(ap => ap.zh)
            .map(ap => ({
              text: ap.zh,
              options: {
                bold: true,
                color: ap.color,
                fontSize: ZH_PT,
                fontFace: 'Microsoft YaHei',
              },
            }));
          if (zhParts.length) {
            slide.addText(zhParts, {
              x: MARGIN_X, y: startY + engH, w: TEXT_W, h: zhH,
              align: 'left', valign: 'top', wrap: true,
            });
          }
        } else {
          // ── Fallback: single random color per sentence block (English + Chinese share same color) ──
          const sentColor = pickRandom(ALL_COLORS);
          slide.addText(pair.eng, {
            x: MARGIN_X, y: startY, w: TEXT_W, h: engH,
            fontSize: ENG_PT, bold: true, color: sentColor,
            fontFace: 'Arial Black', align: 'left', valign: 'top',
            charSpacing: 0, wrap: true,
          });
          if (pair.zh) {
            slide.addText(pair.zh, {
              x: MARGIN_X, y: startY + engH, w: TEXT_W, h: zhH,
              fontSize: ZH_PT, bold: true, color: sentColor,
              fontFace: 'Microsoft YaHei', align: 'left', valign: 'top', wrap: true,
            });
          }
        }
      } else {
        // Placeholder when no AI sentences
        slide.addText(`${idx + 1}. ________________________`, {
          x: MARGIN_X, y: startY, w: TEXT_W, h: engH,
          fontSize: ENG_PT, color: 'D1D5DB',
          fontFace: 'Arial', align: 'left', valign: 'top',
        });
      }
    });
  }

  // Return temp MP3 paths so caller can clean up after prs.write()
  return tempFiles;
}

/**
 * Split a sentence into pptxgenjs rich-text parts, bolding+colouring any
 * occurrence of the target word or its common inflections.
 */
function highlightWord(sentence: string, word: string): PptxGenJS.TextProps[] {
  // Build a regex that matches the base word + common English inflections
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Covers: word, words, word's, wording, worded, wordly, wordness, etc.
  const pattern = new RegExp(`(${escaped}(?:s|es|'s|ing|ed|er|ers|ly|ness|ful|less|ment)?)`, 'gi');

  const parts: PptxGenJS.TextProps[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(sentence)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: sentence.slice(lastIndex, match.index), options: { color: '1A1A2E', fontSize: 38, fontFace: 'Arial' } });
    }
    parts.push({ text: match[0], options: { bold: true, color: 'E8A020', fontSize: 38, fontFace: 'Arial' } });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < sentence.length) {
    parts.push({ text: sentence.slice(lastIndex), options: { color: '1A1A2E', fontSize: 38, fontFace: 'Arial' } });
  }

  return parts.length ? parts : [{ text: sentence, options: { color: '1A1A2E', fontSize: 38, fontFace: 'Arial' } }];
}

/** Enriched key sentence with alignment + audio */
export interface KeySentenceData {
  eng: string;
  zh: string;
  aligned?: AlignedPair[];
  audio?: Buffer | null;
}

/** Enriched dialogue line with alignment + audio */
export interface DialogueLineData {
  speaker: string;
  eng: string;
  zh: string;
  aligned?: AlignedPair[];
  audio?: Buffer | null;
  voice?: string;
}

async function addDialogueImageSlide(prs: PptxGenJS, imageBuffer: Buffer, combinedAudio: Buffer | null, tempFiles: string[]) {
  const slide = prs.addSlide();

  // Save image to temp file
  const tmpFile = path.join(os.tmpdir(), `dialogue_scene_${Date.now()}.png`);
  fs.writeFileSync(tmpFile, imageBuffer);
  tempFiles.push(tmpFile);

  // Full-screen image — exact slide dimensions, no margins
  slide.addImage({
    path: tmpFile,
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    sizing: { type: 'cover', w: SLIDE_W, h: SLIDE_H },
  });

  // Embed combined dialogue audio as amber play button (bottom-right corner)
  if (combinedAudio) {
    const audioFile = path.join(os.tmpdir(), `dialogue_combined_${Date.now()}.mp3`);
    fs.writeFileSync(audioFile, combinedAudio);
    tempFiles.push(audioFile);
    const cover = await getPlayButtonCover();
    const BTN_SIZE = 1.2;
    slide.addMedia({
      type: 'audio',
      extn: 'mp3',
      path: audioFile,
      x: SLIDE_W - BTN_SIZE - 0.3,
      y: SLIDE_H - BTN_SIZE - 0.3,
      w: BTN_SIZE,
      h: BTN_SIZE,
      cover,
    });
  }
}

function addDialogueSlides(prs: PptxGenJS, lines: DialogueLineData[], tempFiles: string[]) {
  if (!lines.length) return;

  const PT_IN = 1 / 72;
  const MARGIN_X = 0.5;
  const CONTENT_W = SLIDE_W - MARGIN_X * 2;

  const SPEAKER_PT = 36;
  const ENG_PT = 80;
  const ZH_PT  = 80;
  const speakerH = (SPEAKER_PT * PT_IN) * 2.2;
  const engH = (ENG_PT * PT_IN) * 2.8;   // taller box so wrapped text doesn't overflow
  const zhH  = (ZH_PT  * PT_IN) * 2.8;
  const BLOCK_GAP = 0.4;                  // gap between EN and ZH boxes — no overlap

  const ICON_SIZE = 0.55;
  const ICON_X = SLIDE_W - MARGIN_X - ICON_SIZE;
  const TEXT_W = CONTENT_W - ICON_SIZE - 0.15;

  // Center the full block vertically
  const BLOCK_H = speakerH + engH + BLOCK_GAP + zhH;
  const startY = (SLIDE_H - BLOCK_H) / 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const slide = prs.addSlide();

    // Pure white background
    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fill: { color: 'FFFFFF' },
      line: { color: 'FFFFFF', width: 0 },
    });

    // ── Speaker name ───────────────────────────────────────────────
    if (line.speaker) {
      slide.addText(`${line.speaker}:`, {
        x: MARGIN_X, y: startY, w: TEXT_W, h: speakerH,
        fontSize: SPEAKER_PT, bold: true, color: '666666',
        fontFace: 'Arial', align: 'left', valign: 'top',
      });
    }

    const engY = startY + speakerH;

    // ── TTS Audio ──────────────────────────────────────────────────
    if (line.audio) {
      const relId = `dl_${i + 1}`;
      const tmpFile = path.join(os.tmpdir(), `${relId}_${Date.now()}.mp3`);
      fs.writeFileSync(tmpFile, line.audio);
      tempFiles.push(tmpFile);
      const cover = PLAY_BUTTON_COVER ?? undefined;
      const iconY = engY + (engH / 2) - (ICON_SIZE / 2);
      slide.addMedia({
        type: 'audio',
        extn: 'mp3',
        path: tmpFile,
        x: ICON_X,
        y: iconY,
        w: ICON_SIZE,
        h: ICON_SIZE,
        ...(cover ? { cover } : {}),
      });
    }

    // ── Sentence text ──────────────────────────────────────────────
    if (line.aligned && line.aligned.length > 0) {
      const engParts: PptxGenJS.TextProps[] = line.aligned.map(ap => ({
        text: ap.en + ' ',
        options: { bold: true, color: ap.color, fontSize: ENG_PT, fontFace: 'Arial Black', charSpacing: 0 },
      }));
      slide.addText(engParts, {
        x: MARGIN_X, y: engY, w: TEXT_W, h: engH,
        align: 'left', valign: 'top', wrap: true,
      });

      const zhParts: PptxGenJS.TextProps[] = line.aligned
        .filter(ap => ap.zh)
        .map(ap => ({
          text: ap.zh,
          options: { bold: true, color: ap.color, fontSize: ZH_PT, fontFace: 'Microsoft YaHei' },
        }));
      if (zhParts.length) {
        slide.addText(zhParts, {
          x: MARGIN_X, y: engY + engH + BLOCK_GAP, w: TEXT_W, h: zhH,
          align: 'left', valign: 'top', wrap: true,
        });
      }
    } else {
      const sentColor = pickRandom(ALL_COLORS);
      slide.addText(line.eng, {
        x: MARGIN_X, y: engY, w: TEXT_W, h: engH,
        fontSize: ENG_PT, bold: true, color: sentColor,
        fontFace: 'Arial Black', align: 'left', valign: 'top', charSpacing: 0, wrap: true,
      });
      if (line.zh) {
        slide.addText(line.zh, {
          x: MARGIN_X, y: engY + engH + BLOCK_GAP, w: TEXT_W, h: zhH,
          fontSize: ZH_PT, bold: true, color: sentColor,
          fontFace: 'Microsoft YaHei', align: 'left', valign: 'top', wrap: true,
        });
      }
    }
  }
}

function addSentencesSlides(prs: PptxGenJS, sentences: KeySentenceData[], tempFiles: string[]) {
  if (!sentences.length) return;

  const PT_IN = 1 / 72;
  const MARGIN_X = 0.5;
  const CONTENT_W = SLIDE_W - MARGIN_X * 2;

  const ENG_PT = 80;
  const ZH_PT  = 80;
  const engH = (ENG_PT * PT_IN) * 2.2;  // ≈ 2.44 in
  const zhH  = (ZH_PT  * PT_IN) * 2.2;  // ≈ 2.44 in
  const BLOCK_GAP = 0.3;

  const ICON_SIZE = 0.55;
  const ICON_X = SLIDE_W - MARGIN_X - ICON_SIZE;
  const TEXT_W = CONTENT_W - ICON_SIZE - 0.15;

  // Anchor sentence vertically: center in the slide
  const slideCenter = SLIDE_H / 2;
  const BLOCK_H = engH + zhH;
  const startY = slideCenter - BLOCK_H / 2;

  for (let i = 0; i < sentences.length; i++) {
    const ks = sentences[i];
    const slide = prs.addSlide();

    // Pure white background
    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fill: { color: 'FFFFFF' },
      line: { color: 'FFFFFF', width: 0 },
    });

    // ── TTS Audio ──────────────────────────────────────────────────
    if (ks.audio) {
      const relId = `ks_${i + 1}`;
      const tmpFile = path.join(os.tmpdir(), `${relId}_${Date.now()}.mp3`);
      fs.writeFileSync(tmpFile, ks.audio);
      tempFiles.push(tmpFile);
      const cover = PLAY_BUTTON_COVER ?? undefined;
      const iconY = startY + (engH / 2) - (ICON_SIZE / 2);
      slide.addMedia({
        type: 'audio',
        extn: 'mp3',
        path: tmpFile,
        x: ICON_X,
        y: iconY,
        w: ICON_SIZE,
        h: ICON_SIZE,
        ...(cover ? { cover } : {}),
      });
    }

    // ── Sentence text ──────────────────────────────────────────────
    if (ks.aligned && ks.aligned.length > 0) {
      // Aligned: word-level color matching
      const engParts: PptxGenJS.TextProps[] = ks.aligned.map(ap => ({
        text: ap.en + ' ',
        options: { bold: true, color: ap.color, fontSize: ENG_PT, fontFace: 'Arial Black', charSpacing: 0 },
      }));
      slide.addText(engParts, {
        x: MARGIN_X, y: startY, w: TEXT_W, h: engH,
        align: 'left', valign: 'top', wrap: true,
      });

      const zhParts: PptxGenJS.TextProps[] = ks.aligned
        .filter(ap => ap.zh)
        .map(ap => ({
          text: ap.zh,
          options: { bold: true, color: ap.color, fontSize: ZH_PT, fontFace: 'Microsoft YaHei' },
        }));
      if (zhParts.length) {
        slide.addText(zhParts, {
          x: MARGIN_X, y: startY + engH, w: TEXT_W, h: zhH,
          align: 'left', valign: 'top', wrap: true,
        });
      }
    } else {
      // Fallback: single random color for both EN + ZH
      const sentColor = pickRandom(ALL_COLORS);
      slide.addText(ks.eng, {
        x: MARGIN_X, y: startY, w: TEXT_W, h: engH,
        fontSize: ENG_PT, bold: true, color: sentColor,
        fontFace: 'Arial Black', align: 'left', valign: 'top', charSpacing: 0, wrap: true,
      });
      if (ks.zh) {
        slide.addText(ks.zh, {
          x: MARGIN_X, y: startY + engH, w: TEXT_W, h: zhH,
          fontSize: ZH_PT, bold: true, color: sentColor,
          fontFace: 'Microsoft YaHei', align: 'left', valign: 'top', wrap: true,
        });
      }
    }
  }
}

function addListSlide(prs: PptxGenJS, heading: string, subheading: string, items: string[]) {
  if (!items.length) return;

  const slide = prs.addSlide();
  addSlideHeader(slide, prs, heading, subheading);

  items.slice(0, 8).forEach((item, i) => {
    slide.addText(`• ${item}`, {
      x: 0.8, y: 1.8 + i * 0.65, w: 11.5, h: 0.6,
      fontSize: 16,
      color: COLORS.darkText,
      fontFace: 'Arial',
      wrap: true,
    });
  });
}

function addSlideHeader(slide: PptxGenJS.Slide, _prs: PptxGenJS, title: string, subtitle?: string) {
  slide.addText(title, {
    x: 0.4, y: 0.15, w: 12, h: 0.65,
    fontSize: 26,
    bold: true,
    color: COLORS.primary,
    fontFace: 'Arial',
    align: 'left',
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.75, w: 12, h: 0.4,
      fontSize: 15,
      color: COLORS.textSecondary,
      fontFace: 'Arial',
      align: 'left',
    });
  }
}

export interface GenerateOptions {
  showPinyin?: boolean;
  wordSentences?: WordSentences[];
  wordAudio?: Map<string, SentenceAudio>;
  keySentences?: KeySentenceData[];
  dialogueLines?: DialogueLineData[];
  dialogueSceneImage?: Buffer | null;  // full-screen scene image before dialogue lines
  dialogueCombinedAudio?: Buffer | null; // combined audio of all dialogue lines
}

export async function generatePptx(lesson: LessonData, options: GenerateOptions = {}): Promise<Buffer> {
  const { showPinyin = false, wordSentences = [], wordAudio = new Map(), keySentences = [], dialogueLines = [], dialogueSceneImage = null, dialogueCombinedAudio = null } = options;

  // Pre-load the play button cover image (cached after first call)
  await getPlayButtonCover();

  // Build a lookup map: lowercase word → sentences
  const sentenceMap = new Map<string, WordSentences>(
    wordSentences.map(ws => [ws.word.toLowerCase(), ws])
  );
  const prs = new PptxGenJS();

  prs.defineLayout({ name: 'CUSTOM', width: SLIDE_W, height: SLIDE_H });
  prs.layout = 'CUSTOM';
  // pptxgenjs uses btoa() internally for document properties — keep them ASCII-only
  prs.title = (lesson.title || 'English Lesson').replace(/[^\x00-\x7F]/g, '').trim() || 'English Lesson';
  prs.author = 'Hex (OpenClaw)';

  // Slide 1: Title
  addTitleSlide(prs, lesson);

  // Slide 2: Objectives
  if (lesson.objectives.length) {
    addObjectivesSlide(prs, lesson.objectives);
  }

  // Slide 3: Introduction
  if (lesson.introduction) {
    addSectionHeader(prs, 'Introduction', '课程介绍');
    addTextSlide(prs, 'Course Introduction', '课程介绍', lesson.introduction);
  }

  // Slide 4: Cultural Differences
  if (lesson.culturalDifferences) {
    addSectionHeader(prs, 'Cultural Differences', '文化差异');
    addTextSlide(prs, 'Cultural Differences', '文化差异', lesson.culturalDifferences);
  }

  // Vocabulary section
  let audioTempFiles: string[] = [];

  if (lesson.vocabulary.length) {
    // Vocabulary section header — 单词学习, centered
    const vocabHeaderSlide = prs.addSlide();
    vocabHeaderSlide.addText('单词学习', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fontSize: 138,
      bold: true,
      color: '095B9F',
      fontFace: 'Microsoft YaHei',
      align: 'center',
      valign: 'middle',
      isTextBox: true,
      autoFit: false,
      shrinkText: false,
    });
    addVocabularySlides(prs, lesson.vocabulary, showPinyin);

    // Word detail slides (one per word with AI example sentences)
    if (wordSentences.length) {
      const exampleSentencesHeaderSlide = prs.addSlide();
      exampleSentencesHeaderSlide.addText('单词例句', {
        x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
        fontSize: 138,
        bold: true,
        color: '095B9F',
        fontFace: 'Microsoft YaHei',
        align: 'center',
        valign: 'middle',
        isTextBox: true,
        autoFit: false,
        shrinkText: false,
      });
      audioTempFiles = addWordDetailSlides(prs, lesson.vocabulary, sentenceMap, showPinyin, wordAudio);
    }
  }

  // Key Sentences section
  if (lesson.keySentences.length || keySentences.length) {
    const enriched = keySentences.length ? keySentences : lesson.keySentences.map(s => ({ eng: s.english, zh: s.chinese }));
    const keySentencesHeaderSlide = prs.addSlide();
    keySentencesHeaderSlide.addText('重点句型', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fontSize: 138,
      bold: true,
      color: '095B9F',
      fontFace: 'Microsoft YaHei',
      align: 'center',
      valign: 'middle',
      isTextBox: true,
      autoFit: false,
      shrinkText: false,
    });
    addSentencesSlides(prs, enriched, audioTempFiles);
  }

  // Dialogue section
  if (dialogueSceneImage || lesson.dialogue.length || dialogueLines.length) {
    const dialogueHeaderSlide = prs.addSlide();
    dialogueHeaderSlide.addText('对话练习', {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fontSize: 138,
      bold: true,
      color: '095B9F',
      fontFace: 'Microsoft YaHei',
      align: 'center',
      valign: 'middle',
      isTextBox: true,
      autoFit: false,
      shrinkText: false,
    });
  }

  // Scene image slide — between Key Sentences and Dialogue (no section header)
  if (dialogueSceneImage) {
    await addDialogueImageSlide(prs, dialogueSceneImage, dialogueCombinedAudio, audioTempFiles);
  }

  // Dialogue line slides
  if (lesson.dialogue.length || dialogueLines.length) {
    const enriched = dialogueLines.length ? dialogueLines : lesson.dialogue.map(d => ({ speaker: d.speaker, eng: d.eng, zh: d.zh }));
    addDialogueSlides(prs, enriched, audioTempFiles);
  }

  // Pronunciation notes
  if (lesson.pronunciationNotes.length) {
    addListSlide(prs, 'Pronunciation Notes', '发音要点', lesson.pronunciationNotes);
  }

  // Teaching notes
  if (lesson.teachingNotes.length) {
    addListSlide(prs, 'Teaching Notes', '教学备注', lesson.teachingNotes);
  }

  // End slide
  const endSlide = prs.addSlide();
  endSlide.addText([
    { text: 'Good night!', options: { breakLine: true } },
    { text: 'See you next time', options: { breakLine: true } },
    { text: 'Take care.', options: { breakLine: false } },
  ], {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fontSize: 115,
    bold: true,
    color: 'FF857E',
    fontFace: 'Arial Black',
    align: 'center',
    valign: 'middle',
    isTextBox: true,
    autoFit: false,
    shrinkText: false,
  });

  // Use base64 output to avoid CJK btoa() issues in Next.js server environment
  const b64 = (await prs.write({ outputType: 'base64' })) as string;

  // Clean up temp MP3 files after pptxgenjs has finished reading them
  for (const tmpFile of audioTempFiles) {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }

  // Fix pptxgenjs bug: it writes <a:videoFile> even for audio type.
  // Post-process the PPTX zip to replace with the correct <a:audioFile>.
  // This is what makes audio click-to-play correctly in WPS and PowerPoint.
  const rawBuffer = Buffer.from(b64, 'base64');
  return fixAudioXml(rawBuffer);
}
