export type AudioSourceType = 'mic' | 'device' | 'mixed';

export type RecordingState = 'inactive' | 'recording' | 'paused';

export interface ActionItem {
  task: string;
  owner?: string;
  priority?: 'Tinggi' | 'Sedang' | 'Rendah';
}

export interface AISummary {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  keyDecisions?: string[];
  sentiment?: string;
  formattedMarkdown: string;
  generatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface TranscriptSnippet {
  id: string;
  timestamp: number; // in seconds from recording start
  timestampFormatted: string; // "01:24"
  text: string;
  isFinal: boolean;
}

export interface DocumentSession {
  id: string;
  title: string;
  content: string;
  audioBlobUrl?: string;
  audioDuration?: number;
  createdAt: string;
  updatedAt: string;
  summary?: AISummary;
  chatHistory: ChatMessage[];
  language: string;
}
