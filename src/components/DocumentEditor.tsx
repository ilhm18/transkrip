import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  Copy,
  Download,
  Check,
  RotateCcw,
  Sparkles,
  FileText,
  Volume2,
  Edit3,
  Eye,
  Instagram,
} from 'lucide-react';
import { formatDateTimeWIB } from '../utils/dateUtils';

interface DocumentEditorProps {
  title: string;
  onTitleChange: (newTitle: string) => void;
  content: string;
  onContentChange: (newContent: string) => void;
  interimTranscript: string;
  isRecording: boolean;
  recordingSeconds: number;
  autoScroll: boolean;
  setAutoScroll: (val: boolean) => void;
  onOpenAISummary?: () => void;
  language: string;
  onLanguageChange: (lang: string) => void;
  audioSource?: string;
}

interface ParsedParagraph {
  id: string;
  startTime: string;
  text: string;
  isHeading?: boolean;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  title,
  onTitleChange,
  content,
  onContentChange,
  interimTranscript,
  isRecording,
  recordingSeconds,
  autoScroll,
  setAutoScroll,
  onOpenAISummary,
  language,
  onLanguageChange,
  audioSource = 'mic',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditingRaw, setIsEditingRaw] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Auto revert confirm reset prompt after 4 seconds
  useEffect(() => {
    if (confirmReset) {
      const timer = setTimeout(() => setConfirmReset(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [confirmReset]);

  // Auto-scroll when new text arrives
  useEffect(() => {
    if (!autoScroll) return;
    if (!isEditingRaw && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    } else if (isEditingRaw && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [content, interimTranscript, autoScroll, isEditingRaw]);

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCopy = () => {
    const fullText = title ? `# ${title}\n\n${content}` : content;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    const element = document.createElement('a');
    const file = new Blob([`${title}\n\n${content}`], { type: 'text/plain;charset=utf-8' });
    element.href = URL.createObjectURL(file);
    element.download = `${(title || 'transkrip-rekaman').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Group continuous speech into spacious, comfortable paragraphs
  const parsedParagraphs = useMemo(() => {
    const rawLines = content.split('\n');
    const paragraphs: ParsedParagraph[] = [];
    let currentParagraph: ParsedParagraph | null = null;

    rawLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentParagraph) {
          paragraphs.push(currentParagraph);
          currentParagraph = null;
        }
        return;
      }

      if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
        if (currentParagraph) {
          paragraphs.push(currentParagraph);
          currentParagraph = null;
        }
        paragraphs.push({
          id: `h-${index}`,
          startTime: '',
          text: trimmed.replace(/^#+\s*/, ''),
          isHeading: true,
        });
        return;
      }

      const match = trimmed.match(/^\[([0-9:]+)\]\s*(.*)$/);
      if (match) {
        const time = match[1];
        const speechText = match[2];

        if (currentParagraph && currentParagraph.text.length < 320) {
          const sep = currentParagraph.text.endsWith('.') || currentParagraph.text.endsWith('?') || currentParagraph.text.endsWith('!') ? ' ' : '. ';
          currentParagraph.text = `${currentParagraph.text}${sep}${speechText}`;
        } else {
          if (currentParagraph) {
            paragraphs.push(currentParagraph);
          }
          currentParagraph = {
            id: `p-${index}`,
            startTime: time,
            text: speechText,
          };
        }
      } else {
        if (currentParagraph) {
          currentParagraph.text = `${currentParagraph.text} ${trimmed}`;
        } else {
          currentParagraph = {
            id: `p-${index}`,
            startTime: '',
            text: trimmed,
          };
        }
      }
    });

    if (currentParagraph) {
      paragraphs.push(currentParagraph);
    }

    return paragraphs;
  }, [content]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;
  const readingTime = Math.ceil(wordCount / 180);

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative w-full min-h-0">
      {/* Top Header Bar: Clean, Minimalist & Responsive */}
      <div className="px-3 sm:px-6 py-2.5 sm:py-3.5 bg-slate-900 border-b border-slate-800/80 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-2.5 no-print shrink-0">
        <div className="w-full sm:w-auto flex-1 min-w-[140px] max-w-2xl">
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Judul Dokumen / Rapat..."
            className="w-full bg-transparent text-base sm:text-xl md:text-2xl font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 rounded px-1 -ml-1 transition-all"
          />
        </div>

        {/* Essential Action Controls: Edit Mode, Language, Copy, Download */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto no-scrollbar">
          {/* Edit/View Toggle */}
          <button
            onClick={() => setIsEditingRaw(!isEditingRaw)}
            className={`flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
              isEditingRaw
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/70'
            }`}
            title="Beralih antara tampilan dokumen rapi dan mode edit manual"
          >
            {isEditingRaw ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Lihat Teks</span>
              </>
            ) : (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Edit Teks</span>
              </>
            )}
          </button>

          {/* Language Selector */}
          <div className="flex items-center bg-slate-800/80 border border-slate-700/70 rounded-xl px-2 py-1 text-xs text-slate-300">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400 mr-1 shrink-0" />
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer max-w-[85px] sm:max-w-none"
            >
              <option value="id-ID" className="bg-slate-800 text-slate-100">🇮🇩 ID</option>
              <option value="en-US" className="bg-slate-800 text-slate-100">🇺🇸 EN</option>
            </select>
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            title="Salin semua teks transkrip"
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/70 text-xs font-medium transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Tersalin' : 'Salin'}</span>
          </button>

          {/* Download TXT */}
          <button
            onClick={handleDownloadTxt}
            title="Unduh file dokumen teks (.txt)"
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Unduh</span>
          </button>
        </div>
      </div>

      {/* Main Expansive Transcript Area: WIDE & SPACIOUS */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-slate-950/60 min-h-0">
        {/* Printable Header for Print/PDF */}
        <div className="hidden print-only mb-6 pb-4 border-b border-gray-300 p-8">
          <h1 className="text-2xl font-bold text-gray-900">{title || 'Transkrip Rekaman'}</h1>
          <p className="text-sm text-gray-600">Dicetak pada: {formatDateTimeWIB()}</p>
        </div>

        {!isEditingRaw ? (
          /* SPACIOUS CLEAN PARAGRAPH VIEW */
          <div
            ref={containerRef}
            className="flex-1 p-3.5 sm:p-6 md:p-10 lg:p-12 overflow-y-auto document-sheet text-slate-100 text-sm sm:text-base md:text-lg leading-relaxed space-y-4 sm:space-y-5 font-sans selection:bg-indigo-500/30 max-w-5xl mx-auto w-full"
          >
            {parsedParagraphs.length > 0 ? (
              parsedParagraphs.map((para) => {
                if (para.isHeading) {
                  return (
                    <h2 key={para.id} className="text-lg sm:text-xl md:text-2xl font-bold text-white pt-2 sm:pt-3 pb-1 border-b border-slate-800/80">
                      {para.text}
                    </h2>
                  );
                }

                return (
                  <p key={para.id} className="text-slate-200 leading-relaxed tracking-wide">
                    {para.startTime && (
                      <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-slate-800/90 border border-slate-700/60 font-mono text-[10px] sm:text-xs font-semibold text-amber-400 mr-2 select-none align-middle shadow-xs">
                        {para.startTime}
                      </span>
                    )}
                    <span>{para.text}</span>
                  </p>
                );
              })
            ) : null}

            {/* Seamless Real-time Typing Stream */}
            {isRecording && (
              <div className="rounded-xl p-2.5 sm:p-3.5 bg-indigo-950/20 border border-indigo-500/30 animate-fadeIn">
                <p className="text-slate-100 leading-relaxed text-sm sm:text-base md:text-lg">
                  <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 font-mono text-[10px] sm:text-xs font-bold text-rose-300 mr-2 select-none align-middle animate-pulse">
                    {formatSeconds(recordingSeconds)}
                  </span>
                  {interimTranscript ? (
                    <span className="bg-indigo-500/20 text-indigo-100 font-medium px-1 rounded transition-all">
                      {interimTranscript}
                    </span>
                  ) : (
                    <span className="italic text-slate-500 text-xs sm:text-sm">
                      Mendengarkan ucapan... mulai berbicara atau putar audio perangkat
                    </span>
                  )}
                  <span className="inline-block w-1.5 sm:w-2 h-4 sm:h-5 ml-1 bg-indigo-400 align-middle animate-cursor" />
                </p>
              </div>
            )}

            {/* Empty State */}
            {!content && !isRecording && (
              <div className="h-full min-h-[220px] flex flex-col items-center justify-center p-6 sm:p-12 text-center text-slate-500">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3 text-indigo-400 shadow-inner">
                  <FileText className="w-6 h-6 sm:w-8 sm:h-8" />
                </div>
                <h3 className="text-slate-200 font-bold text-sm sm:text-base mb-1">Lembar Transkrip Masih Kosong</h3>
                <p className="text-xs sm:text-sm max-w-md text-slate-400 leading-relaxed">
                  Pilih sumber audio (Mikrofon atau Audio Perangkat), lalu klik <strong>"Mulai Rekam"</strong> di atas. Ucapan akan otomatis diketik secara real-time ke lembar ini.
                </p>
              </div>
            )}
          </div>
        ) : (
          /* RAW TEXTAREA EDIT MODE */
          <div className="flex-1 p-3 sm:p-6 md:p-10 max-w-5xl mx-auto w-full flex flex-col min-h-0">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder="Edit langsung teks transkrip dokumen Anda di sini..."
              className="w-full flex-1 bg-transparent text-slate-100 text-sm sm:text-base md:text-lg leading-relaxed resize-none focus:outline-none font-sans min-h-[250px] placeholder:text-slate-600"
              spellCheck="false"
            />
          </div>
        )}
      </div>

      {/* Clean Footer Bar */}
      <div className="px-3 sm:px-6 py-2 bg-slate-900 border-t border-slate-800/80 flex items-center justify-between text-[11px] sm:text-xs text-slate-400 no-print shrink-0">
        <div className="flex items-center gap-2 sm:gap-4">
          <span>Kata: <strong className="text-slate-200">{wordCount}</strong></span>
          <span className="hidden xs:inline">Karakter: <strong className="text-slate-200">{charCount}</strong></span>
          <span className="hidden sm:inline">Estimasi: <strong className="text-slate-200">~{readingTime} menit</strong></span>
        </div>

        {/* Developer Attribution */}
        <div className="hidden md:flex items-center gap-1.5 text-[11px]">
          <span className="text-slate-500">Dibuat oleh</span>
          <a
            href="https://www.instagram.com/ilhamm.18/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-pink-300 border border-slate-700/60 hover:border-pink-500/40 transition-all font-medium group"
            title="Kunjungi Instagram @ilhamm.18"
          >
            <Instagram className="w-3 h-3 text-pink-400 group-hover:scale-110 transition-transform" />
            <span>@ilhamm.18</span>
          </a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <label className="flex items-center gap-1 cursor-pointer text-slate-400 hover:text-slate-300 select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0 cursor-pointer"
            />
            <span>Auto-scroll</span>
          </label>

          {content && (
            <div className="flex items-center">
              {confirmReset ? (
                <div className="flex items-center gap-1.5 bg-rose-500/15 border border-rose-500/40 rounded-lg px-2 py-0.5 animate-fadeIn">
                  <span className="text-[10px] text-rose-300 font-medium whitespace-nowrap">Kosongkan teks?</span>
                  <button
                    onClick={() => {
                      onContentChange('');
                      setConfirmReset(false);
                    }}
                    className="text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-500 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                  >
                    Ya
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="text-[10px] text-slate-400 hover:text-white px-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-slate-500 hover:text-rose-400 transition-colors p-1 rounded hover:bg-slate-800"
                  title="Kosongkan teks lembar dokumen"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
