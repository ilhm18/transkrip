/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  Monitor,
  Square,
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  FolderOpen,
  Plus,
  Trash2,
  Save,
  Check,
  AlertTriangle,
  X,
  FileText,
  Instagram,
} from 'lucide-react';
import {
  AudioSourceType,
  RecordingState,
  DocumentSession,
  AISummary,
  ChatMessage,
} from './types';
import { DeviceAudioRecorder } from './utils/audioRecorder';
import { RealtimeSpeechTranscriber, SpeechRecognitionCallbacks } from './utils/speechRecognition';
import { DocumentEditor } from './components/DocumentEditor';
import { AIPanel } from './components/AIPanel';
import { AudioVisualizer } from './components/AudioVisualizer';
import { SessionDrawer } from './components/SessionDrawer';
import { formatTimeWIB, formatDateTimeWIB } from './utils/dateUtils';

const SESSIONS_STORAGE_KEY = 'transkrip_ai_saved_sessions_v4';
const ACTIVE_ID_KEY = 'transkrip_ai_active_id_v4';

const createEmptySession = (): DocumentSession => ({
  id: `doc-${Date.now()}`,
  title: 'Transkrip Rekaman',
  content: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  language: 'id-ID',
  chatHistory: [],
});

export default function App() {
  // Multi-session state
  const [sessions, setSessions] = useState<DocumentSession[]>(() => {
    try {
      const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Storage read error:', e);
    }
    return [createEmptySession()];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem(ACTIVE_ID_KEY) || sessions[0]?.id || '';
  });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [saveSuccessToast, setSaveSuccessToast] = useState(false);
  const [sessionFinishedNotice, setSessionFinishedNotice] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<DocumentSession | null>(null);
  const [deleteToastMessage, setDeleteToastMessage] = useState<string | null>(null);

  // Active Document Session
  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0] || createEmptySession();

  // Recording State
  const [audioSource, setAudioSource] = useState<AudioSourceType>('mic');
  const [recordingState, setRecordingState] = useState<RecordingState>('inactive');
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Responsive Mobile / Tablet View Switcher Tab ('transcript' | 'ai')
  const [mobileTab, setMobileTab] = useState<'transcript' | 'ai'>('transcript');

  // Toggle AI Panel on desktop to allow 100% full-width transcript view
  const [showAIPanel, setShowAIPanel] = useState<boolean>(true);

  // Live WIB Clock
  const [currentWIBTime, setCurrentWIBTime] = useState<string>(() => formatTimeWIB());

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentWIBTime(formatTimeWIB());
    }, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      localStorage.setItem(ACTIVE_ID_KEY, activeSessionId);
    } catch (e) {
      console.warn('Storage save error:', e);
    }
  }, [sessions, activeSessionId]);

  // References
  const recorderRef = useRef<DeviceAudioRecorder | null>(null);
  const transcriberRef = useRef<RealtimeSpeechTranscriber | null>(null);
  const timerIntervalRef = useRef<any>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const aiVoiceCallbacksRef = useRef<SpeechRecognitionCallbacks | null>(null);

  // Synchronous callback registration for AI Voice Input to share live speech recognition concurrently
  const handleRegisterAIVoiceListener = useCallback((callbacks: SpeechRecognitionCallbacks | null) => {
    aiVoiceCallbacksRef.current = callbacks;
    if (transcriberRef.current) {
      transcriberRef.current.setSecondaryCallbacks(callbacks);
    }
  }, []);

  // Recording timer
  useEffect(() => {
    if (recordingState === 'recording') {
      timerIntervalRef.current = setInterval(() => {
        if (recorderRef.current) {
          setRecordingSeconds(recorderRef.current.getCurrentDuration());
        } else {
          setRecordingSeconds((prev) => prev + 1);
        }
      }, 500);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [recordingState]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current) recorderRef.current.stop().catch(() => {});
      if (transcriberRef.current) transcriberRef.current.stop();
    };
  }, []);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Helper to update active session properties
  const updateActiveSession = (updates: Partial<DocumentSession>) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
        }
        return s;
      })
    );
  };

  // Explicit Save Session Action
  const handleSaveSession = () => {
    updateActiveSession({ updatedAt: new Date().toISOString() });
    setSaveSuccessToast(true);
    setTimeout(() => setSaveSuccessToast(false), 2500);
  };

  // Create New Blank Session Action
  const handleNewSession = () => {
    const newDoc = createEmptySession();
    setSessions((prev) => [newDoc, ...prev]);
    setActiveSessionId(newDoc.id);
    setSessionFinishedNotice(false);
    setMobileTab('transcript');
  };

  // Delete Session Action - Triggers custom modal
  const handleDeleteSession = (idToDelete?: string) => {
    const targetId = idToDelete || activeSessionId;
    const session = sessions.find((s) => s.id === targetId);
    if (session) {
      setSessionToDelete(session);
    }
  };

  const handleConfirmDeleteSession = (targetId: string) => {
    const sessionBeingDeleted = sessions.find((s) => s.id === targetId);
    const docName = sessionBeingDeleted?.title || 'Dokumen';
    const remaining = sessions.filter((s) => s.id !== targetId);

    if (remaining.length === 0) {
      const fresh = createEmptySession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(remaining);
      if (activeSessionId === targetId) {
        setActiveSessionId(remaining[0].id);
      }
    }
    setSessionFinishedNotice(false);
    setSessionToDelete(null);
    setDeleteToastMessage(`"${docName}" berhasil dihapus.`);
    setTimeout(() => setDeleteToastMessage(null), 3000);
  };

  // Safe functional chat message handlers to prevent React batching race conditions
  const handleAddChatMessage = useCallback((msg: ChatMessage) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            chatHistory: [...(s.chatHistory || []), msg],
            updatedAt: new Date().toISOString(),
          };
        }
        return s;
      })
    );
  }, [activeSessionId]);

  const handleUpdateChatMessage = useCallback((id: string, text: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            chatHistory: (s.chatHistory || []).map((m) =>
              m.id === id ? { ...m, text } : m
            ),
            updatedAt: new Date().toISOString(),
          };
        }
        return s;
      })
    );
  }, [activeSessionId]);

  // Start Recording
  const handleStartRecording = async () => {
    setErrorMessage(null);
    setSessionFinishedNotice(false);
    // On mobile/tablet, immediately switch to the transcript tab so user sees words typed in real time
    setMobileTab('transcript');

    try {
      const recorder = new DeviceAudioRecorder();
      recorderRef.current = recorder;

      // Handle periodic audio chunk for device audio
      const handleLiveChunk = async (chunkBlob: Blob) => {
        try {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = (reader.result as string)?.split(',')[1];
            if (!base64) return;

            const res = await fetch('/api/ai/live-chunk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: base64,
                mimeType: chunkBlob.type || 'audio/webm',
                language: activeSession.language || 'id-ID',
                previousContext: activeSession.content.slice(-200),
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.transcript && data.transcript.trim()) {
                const currentDuration = recorderRef.current?.getCurrentDuration() || 0;
                const timeTag = `[${formatTimer(currentDuration)}] `;
                setSessions((prev) =>
                  prev.map((s) => {
                    if (s.id === activeSessionId) {
                      const currentContent = s.content.trim();
                      const separator = currentContent.length > 0 ? '\n' : '';
                      return {
                        ...s,
                        content: `${currentContent}${separator}${timeTag}${data.transcript.trim()}`,
                        updatedAt: new Date().toISOString(),
                      };
                    }
                    return s;
                  })
                );
              }
            }
          };
          reader.readAsDataURL(chunkBlob);
        } catch (e) {
          console.warn('Live chunk error:', e);
        }
      };

      // Start audio capture
      await recorder.start(audioSource, audioSource !== 'mic' ? handleLiveChunk : undefined);
      setAnalyser(recorder.getAnalyser());

      // Start continuous speech recognition for real-time live typing
      const transcriber = new RealtimeSpeechTranscriber(
        {
          onInterimResult: (interim) => {
            setInterimTranscript(interim);
          },
          onFinalResult: (finalText) => {
            setInterimTranscript('');
            const currentDuration = recorder.getCurrentDuration();
            const timeTag = `[${formatTimer(currentDuration)}] `;

            setSessions((prev) =>
              prev.map((s) => {
                if (s.id === activeSessionId) {
                  const currentContent = s.content.trim();
                  const separator = currentContent.length > 0 ? '\n' : '';
                  return {
                    ...s,
                    content: `${currentContent}${separator}${timeTag}${finalText}`,
                    updatedAt: new Date().toISOString(),
                  };
                }
                return s;
              })
            );
          },
          onError: (err) => {
            console.warn('Speech recognition warning:', err);
            if (err.includes('ditolak') || err.includes('not-allowed')) {
              setErrorMessage(err);
            }
          },
          onEnd: () => {},
        },
        activeSession.language || 'id-ID'
      );

      if (aiVoiceCallbacksRef.current) {
        transcriber.setSecondaryCallbacks(aiVoiceCallbacksRef.current);
      }

      transcriberRef.current = transcriber;
      transcriber.start();

      setRecordingState('recording');
      setRecordingSeconds(0);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setErrorMessage(
        err.message || 'Tidak dapat memulai rekaman. Pastikan izin mikrofon atau izin audio perangkat diberikan.'
      );
      setRecordingState('inactive');
      setAnalyser(null);
    }
  };

  // Stop Recording (Finished Session)
  const handleStopRecording = async () => {
    setInterimTranscript('');
    setRecordingState('inactive');

    if (transcriberRef.current) {
      transcriberRef.current.stop();
      transcriberRef.current = null;
    }

    if (recorderRef.current) {
      try {
        await recorderRef.current.stop();
      } catch (err) {
        console.warn('Stop recorder error:', err);
      }
      recorderRef.current = null;
    }
    setAnalyser(null);

    // Save active document state and display post-session options
    updateActiveSession({ updatedAt: new Date().toISOString() });
    setSessionFinishedNotice(true);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Sleek Minimalist & Fully Responsive Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 shrink-0 z-20 no-print">
        {/* DESKTOP & TABLET NAVBAR (sm: 640px and up) */}
        <div className="hidden sm:flex h-16 px-3.5 sm:px-4 md:px-6 items-center justify-between gap-2.5 md:gap-3">
          {/* Left: Brand & Developer Tag */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-rose-500 flex items-center justify-center shadow-md shadow-indigo-600/30 shrink-0">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
              TranskipText
            </span>

            {/* Developer Attribution Tag */}
            <a
              href="https://www.instagram.com/ilhamm.18/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gradient-to-r from-pink-500/15 via-rose-500/15 to-purple-500/15 border border-pink-500/30 hover:border-pink-400 text-pink-300 hover:text-white transition-all cursor-pointer group shadow-sm shadow-pink-500/10 shrink-0"
              title="Dibuat oleh Ilham (@ilhamm.18) - Kunjungi Instagram"
            >
              <Instagram className="w-3 h-3 text-pink-400 group-hover:scale-110 transition-transform shrink-0" />
              <span className="hidden lg:inline text-slate-400 group-hover:text-slate-200 text-[10px]">develop by</span>
              <span className="font-semibold text-pink-300 group-hover:text-pink-100">@ilhamm.18</span>
            </a>
          </div>

          {/* Center: Recording Controls */}
          <div className="flex items-center gap-2 md:gap-2.5 shrink-0">
            {recordingState === 'inactive' ? (
              <div className="flex items-center bg-slate-800/90 border border-slate-700/70 rounded-xl p-0.5 text-xs">
                <button
                  onClick={() => setAudioSource('mic')}
                  className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    audioSource === 'mic'
                      ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Merekam suara dari mikrofon"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Mikrofon</span>
                  <span className="md:hidden">Mic</span>
                </button>

                <button
                  onClick={() => setAudioSource('device')}
                  className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    audioSource === 'device'
                      ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Merekam audio dari tab / perangkat (YouTube, Google Meet, Zoom)"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Audio Tab</span>
                  <span className="md:hidden">Tab</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                <span className="font-mono text-xs font-bold text-slate-100">{formatTimer(recordingSeconds)}</span>
                <span className="text-[10px] text-slate-400 font-semibold uppercase">
                  {audioSource === 'mic' ? 'Mic' : 'Tab'}
                </span>
              </div>
            )}

            {/* Record / Stop Button */}
            {recordingState === 'inactive' ? (
              <button
                onClick={handleStartRecording}
                className="flex items-center gap-1.5 px-3.5 md:px-4 py-1.5 md:py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs md:text-sm font-bold shadow-lg shadow-rose-600/25 transition-all cursor-pointer shrink-0"
              >
                <Mic className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span>Rekam</span>
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-1.5 px-3.5 md:px-4 py-1.5 md:py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs md:text-sm font-bold shadow-lg shadow-rose-600/30 transition-all cursor-pointer shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Selesai</span>
              </button>
            )}
          </div>

          {/* Right: Document & Session Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Saved Documents Button */}
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 text-xs font-medium transition-colors cursor-pointer"
              title="Buka daftar file & sesi dokumen yang tersimpan"
            >
              <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden lg:inline">Dokumen ({sessions.length})</span>
              <span className="lg:hidden text-indigo-300 font-semibold text-[11px]">({sessions.length})</span>
            </button>

            {/* New Session Button */}
            <button
              onClick={handleNewSession}
              className="flex items-center gap-1 p-1.5 md:px-2.5 md:py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 text-xs font-medium transition-colors cursor-pointer"
              title="Mulai sesi baru"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xl:inline">Sesi Baru</span>
            </button>

            {/* Save Button */}
            <button
              onClick={handleSaveSession}
              className="flex items-center gap-1 p-1.5 md:px-2.5 md:py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 text-xs font-medium transition-colors cursor-pointer"
              title="Simpan sesi ini"
            >
              {saveSuccessToast ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Save className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span className="hidden xl:inline">{saveSuccessToast ? 'Tersimpan!' : 'Simpan'}</span>
            </button>

            {/* Delete Active Session Button */}
            <button
              onClick={() => handleDeleteSession()}
              className="p-1.5 md:p-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 border border-slate-700/60 text-xs font-medium transition-colors cursor-pointer"
              title="Hapus sesi / dokumen ini"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <div className="h-5 w-[1px] bg-slate-800 mx-0.5 hidden lg:block"></div>

            {/* Toggle AI Panel Button (Desktop only) */}
            <button
              onClick={() => setShowAIPanel(!showAIPanel)}
              className={`hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                showAIPanel
                  ? 'bg-purple-600/20 text-purple-300 border-purple-500/40 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/60'
              }`}
              title={showAIPanel ? 'Tutup panel AI agar lembar transkrip layar penuh' : 'Buka Asisten AI'}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Asisten AI</span>
              {showAIPanel ? (
                <PanelRightClose className="w-3.5 h-3.5 ml-0.5 text-slate-400" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5 ml-0.5 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {/* MOBILE DEDICATED APP BAR (< sm: 640px) */}
        <div className="flex sm:hidden flex-col">
          {/* Top Row: Brand & Quick Action Icons */}
          <div className="h-12 px-3 flex items-center justify-between border-b border-slate-800/60 bg-slate-900">
            {/* Brand + Instagram */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-rose-500 flex items-center justify-center shadow-md shadow-indigo-600/30 shrink-0">
                <Mic className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent truncate">
                TranskipText
              </span>

              <a
                href="https://www.instagram.com/ilhamm.18/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gradient-to-r from-pink-500/15 to-purple-500/15 border border-pink-500/30 text-pink-300 hover:text-white shrink-0 ml-0.5"
                title="@ilhamm.18"
              >
                <Instagram className="w-2.5 h-2.5 text-pink-400 shrink-0" />
                <span>@ilhamm.18</span>
              </a>
            </div>

            {/* Right: Docs Drawer + Action Buttons */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 text-[11px] font-medium cursor-pointer"
                title="Daftar Dokumen"
              >
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-indigo-300 font-semibold">{sessions.length}</span>
              </button>

              <button
                onClick={handleNewSession}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 cursor-pointer"
                title="Sesi Baru"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
              </button>

              <button
                onClick={handleSaveSession}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 cursor-pointer"
                title="Simpan"
              >
                {saveSuccessToast ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Save className="w-3.5 h-3.5 text-indigo-400" />
                )}
              </button>

              <button
                onClick={() => handleDeleteSession()}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 border border-slate-700/60 cursor-pointer"
                title="Hapus"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Bottom Row: Audio Mode Selector + Record Button (Balanced Full-Width) */}
          <div className="p-2 px-3 flex items-center gap-2 bg-slate-950/50">
            {recordingState === 'inactive' ? (
              <div className="flex-1 flex items-center bg-slate-800/90 border border-slate-700/70 rounded-xl p-0.5 text-xs">
                <button
                  onClick={() => setAudioSource('mic')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg transition-all cursor-pointer text-xs ${
                    audioSource === 'mic'
                      ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Mic className="w-3 h-3" />
                  <span>Mikrofon</span>
                </button>

                <button
                  onClick={() => setAudioSource('device')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg transition-all cursor-pointer text-xs ${
                    audioSource === 'device'
                      ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Monitor className="w-3 h-3" />
                  <span>Audio Tab</span>
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                <span className="font-mono text-xs font-bold text-slate-100">{formatTimer(recordingSeconds)}</span>
                <span className="text-[10px] text-slate-400 font-semibold uppercase">
                  {audioSource === 'mic' ? 'Mic' : 'Tab'}
                </span>
              </div>
            )}

            {/* Record / Stop Button */}
            {recordingState === 'inactive' ? (
              <button
                onClick={handleStartRecording}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-all cursor-pointer shrink-0"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Rekam</span>
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-all cursor-pointer shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Selesai</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Post-session Completion Notice Banner */}
      {sessionFinishedNotice && (
        <div className="bg-indigo-950/90 border-b border-indigo-700/60 px-3 sm:px-4 py-2 text-xs text-indigo-200 flex flex-wrap items-center justify-between gap-2 sm:gap-3 animate-fadeIn shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="font-semibold text-white">
              Sesi rekaman telah selesai dan file otomatis tersimpan!
            </span>
            <span className="hidden lg:inline text-indigo-300">
              Anda bisa menganalisis dengan AI, mengunduh, memulai sesi baru, atau menghapusnya jika sudah tidak dibutuhkan.
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleNewSession}
              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors cursor-pointer"
            >
              + Sesi Baru
            </button>
            <button
              onClick={() => handleDeleteSession()}
              className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 font-semibold transition-colors cursor-pointer"
            >
              Hapus Sesi
            </button>
            <button
              onClick={() => setSessionFinishedNotice(false)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Error notification banner */}
      {errorMessage && (
        <div className="bg-rose-950/90 border-b border-rose-800 px-3 sm:px-4 py-2 text-xs text-rose-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-300 font-bold px-2">✕</button>
        </div>
      )}

      {/* Live Audio Visualizer bar while recording */}
      {recordingState !== 'inactive' && (
        <div className="px-3 sm:px-6 md:px-8 py-1.5 sm:py-2 bg-slate-900/60 border-b border-slate-800 shrink-0">
          <AudioVisualizer
            analyser={analyser}
            isRecording={recordingState === 'recording'}
            isPaused={false}
          />
        </div>
      )}

      {/* Mobile / Tablet Segmented Tab Switcher (< lg screens) */}
      <div className="lg:hidden px-3 sm:px-4 pt-2.5 pb-0 shrink-0">
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl gap-1">
          <button
            onClick={() => setMobileTab('transcript')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mobileTab === 'transcript'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Transkrip Dokumen</span>
            {recordingState === 'recording' && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setMobileTab('ai')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              mobileTab === 'ai'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            <span>Asisten AI</span>
            {activeSession.summary && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        </div>
      </div>

      {/* Main Workspace: Responsive Layout (Full Screen Tabs on Mobile/Tablet, Expansive Side-by-Side on Desktop) */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden p-2.5 sm:p-4 md:p-6 gap-3 lg:gap-4 relative w-full min-h-0">
        {/* EXPANSIVE TRANSCRIPT DOCUMENT CANVAS */}
        <section
          className={`flex-1 flex flex-col h-full min-h-0 min-w-0 transition-all duration-200 ${
            mobileTab === 'ai' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <DocumentEditor
            title={activeSession.title}
            onTitleChange={(title) => updateActiveSession({ title })}
            content={activeSession.content}
            onContentChange={(content) => updateActiveSession({ content })}
            interimTranscript={interimTranscript}
            isRecording={recordingState === 'recording'}
            recordingSeconds={recordingSeconds}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            onOpenAISummary={() => {
              setShowAIPanel(true);
              setMobileTab('ai');
            }}
            language={activeSession.language || 'id-ID'}
            onLanguageChange={(language) => updateActiveSession({ language })}
            audioSource={audioSource}
          />
        </section>

        {/* AI ASSISTANT PANEL */}
        <aside
          className={`w-full lg:w-[380px] xl:w-[420px] h-full shrink-0 flex-col no-print animate-in duration-200 min-h-0 ${
            mobileTab === 'transcript' ? 'hidden lg:flex' : 'flex'
          } ${showAIPanel ? 'lg:flex' : 'lg:hidden'}`}
        >
          <AIPanel
            documentText={activeSession.content}
            documentTitle={activeSession.title}
            summary={activeSession.summary || null}
            onSummaryGenerated={(summary) => updateActiveSession({ summary })}
            onAppendToDocument={(text) => {
              updateActiveSession({ content: `${activeSession.content}${text}` });
              // On mobile, switch back to transcript so user can see appended content
              setMobileTab('transcript');
            }}
            onReplaceDocumentContent={(newContent) => {
              updateActiveSession({ content: newContent });
              setMobileTab('transcript');
            }}
            chatHistory={activeSession.chatHistory || []}
            onAddChatMessage={handleAddChatMessage}
            onUpdateChatMessage={handleUpdateChatMessage}
            language={activeSession.language || 'id-ID'}
            isMainRecording={recordingState === 'recording'}
            onRegisterAIVoiceListener={handleRegisterAIVoiceListener}
          />
        </aside>
      </main>

      {/* Saved Documents Session Drawer */}
      <SessionDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          setActiveSessionId(id);
          setMobileTab('transcript');
        }}
        onNewSession={handleNewSession}
        onDeleteSession={(id) => handleDeleteSession(id)}
      />

      {/* Custom In-App Delete Confirmation Modal (never blocked by browser iframe) */}
      {sessionToDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Hapus Dokumen?</h3>
                <p className="text-xs text-slate-400">Tindakan ini tidak dapat dibatalkan</p>
              </div>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <p className="text-slate-400">Dokumen yang akan dihapus:</p>
              <p className="font-semibold text-white break-words">
                "{sessionToDelete.title || 'Dokumen Tanpa Judul'}"
              </p>
              {sessions.length === 1 && (
                <p className="text-[11px] text-amber-400/90 pt-1 border-t border-slate-800/80">
                  * Ini adalah satu-satunya dokumen tersimpan. Setelah dihapus, lembar kerja akan otomatis dikosongkan dan siap untuk rekaman baru.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDeleteSession(sessionToDelete.id)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Ya, Hapus</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Feedback Toast */}
      {deleteToastMessage && (
        <div className="fixed bottom-5 right-5 z-[80] bg-slate-900 border border-rose-500/50 text-white text-xs py-2.5 px-4 rounded-xl shadow-2xl flex items-center gap-2 animate-fadeIn">
          <Trash2 className="w-4 h-4 text-rose-400" />
          <span>{deleteToastMessage}</span>
        </div>
      )}
    </div>
  );
}
