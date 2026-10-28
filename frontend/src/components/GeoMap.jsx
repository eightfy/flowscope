import { useEffect, useMemo, useState } from 'react'
import * as echarts from 'echarts'
import EChart from './EChart'
import { COLORS, TOOLTIP, compact } from '../format'

const MAP_COLORS = ['#0b3a4a', '#0e7490', '#22d3ee', '#67e8f9', '#fbbf24', '#fb923c']

export default function GeoMap({
  datasetId,
  geo,
  values,
  mode = 'value',
  clusters = [],
  unit = '',
  height = 460,
  onRegionClick,
  selectedRegion,
  valueDigits = 0,
}) {
  const [ready, setReady] = useState(false)
  const mapName = `flowscope-${datasetId}`

  useEffect(() => {
    setReady(false)
    if (!geo || !datasetId) return
    echarts.registerMap(mapName, geo)
    setReady(true)
  }, [datasetId, geo, mapName])

  const labelMap = useMemo(() => {
    const out = {}
    ;(geo?.features || []).forEach((f) => {
      out[f.properties?.name] = f.properties?.label || f.properties?.name
    })
    return out
  }, [geo])

  const { data, min, max } = useMemo(() => {
    const vals = Object.values(values || {}).filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)))
    const lo = vals.length ? Math.min(...vals) : 0
    const sorted = [...vals].sort((a, b) => a - b)
    const hi = sorted.length ? sorted[Math.floor(sorted.length * 0.97)] || sorted[sorted.length - 1] : 1
    return { min: lo, max: hi > lo ? hi : lo + 1 }
  }, [values])

  const option = useMemo(() => {
    const mapData = Object.entries(values || {}).map(([id, v]) => ({
      name: id,
      value: mode === 'cluster' ? v : v,
      label: labelMap[id] || id,
    }))
    const isCluster = mode === 'cluster'
    return {
      backgroundColor: 'transparent',
      tooltip: {
        ...TOOLTIP,
        trigger: 'item',
        formatter: (p) => {
          const label = p.data?.label || p.name
          if (p.value === undefined || p.value === null) return `<b>${label}</b><br/><span style="color:#7f8da6">无数据</span>`
          if (isCluster) {
            const c = clusters.find((x) => x.id === Number(p.value))
            return `<b>${label}</b><br/><span style="color:${c?.color || '#fff'}">●</span> ${c?.name || '簇'} · ${c?.size || 0} 个区域`
          }
          const shown = unit === '%' ? `${Number(p.value).toFixed(0)}%` : compact(p.value, unit)
          return `<b>${label}</b><br/><span style="color:#8b9bb4">${unit === '%' ? '相对均值指数' : '平均负载'}</span> <b style="color:#e8f2ff">${shown}</b>`
        },
      },
      visualMap: isCluster
        ? {
            type: 'piecewise',
            show: true,
            left: 14,
            bottom: 14,
            itemWidth: 10,
            itemHeight: 10,
            itemGap: 7,
            textStyle: { color: '#9aabc4', fontSize: 11 },
            pieces: clusters.map((c) => ({ value: c.id, label: c.name, color: c.color })),
            outOfRange: { color: '#1a2438' },
          }
        : {
            type: 'continuous',
            min,
            max,
            left: 14,
            bottom: 18,
            itemWidth: 9,
            itemHeight: 116,
            calculable: false,
            text: unit === '%' ? [`${Math.round(max)}%`, `${Math.round(min)}%`] : [compact(max, unit), compact(min, unit)],
            textStyle: { color: '#8b9bb4', fontSize: 10 },
            inRange: { color: MAP_COLORS },
            outOfRange: { color: '#182238' },
          },
      series: [
        {
          type: 'map',
          map: mapName,
          roam: true,
          scaleLimit: { min: 0.8, max: 10 },
          zoom: 1.08,
          selectedMode: false,
          data: mapData,
          itemStyle: {
            areaColor: '#17243a',
            borderColor: 'rgba(7, 12, 22, 0.92)',
            borderWidth: 0.7,
          },
          emphasis: {
            itemStyle: { areaColor: '#f8b84e', borderColor: '#fff7e6', borderWidth: 1.2 },
            label: {
              show: true,
              color: '#08101d',
              fontSize: 11,
              fontWeight: 600,
              formatter: (p) => p.data?.label || p.name,
            },
          },
          select: { disabled: true },
        },
      ],
    }
  }, [values, mode, clusters, min, max, unit, mapName, labelMap])

  if (!ready) return <div className="chart-loading" style={{ height }}>地图数据加载中…</div>

  return (
    <EChart
      option={option}
      height={height}
      onEvents={{
        click: (p) => {
          if (p.name && onRegionClick) onRegionClick(p.name)
        },
      }}
    />
  )
}
