import { useState, useMemo } from 'react';
import { GlucoseReading } from './types';
import { TrendingUp, Calendar, Info } from 'lucide-react';

interface Props {
  readings: GlucoseReading[];
  onSelectReading?: (reading: GlucoseReading) => void;
}

export function GlucoseTrendChart({ readings, onSelectReading }: Props) {
  const [daysWindow, setDaysWindow] = useState<7 | 30>(7);
  const [activeReading, setActiveReading] = useState<GlucoseReading | null>(null);

  // Filter readings within window
  const filteredReadings = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysWindow);
    return readings
      .filter((r) => new Date(r.measuredAt) >= cutoff)
      .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());
  }, [readings, daysWindow]);

  // Statistics
  const stats = useMemo(() => {
    if (filteredReadings.length === 0) {
      return { avg: 0, min: 0, max: 0, inRangePct: 0 };
    }
    const values = filteredReadings.map((r) => r.value_mgdl);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = Math.round(sum / values.length);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const inRangeCount = values.filter((v) => v >= 70 && v <= 140).length;
    const inRangePct = Math.round((inRangeCount / values.length) * 100);
    return { avg, min, max, inRangePct };
  }, [filteredReadings]);

  // Chart dimensions
  const width = 600;
  const height = 240;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 35;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const yMin = 40;
  const yMax = 320;

  const getY = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    const ratio = (clamped - yMin) / (yMax - yMin);
    return paddingTop + chartH - ratio * chartH;
  };

  const getX = (index: number, total: number) => {
    if (total <= 1) return paddingLeft + chartW / 2;
    return paddingLeft + (index / (total - 1)) * chartW;
  };

  // Normal band Y coordinates (70 to 140)
  const bandTopY = getY(140);
  const bandBottomY = getY(70);
  const bandHeight = bandBottomY - bandTopY;

  // Polyline points
  const pointsString = filteredReadings
    .map((r, i) => `${getX(i, filteredReadings.length)},${getY(r.value_mgdl)}`)
    .join(' ');

  const getSeverityColor = (val: number) => {
    if (val < 70) return '#EF4444'; // Red (Critical Low)
    if (val <= 140) return '#10B981'; // Green (Normal Target)
    if (val <= 180) return '#F59E0B'; // Amber (Elevated)
    if (val <= 250) return '#F97316'; // Orange (High)
    return '#DC2626'; // Deep Red (Critical High)
  };

  const getSeverityLabel = (val: number) => {
    if (val < 70) return 'Critical Low';
    if (val <= 140) return 'In Target';
    if (val <= 180) return 'Elevated';
    if (val <= 250) return 'High';
    return 'Critical High';
  };

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100/90 flex flex-col">
      {/* Header with Title and 7d/30d Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0071E3] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base text-[#1D1D1F]">Glucose Trend & Range</h3>
          </div>
          <p className="text-xs text-[#86868B] mt-0.5">
            Target healthy range: <strong className="text-emerald-600">70 – 140 mg/dL</strong>
          </p>
        </div>

        {/* 7d / 30d Toggle */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setDaysWindow(7);
              setActiveReading(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              daysWindow === 7 ? 'bg-white text-[#0071E3] shadow-xs' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            7 Days
          </button>
          <button
            type="button"
            onClick={() => {
              setDaysWindow(30);
              setActiveReading(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              daysWindow === 30 ? 'bg-white text-[#0071E3] shadow-xs' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            30 Days
          </button>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-4 gap-2 mb-4 bg-[#F5F5F7] p-3 rounded-2xl">
        <div className="text-center">
          <div className="text-[10px] uppercase font-semibold text-gray-500">Average</div>
          <div className="text-sm font-extrabold text-[#1D1D1F] mt-0.5">
            {stats.avg > 0 ? `${stats.avg}` : '--'} <span className="text-[10px] font-normal">mg/dL</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase font-semibold text-gray-500">In Target</div>
          <div className="text-sm font-extrabold text-emerald-600 mt-0.5">
            {stats.avg > 0 ? `${stats.inRangePct}%` : '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase font-semibold text-gray-500">Lowest</div>
          <div className="text-sm font-extrabold text-blue-600 mt-0.5">
            {stats.min > 0 ? `${stats.min}` : '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase font-semibold text-gray-500">Highest</div>
          <div className="text-sm font-extrabold text-rose-600 mt-0.5">
            {stats.max > 0 ? `${stats.max}` : '--'}
          </div>
        </div>
      </div>

      {/* SVG Chart or Empty State */}
      {filteredReadings.length === 0 ? (
        <div className="h-48 border border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center p-6 text-center text-gray-400">
          <Calendar className="w-8 h-8 mb-2 text-gray-300" />
          <p className="text-sm font-semibold text-gray-600">No glucose readings recorded</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Log your blood sugar reading above or scan a lab report to view trends.
          </p>
        </div>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto select-none overflow-visible"
            style={{ minWidth: '320px', maxHeight: '260px' }}
          >
            {/* Background Grid Lines & Y Axis Labels */}
            {[70, 140, 200, 250].map((level) => {
              const y = getY(level);
              return (
                <g key={level}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={width - paddingRight}
                    y2={y}
                    stroke="#E5E7EB"
                    strokeDasharray={level === 70 || level === 140 ? 'none' : '4,4'}
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 3.5}
                    fontSize="10"
                    fill="#9CA3AF"
                    textAnchor="end"
                    fontWeight="500"
                  >
                    {level}
                  </text>
                </g>
              );
            })}

            {/* Target Normal Band (70 to 140 mg/dL) */}
            <rect
              x={paddingLeft}
              y={bandTopY}
              width={chartW}
              height={bandHeight}
              fill="#10B981"
              fillOpacity="0.08"
            />
            <text
              x={width - paddingRight - 6}
              y={bandTopY + 14}
              fontSize="9"
              fill="#059669"
              fontWeight="bold"
              textAnchor="end"
            >
              Normal Target Band (70 - 140)
            </text>

            {/* Critical Low Threshold Line */}
            <line
              x1={paddingLeft}
              y1={getY(70)}
              x2={width - paddingRight}
              y2={getY(70)}
              stroke="#EF4444"
              strokeWidth="1.5"
              strokeDasharray="3,3"
            />

            {/* Critical High Threshold Line */}
            <line
              x1={paddingLeft}
              y1={getY(250)}
              x2={width - paddingRight}
              y2={getY(250)}
              stroke="#DC2626"
              strokeWidth="1.5"
              strokeDasharray="3,3"
            />

            {/* Connecting Polyline */}
            {filteredReadings.length > 1 && (
              <polyline
                fill="none"
                stroke="#0071E3"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={pointsString}
              />
            )}

            {/* Data Points */}
            {filteredReadings.map((reading, i) => {
              const cx = getX(i, filteredReadings.length);
              const cy = getY(reading.value_mgdl);
              const color = getSeverityColor(reading.value_mgdl);
              const isSelected = activeReading?.id === reading.id;

              return (
                <g
                  key={reading.id}
                  className="cursor-pointer group"
                  onClick={() => {
                    setActiveReading(reading);
                    if (onSelectReading) onSelectReading(reading);
                  }}
                >
                  {/* Hover / selection pulse circle */}
                  {isSelected && (
                    <circle cx={cx} cy={cy} r="10" fill={color} fillOpacity="0.25" className="animate-ping" />
                  )}

                  {/* Outer circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? '7' : '5'}
                    fill="white"
                    stroke={color}
                    strokeWidth={isSelected ? '3' : '2.5'}
                    className="transition-all duration-150"
                  />

                  {/* Inner dot */}
                  <circle cx={cx} cy={cy} r="2.5" fill={color} />

                  {/* X-axis date stamp on last few points */}
                  {(i === 0 || i === filteredReadings.length - 1 || i % Math.ceil(filteredReadings.length / 4) === 0) && (
                    <text
                      x={cx}
                      y={height - 10}
                      fontSize="9"
                      fill="#9CA3AF"
                      textAnchor="middle"
                      fontWeight="500"
                    >
                      {new Date(reading.measuredAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Selected Reading Popover Detail */}
      {activeReading && (
        <div className="mt-3 p-3 bg-blue-50/80 border border-blue-200/80 rounded-2xl flex items-center justify-between text-xs animate-in fade-in">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm text-[#1D1D1F]">
                {activeReading.value_mgdl} mg/dL
              </span>
              <span
                className="px-2 py-0.5 rounded-full font-bold text-[10px] text-white"
                style={{ backgroundColor: getSeverityColor(activeReading.value_mgdl) }}
              >
                {getSeverityLabel(activeReading.value_mgdl)}
              </span>
              <span className="text-[11px] font-medium text-gray-600 capitalize bg-white px-2 py-0.5 rounded-full border border-gray-200">
                {activeReading.context.replace('_', ' ')}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              Recorded on {new Date(activeReading.measuredAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} via {activeReading.source}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveReading(null)}
            className="text-[11px] font-bold text-blue-600 hover:underline px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Chart Legend */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span>70–140 Target</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span>141–180 Elevated</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          <span>181–250 High</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-600" />
          <span>&lt;70 or &gt;250 Critical</span>
        </div>
      </div>
    </div>
  );
}
