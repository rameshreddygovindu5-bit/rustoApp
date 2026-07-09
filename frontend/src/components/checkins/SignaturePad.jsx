import React, { useRef, useEffect, useCallback } from 'react'
import { Eraser } from 'lucide-react'

/**
 * SignaturePad — plain HTML5 canvas signature capture (no npm deps).
 *
 * Uses pointer events so it works with mouse, touch (tablets/phones) and
 * stylus alike. Emits a base64 PNG data URL via `onChange` after every
 * completed stroke, and `null` when cleared.
 *
 * Props:
 *   onChange(dataUrlOrNull)  — called after each stroke / on clear
 *   disabled                 — freeze the pad (e.g. while submitting)
 *   height                   — CSS pixel height of the pad (default 160)
 */
export default function SignaturePad({ onChange, disabled = false, height = 160 }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const hasInkRef = useRef(false)

  // (Re)initialise the canvas: size it to its CSS box × devicePixelRatio so
  // strokes stay crisp on retina/tablet screens, then paint a white base
  // (the exported PNG shouldn't be transparent).
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    // Setting width/height resets the context transform + clears the canvas.
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1B2A4A'
  }, [])

  useEffect(() => { initCanvas() }, [initCanvas])

  const pointFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handlePointerDown = (e) => {
    if (disabled) return
    e.preventDefault()
    try { canvasRef.current.setPointerCapture(e.pointerId) } catch { /* older browsers */ }
    drawingRef.current = true
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    // Dot for a simple tap so single taps still leave a mark.
    ctx.lineTo(x + 0.1, y + 0.1)
    ctx.stroke()
    hasInkRef.current = true
  }

  const handlePointerMove = (e) => {
    if (!drawingRef.current || disabled) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = pointFromEvent(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    hasInkRef.current = true
  }

  const endStroke = (e) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    try { canvasRef.current.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (hasInkRef.current && onChange) {
      onChange(canvasRef.current.toDataURL('image/png'))
    }
  }

  const handleClear = () => {
    hasInkRef.current = false
    drawingRef.current = false
    initCanvas()
    onChange && onChange(null)
  }

  return (
    <div className={disabled ? 'opacity-60 pointer-events-none' : ''}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px`, touchAction: 'none' }}
        className="border-2 border-dashed border-ink-300 rounded-xl bg-white cursor-crosshair select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      />
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[10px] text-ink-400">Sign above with finger, stylus or mouse.</p>
        <button type="button" onClick={handleClear}
          className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-red-600 font-semibold">
          <Eraser size={12} /> Clear
        </button>
      </div>
    </div>
  )
}
