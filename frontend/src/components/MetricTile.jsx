import { compact, metric } from '../format'

export default function MetricTile({ label, value, suffix, base, lowerBetter = true, digits = 3, desc, unit }) {
  let delta = null
  if (base !== undefined && base !== null && value !== undefined && value !== null && Number(base) !== 0) {
    delta = ((Number(value) - Number(base)) / Math.abs(Number(base))) * 100
  }
  const good = delta === null ? null : lowerBetter ? delta < 0 : delta > 0
  return (
    <div className="metric-tile">
      <div className="mt-label">{label}</div>
      <div className="mt-value" title={typeof value === 'number' ? String(value) : undefined}>
        {typeof value === 'number' ? (unit === 'Bytes' ? compact(value, 'Bytes').replace(/\s?B$/, '') : metric(value, digits)) : value ?? '—'}
        {suffix && unit !== 'Bytes' && <span>{suffix}</span>}
        {unit === 'Bytes' && <span>B</span>}
      </div>
      <div className="mt-foot">
        {delta !== null ? (
          <span className={good ? 'text-good' : 'text-bad'}>
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}% <small>vs 基线</small>
          </span>
        ) : (
          <span className="dim">{desc}</span>
        )}
      </div>
    </div>
  )
}
