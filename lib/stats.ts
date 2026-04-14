import fs from 'fs';
import path from 'path';
import os from 'os';

export interface GenerationRecord {
  id: string;
  timestamp: number;
  status: 'success' | 'failed';
  lessonTitle: string;
  slideCount: number;
  durationMs: number;
  tokensUsed: number;
  imageGenerated: boolean;
  audioCount: number;
  errorMessage?: string;
}

export interface StatsData {
  records: GenerationRecord[];
  totalTokensUsed: number;
}

const STATS_FILE = path.join(os.tmpdir(), 'ppt-generator-stats.json');

function loadStats(): StatsData {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    }
  } catch {}
  return { records: [], totalTokensUsed: 0 };
}

function saveStats(data: StatsData) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[stats] Failed to save stats:', e);
  }
}

export function recordGeneration(record: GenerationRecord) {
  const data = loadStats();
  data.records.unshift(record); // newest first
  if (data.records.length > 100) data.records = data.records.slice(0, 100); // keep last 100
  data.totalTokensUsed += record.tokensUsed;
  saveStats(data);
}

export function getStats(): StatsData {
  return loadStats();
}
