import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Layers, Play, RefreshCw, ScanLine, Sparkles, Target, Wand2 } from 'lucide-react'
import { api } from '../api'
import Card from '../components/Card'
import EChart from '../components/EChart'
import GeoMap from '../components/GeoMap'
import RangeField from '../components/RangeField'
import Segmented from '../components/Segmented'
import { AXIS_LABEL, AXIS_LINE, SPLIT_LINE, TOOLTIP, compact, metric } from '../format'

export default function Clusters({ datasetId, meta, geo }) {
  const [cfg, setCfg] = useState({
    k: 4,
    method: 'kmeans',
    auto_k: false,
    use_profile: true,
    use_weekend: true,
    use_level: true,
    use_variability: true,
  })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(
    async (next = cfg) => {
      setLoading(true)
      setError('')
      try {
        const r = await api.post('/api/cluster', { dataset: datasetId, ...next })
        setResult(r)
        if (r.k !== next.k) setCfg((c) => ({ ...c, k: r.k }))
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    },
    [datasetId, cfg],
  )

  useEffect(() => {
    setResult(null)
    const initial = { k: 4, method: 'kmeans', auto_k: false, use_profile: true, use_weekend: true, use_level: true, use_variability: true }
    setCfg(initial)
    run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId])

  const unit = meta.unit
  const labels = useMemo(() => Object.fromEntries((result?.labels || []).map((l) => [l.id, l])), [result])
  const clusterMap = useMemo(() => {
    if (!result) return {}
    const out = {}
    result.labels.forEach((l) => {
      out[l.id] = l.cluster
    })
    return out
  }, [result])

  const pcaOption = useMemo(() => {
    if (!result) return null
    return {
      grid: { left: 46, right: 16, top: 20, bottom: 36 },
      tooltip: {
        ...TOOLTIP,
        formatter: (p) => {
          const d = p.data
          if (!d) return ''
          const c = result.clusters.find((x) => x.id === d.cluster)
          return `<b>${d.label}</b><br/>簇：<span style="color:${c?.color}">${c?.name}</span><br/>PC1 ${d.x.toFixed(2)} · PC2 ${d.y.toFixed(2)}<br/>平均负载 ${compact(d.mean, unit)}`
        },
      },
      xAxis: {
        type: 'value',
        name: 'PC1',
        nameTextStyle: { color: '#5f6c82', fontSize: 9 },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
        axisLine: AXIS_LINE,
        splitLine: SPLIT_LINE,
      },
      yAxis: {
        type: 'value',
        name: 'PC2',
        nameTextStyle: { color: '#5f6c82', fontSize: 9 },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
        axisLine: { show: false },
        splitLine: SPLIT_LINE,
      },
      series: result.clusters.map((c) => ({
        type: 'scatter',
        name: c.name,
        data: result.pca
          .filter((p) => p.cluster === c.id)
          .map((p) => ({ ...p, value: [p.x, p.y] })),
        symbolSize: (v, p) => Math.max(5, Math.min(16, 5 + Math.log10(Math.max(p.data.mean, 1)) * 2.2)),
        itemStyle: { color: c.color, opacity: 0.82, borderColor: 'rgba(255,255,255,.35)', borderWidth: 0.5 },
        emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1.2 } },
      })),
    }
  }, [result, unit])

  const profileOption = useMemo(() => {
    if (!result) return null
    return {
      grid: { left: 46, right: 92, top: 18, bottom: 26 },
      tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => `${Number(v).toFixed(2)}×` },
      legend: { top: 0, right: 0, orient: 'vertical', itemWidth: 8, itemHeight: 3, textStyle: { color: '#8593aa', fontSize: 8 } },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}`),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, interval: 3, formatter: (v) => `${v}h` },
      },
      yAxis: {
        type: 'value',
        axisLabel: { ...AXIS_LABEL, formatter: (v) => `${v}×` },
        splitLine: SPLIT_LINE,
        name: '相对均值',
        nameTextStyle: { color: '#5f6c82', fontSize: 9 },
      },
      series: result.clusters.map((c) => ({
        type: 'line',
        name: c.name,
        data: c.profile,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: c.color, width: 2 },
        emphasis: { focus: 'series' },
      })),
    }
  }, [result])

  const silhouetteOption = useMemo(() => {
    if (!result) return null
    return {
      grid: { left: 40, right: 14, top: 14, bottom: 26 },
      tooltip: { ...TOOLTIP, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: result.silhouetteCurve.map((c) => `k=${c.k}`),
        axisLine: AXIS_LINE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
      },
      yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, max: 1 },
      series: [
        {
          type: 'line',
          data: result.silhouetteCurve.map((c) => c.score),
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#a78bfa', width: 2 },
          itemStyle: { color: '#a78bfa' },
          markPoint: {
            symbolSize: 38,
            itemStyle: { color: '#22d3ee' },
            label: { color: '#06121a', fontSize: 8, fontWeight: 700, formatter: () => `k=${result.k}` },
            data: [{ coord: [`k=${result.k}`, result.silhouetteCurve.find((c) => c.k === result.k)?.score || 0] }],
          },
        },
      ],
    }
  }, [result])

  const featureOption = useMemo(() => {
    if (!result) return null
    const feats = result.features.filter((f) => !f.name.startsWith('h'))
    const data = []
    let lo = 0
    let hi = 0
    feats.forEach((f, y) =>
      f.values.forEach((v, x) => {
        data.push([x, y, v])
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }),
    )
    return {
      grid: { left: 86, right: 22, top: 10, bottom: 42 },
      tooltip: {
        ...TOOLTIP,
        formatter: (p) => `${result.clusters[p.value[0]]?.name}<br/><b>${feats[p.value[1]]?.name}</b> z = ${p.value[2]}`,
      },
      xAxis: {
        type: 'category',
        data: result.clusters.map((c) => c.name),
        axisLabel: { ...AXIS_LABEL, fontSize: 8, interval: 0, rotate: 18 },
        axisLine: AXIS_LINE,
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: feats.map((f) => f.name),
        axisLabel: { ...AXIS_LABEL, fontSize: 9 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: { show: false, min: lo, max: hi, inRange: { color: ['#1e3a5f', '#0e7490', '#22d3ee', '#fbbf24'] } },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: true, fontSize: 8, color: 'rgba(255,255,255,.75)', formatter: (p) => Number(p.value[2]).toFixed(1) },
          itemStyle: { borderColor: 'rgba(7,11,20,.7)', borderWidth: 1, borderRadius: 3 },
        },
      ],
    }
  }, [result])

  const update = (patch) => setCfg((c) => ({ ...c, ...patch }))

  return (
    <div className="lab-layout">
      <aside className="config-panel">
        <div className="config-head">
          <div>
            <h3>聚类配置</h3>
            <p>从时间形态中发现功能区</p>
          </div>
          <span className="badge cyan">Unsupervised</span>
        </div>

        <div className="config-section">
          <div className="field-label">聚类算法</div>
          <Segmented
            value={cfg.method}
            onChange={(method) => update({ method })}
            options={[
              { value: 'kmeans', label: 'K-Means' },
              { value: 'gmm', label: 'GMM' },
              { value: 'agglomerative', label: '层次' },
            ]}
            size="sm"
          />
        </div>

        <div className="config-section">
          <RangeField
            label="簇数量 K"
            hint={cfg.auto_k ? '自动模式下由轮廓系数选择最佳 K' : '建议 3–6 个功能区，便于解释'}
            value={cfg.k}
            min={2}
            max={8}
            step={1}
            onChange={(k) => update({ k })}
            format={(v) => `${v} 个功能区`}
          />
          <label className="toggle" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={cfg.auto_k} onChange={(e) => update({ auto_k: e.target.checked })} />
            <span className="track" />
            自动选择最佳 K
          </label>
        </div>

        <div className="config-section">
          <div className="field-label">特征空间</div>
          <div className="check-list">
            {[
              ['use_profile', '日内形态', '24 小时相对节律'],
              ['use_weekend', '周末效应', '周末 / 平日比率'],
              ['use_level', '流量水平', '区域平均负载'],
              ['use_variability', '波动性', 'CV 与峰值强度'],
            ].map(([key, label, desc]) => (
              <label className="feature-check" key={key}>
                <input type="checkbox" checked={cfg[key]} onChange={(e) => update({ [key]: e.target.checked })} />
                <span className="feature-box" />
                <span className="feature-text">
                  <b>{label}</b>
                  <small>{desc}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        <button type="button" className="btn run-btn" onClick={() => run()} disabled={loading}>
          {loading ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
          {loading ? '聚类中…' : '运行聚类'}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          轮廓系数越接近 1，簇内越紧凑、簇间越分离。当前特征维度 {result?.nFeatures ?? '—'}。
        </p>
      </aside>

      <section className="lab-main">
        {error && <Card title="聚类失败">{error}</Card>}
        {!result && !error && (
          <div className="boot" style={{ minHeight: 420 }}>
            <div className="boot-ring" />
            <p>构建特征空间并聚类…</p>
          </div>
        )}
        {result && (
          <>
            <div className="stat-strip mb-14">
              <div>
                <div className="sl">识别出的功能区</div>
                <div className="sv">{result.k}<small>类</small></div>
              </div>
              <div>
                <div className="sl">轮廓系数</div>
                <div className="sv text-cyan">{metric(result.silhouette)}</div>
              </div>
              <div>
                <div className="sl">PC1 + PC2 解释率</div>
                <div className="sv">{metric((result.explainedVariance[0] + result.explainedVariance[1]) * 100, 1)}<small>%</small></div>
              </div>
              <div>
                <div className="sl">参与聚类区域</div>
                <div className="sv">{result.labels.length}<small>个</small></div>
              </div>
            </div>

            <div className="grid cols-2 mb-14" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)' }}>
              <Card title="功能区空间分布" subtitle="相同颜色代表同一类时间行为" icon={Layers}>
                <GeoMap
                  datasetId={datasetId}
                  geo={geo}
                  values={clusterMap}
                  mode="cluster"
                  clusters={result.clusters}
                  height={412}
                />
              </Card>
              <Card title="特征空间 PCA" subtitle="点大小表示平均负载 · 颜色为簇" icon={Target}>
                <EChart option={pcaOption} height={412} />
              </Card>
            </div>

            <div className="grid cols-2 mb-14" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)' }}>
              <Card title="功能区日内形态" subtitle="归一化后 1.0 = 该簇平均负载" icon={ScanLine}>
                <EChart option={profileOption} height={260} />
              </Card>
              <Card title="轮廓系数随 K 变化" subtitle="自动模式下取最高点" icon={Wand2}>
                <EChart option={silhouetteOption} height={260} />
              </Card>
            </div>

            <div className="cluster-grid mb-14">
              {result.clusters.map((c) => (
                <div className="cluster-card" key={c.id} style={{ '--cluster': c.color }}>
                  <div className="cluster-top">
                    <span className="cluster-dot" />
                    <h4>{c.name}</h4>
                    <span className="cluster-share">{c.share}%</span>
                  </div>
                  <p className="cluster-desc">{c.description}</p>
                  <div className="cluster-stats">
                    <div><span>区域数</span><b>{c.size}</b></div>
                    <div><span>平均负载</span><b>{compact(c.level, unit)}</b></div>
                    <div><span>峰值小时</span><b>{String(c.peakHour).padStart(2, '0')}:00</b></div>
                    <div><span>周末比</span><b>{c.weekendRatio}×</b></div>
                  </div>
                  <div className="member-chips">
                    {c.topMembers.slice(0, 4).map((m) => (
                      <span key={m.id} title={m.label}>{m.label}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Card title="簇特征画像" subtitle="标准化后的特征均值（z-score）" icon={Boxes}>
              <EChart option={featureOption} height={230} />
            </Card>
          </>
        )}
      </section>
    </div>
  )
}
