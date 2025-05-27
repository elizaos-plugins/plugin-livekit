"use client"

import { useEffect, useRef, useState } from "react"

interface AudioVisualizerProps {
  audioStream?: MediaStream
  isActive?: boolean
  barCount?: number
  className?: string
}

export default function AudioVisualizer({
  audioStream,
  isActive = false,
  barCount = 20,
  className = "",
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | undefined>(undefined)
  const analyserRef = useRef<AnalyserNode | undefined>(undefined)
  const [audioData, setAudioData] = useState<Uint8Array | undefined>()

  useEffect(() => {
    if (!audioStream) return

    const audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    const source = audioContext.createMediaStreamSource(audioStream)

    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    setAudioData(dataArray)

    return () => {
      audioContext.close()
    }
  }, [audioStream])

  useEffect(() => {
    if (!isActive || !analyserRef.current || !audioData) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const draw = () => {
      if (!analyserRef.current || !audioData) return

      analyserRef.current.getByteFrequencyData(audioData)

      // Clear with background using computed style
      const computedStyle = getComputedStyle(canvas)
      const mutedColor = `hsl(${computedStyle.getPropertyValue('--muted').trim()})`
      const primaryColor = `hsl(${computedStyle.getPropertyValue('--primary').trim()})`
      
      ctx.fillStyle = mutedColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const barWidth = canvas.width / barCount
      let x = 0

      for (let i = 0; i < barCount; i++) {
        const barHeight = (audioData[i] / 255) * canvas.height * 0.8

        // Simple gradient using primary color
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight)
        gradient.addColorStop(0, primaryColor)
        gradient.addColorStop(1, primaryColor.replace(')', ' / 0.5)'))

        ctx.fillStyle = gradient
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight)

        x += barWidth
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isActive, audioData, barCount])

  return <canvas ref={canvasRef} width={300} height={60} className={`w-full h-full ${className}`} />
}
