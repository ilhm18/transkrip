import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  isPaused: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  analyser,
  isRecording,
  isPaused,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI and responsive resizing
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(rect.width * dpr, 200);
      canvas.height = Math.max(rect.height * dpr, 40);
    };

    updateSize();
    const resizeObserver = new ResizeObserver(() => updateSize());
    resizeObserver.observe(container);

    let bufferLength = 0;
    let dataArray: Uint8Array | null = null;

    if (analyser) {
      bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
    }

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (!isRecording || isPaused || !analyser || !dataArray) {
        // Draw idle subtle horizontal line
        ctx.beginPath();
        ctx.strokeStyle = isPaused ? '#eab308' : '#334155';
        ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        if (isPaused) {
          ctx.fillStyle = '#eab308';
          ctx.font = `${11 * (window.devicePixelRatio || 1)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('DIJEDA (PAUSED)', width / 2, height / 2 - 10);
        }
        return;
      }

      analyser.getByteFrequencyData(dataArray as any);

      // Dynamically calculate bars based on width
      const barCount = Math.min(Math.floor(width / (8 * (window.devicePixelRatio || 1))), 48);
      const barWidth = (width / barCount) - 3;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0;
        const percent = value / 255;
        const barHeight = Math.max(4, percent * (height - 8));
        const x = i * (barWidth + 3);
        const y = (height - barHeight) / 2;

        // Gradient for vibrant sound waves
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#818cf8'); // Indigo
        gradient.addColorStop(0.5, '#c084fc'); // Purple
        gradient.addColorStop(1, '#f43f5e'); // Rose

        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = Math.min(barWidth / 2, 4);
        ctx.roundRect(x, y, barWidth, barHeight, radius);
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [analyser, isRecording, isPaused]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center bg-slate-900/80 border border-slate-800 rounded-xl px-2 sm:px-3 py-1.5 w-full h-10 sm:h-12 overflow-hidden shadow-inner"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
};
