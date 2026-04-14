'use client';

import Link from 'next/link';
import { useState, useCallback, useRef, useEffect } from 'react';

const SAMPLE_MD = `# Barber Shop English
## Course Info
- Level: 6
- Target Group: Adults 50+
- Duration: 60 min

## Objectives
- Learn vocabulary for a barber shop visit
- Practice asking for a haircut

## Vocabulary
| Word | IPA | 中文 | 辅助发音 | 记忆口诀 |
|------|-----|------|----------|----------|
| haircut | /ˈhɛrkʌt/ | 理发 | 嗨-卡特 | 嗨，卡特给我剪头发 |
| scissors | /ˈsɪzərz/ | 剪刀 | 西泽斯 | 西泽用剪刀 |

## Key Sentences
| Speaker | English | Chinese |
|---------|---------|---------|
| Customer | I'd like a haircut, please. | 我想理发。 |
| Barber | How would you like it? | 您想怎么剪？ |

## Dialogue
| Role | English | Chinese |
|------|---------|---------|
| Customer | Good morning! | 早上好！ |
| Barber | Welcome! Please sit down. | 欢迎！请坐。 |

## Pronunciation Notes
- "haircut" — stress on first syllable: HAIR-cut
- "scissors" — the sc is silent, say SIZ-erz

## Teaching Notes
- Bring props: a comb, scissors (plastic), mirror
- Role-play the dialogue in pairs
`;

type Tab = 'paste' | 'file' | 'folder';

interface FolderResult {
  file: string;
  status: string;
}

