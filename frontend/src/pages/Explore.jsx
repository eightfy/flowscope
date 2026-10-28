import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Clock,
  Compass,
  Gauge,
  Layers,
  Pause,
  Play,
  Radio,
  ScanLine,
  Timer,
  Waves,
} from 'lucide-react'
import { api } from '../api'
import Card from '../components/Card'
import EChart from '../components/EChart'
import GeoMap from '../components/GeoMap'
import SearchSelect from '../components/SearchSelect'
import Segmented from '../components/Segmented'
import {
  AXIS_LABEL,
  AXIS_LINE,
  COLORS,
  SPLIT_LINE,
  TOOLTIP,
  axisFmt,
  compact,
  dateLabel,
  fmt,
  metric,
  timeLabel,
  weekdayName,
} from '../format'

export default function Explore({ datasetId, meta, geo, regions, focusRegion }) {
  const [mode, setMode] = useState('temporal')
  const [region, setRegion] = useState(focusRegion || 'ALL')
  const [granularity, setGranularity] = useState('hour')
  const [temporal, setTemporal] = useState(null)
  const [spatial, setSpatial] = useState(null)
  const [spatialGran, setSpatialGran] = useState('day')
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [relative, setRelative] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const playRef = useRef(null)

  const unit = meta.unit
  const axis = axisFmt(unit)
  const regionOptions = useMemo(
    () => regions.map((r) => ({ value: r.id, label: r.label, sub: compact(r.mean, unit) })),
    [regions, unit],
  )

  useEffect(() => {
    setRegion(focusRegion || 'ALL')
    setFrame(0)
    setPlaying(false)
  }, [datasetId, focusRegion])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setTemporal(null)
    api
      .get(`/api/datasets/${datasetId}/temporal?region=${encodeURIComponent(region)}&granularity=${granularity}`)
      .then((d) => alive && setTemporal(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [datasetId, region, granularity])

  useEffect(() => {
    if (mode !== 'spatial') return
    let alive = true
    setSpatial(null)
    setFrame(0)
    setPlaying(false)
    api
      .get(`/api/datasets/${datasetId}/spatial?granularity=${spatialGran}`)
      .then((d) => alive && setSpatial(d))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [datasetId, mode, spatialGran])

  useEffect(() => {
    if (!playing || !spatial) return
    playRef.current = setInterval(() => {
      setFrame((f) => {
        if (f >= spatial.frames.length - 1) return 0
        return f + 1
      })
    }, 720)
    return () => clearInterval(playRef.current)
  }, [playing, spatial])

  const frameData = spatial?.frames?.[frame]

  const bucketMeans = useMemo(() => {
    if (!spatial?.frames?.length) return []
    const n = spatial.regionStats.length
    const sums = new Array(n).fill(0)
    spatial.frames.forEach((f) => f.values.forEach((v, i) => { sums[i] += v }))
    return sums.map((v) => v / spatial.frames.length)
  }, [spatial])

  const mapValues = useMemo(() => {
    if (!frameData) return {}
    const out = {}
    spatial.regionStats.forEach((r, i) => {
      const v = frameData.values[i]
      const base = bucketMeans[i] || 1
      out[r.id] = relative ? (v / Math.max(base, 1e-9)) * 100 : v
    })
    return out
  }, [frameData, spatial, relative, bucketMeans])

  const trendOption = useMemo(() => {
    if (!temporal) return null
    const s = temporal.series
    return {
      grid: { left: 54, right: 16, top: 18, bottom: 46 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        formatter: (ps) => `<b>${timeLabel(ps[0].axisValue)}</b><br/><span style="color:#8b9bb4">${temporal.label}</span> <b style="color:#67e8f9">${compact(ps[0].value, unit)}</b>`,
      },
      xAxis: {
        type: 'category',
        data: s.times,
        boundaryGap: false,
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, formatter: (v) => v.slice(5, 10), interval: 'auto' },
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          height: 14,
          bottom: 8,
          borderColor: 'transparent',
          backgroundColor: 'rgba(148,163,184,.05)',
          fillerColor: 'rgba(34,211,238,.12)',
          handleStyle: { color: '#22d3ee' },
          textStyle: { color: '#6d7c93', fontSize: 9 },
        },
      ],
      series: [
        {
          type: 'line',
          name: temporal.label,
          data: s.values,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { width: 1.8, color: COLORS.cyan },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34,211,238,.2)' },
                { offset: 1, color: 'rgba(34,211,238,.01)' },
              ],
            },
          },
        },
      ],
    }
  }, [temporal, granularity, unit, axis])

  const hourOption = useMemo(() => {
    if (!temporal) return null
    return {
      grid: { left: 46, right: 10, top: 10, bottom: 24 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => compact(v, unit) },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, interval: 3, formatter: (v) => `${v}h` },
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'bar',
          data: temporal.hourProfile,
          barWidth: '62%',
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34,211,238,.9)' },
                { offset: 1, color: 'rgba(14,116,144,.35)' },
              ],
            },
          },
        },
      ],
    }
  }, [temporal, unit, axis])

  const weekdayOption = useMemo(() => {
    if (!temporal) return null
    return {
      grid: { left: 46, right: 10, top: 10, bottom: 24 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => compact(v, unit) },
      xAxis: {
        type: 'category',
        data: [0, 1, 2, 3, 4, 5, 6].map((i) => weekdayName(i).slice(1)),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: AXIS_LABEL,
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'bar',
          data: temporal.weekdayProfile.map((v, i) => ({
            value: v,
            itemStyle: { color: i >= 5 ? 'rgba(251,146,60,.75)' : 'rgba(167,139,250,.7)', borderRadius: [3, 3, 0, 0] },
          })),
          barWidth: '52%',
        },
      ],
    }
  }, [temporal, unit, axis])

  const acfOption = useMemo(() => {
    if (!temporal) return null
    return {
      grid: { left: 44, right: 12, top: 12, bottom: 26 },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: temporal.acf.map((_, i) => i + 1),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, interval: 23, formatter: (v) => `${v}h` },
      },
      yAxis: { type: 'value', min: -0.4, max: 1, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'line',
          data: temporal.acf,
          showSymbol: false,
          lineStyle: { color: COLORS.green, width: 1.5 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(251,146,60,.35)', type: 'dashed' },
            data: [{ xAxis: 24, label: { formatter: '24h', color: '#fb923c', fontSize: 8 } }, { xAxis: 48, label: { formatter: '48h', color: '#fb923c', fontSize: 8 } }],
          },
        },
      ],
    }
  }, [temporal])

  const periodOption = useMemo(() => {
    if (!temporal) return null
    return {
      grid: { left: 44, right: 12, top: 12, bottom: 28 },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: temporal.periods.map((p) => `${p.periodHours}h`),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
      },
      yAxis: { type: 'value', max: 1, axisLabel: { ...AXIS_LABEL, formatter: (v) => v.toFixed(1) }, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'bar',
          data: temporal.periods.map((p, i) => ({
            value: p.power,
            itemStyle: { color: i === 0 ? COLORS.orange : 'rgba(251,146,60,.45)', borderRadius: [4, 4, 0, 0] },
          })),
          barWidth: '44%',
          label: { show: true, position: 'top', color: '#c9a27b', fontSize: 8, formatter: (p) => p.value.toFixed(2) },
        },
      ],
    }
  }, [temporal])

  const stlOption = useMemo(() => {
    if (!temporal?.decomposition) return null
    const d = temporal.decomposition
    const mk = (name, data, color, width = 1.4, dash = 'solid') => ({
      type: 'line',
      name,
      data,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { color, width, type: dash },
    })
    return {
      grid: { left: 54, right: 14, top: 28, bottom: 24 },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      legend: { top: 0, right: 8, itemWidth: 10, itemHeight: 3, textStyle: { color: '#8593aa', fontSize: 9 } },
      xAxis: {
        type: 'category',
        data: d.times,
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, formatter: (v) => dateLabel(v) },
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      series: [
        mk('观测', d.observed, 'rgba(148,163,184,.5)', 1),
        mk('趋势', d.trend, COLORS.cyan, 2),
        mk('周季节', d.seasonal, COLORS.violet, 1.5),
        mk('残差', d.resid, COLORS.orange, 1, 'dashed'),
      ],
    }
  }, [temporal, unit, axis])

  const moverList = useMemo(() => {
    if (!spatial || frame < 1) return []
    const prev = spatial.frames[frame - 1]?.values || []
    const cur = spatial.frames[frame]?.values || []
    const base = spatial.regionStats.map((_, i) => {
      let sum = 0
      spatial.frames.forEach((f) => { sum += f.values[i] })
      return sum / spatial.frames.length
    })
    const ranked = spatial.regionStats
      .map((r, i) => ({
        id: r.id,
        label: r.label,
        value: cur[i],
        delta: Number((((cur[i] - prev[i]) / Math.max(Math.abs(prev[i]), 1e-9)) * 100).toFixed(2)),
        base: base[i],
      }))
      .filter((x) => x.base > 0)
    const valid = ranked.filter((x) => x.base >= [...ranked].sort((a, b) => a.base - b.base)[Math.floor(ranked.length * 0.2)]?.base)
    const up = [...valid].sort((a, b) => b.delta - a.delta).slice(0, 6)
    const down = [...valid].sort((a, b) => a.delta - b.delta).slice(0, 4)
    const seen = new Set()
    return [...up, ...down].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
  }, [spatial, frame])
  const frameCount = spatial?.frames?.length || 0

  const topTrajectoryOption = useMemo(() => {
    if (!spatial) return null
    const top = [...spatial.regionStats].sort((a, b) => b.mean - a.mean).slice(0, 8)
    const colors = [COLORS.cyan, COLORS.violet, COLORS.orange, COLORS.green, COLORS.pink, COLORS.yellow, COLORS.blue, COLORS.red]
    return {
      grid: { left: 48, right: 100, top: 18, bottom: 30 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => `${Number(v).toFixed(1)}%` },
      legend: {
        top: 0,
        right: 0,
        orient: 'vertical',
        itemWidth: 8,
        itemHeight: 3,
        textStyle: { color: '#8593aa', fontSize: 8 },
      },
      xAxis: {
        type: 'category',
        data: spatial.frames.map((f) => f.time),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, formatter: (v) => dateLabel(v) },
      },
      yAxis: {
        type: 'value',
        axisLabel: { ...AXIS_LABEL, formatter: (v) => `${v}%` },
        splitLine: SPLIT_LINE,
        name: '相对自身均值',
        nameTextStyle: { color: '#5f6c82', fontSize: 9 },
      },
      series: top.map((r, idx) => {
        const j = spatial.regionStats.findIndex((x) => x.id === r.id)
        return {
          type: 'line',
          name: r.label.slice(0, 10),
          showSymbol: false,
          smooth: 0.15,
          lineStyle: { width: 1.3, color: colors[idx % colors.length], opacity: 0.9 },
          data: spatial.frames.map((f) => (f.values[j] / Math.max(bucketMeans[j] || 1, 1e-9)) * 100),
        }
      }),
    }
  }, [spatial, bucketMeans])

  if (error) return <Card title="解析失败">{error}</Card>

  return (
    <>
      <div className="row between mb-14 wrap">
        <div className="subtabs">
          <button type="button" className={mode === 'temporal' ? 'active' : ''} onClick={() => setMode('temporal')}>
            时间动态
          </button>
          <button type="button" className={mode === 'spatial' ? 'active' : ''} onClick={() => setMode('spatial')}>
            空间动态
          </button>
        </div>
        {mode === 'temporal' && (
          <div className="row wrap">
            <SearchSelect value={region} onChange={setRegion} options={regionOptions} allowAll allLabel="全部区域合计" width={210} />
            <Segmented
              value={granularity}
              onChange={setGranularity}
              options={[
                { value: 'hour', label: '小时' },
                { value: 'day', label: '天' },
              ]}
            />
          </div>
        )}
        {mode === 'spatial' && (
          <div className="row wrap">
            <Segmented
              value={spatialGran}
              onChange={setSpatialGran}
              options={[
                { value: 'day', label: '按天' },
                { value: 'hour', label: '按小时' },
              ]}
            />
            <label className="toggle">
              <input type="checkbox" checked={relative} onChange={(e) => setRelative(e.target.checked)} />
              <span className="track" />
              相对自身均值
            </label>
          </div>
        )}
      </div>

      {mode === 'temporal' &&
        (!temporal ? (
          <div className="boot" style={{ minHeight: 320 }}>
            <div className="boot-ring" />
            <p>计算时间节律…</p>
          </div>
        ) : (
          <>
            <div className="stat-strip mb-14">
              <div>
                <div className="sl">平均区间负载</div>
                <div className="sv">{compact(temporal.stats.mean, unit)}</div>
              </div>
              <div>
                <div className="sl">波动系数 CV</div>
                <div className="sv">{metric(temporal.stats.cv)}</div>
              </div>
              <div>
                <div className="sl">峰值时刻</div>
                <div className="sv" style={{ fontSize: 13 }}>{timeLabel(temporal.stats.peakTime)}</div>
              </div>
              <div>
                <div className="sl">周末 / 平日负载</div>
                <div className="sv">{metric(temporal.stats.weekendRatio, 2)}×</div>
              </div>
            </div>

            <Card
              title={`${temporal.label} · 负载序列`}
              subtitle={`${granularity === 'hour' ? '小时' : '日'}聚合 · ${temporal.series.times.length} 个观测`}
              icon={Waves}
              className="mb-14"
            >
              <EChart option={trendOption} height={330} />
            </Card>

            <div className="grid cols-3 mb-14">
              <Card title="24 小时节律" subtitle="各小时平均负载" icon={Clock}>
                <EChart option={hourOption} height={190} />
              </Card>
              <Card title="星期节律" subtitle="工作日 vs 周末" icon={CalendarClock}>
                <EChart option={weekdayOption} height={190} />
              </Card>
              <Card title="自相关 ACF" subtitle="滞后 1–120 小时" icon={Radio}>
                <EChart option={acfOption} height={190} />
              </Card>
            </div>

            <div className="grid cols-2">
              <Card title="主导周期" subtitle="小时级周期图峰值（越接近 1 越强）" icon={Timer}>
                {temporal.periods.length ? <EChart option={periodOption} height={230} /> : <div className="empty">序列长度不足，无法估计周期</div>}
              </Card>
              <Card title="STL 分解" subtitle="日总量 · 周季节 · 稳健趋势" icon={ScanLine}>
                {stlOption ? <EChart option={stlOption} height={230} /> : <div className="empty">至少需要 21 天数据</div>}
              </Card>
            </div>

            <div className="stat-strip mt-14">
              <div>
                <div className="sl">夜间相对强度（0–6 时）</div>
                <div className="sv">{metric(temporal.stats.nightRatio * 100, 1)}<small>%</small></div>
              </div>
              <div>
                <div className="sl">日间相对强度（8–18 时）</div>
                <div className="sv">{metric(temporal.stats.dayRatio * 100, 1)}<small>%</small></div>
              </div>
              <div>
                <div className="sl">日均变化趋势</div>
                <div className={`sv ${temporal.stats.trendPerDayPct >= 0 ? 'text-good' : 'text-bad'}`}>
                  {temporal.stats.trendPerDayPct > 0 ? '+' : ''}
                  {metric(temporal.stats.trendPerDayPct, 2)}<small>%/天</small>
                </div>
              </div>
              <div>
                <div className="sl">最大 / 最小负载</div>
                <div className="sv" style={{ fontSize: 13 }}>{compact(temporal.stats.max, unit)} / {compact(temporal.stats.min, unit)}</div>
              </div>
            </div>
          </>
        ))}

      {mode === 'spatial' &&
        (!spatial ? (
          <div className="boot" style={{ minHeight: 320 }}>
            <div className="boot-ring" />
            <p>计算空间场与自相关…</p>
          </div>
        ) : (
          <>
            <div className="grid cols-2 mb-14" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' }}>
              <Card
                title="空间负载场 · 时间切片"
                subtitle={relative ? '切片值 / 该粒度下区域均值 × 100（100 = 平均水平）' : '区域原始负载'}
                icon={Compass}
                action={
                  <div className="row">
                    <button type="button" className="icon-btn" onClick={() => setFrame((f) => Math.max(0, f - 1))}>
                      <ArrowLeft size={13} />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => setPlaying((p) => !p)}>
                      {playing ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button type="button" className="icon-btn" onClick={() => setFrame((f) => Math.min(frameCount - 1, f + 1))}>
                      <ArrowRight size={13} />
                    </button>
                    <span className="badge cyan mono">{frameData ? dateLabel(frameData.time) : '—'}</span>
                  </div>
                }
              >
                <GeoMap
                  datasetId={datasetId}
                  geo={geo}
                  values={mapValues}
                  unit={relative ? '%' : unit}
                  height={452}
                  onRegionClick={(id) => {
                    setRegion(id)
                    setMode('temporal')
                  }}
                />
                <div className="timeline">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, frameCount - 1)}
                    value={frame}
                    onChange={(e) => setFrame(Number(e.target.value))}
                  />
                  <div className="timeline-meta">
                    <span>{frameData ? timeLabel(frameData.time) : '—'}</span>
                    <span className="mono">{frame + 1} / {frameCount}</span>
                  </div>
                </div>
              </Card>

              <div className="stack">
                <Card title="空间自相关" subtitle="Moran's I · 6 近邻权重" icon={Gauge}>
                  <div className="moran">
                    <div className="moran-value">{spatial.moran.i ?? '—'}</div>
                    <div className="moran-meta">
                      <span>p 值 <b className="mono">{spatial.moran.p ?? '—'}</b></span>
                      <span>z 分数 <b className="mono">{spatial.moran.z ?? '—'}</b></span>
                    </div>
                    <p className="hint">
                      I &gt; 0 表示高负载区域趋于聚集。{spatial.moran.i > 0.3 ? '当前呈现显著的空间集聚。' : spatial.moran.i > 0.1 ? '存在温和的空间正相关。' : '空间分布接近随机。'}
                    </p>
                  </div>
                  <div className="mini-stats">
                    <div><span>基尼系数</span><b>{spatial.gini}</b></div>
                    <div><span>Top10% 份额</span><b>{spatial.top10Share}%</b></div>
                    <div><span>热点 / 冷点</span><b>{spatial.hot} / {spatial.cold}</b></div>
                  </div>
                </Card>

                <Card title="切片变化榜" subtitle={frameData ? `${timeLabel(frameData.time)} vs 前一切片` : '当前切片变化'} icon={Radio}>
                  <div className="movers">
                    {moverList.length === 0 && <div className="empty" style={{ minHeight: 70, padding: 8 }}>首帧没有对比基准</div>}
                    {moverList.map((m) => (
                      <div className="mover" key={m.id}>
                        <span className="mover-name">{m.label}</span>
                        <span className={`mover-delta ${m.delta >= 0 ? 'up' : 'down'}`}>
                          {m.delta > 0 ? '+' : ''}
                          {m.delta}%
                        </span>
                        <span className="mover-val">{compact(m.value, unit)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>

            <div className="grid cols-2">
              <Card title="区域负载排名" subtitle="按平均区间流量排序 · Top 15" icon={Layers}>
                <EChart
                  height={300}
                  option={{
                    grid: { left: 92, right: 48, top: 8, bottom: 16 },
                    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => compact(v, unit) },
                    xAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
                    yAxis: {
                      type: 'category',
                      data: [...spatial.regionStats].sort((a, b) => b.mean - a.mean).slice(0, 15).reverse().map((r) => r.label.slice(0, 10)),
                      axisLabel: { ...AXIS_LABEL, fontSize: 9 },
                      axisLine: { show: false },
                      axisTick: { show: false },
                    },
                    series: [
                      {
                        type: 'bar',
                        data: [...spatial.regionStats].sort((a, b) => b.mean - a.mean).slice(0, 15).reverse().map((r) => r.mean),
                        barWidth: '55%',
                        itemStyle: { color: 'rgba(34,211,238,.6)', borderRadius: [0, 3, 3, 0] },
                        label: { show: true, position: 'right', color: '#7f8da6', fontSize: 8, formatter: (p) => compact(p.value, unit) },
                      },
                    ],
                  }}
                />
              </Card>
              <Card title="头部区域轨迹" subtitle="相对自身均值的演变 · Top 8" icon={Waves}>
                <EChart option={topTrajectoryOption} height={300} />
              </Card>
            </div>
          </>
        ))}
    </>
  )
}
