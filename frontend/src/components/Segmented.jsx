export default function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className={`segmented seg-${size}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