// ── shared helper: trigger browser download from a blob ──
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── extract filename from Content-Disposition header ──
function extractFilename(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/);
  return m ? decodeURIComponent(m[1]) : fallback;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('paste');

  // ── Paste tab state ──
  const [markdown, setMarkdown] = useState('');
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteStatus, setPasteStatus] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [pasteSuccess, setPasteSuccess] = useState('');
  const [pasteWarning, setPasteWarning] = useState('');

  // ── File tab state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileStatus, setFileStatus] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileSuccess, setFileSuccess] = useState('');
  const [fileWarning, setFileWarning] = useState('');

  // ── Folder tab state ──
  const [folderPath, setFolderPath] = useState('');
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderStatus, setFolderStatus] = useState('');
  const [folderError, setFolderError] = useState('');
  const [folderResults, setFolderResults] = useState<FolderResult[]>([]);
  const [folderSuccess, setFolderSuccess] = useState('');

  // ── Shared options ──
  const [showPinyin, setShowPinyin] = useState(true);
  const [showSentences, setShowSentences] = useState(true);
  const [generateSceneImage, setGenerateSceneImage] = useState(true);

  // ── API key settings ──
  const [apiKeys, setApiKeys] = useState({ claudeKey: '', ttsKey: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsKeys, setSettingsKeys] = useState({ claudeKey: '', ttsKey: '' });

  useEffect(() => {
    const saved = {
      claudeKey: localStorage.getItem('ppt_claude_key') ?? '',
      ttsKey:    localStorage.getItem('ppt_tts_key')    ?? '',
    };
    setApiKeys(saved);
  }, []);

  const saveSettings = () => {
    localStorage.setItem('ppt_claude_key', settingsKeys.claudeKey);
    localStorage.setItem('ppt_tts_key',    settingsKeys.ttsKey);
    setApiKeys(settingsKeys);
    setShowSettings(false);
  };
  const switchTab = (t: Tab) => {
    setTab(t);
    setPasteError(''); setPasteSuccess(''); setPasteWarning(''); setPasteStatus('');
    setFileError(''); setFileSuccess(''); setFileWarning(''); setFileStatus('');
    setFolderError(''); setFolderSuccess(''); setFolderResults([]); setFolderStatus('');
  };

  // ═══════════════════════════════════════
  // 1. PASTE → generate single PPTX
  // ═══════════════════════════════════════
  const handlePasteGenerate = useCallback(async () => {
    if (!markdown.trim()) { setPasteError('Please paste your lesson markdown first.'); return; }
    setPasteLoading(true); setPasteError(''); setPasteSuccess(''); setPasteWarning(''); setPasteStatus('');

    const hasDialogue = /^## Dialogue/im.test(markdown);
    setPasteStatus('⚙️ Parsing lesson...');
    const statusTimer = (hasDialogue && generateSceneImage) ? setTimeout(() => {
      setPasteStatus('🎨 Generating dialogue scene image (this takes ~2 min)...');
    }, 3000) : null;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKeys.claudeKey && { 'x-claude-key': apiKeys.claudeKey }),
          ...(apiKeys.ttsKey    && { 'x-tts-key':    apiKeys.ttsKey }),
        },
        body: JSON.stringify({ markdown, showPinyin, showSentences, generateSceneImage }),
      });
      if (statusTimer) clearTimeout(statusTimer);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Generation failed'); }
      const warning = res.headers.get('X-Sentence-Warning');
      if (warning) setPasteWarning(warning);
      setPasteStatus('📥 Downloading...');
      const blob = await res.blob();
      const filename = extractFilename(res, 'lesson.pptx');
      triggerDownload(blob, filename);
      setPasteSuccess(`Downloaded "${filename}" successfully!`);
    } catch (err) {
      if (statusTimer) clearTimeout(statusTimer);
      setPasteError(String(err));
    } finally {
      setPasteLoading(false);
      setPasteStatus('');
    }
  }, [markdown, showPinyin, showSentences, generateSceneImage]);

  // ═══════════════════════════════════════
  // 2. FILE UPLOAD → generate single PPTX
  // ═══════════════════════════════════════
  const handleFileGenerate = useCallback(async () => {
    if (!selectedFile) { setFileError('Please select a .md file first.'); return; }
    setFileLoading(true); setFileError(''); setFileSuccess(''); setFileWarning(''); setFileStatus('');
    setFileStatus('⚙️ Parsing lesson...');
    const statusTimer = generateSceneImage ? setTimeout(() => {
      setFileStatus('🎨 Generating dialogue scene image (this takes ~2 min)...');
    }, 3000) : null;
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('showPinyin', String(showPinyin));
      formData.append('showSentences', String(showSentences));
      formData.append('generateSceneImage', String(generateSceneImage));
      const extraHeaders: Record<string, string> = {};
      if (apiKeys.claudeKey) extraHeaders['x-claude-key'] = apiKeys.claudeKey;
      if (apiKeys.ttsKey)    extraHeaders['x-tts-key']    = apiKeys.ttsKey;
      const res = await fetch('/api/generate-file', { method: 'POST', body: formData, headers: extraHeaders });
      if (statusTimer) clearTimeout(statusTimer);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Generation failed'); }
      const warning = res.headers.get('X-Sentence-Warning');
      if (warning) setFileWarning(warning);
      setFileStatus('📥 Downloading...');
      const blob = await res.blob();
      const filename = extractFilename(res, selectedFile.name.replace('.md', '.pptx'));
      triggerDownload(blob, filename);
      setFileSuccess(`Downloaded "${filename}" successfully!`);
    } catch (err) {
      if (statusTimer) clearTimeout(statusTimer);
      setFileError(String(err));
    } finally {
      setFileLoading(false);
      setFileStatus('');
    }
  }, [selectedFile, showPinyin, showSentences, generateSceneImage]);

  // ═══════════════════════════════════════
  // 3. FOLDER PATH → batch ZIP download
  // ═══════════════════════════════════════
  const handleFolderGenerate = useCallback(async () => {
    if (!folderPath.trim()) { setFolderError('Please enter a folder path.'); return; }
    setFolderLoading(true); setFolderError(''); setFolderSuccess(''); setFolderResults([]); setFolderStatus('');
    setFolderStatus('⚙️ Processing files...');
    const statusTimer = generateSceneImage ? setTimeout(() => {
      setFolderStatus('🎨 Generating dialogue scene images (this takes ~2 min per file)...');
    }, 3000) : null;
    try {
      const res = await fetch('/api/generate-folder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKeys.claudeKey && { 'x-claude-key': apiKeys.claudeKey }),
        },
        body: JSON.stringify({ folderPath: folderPath.trim(), showPinyin, showSentences, generateSceneImage }),
      });
      if (statusTimer) clearTimeout(statusTimer);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Generation failed'); }

      // Parse per-file results from header
      const resultsHeader = res.headers.get('X-Generation-Results');
      if (resultsHeader) {
        try { setFolderResults(JSON.parse(resultsHeader)); } catch { /* ignore */ }
      }

      setFolderStatus('📥 Downloading...');
      const blob = await res.blob();
      triggerDownload(blob, 'lessons.zip');
      setFolderSuccess('Downloaded lessons.zip successfully!');
    } catch (err) {
      if (statusTimer) clearTimeout(statusTimer);
      setFolderError(String(err));
    } finally {
      setFolderLoading(false);
      setFolderStatus('');
    }
  }, [folderPath, showPinyin]);

  const tabClass = (t: Tab) =>
    `px-5 py-2.5 rounded-lg text-sm font-semibold transition-all border ${
      tab === t
        ? 'bg-amber-500 text-white border-amber-400 shadow-md'
        : 'bg-white/10 text-white/70 border-white/10 hover:bg-white/20 hover:text-white'
    }`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-start py-12 px-4">
      {/* Header */}
      <div className="text-center mb-10 relative w-full max-w-4xl">
        <h1 className="text-4xl font-bold text-white mb-2">English Lessons PPT Generator</h1>
        <p className="text-blue-300 text-lg">God blesses English Lessons.</p>
        <button
          onClick={() => { setSettingsKeys(apiKeys); setShowSettings(true); }}
          className="absolute top-0 right-0 text-white/40 hover:text-white transition text-2xl"
          title="API Key Settings"
        >⚙️</button>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-white font-bold text-lg mb-1">API Key Settings</h2>
            <p className="text-slate-400 text-sm mb-5">Leave blank to use the server&apos;s default keys.</p>

            <label className="block text-slate-300 text-sm mb-1">Claude API Key <span className="text-slate-500">(AI sentences &amp; alignment)</span></label>
            <input
              type="password"
              value={settingsKeys.claudeKey}
              onChange={e => setSettingsKeys(k => ({ ...k, claudeKey: e.target.value }))}
              placeholder="sk-..."
              className="w-full bg-slate-900 text-slate-100 rounded-lg px-3 py-2 text-sm border border-white/10 focus:border-blue-400 focus:outline-none mb-4 font-mono"
            />

            <label className="block text-slate-300 text-sm mb-1">TTS API Key <span className="text-slate-500">(audio generation)</span></label>
            <input
              type="password"
              value={settingsKeys.ttsKey}
              onChange={e => setSettingsKeys(k => ({ ...k, ttsKey: e.target.value }))}
              placeholder="sk-..."
              className="w-full bg-slate-900 text-slate-100 rounded-lg px-3 py-2 text-sm border border-white/10 focus:border-blue-400 focus:outline-none mb-6 font-mono"
            />

            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition">Cancel</button>
              <button onClick={saveSettings} className="px-5 py-2 text-sm bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold transition">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-3 mb-6">
        <button onClick={() => switchTab('paste')} className={tabClass('paste')}>✏️ Paste Text</button>
        <button onClick={() => switchTab('file')} className={tabClass('file')}>📄 Upload File</button>
        <button onClick={() => switchTab('folder')} className={tabClass('folder')}>📁 Folder Batch</button>
      </div>

      {/* ── Tab 1: Paste ── */}
      {tab === 'paste' && (
        <div className="w-full max-w-4xl bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setMarkdown(SAMPLE_MD)}
              className="px-4 py-2 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition border border-white/10"
            >
              Load Sample
            </button>
            <button
              onClick={() => { setMarkdown(''); setPasteError(''); setPasteSuccess(''); }}
              className="px-4 py-2 text-sm rounded-lg bg-white/10 text-white hover:bg-white/20 transition border border-white/10"
            >
              Clear
            </button>
            <div className="flex-1" />
            <span className="text-white/40 text-sm self-center">
              {markdown ? `${markdown.split('\n').length} lines` : 'No content'}
            </span>
          </div>

          <textarea
            value={markdown}
            onChange={e => { setMarkdown(e.target.value); setPasteError(''); setPasteSuccess(''); }}
            placeholder="Paste your lesson markdown here..."
            className="w-full h-72 bg-slate-900/60 text-slate-100 rounded-xl p-4 font-mono text-sm border border-white/10 focus:border-blue-400 focus:outline-none resize-y placeholder-slate-500"
          />

          {pasteError && <AlertBox type="error" message={pasteError} />}
          {pasteWarning && <AlertBox type="warning" message={pasteWarning} />}
          {pasteSuccess && <AlertBox type="success" message={pasteSuccess} />}
          {pasteStatus && <StatusBar status={pasteStatus} />}

          <PinyinCheckbox checked={showPinyin} onChange={setShowPinyin} />
          <SentencesCheckbox checked={showSentences} onChange={setShowSentences} />
          <SceneImageCheckbox checked={generateSceneImage} onChange={setGenerateSceneImage} />
          <GenerateButton loading={pasteLoading} disabled={!markdown.trim()} onClick={handlePasteGenerate} />
        </div>
      )}

      {/* ── Tab 2: File Upload ── */}
      {tab === 'file' && (
        <div className="w-full max-w-4xl bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl">
          <p className="text-slate-300 text-sm mb-5">
            Upload a <code className="bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded">.md</code> file and generate a PPTX from it.
          </p>

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f?.name.endsWith('.md')) { setSelectedFile(f); setFileError(''); setFileSuccess(''); }
              else setFileError('Only .md files are supported');
            }}
            className="border-2 border-dashed border-white/20 hover:border-amber-400/60 rounded-xl p-10 text-center cursor-pointer transition-colors"
          >
            {selectedFile ? (
              <div>
                <div className="text-3xl mb-2">📄</div>
                <p className="text-white font-semibold">{selectedFile.name}</p>
                <p className="text-slate-400 text-sm mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                <button
                  onClick={e => { e.stopPropagation(); setSelectedFile(null); setFileError(''); setFileSuccess(''); }}
                  className="mt-3 text-xs text-red-400 hover:text-red-300 underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <div className="text-4xl mb-3">⬆️</div>
                <p className="text-slate-300">Click to select or drag & drop a <strong>.md</strong> file</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) { setSelectedFile(f); setFileError(''); setFileSuccess(''); }
            }}
          />

          {fileError && <AlertBox type="error" message={fileError} />}
          {fileWarning && <AlertBox type="warning" message={fileWarning} />}
          {fileSuccess && <AlertBox type="success" message={fileSuccess} />}
          {fileStatus && <StatusBar status={fileStatus} />}

          <PinyinCheckbox checked={showPinyin} onChange={setShowPinyin} />
          <SentencesCheckbox checked={showSentences} onChange={setShowSentences} />
          <SceneImageCheckbox checked={generateSceneImage} onChange={setGenerateSceneImage} />
          <GenerateButton loading={fileLoading} disabled={!selectedFile} onClick={handleFileGenerate} />
        </div>
      )}

      {/* ── Tab 3: Folder Batch ── */}
      {tab === 'folder' && (
        <div className="w-full max-w-4xl bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl">
          <p className="text-slate-300 text-sm mb-5">
            Enter the <strong>absolute path</strong> to a folder containing <code className="bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded">.md</code> files.
            All files will be converted and bundled into a single <strong>lessons.zip</strong> download.
          </p>

          <div className="flex gap-3">
            <input
              type="text"
              value={folderPath}
              onChange={e => { setFolderPath(e.target.value); setFolderError(''); setFolderSuccess(''); setFolderResults([]); }}
              placeholder="/Users/you/lessons"
              className="flex-1 bg-slate-900/60 text-slate-100 rounded-xl px-4 py-3 font-mono text-sm border border-white/10 focus:border-blue-400 focus:outline-none placeholder-slate-500"
            />
          </div>

          {folderError && <AlertBox type="error" message={folderError} />}
          {folderSuccess && <AlertBox type="success" message={folderSuccess} />}
          {folderStatus && <StatusBar status={folderStatus} />}

          {/* Per-file results */}
          {folderResults.length > 0 && (
            <div className="mt-4 bg-slate-900/50 rounded-xl p-4 border border-white/10">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">
                Generation Results ({folderResults.length} files)
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {folderResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span>{r.status === 'ok' ? '✅' : '❌'}</span>
                    <span className="text-slate-300 font-mono">{r.file}</span>
                    {r.status !== 'ok' && (
                      <span className="text-red-400 text-xs">{r.status}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <PinyinCheckbox checked={showPinyin} onChange={setShowPinyin} />
          <SentencesCheckbox checked={showSentences} onChange={setShowSentences} />
          <SceneImageCheckbox checked={generateSceneImage} onChange={setGenerateSceneImage} />
          <GenerateButton
            loading={folderLoading}
            disabled={!folderPath.trim()}
            onClick={handleFolderGenerate}
            label={folderLoading ? 'Generating slides...' : 'Generate All & Download ZIP'}
          />
        </div>
      )}

      {/* ── Format Guide ── */}
      <div className="w-full max-w-4xl mt-8 bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-4 text-lg">Markdown Format Guide</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {[
            ['# Lesson Title', 'Title slide'],
            ['## Course Info', 'Level, Target Group, Duration'],
            ['## Objectives', 'Bullet list of goals'],
            ['## Introduction', 'Free text (Chinese OK)'],
            ['## Cultural Differences', 'Free text'],
            ['## Vocabulary', 'Table: word | IPA | 中文 | 辅助 | 口诀'],
            ['## Key Sentences', 'Table: Speaker | English | Chinese'],
            ['## Dialogue', 'Table: Role | English | Chinese'],
            ['## Pronunciation Notes', 'Bullet list'],
            ['## Teaching Notes', 'Bullet list'],
          ].map(([code, desc]) => (
            <div key={code} className="flex gap-3 items-start">
              <code className="bg-slate-800 text-amber-300 px-2 py-0.5 rounded text-xs shrink-0">{code}</code>
              <span className="text-slate-400">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

// ── Shared UI components ──

function AlertBox({ type, message }: { type: 'error' | 'success' | 'warning'; message: string }) {
  return (
    <div className={`mt-3 p-3 rounded-lg text-sm border ${
      type === 'error'
        ? 'bg-red-900/40 border-red-500/40 text-red-300'
        : type === 'warning'
        ? 'bg-amber-900/40 border-amber-500/40 text-amber-300'
        : 'bg-green-900/40 border-green-500/40 text-green-300'
    }`}>
      {type === 'error' ? '⚠ Error: ' : type === 'warning' ? '⚠ Warning: ' : ''}{message}
    </div>
  );
}

// ── Progress/status bar shown during generation ──
function StatusBar({ status }: { status: string }) {
  if (!status) return null;

  // Map status text to a progress percentage
  const steps = [
    { match: /parsing/i,       pct: 10,  label: status },
    { match: /generating.*audio|tts/i, pct: 35, label: status },
    { match: /generating.*image|scene/i, pct: 65, label: status },
    { match: /building|creating.*pptx/i, pct: 85, label: status },
    { match: /download/i,      pct: 98,  label: status },
  ];
  const step = steps.find(s => s.match.test(status)) ?? { pct: 20, label: status };

  return (
    <div className="mt-4 rounded-xl bg-gray-800/60 border border-gray-700 p-4">
      {/* Status text */}
      <p className="text-sm text-blue-300 animate-pulse mb-2 font-medium">{step.label}</p>
      {/* Progress bar */}
      <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
        <div
          className="h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700 ease-out"
          style={{ width: `${step.pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1.5 text-right">{step.pct}%</p>
    </div>
  );
}

function SceneImageCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer mt-4 mb-2 select-none w-fit">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-violet-500"
      />
      <span className="text-slate-300 text-sm">🎨 Generate dialogue scene image <span className="text-slate-500 text-xs">(~2 min)</span></span>
    </label>
  );
}

function PinyinCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer mt-4 mb-2 select-none w-fit">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-amber-400"
      />
      <span className="text-slate-200 text-sm">
        显示中文辅助发音 <span className="text-slate-400 text-xs">(Add Chinese pronunciation aid to vocab slides)</span>
      </span>
    </label>
  );
}

function SentencesCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer mt-1 mb-2 select-none w-fit">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-blue-400"
      />
      <span className="text-slate-200 text-sm">
        AI 例句幻灯片 <span className="text-slate-400 text-xs">(Generate one-word-per-slide with 2 AI example sentences)</span>
      </span>
    </label>
  );
}


function GenerateButton({ loading, disabled, onClick, label }: {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="mt-5 w-full py-4 rounded-xl font-bold text-lg transition-all bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg"
    >
      {label ?? (loading ? 'Generating slides...' : 'Generate PowerPoint')}
    </button>
  );
}
