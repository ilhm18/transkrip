import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  MessageSquare,
  ListChecks,
  Wand2,
  Send,
  PlusCircle,
  Copy,
  Check,
  Loader2,
  HelpCircle,
  ChevronRight,
  FileCheck,
  AlertCircle,
  Mic,
  MicOff,
  Square,
} from 'lucide-react';
import { AISummary, ChatMessage, ActionItem } from '../types/index';
import { formatTimeWIB } from '../utils/dateUtils';
import { RealtimeSpeechTranscriber, SpeechRecognitionCallbacks } from '../utils/speechRecognition';

interface AIPanelProps {
  documentText: string;
  documentTitle: string;
  summary: AISummary | null;
  onSummaryGenerated: (summary: AISummary) => void;
  onAppendToDocument: (textToAppend: string) => void;
  onReplaceDocumentContent: (newText: string) => void;
  chatHistory: ChatMessage[];
  onAddChatMessage: (msg: ChatMessage) => void;
  onUpdateChatMessage: (id: string, text: string) => void;
  onTranscribeAudioWithAI?: () => void;
  hasAudioBlob?: boolean;
  language?: string;
  isMainRecording?: boolean;
  onRegisterAIVoiceListener?: (callbacks: SpeechRecognitionCallbacks | null) => void;
}

