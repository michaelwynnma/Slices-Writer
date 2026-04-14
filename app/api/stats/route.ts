import { NextResponse } from 'next/server';
import { getStats } from '@/lib/stats';

const CLAUDE_BASE_URL = process.env.CLAUDE_BASE_URL ?? 'https://api-aigw.corp.hongsong.club/v1';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY ?? 'sk-internal-294b0f9a658d474f91615ccd';
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL ?? 'https://api-aigw.corp.hongsong.club/v1beta/models';
const IMAGE_API_KEY = process.env.IMAGE_API_KEY ?? 'sk-internal-294b0f9a658d474f91615ccd';
const TTS_BASE_URL = process.env.TTS_BASE_URL ?? 'https://api-aigw.corp.hongsong.club/v1';

async function checkClaudeApi(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${CLAUDE_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${CLAUDE_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e.message };
  }
}

async function checkImageApi(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${IMAGE_BASE_URL}/gemini-3.1-flash-image-preview`, {
      headers: { Authorization: `Bearer ${IMAGE_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    // Any response (even 4xx) means the server is reachable
    return { ok: res.status < 500, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e.message };
  }
}

async function checkTtsApi(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${TTS_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${CLAUDE_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: e.message };
  }
}

export async function GET() {
  const [stats, claudeStatus, imageStatus, ttsStatus] = await Promise.all([
    Promise.resolve(getStats()),
    checkClaudeApi(),
    checkImageApi(),
    checkTtsApi(),
  ]);

  const records = stats.records;
  const total = records.length;
  const successful = records.filter(r => r.status === 'success').length;
  const failed = records.filter(r => r.status === 'failed').length;
  const avgDuration = total > 0
    ? Math.round(records.reduce((s, r) => s + r.durationMs, 0) / total)
    : 0;

  return NextResponse.json({
    summary: { total, successful, failed, totalTokensUsed: stats.totalTokensUsed, avgDurationMs: avgDuration },
    apiStatus: {
      claude: claudeStatus,
      image: imageStatus,
      tts: ttsStatus,
    },
    recentRecords: records.slice(0, 20),
  });
}
