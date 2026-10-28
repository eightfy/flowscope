import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CheckSquare,
  GitCompareArrows,
  Layers,
  LineChart as LineChartIcon,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Trophy,
} from 'lucide-react'
import { api } from '../api'
import Card from '../components/Card'
import EChart from '../components/EChart'
import MetricTile from '../components/MetricTile'
import Segmented from '../components/Segmented'
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

function RunCard({ run, selected, onToggle, onDelete }) {
  return (
    <div className={`run-card ${selected ? 'selected' : ''}`} onClick={onToggle}>
      <div className="run-check">{selected ? <CheckSquare size={14} /> : <Square size={14} />}</div>
      <div className="run-info">
        <div className="run-top">
          <b>{run.algorithmName}</b>
          <span className="badge gray mono">{run.dataset}</span>
        </div>
        <div className="run-region">{run.regionLabel}</div>
        <div className="run-metrics">
          <span>MAE <b>{fmt(run.metrics.mae, 0)}</b></span>
          <span>RMSE <b>{fmt(run.metrics.rmse, 0)}</b></span>
          <span>R² <b>{metric(run.metrics.r2, 2)}</b></span>
        </div>
        <div className="run-foot">
          <span>{String(run.createdAt).replace('T', ' ').slice(5, 16)}</span>
          <span>{run.inputLen} → {run.outputLen}</span>
        </div>
      </div>
      <button
        type="button"
        className="icon-btn danger run-del"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(run.id)
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function forecastOption(result, unit) {
  if (!result) return null
  const h = result.history
  const times = [...h.times, ...result.horizon.map((x) => x.time)]
  const histVals = [...h.values, ...result.horizon.map(() => null)]
  const actVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.actual)]
  const predVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.predicted)]
  const loVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.lo)]
  const hiVals = [...h.values.map(() => null), ...result.horizon.map((x) => x.hi)]
  const axis = axisFmt(unit)
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
    grid: { left: 58, right: 18, top: 34, bottom: 46 },
    tooltip: {
      ...TOOLTIP,
      trigger: 'axis',
      formatter: (ps) => {
        const idx = ps[0].dataIndex
        const rows = ps
          .filter((p) => p.value !== null && p.value !== undefined && !['下界', '上界'].includes(p.seriesName))
          .map(
            (p) =>
              `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${p.color}">● ${p.seriesName}</span><b>${compact(p.value, unit)}</b></div>`,
          )
          .join('')
        return `<b>${timeLabel(times[idx])}</b>${rows ? `<div style="margin-top:6px">${rows}</div>` : ''}`
      },
    },
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 3, textStyle: { color: '#8593aa', fontSize: 9 } },
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
        name: '下界',
        type: 'line',
        data: loVals,
        showSymbol: false,
        lineStyle: { color: 'rgba(167,139,250,.3)', width: 1, type: 'dotted' },
        silent: true,
      },
      {
        name: '上界',
        type: 'line',
        data: hiVals,
        showSymbol: false,
        lineStyle: { color: 'rgba(167,139,250,.3)', width: 1, type: 'dotted' },
        silent: true,
      },
      {
        name: '历史观测',
        type: 'line',
        data: histVals,
        showSymbol: false,
        lineStyle: { color: 'rgba(148,163,184,.5)', width: 1.2 },
      },
      {
        name: '真实值',
        type: 'line',
        data: actVals,
        showSymbol: false,
        lineStyle: { color: COLORS.cyan, width: 2.2 },
      },
      {
        name: '预测值',
        type: 'line',
        data: predVals,
        showSymbol: false,
        lineStyle: { color: COLORS.orange, width: 2.2, type: 'dashed' },
      },
    ],
  }
}

