import React from 'react';
import { Plus, FileText, Trash2, Clock, Calendar, CheckSquare, Instagram } from 'lucide-react';
import { DocumentSession } from '../types';
import { formatDateTimeWIB } from '../utils/dateUtils';

interface SessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: DocumentSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
}

export const SessionDrawer: React.FC<SessionDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="w-80 max-w-[85vw] h-full bg-slate-900 border-r border-slate-800 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Daftar Dokumen</h2>
              <p className="text-[11px] text-slate-400">Riwayat sesi transkrip tersimpan</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* New Document Button */}
        <div className="p-3 border-b border-slate-800/80">
          <button
            onClick={() => {
              onNewSession();
              onClose();
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Buat Dokumen Baru</span>
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              Belum ada dokumen lain yang tersimpan.
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const wordCount = session.content.trim() ? session.content.trim().split(/\s+/).length : 0;

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                  className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-950/40 border-indigo-600/50 text-slate-100 shadow-md shadow-indigo-950/50'
                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h4 className="text-xs font-semibold truncate flex-1 pr-6">
                      {session.title || 'Dokumen Tanpa Judul'}
                    </h4>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 p-1.5 rounded-lg transition-colors shrink-0"
                      title="Hapus Dokumen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 mb-2 leading-relaxed font-sans">
                    {session.content.trim() || '(Dokumen belum memiliki teks)'}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDateTimeWIB(session.updatedAt || session.createdAt)}
                    </span>
                    <span className="flex items-center gap-2">
                      {session.summary && (
                        <span className="text-purple-400 font-medium flex items-center gap-0.5">
                          <CheckSquare className="w-3 h-3" /> Ada Ringkasan
                        </span>
                      )}
                      <span>{wordCount} kata</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Developer Attribution Footer */}
        <div className="p-3 bg-slate-950/90 border-t border-slate-800 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-pink-500 via-rose-500 to-amber-500 flex items-center justify-center text-white shrink-0 shadow-sm shadow-pink-500/20">
              <Instagram className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-200 truncate">Dibuat oleh Ilham</p>
              <a
                href="https://www.instagram.com/ilhamm.18/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-pink-400 hover:text-pink-300 font-medium hover:underline block truncate"
              >
                @ilhamm.18 di Instagram
              </a>
            </div>
          </div>
          <a
            href="https://www.instagram.com/ilhamm.18/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 text-pink-300 border border-pink-500/30 text-[10px] font-semibold transition-colors shrink-0"
          >
            Kunjungi
          </a>
        </div>
      </div>

      <div className="flex-1" onClick={onClose} />
    </div>
  );
};
