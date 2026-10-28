import { COLORS } from './format'

export function gaugeColor(p) {
  if (p >= 0.95) return COLORS.green
  if (p >= 0.5) return COLORS.cyan
  return COLORS.violet
}

export function heatColor(value, min, max) {
  if (max <= min) return 'rgba(34,211,238,.12)'
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  if (t < 0.5) {
    const k = t * 2
    return `rgba(${Math.round(14 + k * 20)}, ${Math.round(116 + k * 95)}, ${Math.round(144 + k * 94)}, ${0.22 + k * 0.55})`
  }
  const k = (t - 0.5) * 2
  return `rgba(${Math.round(34 + k * 217)}, ${Math.round(211 - k * 78)}, ${Math.round(238 - k * 182)}, ${0.77 + k * 0.2})`
}

export function clusterPieces(clusters) {
  return clusters.map((c) => ({ value: c.id, label: c.name, color: c.color }))
}