export default function Evaluation({ datasetId, meta, onNavigate }) {
  const [runs, setRuns] = useState([])
  const [scope, setScope] = useState('current')
  const [selected, setSelected] = useState([])
  const [details, setDetails] = useState({})
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const d = await api.get('/api/runs?limit=80')
      setRuns(d.runs)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [datasetId])

  const visible = useMemo(
    () => (scope === 'current' ? runs.filter((r) => r.dataset === datasetId) : runs),
    [runs, scope, datasetId],
  )

  useEffect(() => {
    setSelected([])
    setDetails({})
  }, [datasetId, scope])

  useEffect(() => {
    if (!visible.length) return
    setSelected((s) => {
      const still = s.filter((id) => visible.some((r) => r.id === id))
      return still.length ? still : [visible[0].id]
    })
  }, [visible])

  useEffect(() => {
    let alive = true
    selected.forEach((id) => {
      if (details[id]) return
      api
        .get(`/api/runs/${id}`)
        .then((r) => alive && setDetails((d) => ({ ...d, [id]: r })))
        .catch(() => {})
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const toggle = (id) => {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id)
      if (s.length >= 3) return [...s.slice(1), id]
      return [...s, id]
    })
  }

  const remove = async (id) => {
    await api.del(`/api/runs/${id}`)
    setRuns((rs) => rs.filter((r) => r.id !== id))
    setSelected((s) => s.filter((x) => x !== id))
    setDetails((d) => {
      const n = { ...d }
      delete n[id]
      return n
    })
  }

  const selectedResults = selected.map((id) => details[id]).filter(Boolean)
  const primary = selectedResults[0]
  const activeUnit = primary?.unit || meta.unit
  const mixedDatasets = new Set(selectedResults.map((r) => r.dataset)).size > 1
  const comparable =
    selectedResults.length > 1 &&
    selectedResults.every(
      (r) => r.dataset === primary.dataset && r.region === primary.region && r.config.output_len === primary.config.output_len,
    )

  const unit = meta.unit
  const compareOption = useMemo(() => {
    if (selectedResults.length < 2) return null
    const labels = selectedResults.map((r) => `${r.algorithm.toUpperCase()}·${r.regionLabel.slice(0, 6)}`)
    return {
      grid: { left: 54, right: 16, top: 28, bottom: 46 },
      tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => compact(v, unit) },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 3, textStyle: { color: '#8593aa', fontSize: 9 } },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, fontSize: 8, interval: 0, rotate: 12 },
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axisFmt(unit) }, splitLine: SPLIT_LINE },
      series: [
        {
          name: 'MAE',
          type: 'bar',
          data: selectedResults.map((r) => r.metrics.mae),
          barWidth: '26%',
          itemStyle: { color: 'rgba(34,211,238,.7)', borderRadius: [3, 3, 0, 0] },
        },
        {
          name: 'RMSE',
          type: 'bar',
          data: selectedResults.map((r) => r.metrics.rmse),
          barWidth: '26%',
          itemStyle: { color: 'rgba(251,146,60,.7)', borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [selectedResults, unit])

  const overlayOption = useMemo(() => {
    if (!comparable) return null
    const base = selectedResults[0]
    const axis = axisFmt(unit)
    return {
      grid: { left: 58, right: 16, top: 34, bottom: 34 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => compact(v, unit) },
      legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 3, textStyle: { color: '#8593aa', fontSize: 9 } },
      xAxis: {
        type: 'category',
        data: base.horizon.map((h) => `t+${h.step}`),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
      },
      yAxis: { type: 'value', scale: true, axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      series: [
        {
          name: '真实值',
          type: 'line',
          data: base.horizon.map((h) => h.actual),
          showSymbol: false,
          lineStyle: { color: '#dbe6f5', width: 2.2 },
        },
        ...selectedResults.map((r, i) => ({
          name: r.algorithmName || r.algorithm,
          type: 'line',
          data: r.horizon.map((h) => h.predicted),
          showSymbol: false,
          lineStyle: {
            color: [COLORS.orange, COLORS.cyan, COLORS.violet][i % 3],
            width: 1.8,
            type: i === 0 ? 'dashed' : 'solid',
          },
        })),
      ],
    }
  }, [comparable, selectedResults, unit])

  const leaderboard = useMemo(() => {
    const map = new Map()
    visible.forEach((r) => {
      const cur = map.get(r.algorithm) || { algorithm: r.algorithm, name: r.algorithmName, n: 0, rmse: 0, mape: 0, skill: 0, sk: 0 }
      cur.n += 1
      cur.rmse += r.metrics.rmse || 0
      cur.mape += r.metrics.mape || 0
      if (r.metrics.skill !== undefined) {
        cur.skill += r.metrics.skill
        cur.sk += 1
      }
      map.set(r.algorithm, cur)
    })
    return [...map.values()]
      .map((x) => ({
        ...x,
        rmse: x.rmse / x.n,
        mape: x.mape / x.n,
        skill: x.sk ? (x.skill / x.sk) * 100 : null,
      }))
      .sort((a, b) => (b.skill ?? -999) - (a.skill ?? -999))
  }, [visible])

  const leaderOption = useMemo(() => {
    if (!leaderboard.length) return null
    const arr = [...leaderboard].slice(0, 8).reverse()
    return {
      grid: { left: 92, right: 50, top: 8, bottom: 22 },
      tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => `${Number(v).toFixed(1)}%` },
      xAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: (v) => `${v}%` }, splitLine: SPLIT_LINE },
      yAxis: {
        type: 'category',
        data: arr.map((x) => x.name),
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: arr.map((x) => ({
            value: x.skill,
            label: { position: x.skill >= 0 ? 'insideRight' : 'insideLeft', color: x.skill >= 0 ? '#06202a' : '#fff1f1', fontSize: 8, fontWeight: 600 },
            itemStyle: {
              color: x.skill >= 0 ? 'rgba(52,211,153,.7)' : 'rgba(248,113,113,.6)',
              borderRadius: x.skill >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
            },
          })),
          barWidth: '54%',
          label: { show: true, formatter: (p) => `${Number(p.value).toFixed(1)}%` },
        },
      ],
    }
  }, [leaderboard])

  return (
    <div className="eval-layout">
      <aside className="runs-panel">
        <div className="runs-head">
          <div>
            <h3>实验记录</h3>
            <p>{visible.length} 次运行 · 选 2–3 次对比</p>
          </div>
          <button type="button" className="icon-btn" onClick={load}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'current', label: '当前数据集' },
            { value: 'all', label: '全部' },
          ]}
          size="sm"
        />
        <div className="runs-list">
          {visible.map((r) => (
            <RunCard key={r.id} run={r} selected={selected.includes(r.id)} onToggle={() => toggle(r.id)} onDelete={remove} />
          ))}
          {!visible.length && (
            <div className="empty" style={{ minHeight: 200 }}>
              <Layers size={22} />
              <p>还没有实验记录</p>
              <button type="button" className="btn ghost sm" onClick={() => onNavigate('lab')}>
                去预测实验室
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="eval-main">
        {!selectedResults.length && (
          <div className="lab-hero">
            <div className="hero-glow" />
            <div className="hero-icon"><GitCompareArrows size={26} /></div>
            <h2>选择实验，开始评估</h2>
            <p>左侧勾选实验后，可查看真实值与预测值对照、逐步误差，并对多个算法做横向比较。</p>
            <button type="button" className="btn" onClick={() => onNavigate('lab')}>
              去创建预测实验
            </button>
          </div>
        )}

        {selectedResults.length > 0 && (
          <>
            <div className="result-head">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge violet"><GitCompareArrows size={11} /> 已选 {selectedResults.length} 个实验</span>
                  {comparable && <span className="badge green">可对齐对比</span>}
                  {mixedDatasets && <span className="badge orange">跨数据集 · 单位/量级不可直接比较</span>}
                </div>
                <h2>{selectedResults.length > 1 ? '多实验横向评估' : `${primary.regionLabel} · ${primary.algorithmName || primary.algorithm}`}</h2>
                <p>
                  {selectedResults.length > 1
                    ? comparable
                      ? '同一区域与预测长度，真实值可直接叠加对比。'
                      : '所选实验的数据集 / 区域 /  длины不一致，仅汇总指标对比。'
                    : `${timeLabel(primary.testStart)} → ${timeLabel(primary.testEnd)} · ${primary.config.output_len} 步预测`}
                </p>
              </div>
            </div>

            {selectedResults.length === 1 && (
              <>
                <div className="metric-grid mb-14">
                  <MetricTile label="MAE" value={primary.metrics.mae} base={primary.baseline.mae} desc="平均绝对误差" digits={0} unit={activeUnit} />
                  <MetricTile label="RMSE" value={primary.metrics.rmse} base={primary.baseline.rmse} desc="均方根误差" digits={0} unit={activeUnit} />
                  <MetricTile label="MAPE" value={primary.metrics.mape} suffix="%" base={primary.baseline.mape} desc="平均百分比误差" digits={2} />
                  <MetricTile label="sMAPE" value={primary.metrics.smape} suffix="%" base={primary.baseline.smape} desc="对称百分比误差" digits={2} />
                  <MetricTile label="R²" value={primary.metrics.r2} base={primary.baseline.r2} lowerBetter={false} desc="决定系数" digits={3} />
                  <MetricTile
                    label="Skill"
                    value={primary.metrics.skill !== undefined ? primary.metrics.skill * 100 : null}
                    suffix="%"
                    lowerBetter={false}
                    desc="相对季节朴素基线"
                    digits={1}
                  />
                </div>

                <Card title="真实值 vs 预测值" subtitle="默认聚焦预测窗口，可拖动缩放条回看更早历史" icon={LineChartIcon} className="mb-14">
                  <EChart option={forecastOption(primary, activeUnit)} height={360} />
                </Card>

                <div className="grid cols-2">
                  <Card title="逐步明细" subtitle="预测窗口内的每个点" icon={Layers}>
                    <div className="table-wrap" style={{ maxHeight: 350 }}>
                      <table>
                        <thead>
                          <tr><th>步</th><th>时间</th><th>真实</th><th>预测</th><th>误差</th><th>APE%</th></tr>
                        </thead>
                        <tbody>
                          {primary.horizon.map((h) => (
                            <tr key={h.step}>
                              <td>{h.step}</td>
                              <td>{timeLabel(h.time)}</td>
                              <td>{activeUnit === 'Bytes' ? compact(h.actual, activeUnit) : fmt(h.actual, 0)}</td>
                              <td className="text-orange">{activeUnit === 'Bytes' ? compact(h.predicted, activeUnit) : fmt(h.predicted, 0)}</td>
                              <td className={h.error >= 0 ? 'text-good' : 'text-bad'}>{activeUnit === 'Bytes' ? compact(h.error, activeUnit) : fmt(h.error, 0)}</td>
                              <td>{h.absPct.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                  <Card title="实验配置" subtitle="本次运行的关键参数" icon={Sparkles}>
                    <div className="model-info">
                      <div><span>数据集</span><b>{primary.dataset}</b></div>
                      <div><span>区域</span><b>{primary.regionLabel}</b></div>
                      <div><span>算法</span><b>{primary.algorithmName || primary.algorithm}</b></div>
                      <div><span>输入 / 输出</span><b>{primary.config.input_len} → {primary.config.output_len}</b></div>
                      <div><span>训练历史</span><b>{primary.config.history_len}</b></div>
                      <div><span>MAPE / WAPE</span><b>{primary.metrics.mape}% / {primary.metrics.wape}%</b></div>
                      <div><span>MASE</span><b>{primary.metrics.mase ?? '—'}</b></div>
                      <div><span>对数变换</span><b>{primary.config.log_transform ? '开' : '关'}</b></div>
                    </div>
                    <div className="param-chips">
                      {Object.entries(primary.config.params || {}).map(([k, v]) => (
                        <span key={k}><i>{k}</i>{String(v)}</span>
                      ))}
                    </div>
                  </Card>
                </div>
              </>
            )}

            {selectedResults.length > 1 && (
              <>
                <Card title="指标对比" subtitle="MAE 与 RMSE（同量纲）" icon={BarChart3} className="mb-14">
                  <EChart option={compareOption} height={260} />
                </Card>

                {comparable ? (
                  <Card title="预测曲线叠加" subtitle="共同真实值 + 各算法预测" icon={LineChartIcon} className="mb-14">
                    <EChart option={overlayOption} height={330} />
                  </Card>
                ) : (
                  <Card title="曲线无法对齐" className="mb-14">
                    <div className="empty" style={{ minHeight: 100 }}>
                      所选实验的区域或输出长度不同，无法共用同一条真实值序列。请选择同一区域、同一预测长度的实验进行曲线对比。
                    </div>
                  </Card>
                )}

                <Card title="实验明细" subtitle="逐行比较核心指标" icon={Layers} className="mb-14">
                  <div className="table-wrap" style={{ maxHeight: 380 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>算法</th><th>区域</th><th>输入→输出</th><th>MAE</th><th>RMSE</th><th>MAPE</th><th>sMAPE</th><th>R²</th><th>Skill</th><th>耗时</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedResults.map((r) => (
                          <tr key={r.config ? `${r.region}-${r.algorithm}-${r.testStart}` : r.algorithm}>
                            <td className="label-cell">{r.algorithmName || r.algorithm}</td>
                            <td className="label-cell">{r.regionLabel}</td>
                            <td>{r.config.input_len}→{r.config.output_len}</td>
                            <td>{fmt(r.metrics.mae, 0)}</td>
                            <td>{fmt(r.metrics.rmse, 0)}</td>
                            <td>{metric(r.metrics.mape, 2)}%</td>
                            <td>{metric(r.metrics.smape, 2)}%</td>
                            <td>{metric(r.metrics.r2, 3)}</td>
                            <td className={r.metrics.skill >= 0 ? 'text-good' : 'text-bad'}>{metric((r.metrics.skill || 0) * 100, 1)}%</td>
                            <td>{r.duration ? `${r.duration}s` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}

            <div className="grid cols-2">
              <Card title="算法排行榜" subtitle="按平均 Skill 排序（当前数据集）" icon={Trophy}>
                {leaderOption ? <EChart option={leaderOption} height={250} /> : <div className="empty">暂无足够实验</div>}
              </Card>
              <Card title="评估口径" subtitle="指标定义与解读">
                <div className="formula-list">
                  <div><b>MAE</b><span>Σ|y−ŷ|/n，直观反映平均偏差。</span></div>
                  <div><b>RMSE</b><span>对大误差更敏感，适合评估尖峰预测。</span></div>
                  <div><b>MAPE</b><span>百分比误差，便于跨区域、跨量级比较。</span></div>
                  <div><b>R²</b><span>相对均值基准的解释力，负值说明不如直接取均值。</span></div>
                  <div><b>Skill</b><span>1 − RMSE_model / RMSE_seasonal_naive，&gt;0 即优于基线。</span></div>
                  <div><b>MASE</b><span>相对季节差分的误差，&lt;1 表示优于季节朴素。</span></div>
                </div>
              </Card>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
