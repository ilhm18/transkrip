import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Download, Volume2, Sparkles, RotateCcw } from 'lucide-react';

interface AudioPlayerProps {
  audioUrl: string;
  duration?: number;
  onTranscribeAI?: () => void;
  isTranscribingAI?: boolean;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  duration = 0,
  onTranscribeAI,
  isTranscribingAI = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [actualDuration, setActualDuration] = useState(duration);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setActualDuration(audio.duration);
      }
    };
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const changeSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2, 0.75];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const newSpeed = speeds[nextIdx];
    setPlaybackSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `rekaman_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg text-xs text-slate-300">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Play/Pause & Time */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-indigo-600/30 cursor-pointer"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        <div className="flex items-center gap-1 font-mono text-[11px] text-slate-400">
          <span className="text-slate-200 font-semibold">{formatTime(currentTime)}</span>
          <span>/</span>
          <span>{formatTime(actualDuration || duration)}</span>
        </div>
      </div>

      {/* Seekbar */}
      <div className="flex-1 min-w-[160px] flex items-center gap-2">
        <input
          type="range"
          min="0"
          max={actualDuration || duration || 100}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
      </div>

      {/* Speed, Download & AI Retranscribe */}
      <div className="flex items-center gap-2">
        <button
          onClick={changeSpeed}
          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px] transition-colors"
          title="Kecepatan Pemutaran"
        >
          {playbackSpeed}x
        </button>

        <button
          onClick={handleDownload}
          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          title="Unduh File Rekaman Audio (.webm)"
        >
          <Download className="w-4 h-4" />
        </button>

        {onTranscribeAI && (
          <button
            onClick={onTranscribeAI}
            disabled={isTranscribingAI}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-medium transition-colors cursor-pointer"
            title="Transkripsi audio ini secara komprehensif menggunakan Gemini 3.5 Transcribe"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isTranscribingAI ? 'Mentranskripsi...' : 'Transkripsi Ulang AI'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
