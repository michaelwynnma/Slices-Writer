'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface ApiStatus {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface DashboardData {
  summary: {
    total: number;
    successful: number;
    failed: number;
    totalTokensUsed: number;
    avgDurationMs: number;
  };
  apiStatus: {
    claude: ApiStatus;
    image: ApiStatus;
    tts: ApiStatus;
  };
  recentRecords: Array<{
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
  }>;
}

function StatusBadge({ ok, latencyMs, error }: ApiStatus) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${ok ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
      {ok ? `Online · ${latencyMs}ms` : `Offline${error ? ` · ${error.slice(0, 30)}` : ''}`}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="text-slate-400 text-sm mb-1">{label}</div>
      <div className={`text-3xl font-bold ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        setData(await res.json());
        setLastRefresh(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const successRate = data
    ? data.summary.total > 0
      ? Math.round((data.summary.successful / data.summary.total) * 100)
      : 0
    : 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">📊 PPT Generator Dashboard</h1>
            <p className="text-slate-400 text-sm mt-1">
              {lastRefresh ? `Last updated: ${lastRefresh.toLocaleTimeString('zh-CN', { hour12: false })} · Auto-refreshes every 30s` : 'Loading...'}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchData}
              className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              🔄 Refresh
            </button>
            <Link
              href="/"
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              ← Back to App
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-20">Loading dashboard...</div>
        ) : !data ? (
          <div className="text-center text-red-400 py-20">Failed to load stats</div>
        ) : (
          <>
            {/* API Status */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
              <h2 className="text-slate-300 font-semibold mb-4">🔌 API Connection Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Claude AI (Text)</span>
                  <StatusBadge {...data.apiStatus.claude} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">Image API</span>
                  <StatusBadge {...data.apiStatus.image} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">TTS Audio</span>
                  <StatusBadge {...data.apiStatus.tts} />
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="Total Generated" value={data.summary.total} sub="all time" />
              <StatCard
                label="Successful"
                value={data.summary.successful}
                sub={`${successRate}% success rate`}
                color="text-green-400"
              />
              <StatCard
                label="Failed"
                value={data.summary.failed}
                sub={data.summary.failed > 0 ? 'needs attention' : 'all good!'}
                color={data.summary.failed > 0 ? 'text-red-400' : 'text-slate-400'}
              />
              <StatCard
                label="Avg Duration"
                value={formatDuration(data.summary.avgDurationMs)}
                sub="per generation"
              />
            </div>

            {/* Recent Activity */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h2 className="text-slate-300 font-semibold mb-4">📋 Recent Generations</h2>
              {data.recentRecords.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-8">
                  No generations yet. Go generate some PPTXs! 🎉
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-700">
                        <th className="text-left py-2 pr-4">Time</th>
                        <th className="text-left py-2 pr-4">Lesson</th>
                        <th className="text-left py-2 pr-4">Status</th>
                        <th className="text-left py-2 pr-4">Duration</th>
                        <th className="text-left py-2 pr-4">Words</th>
                        <th className="text-left py-2 pr-4">Audio</th>
                        <th className="text-left py-2">Image</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentRecords.map(r => (
                        <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="py-2 pr-4 text-slate-400 text-xs whitespace-nowrap">{formatTime(r.timestamp)}</td>
                          <td className="py-2 pr-4 text-white max-w-[180px] truncate" title={r.lessonTitle}>{r.lessonTitle}</td>
                          <td className="py-2 pr-4">
                            {r.status === 'success' ? (
                              <span className="text-green-400 font-medium">✅ Success</span>
                            ) : (
                              <span className="text-red-400 font-medium" title={r.errorMessage}>❌ Failed</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-slate-300">{formatDuration(r.durationMs)}</td>
                          <td className="py-2 pr-4 text-slate-300">{r.slideCount}</td>
                          <td className="py-2 pr-4 text-slate-300">{r.audioCount}</td>
                          <td className="py-2 text-slate-300">{r.imageGenerated ? '🖼️' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
