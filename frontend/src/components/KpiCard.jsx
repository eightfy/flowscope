import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

export default function KpiCard({ label, value, unit, sub, icon: Icon, tone = 'cyan', delta, deltaLabel }) {
  const up = Number(delta) >= 0
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {Icon && (
          <span className="kpi-icon">
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-foot">
        {delta !== undefined && delta !== null && (
          <span className={`delta ${up ? 'up' : 'down'}`}>
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(Number(delta)).toFixed(1)}%
          </span>
        )}
        <span className="kpi-sub">{deltaLabel || sub}</span>
      </div>
    </div>
  )
}
