import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  FlaskConical,
  Gauge,
  Layers,
  LineChart as LineChartIcon,
  Loader2,
  Play,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  Wand2,
  XCircle,
  Zap,
} from 'lucide-react'
import { api } from '../api'
import Card from '../components/Card'
import EChart from '../components/EChart'
import RangeField from '../components/RangeField'
import MetricTile from '../components/MetricTile'
import SearchSelect from '../components/SearchSelect'
import {
  AXIS_LABEL,
  AXIS_LINE,
  COLORS,
  SPLIT_LINE,
  TOOLTIP,
  axisFmt,
  compact,
  fmt,
  metric,
  timeLabel,
} from '../format'

export default function ForecastLab({ datasetId, meta, regions }) {
  const interval = meta.interval_min
  const season = interval === 10 ? 144 : 96
  const [algos, setAlgos] = useState([])
  const [algoId, setAlgoId] = useState('random_forest')
  const [region, setRegion] = useState(regions[0]?.id || '')
  const [inputLen, setInputLen] = useState(season)
  const [outputLen, setOutputLen] = useState(24)
  const [historyLen, setHistoryLen] = useState(interval === 10 ? 2016 : 1344)
  const [logTransform, setLogTransform] = useState(true)
  const [params, setParams] = useState({})
  const [job, setJob] = useState(null)
  const [result, setResult] = useState(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef(null)

  useEffect(() => {
    setRegion(regions[0]?.id || '')
    setInputLen(season)
    setOutputLen(24)
    setHistoryLen(interval === 10 ? 2016 : 1344)
    setJob(null)
    setResult(null)
    setError('')
  }, [datasetId, interval, season])

  useEffect(() => {
    let alive = true
    api
      .get(`/api/algorithms?dataset=${datasetId}`)
      .then((d) => {
        if (!alive) return
        setAlgos(d.algorithms)
        const current = d.algorithms.find((a) => a.id === algoId) || d.algorithms[0]
        if (current && current.id !== algoId) setAlgoId(current.id)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId])

  const algo = useMemo(() => algos.find((a) => a.id === algoId), [algos, algoId])

  useEffect(() => {
    if (!algo) return
    const p = {}
    algo.params.forEach((x) => {
      p[x.key] = x.default
    })
    setParams(p)
  }, [algo])

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let alive = true
    const t = setInterval(async () => {
      try {
        const s = await api.get(`/api/jobs/${job.id}`)
        if (!alive) return
        if (s.status === 'succeeded') {
          const r = await api.get(`/api/jobs/${job.id}/result`)
          if (alive) {
            setResult(r)
            setJob(s)
          }
          clearInterval(t)
        } else {
          setJob(s)
          if (s.status === 'failed' || s.status === 'cancelled') clearInterval(t)
        }
      } catch (e) {
        if (alive) setError(e.message)
        clearInterval(t)
      }
    }, 650)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [job?.id, job?.status])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.logs?.length])

  const maxHistory = Math.max(64, meta.n_points - outputLen - 1)
  const maxInput = Math.max(16, Math.min(2048, historyLen - 40))
  const maxOutput = Math.max(1, Math.min(512, meta.n_points - inputLen - 40))

  const regionOptions = useMemo(
    () => regions.map((r) => ({ value: r.id, label: r.label, sub: compact(r.mean, meta.unit) })),
    [regions, meta.unit],
  )

  const setInput = (v) => {
    const val = Math.max(4, Math.min(v, maxInput))
    setInputLen(val)
    if (historyLen < val + 40) setHistoryLen(Math.min(maxHistory, val + 40))
  }

  const setOutput = (v) => {
    const val = Math.max(1, Math.min(v, maxOutput))
    setOutputLen(val)
    if (historyLen > meta.n_points - val - 1) setHistoryLen(Math.max(inputLen + 40, meta.n_points - val - 1))
  }

  const start = async () => {
    setError('')
    if (!algo || !region) return
    if (historyLen <= inputLen + 16) {
      setError('训练历史必须大于输入长度 + 16 步，请调整窗口。')
      return
    }
    setStarting(true)
    setResult(null)
    try {
      const res = await api.post('/api/forecast', {
        dataset: datasetId,
        region,
        algorithm: algoId,
        input_len: inputLen,
        output_len: outputLen,
        history_len: historyLen,
        log_transform: logTransform,
        params,
      })
      setJob(res.state)
    } catch (e) {
      setError(e.message)
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    try {
      const r = await api.post(`/api/jobs/${job.id}/cancel`, {})
      setJob(r.state)
    } catch (e) {
      setError(e.message)
    }
  }

  const running = job && ['queued', 'running'].includes(job.status)
  const unit = meta.unit
  const axis = axisFmt(unit)

  const forecastOption = useMemo(() => {
    if (!result) return null
    const h = result.history
    const times = [...h.times, ...result.horizon.map((x) => x.time)]
    const histVals = [...h.values, ...result.horizon.map(() => null)]
    const actVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.actual)]
    const predVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.predicted)]
    const loVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.lo)]
    const hiVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.hi)]
    const split = h.times.length
    const focus = Math.min(times.length, Math.max(result.config.output_len * 5 + 12, 84))
    const startIdx = Math.max(0, times.length - focus)
    const visible = [
      ...h.values.slice(-focus),
      ...result.horizon.flatMap((x) => [x.actual, x.predicted, x.lo, x.hi]),
    ].filter((v) => Number.isFinite(Number(v))).map(Number)
    const yMin = Math.max(0, Math.min(...visible))
    const yMax = Math.max(...visible)
    const pad = Math.max((yMax - yMin) * 0.06, 1)
    return {
      grid: { left: 58, right: 18, top: 34, bottom: 52 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        formatter: (ps) => {
          const idx = ps[0].dataIndex
          const t = times[idx]
          const rows = ps
            .filter((p) => p.value !== null && p.value !== undefined)
            .map(
              (p) =>
                `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${p.color}">● ${p.seriesName}</span><b>${compact(p.value, unit)}</b></div>`,
            )
            .join('')
          return `<b>${timeLabel(t)}</b>${rows ? `<div style="margin-top:6px">${rows}</div>` : ''}`
        },
      },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 3,
        textStyle: { color: '#8593aa', fontSize: 9 },
        data: ['历史观测', '真实值', '预测值'],
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: false,
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, formatter: (v) => timeLabel(v).slice(3) },
      },
      yAxis: { type: 'value', min: Math.max(0, yMin - pad), max: yMax + pad, axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      dataZoom: [
        { type: 'inside', startValue: startIdx, endValue: times.length - 1 },
        {
          type: 'slider',
          height: 12,
          bottom: 8,
          borderColor: 'transparent',
          backgroundColor: 'rgba(148,163,184,.05)',
          fillerColor: 'rgba(251,146,60,.12)',
          handleStyle: { color: '#fb923c', borderColor: '#fb923c' },
          textStyle: { color: '#6d7c93', fontSize: 8 },
        },
      ],
      series: [
        {
          name: '90% 区间',
          type: 'line',
          data: hiVals,
          showSymbol: false,
          lineStyle: { opacity: 0, width: 0 },
          areaStyle: { opacity: 0 },
          silent: true,
          tooltip: { show: false },
        },
        {
          name: '下界',
          type: 'line',
          data: loVals,
          showSymbol: false,
          lineStyle: { color: 'rgba(167,139,250,.35)', width: 1, type: 'dotted' },
          silent: true,
          tooltip: { show: false },
        },
        {
          name: '上界',
          type: 'line',
          data: hiVals,
          showSymbol: false,
          lineStyle: { color: 'rgba(167,139,250,.35)', width: 1, type: 'dotted' },
          silent: true,
          tooltip: { show: false },
        },
        {
          name: '历史观测',
          type: 'line',
          data: histVals,
          showSymbol: false,
          lineStyle: { color: 'rgba(148,163,184,.55)', width: 1.2 },
        },
        {
          name: '真实值',
          type: 'line',
          data: actVals,
          showSymbol: false,
          lineStyle: { color: COLORS.cyan, width: 2.2 },
          itemStyle: { color: COLORS.cyan },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(251,146,60,.4)', type: 'dashed' },
            label: { formatter: '预测起点', color: '#fb923c', fontSize: 9, position: 'insideEndTop' },
            data: [{ xAxis: split }],
          },
        },
        {
          name: '预测值',
          type: 'line',
          data: predVals,
          showSymbol: false,
          lineStyle: { color: COLORS.orange, width: 2.2, type: 'dashed' },
          itemStyle: { color: COLORS.orange },
        },
      ],
    }
  }, [result, unit, axis])

  const residualOption = useMemo(() => {
    if (!result) return null
    return {
      grid: { left: 54, right: 14, top: 16, bottom: 26 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => compact(v, unit) },
      xAxis: {
        type: 'category',
        data: result.horizon.map((h) => h.step),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'bar',
          data: result.horizon.map((h) => ({
            value: h.error,
            itemStyle: { color: h.error >= 0 ? 'rgba(34,211,238,.7)' : 'rgba(248,113,113,.7)', borderRadius: h.error >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] },
          })),
          barWidth: '58%',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(148,163,184,.3)' },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    }
  }, [result, unit, axis])

  const curveOption = useMemo(() => {
    const curve = result?.trainingCurve || job?.curve || []
    if (!curve.length) return null
    return {
      grid: { left: 46, right: 16, top: 26, bottom: 24 },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 3, textStyle: { color: '#8593aa', fontSize: 9 } },
      xAxis: {
        type: 'category',
        data: curve.map((c) => c.step),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
        name: '迭代',
        nameTextStyle: { color: '#5f6c82', fontSize: 9 },
      },
      yAxis: { type: 'value', scale: true, axisLabel: { ...AXIS_LABEL, fontSize: 9 }, splitLine: SPLIT_LINE },
      series: [
        {
          name: '验证损失',
          type: 'line',
          data: curve.map((c) => c.val),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: COLORS.orange, width: 1.8 },
        },
        {
          name: '训练损失',
          type: 'line',
          data: curve.map((c) => c.train),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: COLORS.cyan, width: 1.6 },
        },
      ],
    }
  }, [result, job])

  const importanceOption = useMemo(() => {
    const imp = result?.info?.importantLags
    if (!imp || !imp.length) return null
    const arr = [...imp].reverse()
    return {
      grid: { left: 48, right: 34, top: 8, bottom: 20 },
      tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, fontSize: 8 }, splitLine: SPLIT_LINE },
      yAxis: {
        type: 'category',
        data: arr.map((x) => `lag ${x.lag}`),
        axisLabel: { ...AXIS_LABEL, fontSize: 8 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: arr.map((x) => x.importance),
          barWidth: '54%',
          itemStyle: { color: 'rgba(34,211,238,.6)', borderRadius: [0, 3, 3, 0] },
        },
      ],
    }
  }, [result])

  const paramFields = (algo?.params || []).map((p) => {
    if (p.type === 'select') {
      return (
        <div className="param-field" key={p.key}>
          <div className="field-label">{p.label}</div>
          <select
            className="control"
            value={params[p.key] ?? p.default}
            onChange={(e) => setParams((s) => ({ ...s, [p.key]: e.target.value }))}
          >
            {p.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )
    }
    if (p.type === 'bool') {
      return (
        <label className="toggle param-toggle" key={p.key}>
          <input
            type="checkbox"
            checked={Boolean(params[p.key] ?? p.default)}
            onChange={(e) => setParams((s) => ({ ...s, [p.key]: e.target.checked }))}
          />
          <span className="track" />
          {p.label}
        </label>
      )
    }
    const step = p.type === 'float' ? (p.step < 1 ? p.step : 0.1) : p.step
    return (
      <RangeField
        key={p.key}
        label={p.label}
        hint={p.help}
        value={params[p.key] ?? p.default}
        min={p.min}
        max={p.max}
        step={step}
        onChange={(v) => setParams((s) => ({ ...s, [p.key]: p.type === 'float' ? Number(v.toFixed(5)) : Math.round(v) }))}
        format={(v) => (p.type === 'float' ? Number(v).toFixed(3) : `${v}`)}
      />
    )
  })

  return (
    <div className="lab-layout">
      <aside className="config-panel">
        <div className="config-head">
          <div>
            <h3>实验配置</h3>
            <p>构建样本并训练预测器</p>
          </div>
          <span className="badge orange">{algos.length || 15} 算法</span>
        </div>

        <div className="config-section">
          <div className="field-label">目标区域</div>
          <SearchSelect value={region} onChange={setRegion} options={regionOptions} width="100%" />
        </div>

        <div className="config-section">
          <div className="field-label">预测算法</div>
          <select className="control" value={algoId} onChange={(e) => setAlgoId(e.target.value)}>
            {['基线模型', '统计模型', '机器学习', '深度学习'].map((g) => (
              <optgroup label={g} key={g}>
                {algos
                  .filter((a) => a.group === g)
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name} · {a.tag}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {algo && <p className="algo-desc">{algo.description}</p>}
        </div>

        <div className="config-section">
          <div className="section-line">
            <span className="field-label">输入 / 输出窗口</span>
            <span className="badge gray mono">{inputLen} → {outputLen}</span>
          </div>
          <div className="window-viz">
            <div className="wv-history">
              <span>训练历史 {historyLen} 步</span>
              <div className="wv-bar">
                <i className="wv-fill" />
                <i className="wv-context" style={{ width: `${Math.min(100, (inputLen / Math.max(historyLen, 1)) * 100)}%` }} />
              </div>
            </div>
            <div className="wv-legend">
              <span><i className="lg-context" /> 输入上下文</span>
              <span><i className="lg-out" /> 预测区间</span>
            </div>
          </div>
          <RangeField
            label="输入长度（回看步数）"
            value={inputLen}
            min={4}
            max={maxInput}
            step={Math.max(1, Math.round(season / 12))}
            onChange={setInput}
            format={(v) => `${v} 步 · ${(v * interval) / 60 >= 1 ? `${((v * interval) / 60).toFixed(1)} 小时` : `${v * interval} 分钟`}`}
          />
          <RangeField
            label="输出长度（预测步数）"
            value={outputLen}
            min={1}
            max={Math.min(288, maxOutput)}
            step={1}
            onChange={setOutput}
            format={(v) => `${v} 步 · ${((v * interval) / 60).toFixed(1)} 小时`}
          />
          <RangeField
            label="训练历史窗口"
            value={historyLen}
            min={Math.max(64, inputLen + 40)}
            max={maxHistory}
            step={24}
            onChange={setHistoryLen}
            format={(v) => `${v} 步 ≈ ${(v * interval / 1440).toFixed(1)} 天`}
          />
          <label className="toggle" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={logTransform} onChange={(e) => setLogTransform(e.target.checked)} />
            <span className="track" />
            对数变换 log1p（抑制尖峰）
          </label>
        </div>

        {algo?.params?.length > 0 && (
          <div className="config-section">
            <div className="section-line">
              <span className="field-label">算法核心参数</span>
              <Settings2 size={13} className="dim" />
            </div>
            <div className="param-list">{paramFields}</div>
          </div>
        )}

        <div className="config-foot">
          <div className="sample-note">
            <span>可用训练样本</span>
            <b className="mono">{Math.max(0, historyLen - inputLen)}</b>
          </div>
          {error && (
            <div className="inline-error">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
          {running ? (
            <button type="button" className="btn danger run-btn" onClick={cancel}>
              <Square size={12} /> 取消训练
            </button>
          ) : (
            <button type="button" className="btn run-btn" onClick={start} disabled={starting || !algo}>
              {starting ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              {starting ? '提交中…' : result ? '重新训练' : '开始训练与预测'}
            </button>
          )}
        </div>
      </aside>

      <section className="lab-main">
        {!job && !result && (
          <div className="lab-hero">
            <div className="hero-glow" />
            <div className="hero-icon">
              <FlaskConical size={26} />
            </div>
            <span className="badge cyan">FORECAST LAB</span>
            <h2>从历史流量构建多步预测</h2>
            <p>
              选择区域与算法，设置回看窗口和预测长度。训练过程会实时回报损失曲线与阶段进度，
              完成后自动对照真实值并计算 MAE、RMSE、MAPE、sMAPE、R² 等指标。
            </p>
            <div className="hero-steps">
              <div>
                <span>01</span>
                <b>构建样本</b>
                <small>滑动窗口 + 训练/验证切分</small>
              </div>
              <div>
                <span>02</span>
                <b>训练监控</b>
                <small>逐轮损失 / 阶段日志</small>
              </div>
              <div>
                <span>03</span>
                <b>评估对比</b>
                <small>真实值、区间与核心指标</small>
              </div>
            </div>
            <div className="hero-tags">
              {['15 种算法', '递归多步', '早停', '90% 区间', '实验存档'].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {job && running && (
          <div className="monitor-grid">
            <Card title="训练进行中" subtitle={`${job.algorithmName} · ${job.regionLabel}`} icon={Cpu} accent="cyan">
              <div className="training-head">
                <div className="progress-ring" style={{ '--p': (job.progress * 100).toFixed(1) }}>
                  <div className="ring-inner">
                    <b>{Math.round(job.progress * 100)}<small>%</small></b>
                    <span>{job.stage === 'training' ? '训练中' : job.stage === 'predict' ? '预测中' : job.stage === 'evaluate' ? '评估中' : '准备中'}</span>
                  </div>
                </div>
                <div className="training-meta">
                  <div className="tm-row">
                    <span>当前阶段</span>
                    <b>{job.message}</b>
                  </div>
                  <div className="tm-row">
                    <span>已用时</span>
                    <b className="mono">{job.duration?.toFixed(1) ?? '0.0'}s</b>
                  </div>
                  <div className="tm-row">
                    <span>训练样本</span>
                    <b className="mono">{Math.max(0, historyLen - inputLen)}</b>
                  </div>
                  <div className="tm-row">
                    <span>迭代点数</span>
                    <b className="mono">{job.curve?.length || 0}</b>
                  </div>
                  <div className="progress-bar">
                    <i style={{ width: `${job.progress * 100}%` }} />
                  </div>
                </div>
              </div>
            </Card>

            <Card title="实时学习曲线" subtitle="训练损失 vs 验证损失（标准化目标）" icon={LineChartIcon}>
              {curveOption ? (
                <EChart option={curveOption} height={210} />
              ) : (
                <div className="empty" style={{ minHeight: 210 }}>
                  <Loader2 size={18} className="spin" />
                  {job?.stage === 'training' ? '正在等待首轮迭代输出…' : '该算法按阶段回报进度'}
                </div>
              )}
            </Card>

            <Card title="训练日志" subtitle="阶段与参数实时输出" icon={Braces} className="span-2">
              <div className="terminal" ref={logRef}>
                {(job.logs || []).map((l, i) => (
                  <div className="log-line" key={i}>
                    <span className="log-time">{String(l.t).slice(11)}</span>
                    <span className="log-pct">{Math.round((l.progress || 0) * 100)}%</span>
                    <span>{l.message}</span>
                  </div>
                ))}
                {(!job.logs || !job.logs.length) && <div className="log-line dim">等待引擎输出…</div>}
              </div>
            </Card>
          </div>
        )}

        {job?.status === 'failed' && (
          <Card title="训练失败" icon={XCircle}>
            <div className="inline-error" style={{ fontSize: 12 }}>
              <AlertTriangle size={14} /> {job.error || job.message}
            </div>
            <div className="terminal" style={{ marginTop: 12 }}>
              {(job.logs || []).slice(-12).map((l, i) => (
                <div className="log-line" key={i}>
                  <span className="log-time">{String(l.t).slice(11)}</span>
                  <span>{l.message}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {result && (
          <>
            <div className="result-head">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge green"><CheckCircle2 size={11} /> 训练完成</span>
                  <span className="badge gray mono">run {job?.id?.slice(0, 8) || '—'}</span>
                </div>
                <h2>{result.regionLabel} · {job?.algorithmName || result.algorithm}</h2>
                <p>
                  {timeLabel(result.testStart)} → {timeLabel(result.testEnd)} · 预测 {result.config.output_len} 步 ·
                  用时 {job?.duration?.toFixed(1) ?? '—'}s · 已自动存档到评估中心
                </p>
              </div>
              <div className="row">
                <button type="button" className="btn ghost sm" onClick={() => { setJob(null); setResult(null) }}>
                  <RotateCcw size={12} /> 新的实验
                </button>
              </div>
            </div>

            <div className="metric-grid mb-14">
              <MetricTile label="MAE" value={result.metrics.mae} suffix={unit === 'Bytes' ? 'B' : ''} base={result.baseline.mae} desc="平均绝对误差" digits={0} unit={unit} />
              <MetricTile label="RMSE" value={result.metrics.rmse} suffix={unit === 'Bytes' ? 'B' : ''} base={result.baseline.rmse} desc="均方根误差" digits={0} unit={unit} />
              <MetricTile label="MAPE" value={result.metrics.mape} suffix="%" base={result.baseline.mape} desc="平均绝对百分比误差" digits={2} />
              <MetricTile label="sMAPE" value={result.metrics.smape} suffix="%" base={result.baseline.smape} desc="对称平均绝对百分比误差" digits={2} />
              <MetricTile label="R²" value={result.metrics.r2} base={result.baseline.r2} lowerBetter={false} desc="决定系数" digits={3} />
              <MetricTile
                label="Skill vs 季节朴素"
                value={result.metrics.skill !== undefined ? result.metrics.skill * 100 : null}
                suffix="%"
                lowerBetter={false}
                desc="RMSE 相对基线的改进"
                digits={1}
              />
            </div>

            <div className="grid cols-2 mb-14" style={{ gridTemplateColumns: 'minmax(0,1.75fr) minmax(0,1fr)' }}>
              <Card
                title="真实值 vs 预测值"
                subtitle="默认聚焦预测窗口，可拖动底部缩放条回看更早历史"
                icon={LineChartIcon}
              >
                <EChart option={forecastOption} height={370} />
              </Card>

              <div className="stack">
                <Card title="模型与样本" subtitle="本次实验的训练配置" icon={Settings2}>
                  <div className="model-info">
                    <div><span>算法</span><b>{job?.algorithmName || result.algorithm}</b></div>
                    <div><span>输入长度</span><b>{result.config.input_len} 步</b></div>
                    <div><span>输出长度</span><b>{result.config.output_len} 步</b></div>
                    <div><span>训练历史</span><b>{result.config.history_len} 步</b></div>
                    <div><span>训练 / 验证</span><b>{result.info.samples ?? '—'} / {result.info.valSamples ?? '—'}</b></div>
                    <div><span>对数变换</span><b>{result.config.log_transform ? '开' : '关'}</b></div>
                    <div><span>MASE</span><b>{result.metrics.mase ?? '—'}</b></div>
                    <div><span>WAPE</span><b>{result.metrics.wape}%</b></div>
                  </div>
                  <div className="param-chips">
                    {Object.entries(result.config.params || {}).map(([k, v]) => (
                      <span key={k}><i>{k}</i>{String(v)}</span>
                    ))}
                  </div>
                </Card>

                {importanceOption ? (
                  <Card title="关键滞后项" subtitle="模型最依赖的历史时刻（Top 12）" icon={Zap}>
                    <EChart option={importanceOption} height={190} />
                  </Card>
                ) : (
                  <Card title="基线对照" subtitle="季节朴素基线 vs 本模型" icon={Gauge}>
                    <div className="model-info">
                      <div><span>基线 MAE</span><b>{fmt(result.baseline.mae, 0)}</b></div>
                      <div><span>基线 RMSE</span><b>{fmt(result.baseline.rmse, 0)}</b></div>
                      <div><span>基线 MAPE</span><b>{result.baseline.mape}%</b></div>
                      <div><span>基线 R²</span><b>{result.baseline.r2}</b></div>
                    </div>
                  </Card>
                )}
              </div>
            </div>

            <div className="grid cols-2 mb-14" style={{ gridTemplateColumns: curveOption ? '1fr 1fr' : '1fr' }}>
              {curveOption && (
                <Card title="训练过程" subtitle="本次实验的损失曲线（已存档）" icon={Cpu}>
                  <EChart option={curveOption} height={210} />
                </Card>
              )}
              <Card title="逐步残差" subtitle="真实值 − 预测值，正值表示低估" icon={Gauge}>
                <EChart option={residualOption} height={210} />
              </Card>
            </div>

            <div className="grid cols-2" style={{ gridTemplateColumns: 'minmax(0,1.45fr) minmax(0,1fr)' }}>
              <Card title="逐步预测明细" subtitle="可直接核对每一个预测时刻" icon={Layers}>
                <div className="table-wrap" style={{ maxHeight: 320 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>步</th>
                        <th>时间</th>
                        <th>真实值</th>
                        <th>预测值</th>
                        <th>误差</th>
                        <th>绝对误差%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.horizon.map((h) => (
                        <tr key={h.step}>
                          <td>{h.step}</td>
                          <td>{timeLabel(h.time)}</td>
                          <td>{unit === 'Bytes' ? compact(h.actual, unit) : fmt(h.actual, 0)}</td>
                          <td className="text-orange">{unit === 'Bytes' ? compact(h.predicted, unit) : fmt(h.predicted, 0)}</td>
                          <td className={h.error >= 0 ? 'text-good' : 'text-bad'}>{unit === 'Bytes' ? compact(h.error, unit) : fmt(h.error, 0)}</td>
                          <td>{h.absPct.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="指标说明" subtitle="本平台采用的核心评估口径" icon={Sparkles}>
                <div className="formula-list">
                  <div><b>MAE</b><span>平均绝对误差，与数据同量纲，越低越好。</span></div>
                  <div><b>RMSE</b><span>对大误差更敏感，越低越好。</span></div>
                  <div><b>MAPE</b><span>平均绝对百分比误差，便于跨区域比较。</span></div>
                  <div><b>sMAPE</b><span>对称百分比误差，缓解小值放大问题。</span></div>
                  <div><b>R²</b><span>相对均值模型的解释力，越接近 1 越好。</span></div>
                  <div><b>MASE</b><span>相对季节朴素基线的平均绝对误差，&lt; 1 优于基线。</span></div>
                </div>
              </Card>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
