import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export default function EChart({ option, height = 320, className = '', onEvents, style, renderer = 'canvas' }) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  const eventsRef = useRef(onEvents)
  eventsRef.current = onEvents

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, null, { renderer })
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [renderer])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.setOption(option || {}, { notMerge: true, lazyUpdate: false })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const handler = (e) => eventsRef.current?.click?.(e)
    chart.off('click')
    chart.on('click', handler)
    return () => chart.off('click', handler)
  }, [onEvents])

  return <div ref={ref} className={`echart ${className}`} style={{ height, ...style }} />
}
