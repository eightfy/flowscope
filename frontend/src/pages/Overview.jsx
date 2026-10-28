import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Database,
  Gauge,
  MapPin,
  Timer,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react'
import { api } from '../api'
import Card from '../components/Card'
import EChart from '../components/EChart'
import GeoMap from '../components/GeoMap'
import KpiCard from '../components/KpiCard'
import Segmented from '../components/Segmented'
import { AXIS_LABEL, AXIS_LINE, COLORS, SPLIT_LINE, TOOLTIP, axisFmt, compact, timeLabel, weekdayName } from '../format'

export default function Overview({ datasetId, meta, geo, regions, onNavigate, onFocusRegion }) {
  const [ov, setOv] = useState(null)
  const [error, setError] = useState('')
  const [trendMode, setTrendMode] = useState('day')

  useEffect(() => {
    let alive = true
    setOv(null)
    api
      .get(`/api/datasets/${datasetId}/overview`)
      .then((d) => alive && setOv(d))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [datasetId])

  const unit = meta.unit
  const axis = axisFmt(unit)

  const trendOption = useMemo(() => {
    if (!ov) return null
    const src = trendMode === 'day' ? ov.daily : ov.hourlyTotal
    return {
      backgroundColor: 'transparent',
      grid: { left: 52, right: 16, top: 20, bottom: 44 },
      tooltip: {
        ...TOOLTIP,
        trigger: 'axis',
        formatter: (ps) => {
          const p = ps[0]
          return `<b>${p.axisValue}</b><br/><span style="color:#8b9bb4">总负载</span> <b style="color:#67e8f9">${compact(p.value, unit)}</b>`
        },
      },
      xAxis: {
        type: 'category',
        data: src.times,
        axisLabel: { ...AXIS_LABEL, formatter: (v) => (trendMode === 'day' ? v.slice(5, 10) : timeLabel(v)) },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        splitLine: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        axisLabel: { ...AXIS_LABEL, formatter: axis },
        splitLine: SPLIT_LINE,
        axisLine: { show: false },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          height: 14,
          bottom: 8,
          start: 0,
          end: 100,
          borderColor: 'transparent',
          backgroundColor: 'rgba(148,163,184,.05)',
          fillerColor: 'rgba(34,211,238,.12)',
          handleStyle: { color: '#22d3ee', borderColor: '#22d3ee' },
          textStyle: { color: '#6d7c93', fontSize: 9 },
          dataBackground: { lineStyle: { color: 'rgba(34,211,238,.3)' }, areaStyle: { color: 'rgba(34,211,238,.06)' } },
        },
      ],
      series: [
        {
          type: 'line',
          data: src.values,
          smooth: 0.25,
          symbol: 'none',
          lineStyle: { width: 2, color: COLORS.cyan },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34,211,238,.22)' },
                { offset: 1, color: 'rgba(34,211,238,0)' },
              ],
            },
          },
          markPoint: {
            symbolSize: 42,
            label: { color: '#06121a', fontSize: 9, fontWeight: 700 },
            itemStyle: { color: COLORS.orange },
            data: [{ type: 'max', name: '峰值' }],
          },
        },
      ],
    }
  }, [ov, trendMode, unit, axis])

  const hourOption = useMemo(() => {
    if (!ov) return null
    return {
      grid: { left: 42, right: 12, top: 12, bottom: 26 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => compact(v, unit) },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        axisLabel: { ...AXIS_LABEL, interval: 3, formatter: (v) => `${v}:00` },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
      series: [
        {
          type: 'line',
          data: ov.hourProfile,
          smooth: true,
          symbol: 'circle',
          symbolSize: 3,
          itemStyle: { color: COLORS.violet },
          lineStyle: { color: COLORS.violet, width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(167,139,250,.22)' },
                { offset: 1, color: 'rgba(167,139,250,0)' },
              ],
            },
          },
        },
      ],
    }
  }, [ov, unit, axis])

  const heatOption = useMemo(() => {
    if (!ov) return null
    const data = []
    let max = 0
    ov.weekdayHour.forEach((row, wd) =>
      row.forEach((v, h) => {
        data.push([h, wd, v])
        max = Math.max(max, v)
      }),
    )
    return {
      grid: { left: 44, right: 12, top: 10, bottom: 28 },
      tooltip: {
        ...TOOLTIP,
        formatter: (p) => `${weekdayName(p.value[1])} ${String(p.value[0]).padStart(2, '0')}:00<br/><b style="color:#67e8f9">${compact(p.value[2], unit)}</b>`,
      },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        splitArea: { show: false },
        axisLabel: { ...AXIS_LABEL, interval: 3, formatter: (v) => `${v}h` },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: [0, 1, 2, 3, 4, 5, 6].map(weekdayName),
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: {
        show: false,
        min: 0,
        max,
        inRange: { color: ['#0a1a2a', '#0c4a5e', '#0e7490', '#22d3ee', '#fbbf24'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderColor: 'rgba(7,11,20,.8)', borderWidth: 1.5, borderRadius: 2 },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(34,211,238,.4)' } },
        },
      ],
    }
  }, [ov, unit])

  if (error) return <Card title="总览加载失败">{error}</Card>
  if (!ov) return <div className="boot"><div className="boot-ring" /><p>正在计算全局态势…</p></div>

  const k = ov.kpis
  const peakHour = `${String(ov.hourlyPeak).padStart(2, '0')}:00`
  const top = ov.topRegions[0]
  const insights = [
    `日内负载在 ${peakHour} 达到平均峰值，${k.hourlyPeak >= 18 ? '晚间活动' : k.hourlyPeak <= 6 ? '凌晨低峰' : '日间活动'}特征明显。`,
    `${top?.label || '—'} 是负载最高的区域，约占全域的 ${top?.share ?? '—'}%；前 10% 区域贡献 ${k.top10Share}% 的流量。`,
    `基尼系数 ${k.gini}，${k.gini > 0.5 ? '空间集中度较高，存在明显的核心—边缘结构。' : k.gini > 0.35 ? '空间分布存在一定不均衡。' : '空间分布相对均衡。'}`,
    `数据共覆盖 ${k.regions} 个区域、${k.days} 天，采样粒度 ${meta.interval_min} 分钟。`,
  ]

  return (
    <>
      <div className="kpi-grid">
        <KpiCard
          label="总流量规模"
          value={compact(k.total, unit)}
          icon={Database}
          tone="cyan"
          sub={`${k.days} 天累计`}
        />
        <KpiCard
          label="平均区间负载"
          value={compact(k.mean, unit)}
          icon={Activity}
          tone="violet"
          sub={`${k.regions} 区域均值`}
        />
        <KpiCard
          label="峰值负载"
          value={compact(k.peak, unit)}
          icon={Zap}
          tone="orange"
          sub={timeLabel(k.peakTime)}
        />
        <KpiCard
          label="最近一日变化"
          value={`${k.lastDayDelta > 0 ? '+' : ''}${k.lastDayDelta}%`}
          icon={TrendingUp}
          tone={k.lastDayDelta >= 0 ? 'green' : 'pink'}
          sub="对比前一日总流量"
        />
        <KpiCard
          label="空间集中度"
          value={k.gini}
          icon={Gauge}
          tone="pink"
          sub={`Top 10% 区域占比 ${k.top10Share}%`}
        />
      </div>

      <div className="grid cols-2 mb-14">
        <Card
          title="全局负载趋势"
          subtitle={trendMode === 'day' ? '按日聚合的总流量' : '按小时聚合的总流量'}
          icon={Activity}
          action={
            <Segmented
              value={trendMode}
              onChange={setTrendMode}
              options={[
                { value: 'day', label: '日' },
                { value: 'hour', label: '小时' },
              ]}
              size="sm"
            />
          }
        >
          <EChart option={trendOption} height={310} />
        </Card>

        <Card title="负载 Top 区域" subtitle="按区域平均区间流量排序" icon={MapPin}>
          <EChart
            height={310}
            option={{
              grid: { left: 92, right: 50, top: 8, bottom: 12 },
              tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => compact(v, unit) },
              xAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: axis }, splitLine: SPLIT_LINE },
              yAxis: {
                type: 'category',
                data: [...ov.topRegions].reverse().map((r) => r.label.slice(0, 12)),
                axisLabel: { ...AXIS_LABEL, fontSize: 9, color: '#9aabc4' },
                axisLine: { show: false },
                axisTick: { show: false },
              },
              series: [
                {
                  type: 'bar',
                  data: [...ov.topRegions].reverse().map((r, i) => ({
                    value: r.mean,
                    itemStyle: {
                      color: i >= ov.topRegions.length - 3 ? 'rgba(251,146,60,.85)' : 'rgba(34,211,238,.68)',
                      borderRadius: [0, 4, 4, 0],
                    },
                  })),
                  barWidth: '54%',
                  label: {
                    show: true,
                    position: 'right',
                    color: '#8b9bb4',
                    fontSize: 8,
                    formatter: (p) => compact(p.value, unit),
                  },
                },
              ],
            }}
          />
        </Card>
      </div>

      <div className="grid cols-2 mb-14" style={{ gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,1.35fr)' }}>
        <Card title="区域平均负载地图" subtitle="颜色越暖，区域平均负载越高" icon={MapPin} action={<button type="button" className="btn ghost sm" onClick={() => onNavigate('explore')}>空间探索 <ArrowUpRight size={12} /></button>}>
          <GeoMap
            datasetId={datasetId}
            geo={geo}
            values={ov.regionMean}
            unit={unit}
            height={430}
            onRegionClick={(id) => { onFocusRegion?.(id); onNavigate('explore') }}
          />
        </Card>

        <div className="grid" style={{ gridTemplateRows: '1fr 1fr', gap: 14 }}>
          <Card title="24 小时平均节律" subtitle={`平均峰值出现在 ${peakHour}`} icon={Timer}>
            <EChart option={hourOption} height={188} />
          </Card>
          <Card title="星期 × 小时热力" subtitle="颜色越亮，负载越高" icon={CalendarDays}>
            <EChart option={heatOption} height={188} />
          </Card>
        </div>
      </div>

      <Card title="读图提示" subtitle="从数据中自动提取的关键观察" icon={Waves}>
        <div className="insight-grid">
          {insights.map((text, i) => (
            <div className="insight" key={i}>
              <span className="insight-index">{String(i + 1).padStart(2, '0')}</span>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
