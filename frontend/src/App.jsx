import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Database,
  FlaskConical,
  GitCompareArrows,
  Layers,
  LayoutDashboard,
  RefreshCw,
  Sparkles,
  Waves,
} from 'lucide-react'
import { api } from './api'
import Overview from './pages/Overview'
import Explore from './pages/Explore'
import Clusters from './pages/Clusters'
import ForecastLab from './pages/ForecastLab'
import Evaluation from './pages/Evaluation'

const TABS = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, title: '全局态势总览', subtitle: '区域负载、节律与集中度一屏掌握' },
  { id: 'explore', label: '时空探索', icon: Waves, title: '时空动态探索', subtitle: '时间节律、周期结构与空间自相关' },
  { id: 'clusters', label: '功能聚类', icon: Layers, title: '功能区识别', subtitle: '基于日内形态与周末效应的无监督分区' },
  { id: 'lab', label: '预测实验室', icon: FlaskConical, title: '预测实验室', subtitle: '15 种算法 · 可调窗口与超参 · 训练实时监控' },
  { id: 'evaluate', label: '评估对比', icon: GitCompareArrows, title: '预测评估与对比', subtitle: '真实值对照、核心指标与多实验横评' },
]

function Sidebar({ datasets, datasetId, setDatasetId, tab, setTab, online }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Activity size={20} strokeWidth={2.4} />
        </div>
        <div className="brand-text">
          <div className="brand-name">FlowScope</div>
          <div className="brand-sub">URBAN FLOW INTELLIGENCE</div>
        </div>
      </div>

      <div className="nav-section-label">分析工作台</div>
      <nav className="nav">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              className={`nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={17} />
              <span>{t.label}</span>
              {tab === t.id && <span className="nav-dot" />}
            </button>
          )
        })}
      </nav>

      <div className="nav-section-label source-label">数据源</div>
      <div className="source-list">
        {datasets.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`source-item ${datasetId === d.id ? 'active' : ''}`}
            onClick={() => setDatasetId(d.id)}
          >
            <span className="source-bar" style={{ background: d.color }} />
            <span className="source-info">
              <span className="source-name">{d.name}</span>
              <span className="source-meta">
                {d.n_regions} 区域 · {d.interval_min}min
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className={`api-status ${online ? 'online' : 'offline'}`}>
          <span className="status-dot" />
          {online ? '分析引擎在线' : '引擎未连接'}
        </div>
        <div className="side-note">15 算法 · 3 数据集</div>
        <div className="side-hint">FlowScope v1.0</div>
      </div>
    </aside>
  )
}

function Topbar({ tab, meta }) {
  const current = TABS.find((t) => t.id === tab) || TABS[0]
  return (
    <header className="topbar">
      <div className="page-heading">
        <div className="eyebrow">
          <span className="eyebrow-line" />
          {meta?.subtitle || '智能流量分析'}
        </div>
        <h1>{current.title}</h1>
        <p>{current.subtitle}</p>
      </div>
      <div className="top-meta">
        <div className="meta-chip">
          <Database size={13} />
          <span>{meta?.name || '—'}</span>
        </div>
        <div className="meta-chip muted">
          <span>{meta ? `${meta.n_regions} 区域` : '—'}</span>
          <span className="dot-sep" />
          <span>{meta ? `${meta.interval_min} min` : '—'}</span>
        </div>
        <div className="meta-chip muted hide-sm">
          <RefreshCw size={12} />
          <span>
            {meta ? `${String(meta.start).slice(0, 10)} → ${String(meta.end).slice(0, 10)}` : '—'}
          </span>
        </div>
        <div className="ready-chip">
          <span className="status-dot" />
          数据就绪
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const [datasets, setDatasets] = useState([])
  const [datasetId, setDatasetId] = useState('milano')
  const [meta, setMeta] = useState(null)
  const [geo, setGeo] = useState(null)
  const [focusRegion, setFocusRegion] = useState(null)
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1)
    return TABS.some((t) => t.id === h) ? h : 'overview'
  })
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get('/api/datasets')
      .then((d) => {
        setDatasets(d.datasets)
        setOnline(true)
        if (d.datasets.length && !d.datasets.some((x) => x.id === datasetId)) setDatasetId(d.datasets[0].id)
      })
      .catch((e) => {
        setOnline(false)
        setError(e.message)
      })
  }, [])

  useEffect(() => {
    let alive = true
    setMeta(null)
    setGeo(null)
    setFocusRegion(null)
    api
      .get(`/api/datasets/${datasetId}`)
      .then((m) => alive && setMeta(m))
      .catch((e) => alive && setError(e.message))
    api
      .get(`/api/datasets/${datasetId}/geo`)
      .then((g) => alive && setGeo(g))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [datasetId])

  useEffect(() => {
    window.location.hash = tab
  }, [tab])

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1)
      if (TABS.some((t) => t.id === h)) setTab(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const page = useMemo(() => {
    if (!meta) return null
    const props = { datasetId, meta, geo, regions: meta.regions || [], focusRegion }
    if (tab === 'overview') return <Overview {...props} onNavigate={setTab} onFocusRegion={setFocusRegion} />
    if (tab === 'explore') return <Explore {...props} onNavigate={setTab} />
    if (tab === 'clusters') return <Clusters {...props} />
    if (tab === 'lab') return <ForecastLab {...props} />
    return <Evaluation {...props} onNavigate={setTab} />
  }, [tab, datasetId, meta, geo, focusRegion])

  return (
    <div className="app">
      <Sidebar
        datasets={datasets}
        datasetId={datasetId}
        setDatasetId={setDatasetId}
        tab={tab}
        setTab={setTab}
        online={online}
      />
      <main className="main">
        <Topbar tab={tab} meta={meta} />
        {error && !meta && (
          <div className="fatal">
            <Sparkles size={20} />
            <h2>分析服务连接失败</h2>
            <p>{error}</p>
            <p className="hint">请确认后端已启动：./run.sh 或 .venv/bin/uvicorn backend.app.main:app --port 8000</p>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        )}
        {!error && !meta && (
          <div className="boot">
            <div className="boot-ring" />
            <p>正在加载 {datasets.find((d) => d.id === datasetId)?.name || '数据'} …</p>
          </div>
        )}
        {meta && <div className="page" key={`${datasetId}-${tab}`}>{page}</div>}
      </main>
    </div>
  )
}
