export const COLORS = {
  cyan: '#22d3ee',
  violet: '#a78bfa',
  orange: '#fb923c',
  green: '#34d399',
  pink: '#f472b6',
  yellow: '#facc15',
  blue: '#60a5fa',
  red: '#f87171',
  muted: '#7d8ba3',
  grid: 'rgba(148, 163, 184, 0.10)',
  axis: 'rgba(148, 163, 184, 0.35)',
}

export function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  const v = Number(value)
  if (Math.abs(v) >= 10000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function compact(value, unit = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  const v = Number(value)
  if (unit === 'Bytes') {
    const abs = Math.abs(v)
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} TB`
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} GB`
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} MB`
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)} KB`
    return `${v.toFixed(0)} B`
  }
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return `${v.toFixed(0)}`
}

export function axisFmt(unit) {
  return (v) => compact(v, unit)
}

export function timeLabel(iso, granularity = 'hour') {
  if (!iso) return ''
  const s = String(iso)
  if (s.length >= 16) return s.slice(5, 16).replace('T', ' ')
  return s
}

export function dateLabel(iso) {
  if (!iso) return ''
  return String(iso).slice(5, 10)
}

export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}

export function metric(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(digits)
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

export function classNames(...xs) {
  return xs.filter(Boolean).join(' ')
}

export function weekdayName(i) {
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i] || ''
}

export const TOOLTIP = {
  backgroundColor: 'rgba(9, 14, 25, 0.96)',
  borderColor: 'rgba(148, 163, 184, 0.22)',
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: '#dbe6f5', fontSize: 12 },
  extraCssText: 'box-shadow: 0 12px 32px rgba(0,0,0,.45); border-radius: 10px;',
}

export const AXIS_LABEL = { color: '#7f8da6', fontSize: 11 }
export const AXIS_LINE = { lineStyle: { color: 'rgba(148,163,184,.25)' } }
export const SPLIT_LINE = { lineStyle: { color: 'rgba(148,163,184,.08)' } }
