import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

export default function SearchSelect({
  value,
  onChange,
  options,
  placeholder = '搜索并选择',
  allowAll = false,
  allLabel = '全部区域',
  allValue = 'ALL',
  width,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = useMemo(() => {
    if (allowAll && value === allValue) return { value: allValue, label: allLabel }
    return options.find((o) => o.value === value)
  }, [options, value, allowAll, allLabel, allValue])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const base = ql
      ? options.filter((o) => o.label.toLowerCase().includes(ql) || String(o.value).toLowerCase().includes(ql))
      : options
    return base.slice(0, 120)
  }, [options, q])

  return (
    <div className="search-select" ref={boxRef} style={{ width }}>
      <button type="button" className={`ss-trigger ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)}>
        <span className="ss-label">{current?.label || placeholder}</span>
        {current?.sub && <span className="ss-sub">{current.sub}</span>}
        <ChevronDown size={14} className="ss-chevron" />
      </button>
      {open && (
        <div className="ss-menu">
          <div className="ss-search">
            <Search size={13} />
            <input autoFocus placeholder="搜索区域名称 / ID" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="ss-list">
            {allowAll && (
              <button
                type="button"
                className={`ss-item ${value === allValue ? 'active' : ''}`}
                onClick={() => {
                  onChange(allValue)
                  setOpen(false)
                }}
              >
                <span>{allLabel}</span>
              </button>
            )}
            {filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                className={`ss-item ${value === o.value ? 'active' : ''}`}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span className="ss-item-label">{o.label}</span>
                {o.sub && <span className="ss-item-sub">{o.sub}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="ss-empty">没有匹配的区域</div>}
          </div>
        </div>
      )}
    </div>
  )
}
