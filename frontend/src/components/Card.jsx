export default function Card({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className = '',
  bodyClass = '',
  noPad = false,
  accent,
}) {
  return (
    <section className={`card ${accent ? `accent-${accent}` : ''} ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <div className="card-title-wrap">
            {Icon && (
              <span className="card-icon">
                <Icon size={15} />
              </span>
            )}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {action && <div className="card-action">{action}</div>}
        </header>
      )}
      <div className={`card-body ${noPad ? 'no-pad' : ''} ${bodyClass}`}>{children}</div>
    </section>
  )
}
