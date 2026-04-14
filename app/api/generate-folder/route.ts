import { NextRequest, NextResponse } from 'next/server';
import { parseLesson } from '@/lib/parseLesson';
import { generatePptx } from '@/lib/generatePptx';
import { generateSentencesForWords, enrichWithAlignment } from '@/lib/aiSentences';
import { readdir, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import JSZip from 'jszip';

export async function POST(req: NextRequest) {
  try {
    const { folderPath, showPinyin, showSentences } = await req.json();
    const claudeApiKey = req.headers.get('x-claude-key') || undefined;

    if (!folderPath || typeof folderPath !== 'string') {
      return NextResponse.json({ error: 'Missing folderPath' }, { status: 400 });
    }

    // Security: only allow absolute paths (no traversal tricks)
    const resolvedPath = folderPath.trim();
    if (!resolvedPath.startsWith('/')) {
      return NextResponse.json({ error: 'Please provide an absolute folder path (starting with /)' }, { status: 400 });
    }

    let entries: string[];
    try {
      entries = await readdir(resolvedPath);
    } catch {
      return NextResponse.json({ error: `Cannot read folder: ${resolvedPath}` }, { status: 400 });
    }

    const mdFiles = entries.filter(f => extname(f).toLowerCase() === '.md');
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: 'No .md files found in that folder' }, { status: 400 });
    }

    const zip = new JSZip();
    const results: { file: string; status: string }[] = [];

    for (const mdFile of mdFiles) {
      try {
        const fullPath = join(resolvedPath, mdFile);
        const markdown = await readFile(fullPath, 'utf8');
        const lesson = parseLesson(markdown);

        const wordSentences = showSentences && lesson.vocabulary.length
          ? await enrichWithAlignment(
              await generateSentencesForWords(lesson.vocabulary.map(v => v.word), claudeApiKey),
              claudeApiKey,
            )
          : [];

        const pptxBuffer = await generatePptx(lesson, { showPinyin: !!showPinyin, wordSentences });

        const safeName = basename(mdFile, '.md')
          .replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _-]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 60) + '.pptx';

        zip.file(safeName, pptxBuffer);
        results.push({ file: mdFile, status: 'ok' });
      } catch (e) {
        results.push({ file: mdFile, status: `error: ${e}` });
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    return new NextResponse(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="lessons.zip"',
        'X-Generation-Results': JSON.stringify(results),
      },
    });
  } catch (err) {
    console.error('Folder generation error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
