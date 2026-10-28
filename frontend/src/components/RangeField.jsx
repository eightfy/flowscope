export default function RangeField({ label, hint, value, min, max, step = 1, onChange, format }) {
  const v = Number(value)
  return (
    <div className="range-field">
      <div className="range-top">
        <label>{label}</label>
        <input
          className="mini-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={v}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)))
          }}
        />
      </div>
      {hint && <p className="hint">{hint}</p>}
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {format && <div className="range-scale">{format(v)}</div>}
    </div>
  )
}
