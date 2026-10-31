import { useState } from 'react';
import { GlucoseReading } from './types';
import { glucoseStorage } from './glucoseStorage';
import { deleteGlucoseReadingApi } from './api';
import { Clock, Mic, FileText, Keyboard, Trash2, CheckCircle2, CloudUpload, RefreshCw } from 'lucide-react';

interface Props {
  readings: GlucoseReading[];
  onDeleted: (id: string) => void;
  onRefresh?: () => void;
}

export function GlucoseHistoryList({ readings, onDeleted, onRefresh }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const getSeverity = (val: number) => {
    if (val < 70) return { label: 'Low', bg: 'bg-rose-100 text-rose-800 border-rose-200' };
    if (val <= 140) return { label: 'Target', bg: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    if (val <= 180) return { label: 'Elevated', bg: 'bg-amber-100 text-amber-800 border-amber-200' };
    if (val <= 250) return { label: 'High', bg: 'bg-orange-100 text-orange-800 border-orange-200' };
    return { label: 'Critical', bg: 'bg-red-200 text-red-900 border-red-300 font-extrabold' };
  };

  const getSourceIcon = (src: string) => {
    switch (src) {
      case 'voice':
        return <Mic className="w-3.5 h-3.5 text-emerald-600" title="Voice Recorded" />;
      case 'lab_scan':
        return <FileText className="w-3.5 h-3.5 text-blue-600" title="Lab Scan Auto-filled" />;
      default:
        return <Keyboard className="w-3.5 h-3.5 text-gray-500" title="Manual Entry" />;
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await glucoseStorage.deleteReading(id);
      await deleteGlucoseReadingApi(id);
      onDeleted(id);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  };

  if (readings.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100/90 mt-4">
      <div className="flex items-center justify-between mb-3.5">
        <h4 className="font-bold text-base text-[#1D1D1F]">Recent Log History</h4>
        <span className="text-xs text-gray-500 font-medium">{readings.length} entries</span>
      </div>

      <div className="space-y-2.5">
        {readings.map((reading) => {
          const sev = getSeverity(reading.value_mgdl);
          const isPendingSync = !reading.syncedAt;

          return (
            <div
              key={reading.id}
              className="p-3.5 rounded-2xl bg-[#F5F5F7] border border-gray-200/70 flex items-center justify-between hover:bg-gray-100/70 transition-colors"
            >
              {/* Left: Value & Badges */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-start min-w-[70px]">
                  <span className="text-xl font-extrabold text-[#1D1D1F] tracking-tight">
                    {reading.value_mgdl}
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium uppercase">
                    {reading.unit_entered}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sev.bg}`}
                    >
                      {sev.label}
                    </span>

                    <span className="text-[10px] bg-white text-gray-700 font-medium px-2 py-0.5 rounded-full border border-gray-200 capitalize">
                      {reading.context.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span>
                      {new Date(reading.measuredAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Source & Sync Indicator & Delete */}
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-2xs"
                  title={`Source: ${reading.source}`}
                >
                  {getSourceIcon(reading.source)}
                </div>

                {isPendingSync ? (
                  <span
                    className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200"
                    title="Saved locally on device; pending cloud sync"
                  >
                    <CloudUpload className="w-3 h-3 text-amber-600 animate-pulse" />
                    <span className="hidden sm:inline">Offline</span>
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200"
                    title="Synced with server"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span className="hidden sm:inline">Synced</span>
                  </span>
                )}

                <button
                  type="button"
                  disabled={deletingId === reading.id}
                  onClick={() => handleDelete(reading.id)}
                  className="w-7 h-7 rounded-xl hover:bg-rose-50 hover:text-rose-600 text-gray-400 flex items-center justify-center transition-colors active:scale-95"
                  title="Delete record"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