export const AIPanel: React.FC<AIPanelProps> = ({
  documentText,
  documentTitle,
  summary,
  onSummaryGenerated,
  onAppendToDocument,
  onReplaceDocumentContent,
  chatHistory,
  onAddChatMessage,
  onUpdateChatMessage,
  onTranscribeAudioWithAI,
  hasAudioBlob,
  language = 'id-ID',
  isMainRecording = false,
  onRegisterAIVoiceListener,
}) => {
  // Tab selection: 'chat' is prominent for active interactive AI Q&A
  const [activeTab, setActiveTab] = useState<'summary' | 'chat' | 'refine'>('chat');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);


  // Local Chat state to ensure zero-delay UI rendering and avoid batching races
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(chatHistory);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);

  // Synchronize local messages when external session chatHistory changes
  useEffect(() => {
    setLocalMessages(chatHistory);
  }, [chatHistory]);

  // Voice Question state & refs
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const voiceTranscriberRef = useRef<RealtimeSpeechTranscriber | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const accumulatedQuestionRef = useRef<string>('');
  const autoSendTimerRef = useRef<any>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Refine state
  const [isRefining, setIsRefining] = useState(false);
  const [refineResult, setRefineResult] = useState<string | null>(null);
  const [refineError, setRefineError] = useState<string | null>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [localMessages, isAsking]);

  // Stop voice question safely
  const stopVoiceQuestion = async (autoSend: boolean = false) => {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }

    // Detach from main transcriber if listening together
    if (onRegisterAIVoiceListener) {
      onRegisterAIVoiceListener(null);
    }

    // Stop dedicated voice transcriber if one was started
    if (voiceTranscriberRef.current) {
      voiceTranscriberRef.current.stop();
      voiceTranscriberRef.current = null;
    }

    // Stop MediaRecorder if running
    let recordedBlob: Blob | null = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        recordedBlob = await new Promise<Blob>((resolve) => {
          if (!mediaRecorderRef.current) return resolve(new Blob());
          mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            resolve(blob);
          };
          mediaRecorderRef.current.stop();
        });
      } catch (e) {
        console.warn('Error stopping MediaRecorder:', e);
      }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsVoiceRecording(false);

    let finalQuestion = (accumulatedQuestionRef.current || inputQuestion).trim();

    // If speech recognition didn't yield text, but we have an audio blob, transcribe via Gemini!
    if (!finalQuestion && recordedBlob && recordedBlob.size > 800) {
      setIsTranscribingVoice(true);
      try {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = (reader.result as string)?.split(',')[1] || '';
            resolve(res);
          };
          reader.readAsDataURL(recordedBlob!);
        });

        if (base64) {
          const res = await fetch('/api/ai/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: recordedBlob.type || 'audio/webm',
              language,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.transcript && data.transcript.trim()) {
              finalQuestion = data.transcript.trim();
              setInputQuestion(finalQuestion);
            }
          }
        }
      } catch (transcribeErr) {
        console.warn('Gemini audio transcription error:', transcribeErr);
      } finally {
        setIsTranscribingVoice(false);
      }
    }

    if (autoSend && finalQuestion) {
      handleAskQuestion(finalQuestion);
    }
  };

  // Start voice question recording
  const startVoiceQuestion = () => {
    setIsVoiceRecording(true);
    setInputQuestion('');
    accumulatedQuestionRef.current = '';
    audioChunksRef.current = [];

    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }

    const callbacks: SpeechRecognitionCallbacks = {
      onInterimResult: (interim) => {
        if (interim) {
          const base = (accumulatedQuestionRef.current || '').trim();
          setInputQuestion(base ? `${base} ${interim}` : interim);
          if (autoSendTimerRef.current) {
            clearTimeout(autoSendTimerRef.current);
            autoSendTimerRef.current = null;
          }
        }
      },
      onFinalResult: (finalText) => {
        if (!finalText.trim()) return;
        const currentAcc = (accumulatedQuestionRef.current || '').trim();
        const updated = currentAcc ? `${currentAcc} ${finalText.trim()}` : finalText.trim();
        accumulatedQuestionRef.current = updated;
        setInputQuestion(updated);

        // Auto-send after 2 seconds pause if user stopped speaking
        if (autoSendTimerRef.current) {
          clearTimeout(autoSendTimerRef.current);
        }
        autoSendTimerRef.current = setTimeout(() => {
          stopVoiceQuestion(true);
        }, 2000);
      },
      onError: (err) => {
        console.warn('Voice question recognition notice:', err);
      },
      onEnd: () => {
        if (!isMainRecording) {
          // Continuous recording handles restarts
        }
      },
    };

    if (isMainRecording && onRegisterAIVoiceListener) {
      // Main transcription is currently recording: hook directly into audio stream!
      // This ensures main transcript keeps running uninterrupted while capturing AI question!
      onRegisterAIVoiceListener(callbacks);
    } else {
      // 1. Start real-time speech recognition if supported
      try {
        const transcriber = new RealtimeSpeechTranscriber(callbacks, language);
        voiceTranscriberRef.current = transcriber;
        transcriber.start();
      } catch (e) {
        console.warn('Speech recognition not available for voice question:', e);
      }

      // 2. Concurrently capture microphone audio with MediaRecorder as universal fallback
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            mediaStreamRef.current = stream;
            try {
              const mr = new MediaRecorder(stream);
              mediaRecorderRef.current = mr;
              audioChunksRef.current = [];
              mr.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                  audioChunksRef.current.push(e.data);
                }
              };
              mr.start(250);
            } catch (err) {
              console.warn('MediaRecorder init error:', err);
            }
          })
          .catch((err) => {
            console.warn('Mic permission error:', err);
          });
      }
    }
  };

  // Toggle Voice Question Recording
  const toggleVoiceQuestion = () => {
    if (isVoiceRecording) {
      stopVoiceQuestion(false);
    } else {
      startVoiceQuestion();
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      if (onRegisterAIVoiceListener) onRegisterAIVoiceListener(null);
      if (voiceTranscriberRef.current) voiceTranscriberRef.current.stop();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onRegisterAIVoiceListener]);

  // Trigger Summarization (Fast)
  const handleGenerateSummary = async () => {
    if (!documentText.trim()) {
      setSummaryError('Dokumen masih kosong. Rekam suara atau ketik teks terlebih dahulu untuk diringkas.');
      return;
    }

    setIsSummarizing(true);
    setSummaryError(null);

    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: documentText,
          title: documentTitle,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal memproses ringkasan dengan server AI.');
      }

      const data = await res.json();
      const newSummary: AISummary = {
        title: data.title || documentTitle || 'Ringkasan Transkrip',
        summary: data.summary || '',
        keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [],
        actionItems: Array.isArray(data.actionItems) ? data.actionItems : [],
        keyDecisions: Array.isArray(data.keyDecisions) ? data.keyDecisions : [],
        sentiment: data.sentiment || '',
        formattedMarkdown: data.formattedMarkdown || data.summary || '',
        generatedAt: formatTimeWIB(),
      };

      onSummaryGenerated(newSummary);
    } catch (err: any) {
      setSummaryError(err.message || 'Terjadi kesalahan saat meringkas.');
    } finally {
      setIsSummarizing(false);
    }
  };

  // Fast Streaming Chat Q&A (Ultra-low latency streaming response)
  const handleAskQuestion = async (questionText?: string) => {
    const q = (questionText || inputQuestion).trim();
    if (!q || isAsking) return;

    // Stop voice recording cleanly if still running
    if (isVoiceRecording) {
      stopVoiceQuestion(false);
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: q,
      timestamp: formatTimeWIB(),
    };

    const aiMsgId = (Date.now() + 1).toString();
    const initialAiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'model',
      text: '',
      timestamp: formatTimeWIB(),
    };

    // Render both messages immediately in local state
    setLocalMessages((prev) => [...prev, userMsg, initialAiMsg]);
    onAddChatMessage(userMsg);
    onAddChatMessage(initialAiMsg);

    setInputQuestion('');
    setIsAsking(true);

    try {
      // Call fast streaming endpoint
      const res = await fetch('/api/ai/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: documentText,
          question: q,
          history: localMessages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal memproses jawaban dari AI.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete trailing chunk in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.text) {
                accumulated += parsed.text;
                setLocalMessages((prev) =>
                  prev.map((m) => (m.id === aiMsgId ? { ...m, text: accumulated } : m))
                );
                onUpdateChatMessage(aiMsgId, accumulated);
              } else if (parsed.error) {
                accumulated = parsed.error;
                setLocalMessages((prev) =>
                  prev.map((m) => (m.id === aiMsgId ? { ...m, text: accumulated } : m))
                );
                onUpdateChatMessage(aiMsgId, accumulated);
              }
            } catch {
              // Ignore partial parse
            }
          }
        }
      }

      // Process any remainder in lineBuffer
      if (lineBuffer.trim().startsWith('data: ')) {
        const dataStr = lineBuffer.trim().slice(6).trim();
        if (dataStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.text) {
              accumulated += parsed.text;
              setLocalMessages((prev) =>
                prev.map((m) => (m.id === aiMsgId ? { ...m, text: accumulated } : m))
              );
              onUpdateChatMessage(aiMsgId, accumulated);
            }
          } catch {
            // Ignore
          }
        }
      }

      if (!accumulated) {
        const fallbackText = 'Saya siap membantu! Ada hal spesifik yang ingin Anda tanyakan seputar dokumen atau rekaman ini?';
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: fallbackText } : m))
        );
        onUpdateChatMessage(aiMsgId, fallbackText);
      }
    } catch (err: any) {
      console.warn('Fallback to standard chat endpoint:', err);
      // Fallback to standard chat endpoint if streaming fails
      try {
        const fallbackRes = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: documentText,
            question: q,
            history: localMessages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          }),
        });
        const data = await fallbackRes.json();
        const ans = data.answer || 'Tidak ada respons.';
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: ans } : m))
        );
        onUpdateChatMessage(aiMsgId, ans);
      } catch (fallbackErr: any) {
        const errMsg = `Maaf, terjadi kesalahan: ${err.message || fallbackErr.message}`;
        setLocalMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, text: errMsg } : m))
        );
        onUpdateChatMessage(aiMsgId, errMsg);
      }
    } finally {
      setIsAsking(false);
    }
  };

  // Trigger Refinement
  const handleRefine = async (mode: 'fix_punctuation' | 'formal_notes' | 'translate_en' | 'translate_id') => {
    if (!documentText.trim()) {
      setRefineError('Dokumen masih kosong. Rekam suara atau ketik teks terlebih dahulu untuk dipoles.');
      return;
    }

    setIsRefining(true);
    setRefineResult(null);
    setRefineError(null);

    try {
      const res = await fetch('/api/ai/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: documentText,
          mode,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Gagal memproses perbaikan teks.');
      }

      const data = await res.json();
      setRefineResult(data.refinedText);
    } catch (err: any) {
      setRefineError(err.message || 'Gagal memproses perbaikan teks.');
    } finally {
      setIsRefining(false);
    }
  };

  const copySummaryMarkdown = () => {
    if (!summary) return;
    const text = `## Ringkasan Eksekutif\n${summary.summary}\n\n### Poin-Poin Penting:\n${summary.keyPoints
      .map((p: string) => `- ${p}`)
      .join('\n')}\n\n### Tindakan / Action Items:\n${summary.actionItems
      .map((a: ActionItem) => `- [ ] ${a.task} (${a.owner || 'Umum'} - Prioritas: ${a.priority || 'Normal'})`)
      .join('\n')}`;

    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const appendSummaryToDoc = () => {
    if (!summary) return;
    const markdown = `\n\n---\n\n## 📌 Ringkasan Poin Penting\n${summary.summary}\n\n### 🎯 Poin Kunci:\n${summary.keyPoints
      .map((p: string) => `* ${p}`)
      .join('\n')}\n\n### ✅ Action Items & Tugas:\n${summary.actionItems
      .map((a: ActionItem) => `* [ ] **${a.task}** (${a.owner || 'Tim'} - Prioritas: ${a.priority || 'Sedang'})`)
      .join('\n')}\n`;

    onAppendToDocument(markdown);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">

      {/* Tabs Header */}
      <div className="flex items-center border-b border-slate-800 bg-slate-950/60 p-1 sm:p-1.5 gap-1 text-[11px] sm:text-xs shrink-0">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 py-1.5 sm:py-2 px-1.5 sm:px-3 rounded-lg sm:rounded-xl font-medium transition-all cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span className="truncate">Ringkas Poin</span>
        </button>

        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 py-1.5 sm:py-2 px-1.5 sm:px-3 rounded-lg sm:rounded-xl font-medium transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">Tanya AI</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
        </button>

        <button
          onClick={() => setActiveTab('refine')}
          className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 py-1.5 sm:py-2 px-1.5 sm:px-3 rounded-lg sm:rounded-xl font-medium transition-all cursor-pointer ${
            activeTab === 'refine'
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Wand2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">Poles Teks</span>
        </button>
      </div>

      {/* Tab 1: Ringkasan & Poin Penting */}
      {activeTab === 'summary' && (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Action Trigger Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-purple-950/40 via-slate-900 to-indigo-950/30 border border-purple-800/40 shadow-inner">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Peringkas Cerdas AI</h3>
                  <p className="text-xs text-slate-400">Ekstrak poin inti, kesimpulan, dan daftar tugas</p>
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerateSummary}
              disabled={isSummarizing || !documentText.trim()}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-purple-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {isSummarizing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-purple-200" />
                  <span>Menganalisis Cepat dengan Gemini...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{summary ? 'Perbarui Ringkasan Poin Penting' : 'Ringkas Poin Penting Sekarang'}</span>
                </>
              )}
            </button>

            {summaryError && (
              <div className="mt-2.5 p-2 rounded-lg bg-rose-950/50 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{summaryError}</span>
              </div>
            )}
          </div>

          {/* Results Display */}
          {summary ? (
            <div className="space-y-4 animate-fadeIn">
              {/* Executive Summary */}
              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                    <span>📌</span> Ringkasan Eksekutif
                  </span>
                  {summary.sentiment && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                      {summary.sentiment}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">{summary.summary}</p>
              </div>

              {/* Key Points */}
              {summary.keyPoints && summary.keyPoints.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                    <span>🎯</span> Poin-Poin Penting ({summary.keyPoints.length})
                  </span>
                  <ul className="space-y-2">
                    {summary.keyPoints.map((point: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-200 leading-normal">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Items */}
              {summary.actionItems && summary.actionItems.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                    <span>✅</span> Tugas & Tindak Lanjut ({summary.actionItems.length})
                  </span>
                  <div className="space-y-2">
                    {summary.actionItems.map((item: ActionItem, idx: number) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="flex items-start gap-2">
                          <input type="checkbox" className="mt-0.5 rounded bg-slate-800 border-slate-700 text-emerald-500" />
                          <span className="text-slate-200 font-medium">{item.task}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.owner && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
                              {item.owner}
                            </span>
                          )}
                          {item.priority && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                item.priority === 'Tinggi'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-slate-700 text-slate-300'
                              }`}
                            >
                              {item.priority}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons: Insert into document or copy */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={appendSummaryToDoc}
                  className="flex-1 py-2 px-3 rounded-xl bg-purple-950 hover:bg-purple-900 border border-purple-800/80 text-purple-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-purple-400" />
                  <span>Sisipkan ke Dokumen</span>
                </button>
                <button
                  onClick={copySummaryMarkdown}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedSummary ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSummary ? 'Tersalin' : 'Salin'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <ListChecks className="w-8 h-8 mb-2 text-slate-600" />
              <p className="text-xs text-slate-400 font-medium">Belum ada ringkasan</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-[220px]">
                {documentText.trim()
                  ? 'Klik tombol "Ringkas Poin Penting Sekarang" di atas untuk menganalisis transkrip dengan AI.'
                  : 'Dokumen masih kosong. Rekam suara, ketik dokumen, atau coba masukkan contoh teks rapat.'}
              </p>
              {!documentText.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    const sample = `[00:05] Selamat pagi rekan-rekan sekalian, mari kita mulai rapat koordinasi mingguan.\n[00:15] Agenda pertama adalah evaluasi performa fitur transkripsi suara langsung dan kecepatan respon asisten AI.\n[00:35] Budi melaporkan bahwa integrasi Gemini 3.8 Flash memberikan peningkatan respon yang sangat signifikan.\n[00:50] Tindak lanjut: Sarah akan menyelesaikan pengujian fitur perekaman pada perangkat mobile dan tablet hari ini.\n[01:10] Target rilis versi terbaru dijadwalkan pada hari Jumat pukul 14:00 WIB.`;
                    onAppendToDocument(sample);
                  }}
                  className="mt-3 px-3 py-1.5 rounded-xl bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-700/60 text-xs font-semibold transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                  <span>Isi Contoh Teks Rapat</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Tanya Jawab AI (Q&A Chat dengan Fast Streaming & Voice Question Input) */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Chat Messages scroll area */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {localMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center h-full text-slate-500 py-6">
                <div className="w-10 h-10 rounded-xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center text-indigo-400 mb-2">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <h4 className="text-xs font-semibold text-slate-200">Tanya Cepat dengan Teks atau Suara</h4>
                <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                  Respon streaming kilat berkecepatan tinggi! Anda bisa mengetik pertanyaan atau menekan tombol mikrofon untuk bertanya lewat suara.
                </p>

                {/* Suggested Prompt Chips */}
                <div className="mt-4 w-full flex flex-col gap-1.5 text-left">
                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    Contoh Pertanyaan Cepat:
                  </span>
                  {[
                    'Halo AI, apa saja yang bisa kamu bantu?',
                    'Bagaimana cara mulai merekam suara atau audio tab?',
                    'Apa kesimpulan utama dari transkrip ini?',
                    'Siapa saja yang diberi tugas dan apa batas waktunya?',
                  ].map((chip, i) => (
                    <button
                      key={i}
                      onClick={() => handleAskQuestion(chip)}
                      className="text-xs text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 hover:text-indigo-300 border border-slate-700/60 rounded-lg p-2 transition-all flex items-center justify-between text-left group cursor-pointer"
                    >
                      <span className="truncate">{chip}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 shrink-0 ml-1" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              localMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-600/20'
                        : 'bg-slate-800/90 text-slate-200 border border-slate-700/70 rounded-bl-none shadow-sm'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">
                      {msg.text || (
                        <span className="flex items-center gap-1.5 text-indigo-300 italic">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Mengetik jawaban...
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
                </div>
              ))
            )}

            {isAsking && !localMessages[localMessages.length - 1]?.text && (
              <div className="flex items-center gap-2 p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-2xl rounded-bl-none w-fit text-xs text-indigo-300 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>Menghubungi AI...</span>
              </div>
            )}
          </div>

          {/* Voice Input Transcribing Spinner */}
          {isTranscribingVoice && (
            <div className="px-3.5 py-2 bg-indigo-950/95 border-t border-indigo-800 text-indigo-200 text-xs flex items-center justify-between gap-2 animate-fadeIn">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Mendengarkan dan mentranskripsi suara Anda dengan Gemini...</span>
              </div>
            </div>
          )}

          {/* Voice Input Listening Overlay Banner */}
          {isVoiceRecording && (
            <div className="px-3.5 py-2 bg-gradient-to-r from-rose-950/90 via-slate-900 to-indigo-950/90 border-t border-rose-700/60 flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-2 text-rose-300 text-xs min-w-0 flex-1">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </span>
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-rose-200">
                    {isMainRecording ? 'Merekam Pertanyaan (Transkrip tetap berjalan): ' : 'Mendengarkan ucapan: '}
                  </span>
                  <span className="italic text-white">
                    {inputQuestion ? `"${inputQuestion}"` : 'Mulai bicara sekarang...'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const q = (accumulatedQuestionRef.current || inputQuestion).trim();
                    stopVoiceQuestion(false);
                    if (q) handleAskQuestion(q);
                  }}
                  disabled={!inputQuestion.trim()}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm"
                >
                  Kirim
                </button>
                <button
                  type="button"
                  onClick={() => stopVoiceQuestion(false)}
                  className="p-1 rounded-lg hover:bg-slate-800 text-rose-400 hover:text-white transition-colors"
                  title="Hentikan rekam suara AI"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Chat Input Bar */}
          <div className="p-3 bg-slate-950/90 border-t border-slate-800/80">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAskQuestion();
              }}
              className="flex items-center gap-2"
            >
              {/* Voice Question Button */}
              <button
                type="button"
                onClick={toggleVoiceQuestion}
                className={`p-2 rounded-xl transition-all cursor-pointer ${
                  isVoiceRecording
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-200 border border-slate-700/80'
                }`}
                title={isVoiceRecording ? 'Hentikan rekam suara' : 'Tanya menggunakan rekaman suara / pesan suara'}
              >
                {isVoiceRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <input
                type="text"
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                placeholder={isVoiceRecording ? 'Sedang mendengarkan ucapan Anda...' : 'Tanyakan sesuatu atau tekan mic...'}
                disabled={isAsking}
                className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />

              <button
                type="submit"
                disabled={isAsking || !inputQuestion.trim()}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white transition-colors cursor-pointer shadow-md shadow-indigo-600/20"
                title="Kirim Pertanyaan"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab 3: Poles Transkrip & Format (Refine) */}
      {activeTab === 'refine' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
            <h4 className="text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Poles & Transformasi Dokumen</span>
            </h4>
            <p className="text-[11px] text-slate-400">
              Gunakan kecerdasan buatan Gemini untuk menyempurnakan kualitas teks lisan menjadi tulisan profesional.
            </p>
          </div>

          {refineError && (
            <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center justify-between gap-2 animate-fadeIn">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{refineError}</span>
              </div>
              <button
                type="button"
                onClick={() => setRefineError(null)}
                className="text-rose-400 hover:text-white px-1 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => handleRefine('fix_punctuation')}
              disabled={isRefining || !documentText.trim()}
              className="p-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/70 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20">
                <FileCheck className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-slate-200 group-hover:text-emerald-300">
                  Rapikan Tanda Baca & Huruf Kapital
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Tambahkan titik, koma, huruf besar, dan perbaiki kata typo otomatis.
                </div>
              </div>
            </button>

            <button
              onClick={() => handleRefine('formal_notes')}
              disabled={isRefining || !documentText.trim()}
              className="p-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/70 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20">
                <ListChecks className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-slate-200 group-hover:text-indigo-300">
                  Ubah ke Format Notulensi Rapat Formal (MOM)
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Tata menjadi dokumen notula resmi berisikan agenda, pembahasan, dan kesepakatan.
                </div>
              </div>
            </button>

            <button
              onClick={() => handleRefine('translate_en')}
              disabled={isRefining || !documentText.trim()}
              className="p-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/70 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20">
                <span className="text-xs font-bold font-mono">EN</span>
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-slate-200 group-hover:text-amber-300">
                  Terjemahkan ke Bahasa Inggris
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Terjemahan natural dan kontekstual untuk kebutuhan internasional.
                </div>
              </div>
            </button>
          </div>

          {/* Audio Transcribe with Gemini Model */}
          {hasAudioBlob && onTranscribeAudioWithAI && (
            <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/40">
              <h5 className="text-xs font-semibold text-indigo-200 mb-1">Transkripsi Audio dengan Gemini AI</h5>
              <p className="text-[11px] text-slate-400 mb-2">
                Punya rekaman audio yang belum lengkap? Kirim rekaman langsung ke model Gemini 3.5 Transcribe.
              </p>
              <button
                onClick={onTranscribeAudioWithAI}
                className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Proses Audio dengan Model Gemini Transcribe
              </button>
            </div>
          )}

          {/* Refine Processing Indicator */}
          {isRefining && (
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center gap-2 text-xs text-emerald-300">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Memproses transformasi teks dengan AI...</span>
            </div>
          )}

          {/* Refine Result Preview */}
          {refineResult && (
            <div className="p-3.5 rounded-xl bg-slate-800/90 border border-emerald-500/40 space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Hasil Transformasi Teks</span>
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto p-2.5 rounded-lg bg-slate-900 text-xs text-slate-200 leading-relaxed font-sans whitespace-pre-wrap">
                {refineResult}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onReplaceDocumentContent(refineResult)}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Gantikan Teks Dokumen
                </button>
                <button
                  onClick={() => onAppendToDocument(`\n\n${refineResult}`)}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Tambahkan ke Akhir
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
