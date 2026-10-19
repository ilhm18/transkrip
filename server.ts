import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing with generous limit for audio data base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Server-side Gemini client setup with required User-Agent
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Priority cascade for text/reasoning/chat:
// 1. gemini-3.5-flash-lite: Ultra-fast, minimal latency, separate quota pool
// 2. gemini-3.1-flash-lite: Reliable fast lite model, independent quota
// 3. gemini-flash-latest: Alias for latest flash model
// 4. gemini-3.8-flash: Full flash model
// Priority cascade for text/reasoning/chat:
// Expansive pool of 13 models with independent quotas to guarantee 99.9% uptime
const TEXT_MODELS = [
  // 1. Ultra-fast Lite Models (Lowest latency, separate free tier quotas)
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite-preview',
  // 2. Full Flash Models (High intelligence, fast execution)
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  // 3. Pro & Advanced Reasoning Models
  'gemini-3.1-pro-preview',
  'gemini-pro-latest',
  // 4. Open-weights Gemma Model
  'gemma-4-26b-a4b-it',
];

// Audio transcription cascade
const AUDIO_MODELS = [
  'gemini-3.5-transcribe',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
];

// Format errors into friendly Indonesian guidance
function formatGeminiError(error: any): string {
  const errMsg = String(error?.message || error || '');
  const errCode = error?.status || error?.code;

  if (
    errMsg.includes('429') ||
    errMsg.includes('RESOURCE_EXHAUSTED') ||
    errMsg.includes('Quota exceeded') ||
    errMsg.includes('rate-limit') ||
    errCode === 429
  ) {
    return 'Batas Kuota Gemini API Tercapai (HTTP 429 / RESOURCE_EXHAUSTED). Akun Google AI Studio gratis memiliki kuota harian/menit per model. Sistem telah mencoba beralih ke seluruh model alternatif di pool. Jika semua kuota habis, tunggu sejenak atau aktifkan billing Pay-as-you-go di Google AI Studio (aistudio.google.com).';
  }

  if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('401') || errCode === 401) {
    return 'API Key Gemini tidak valid atau tidak memiliki izin akses. Mohon periksa kembali GEMINI_API_KEY Anda.';
  }

  if (errMsg.includes('404') || errMsg.includes('NOT_FOUND') || errCode === 404) {
    return 'Model AI tidak ditemukan atau sedang diperbarui. Sistem otomatis mencoba model cadangan berikutnya.';
  }

  return errMsg || 'Terjadi gangguan saat memproses permintaan ke server AI.';
}

// Resilient content generator that cascades through candidate models if one hits quota/rate-limits
async function generateContentWithFallback(
  options: {
    contents: any;
    config?: any;
    models?: string[];
  }
): Promise<{ text: string; modelUsed: string }> {
  const models = options.models && options.models.length > 0 ? options.models : TEXT_MODELS;
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: options.contents,
        config: options.config,
      });
      const text = response.text || '';
      return { text, modelUsed: model };
    } catch (err: any) {
      console.warn(`[Fallback] Model ${model} failed: ${err?.message?.slice(0, 150)}`);
      lastError = err;
      // Continue to next model in cascade
    }
  }

  throw lastError;
}

// Resilient stream generator with fallback
async function generateStreamWithFallback(
  options: {
    contents: any;
    config?: any;
    models?: string[];
  }
): Promise<{ stream: any; modelUsed: string }> {
  const models = options.models && options.models.length > 0 ? options.models : TEXT_MODELS;
  let lastError: any = null;

  for (const model of models) {
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents: options.contents,
        config: options.config,
      });
      return { stream, modelUsed: model };
    } catch (err: any) {
      console.warn(`[Stream Fallback] Model ${model} failed: ${err?.message?.slice(0, 150)}`);
      lastError = err;
      // Continue to next model
    }
  }

  throw lastError;
}

// Helper to check if GEMINI_API_KEY is configured
function checkApiKey(res: Response): boolean {
  if (!process.env.GEMINI_API_KEY) {
    res.status(401).json({
      error: 'GEMINI_API_KEY belum terpasang. Silakan buka menu Settings > Secrets di AI Studio untuk menyematkan API Key Anda.',
    });
    return false;
  }
  return true;
}

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    time: new Date().toISOString(),
  });
});

// Endpoint: Cek Validitas, Status Kuota, dan Kecepatan Respon Gemini API Key
// Tests all models concurrently in parallel with timeout for lightning-fast diagnostics
app.get('/api/ai/check-key', async (req: Request, res: Response) => {
  const startTime = Date.now();
  if (!process.env.GEMINI_API_KEY) {
    return res.status(401).json({
      valid: false,
      error: 'GEMINI_API_KEY belum terpasang di Settings > Secrets.',
    });
  }

  // Test single model with 5s timeout helper
  const testSingleModel = async (model: string): Promise<{
    model: string;
    status: 'ok' | 'quota_limit' | 'error';
    latencyMs?: number;
    message?: string;
  }> => {
    const t0 = Date.now();
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout 6000ms')), 6000)
      );

      const testRes: any = await Promise.race([
        ai.models.generateContent({
          model,
          contents: 'Tes koneksi sistem: jawab "OK"',
        }),
        timeoutPromise,
      ]);

      const lat = Date.now() - t0;
      return {
        model,
        status: 'ok',
        latencyMs: lat,
        message: testRes?.text?.trim() || 'OK',
      };
    } catch (err: any) {
      const errMsg = String(err?.message || '');
      const isQuota =
        errMsg.includes('429') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('Quota exceeded');
      return {
        model,
        status: isQuota ? 'quota_limit' : 'error',
        message: isQuota ? 'Batas kuota harian model ini tercapai' : errMsg.slice(0, 100),
      };
    }
  };

  // Run all model tests in parallel for maximum speed
  const settled = await Promise.allSettled(TEXT_MODELS.map((m) => testSingleModel(m)));
  const modelResults = settled.map((s, idx) => {
    if (s.status === 'fulfilled') {
      return s.value;
    }
    return {
      model: TEXT_MODELS[idx],
      status: 'error' as const,
      message: 'Gagal pengujian',
    };
  });

  // Find first active model in priority order
  const firstWorking = modelResults.find((m) => m.status === 'ok');
  const workingModel = firstWorking ? firstWorking.model : null;
  const fastestLatency = firstWorking?.latencyMs || 0;

  const hasAnyWorking = workingModel !== null;
  const elapsedMs = Date.now() - startTime;

  if (hasAnyWorking) {
    return res.json({
      valid: true,
      activeModel: workingModel,
      responseTimeMs: fastestLatency || elapsedMs,
      models: modelResults,
      message: `API Key aktif! Model utama: ${workingModel} (${fastestLatency}ms). Sistem dilengkapi auto-fallback ke ${TEXT_MODELS.length} model jika kuota salah satu model tercapai.`,
    });
  }

  const isAllQuota = modelResults.every((m) => m.status === 'quota_limit');
  return res.status(429).json({
    valid: false,
    isQuotaExhausted: isAllQuota,
    error: isAllQuota
      ? 'Batas kuota harian (Rate Limit / Quota Exceeded) telah tercapai pada seluruh model gratis Google AI Studio. Silakan tunggu beberapa saat atau ganti dengan API Key berbayar.'
      : 'Gagal terhubung ke Gemini API.',
    models: modelResults,
  });
});

// Endpoint: Ringkas Dokumen / Hasil Transkrip Menjadi Poin-Poin Penting
app.post('/api/ai/summarize', async (req: Request, res: Response) => {
  try {
    if (!checkApiKey(res)) return;

    const { text, title } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Teks transkrip tidak boleh kosong.' });
    }

    const prompt = `Anda adalah asisten cerdas pencatat dan perangkum profesional.
Analisis transkrip rekaman berikut ini dan buat ringkasan komprehensif, terstruktur, dan mudah dipahami dalam Bahasa Indonesia (kecuali jika isi seluruhnya bahasa lain, sesuaikan).

Judul Konteks: ${title || 'Rekaman Suara / Perangkat'}
Transkrip:
"""
${text}
"""

Format keluaran HARUS berupa objek JSON valid dengan struktur:
{
  "title": "Judul singkat yang mewakili inti pembahasan",
  "summary": "Ringkasan eksekutif 2-4 kalimat yang padat dan jelas tentang inti dari apa yang dibicarakan.",
  "keyPoints": [
    "Poin penting 1 disertai konteks singkat",
    "Poin penting 2...",
    "..."
  ],
  "actionItems": [
    {
      "task": "Tindakan atau tugas yang harus dilakukan",
      "owner": "Pihak/nama terkait jika disebutkan (atau 'Tim'/'Umum')",
      "priority": "Tinggi | Sedang | Rendah"
    }
  ],
  "keyDecisions": [
    "Keputusan atau kesepakatan penting yang dicapai (jika ada)"
  ],
  "sentiment": "Nada pembicaraan (misal: Produktif, Santai, Mendesak, Diskusi Strategis)",
  "formattedMarkdown": "Teks markdown siap pakai berisi judul, ringkasan eksekutif, poin-poin utama dalam bullet points, dan tabel atau daftar action items rapi."
}
Pastikan hanya mengembalikan JSON yang valid.`;

    const { text: rawOutput } = await generateContentWithFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    let parsedData;
    try {
      parsedData = JSON.parse(rawOutput || '{}');
    } catch {
      parsedData = {
        title: title || 'Ringkasan Transkrip',
        summary: rawOutput,
        keyPoints: ['Telah diekstraksi dari hasil rekaman.'],
        actionItems: [],
        formattedMarkdown: rawOutput,
      };
    }

    res.json(parsedData);
  } catch (error: any) {
    console.error('Error generating summary:', error);
    res.status(500).json({
      error: formatGeminiError(error),
    });
  }
});

// Endpoint: AI Q&A Streaming Chatbot (Ultra-fast real-time response with model fallback)
app.post('/api/ai/chat-stream', async (req: Request, res: Response) => {
  try {
    if (!checkApiKey(res)) return;

    const { transcript, question, history = [] } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
    }

    // Set Server-Sent Events headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const conversationHistory = history
      .slice(-6)
      .map((item: { role: string; text: string }) => `${item.role === 'user' ? 'User' : 'Asisten'}: ${item.text}`)
      .join('\n');

    const hasTranscript = transcript && typeof transcript === 'string' && transcript.trim().length > 0;

    const prompt = `Anda adalah Asisten AI untuk aplikasi transkripsi dan pencatatan ini.
Tugas Anda: Menjawab pertanyaan pengguna secara super cepat, ringkas, padat, ramah, dan to-the-point.
Gunakan Bahasa Indonesia yang alami, bersahabat, dan profesional. Hindari basa-basi panjang.

${hasTranscript ? `Konteks Transkrip Rekaman Dokumen:
"""
${transcript}
"""
Instruksi konteks: Utamakan menjawab pertanyaan berdasarkan isi transkrip rekaman di atas jika pertanyaan berkaitan dengannya.` : `(Catatan: Dokumen transkrip saat ini masih kosong atau belum ada rekaman. Anda tetap dapat menjawab pertanyaan apa pun secara ramah, membantu menjelaskan cara kerja transkripsi atau aplikasi, atau menjawab pertanyaan umum pengguna).`}

Riwayat Obrolan:
${conversationHistory || 'Belum ada obrolan sebelumnya.'}

Pertanyaan Pengguna saat ini:
"${question}"

Jawab langsung dengan jelas dan cepat:`;

    const { stream: responseStream } = await generateStreamWithFallback({
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Error in chat-stream:', error);
    res.write(`data: ${JSON.stringify({ error: formatGeminiError(error) })}\n\n`);
    res.end();
  }
});

// Endpoint: AI Q&A Chatbot mengenai Dokumen Transkrip (Fallback non-stream)
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    if (!checkApiKey(res)) return;

    const { transcript, question, history = [] } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
    }

    const conversationHistory = history
      .slice(-6)
      .map((item: { role: string; text: string }) => `${item.role === 'user' ? 'User' : 'Asisten'}: ${item.text}`)
      .join('\n');

    const hasTranscript = transcript && typeof transcript === 'string' && transcript.trim().length > 0;

    const prompt = `Anda adalah Asisten AI untuk aplikasi transkripsi dan pencatatan ini.
Tugas Anda: Menjawab pertanyaan pengguna secara ramah, akurat, solutif, dan cepat.
Gunakan bahasa Indonesia yang jelas, profesional, dan mudah dimengerti.

${hasTranscript ? `Konteks Transkrip Rekaman Dokumen:
"""
${transcript}
"""
Utamakan menjawab berdasarkan isi transkrip jika berkaitan.` : `(Catatan: Dokumen transkrip saat ini masih kosong atau belum ada rekaman. Anda tetap dapat menjawab pertanyaan apa pun secara ramah dan membantu).`}

Riwayat Obrolan:
${conversationHistory || 'Belum ada obrolan sebelumnya.'}

Pertanyaan Pengguna saat ini:
"${question}"

Berikan jawaban yang langsung menjawab pertanyaan:`;

    const { text: answer } = await generateContentWithFallback({
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    res.json({
      answer: answer || 'Tidak ada respons yang dihasilkan.',
    });
  } catch (error: any) {
    console.error('Error answering question:', error);
    res.status(500).json({
      error: formatGeminiError(error),
    });
  }
});

// Endpoint: Perbaiki / Poles Transkrip (Punctuation, Pilihan Kata, Format Notulensi)
app.post('/api/ai/refine', async (req: Request, res: Response) => {
  try {
    if (!checkApiKey(res)) return;

    const { text, mode = 'fix_punctuation' } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Teks tidak boleh kosong.' });
    }

    let instruction = '';
    if (mode === 'fix_punctuation') {
      instruction = `Rapikan teks transkrip suara berikut dengan menambahkan tanda baca yang benar (titik, koma, tanda tanya), kapitalisasi huruf awal kalimat, memperbaiki kata berulang/typo dari speech-to-text tanpa mengubah makna kalimat aslinya:`;
    } else if (mode === 'formal_notes') {
      instruction = `Ubah teks transkrip lisan berikut menjadi format Notulensi Rapat resmi yang tertata rapi dengan bagian Agenda, Hasil Diskusi, dan Kesimpulan:`;
    } else if (mode === 'translate_en') {
      instruction = `Terjemahkan teks transkrip berikut ke dalam Bahasa Inggris yang natural dan akurat:`;
    } else if (mode === 'translate_id') {
      instruction = `Terjemahkan teks transkrip berikut ke dalam Bahasa Indonesia yang formal dan alami:`;
    } else {
      instruction = `Perbaiki dan perjelas teks transkrip berikut agar nyaman dibaca:`;
    }

    const prompt = `${instruction}

Teks:
"""
${text}
"""

Keluarkan HANYA hasil teks yang telah diperbaiki tanpa basa-basi pengantar atau penutup.`;

    const { text: refinedText } = await generateContentWithFallback({
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    res.json({
      refinedText: refinedText || text,
    });
  } catch (error: any) {
    console.error('Error refining text:', error);
    res.status(500).json({
      error: formatGeminiError(error),
    });
  }
});

// Endpoint: AI Audio Transcription (transcribe audio file / chunk via Gemini)
app.post('/api/ai/transcribe', async (req: Request, res: Response) => {
  try {
    if (!checkApiKey(res)) return;

    const { audioBase64, mimeType = 'audio/webm', language = 'id' } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Data audio base64 diperlukan.' });
    }

    const audioPart = {
      inlineData: {
        mimeType: mimeType.split(';')[0] || 'audio/webm',
        data: audioBase64,
      },
    };

    const promptText = `Transkripsikan rekaman audio ini ke dalam teks secara verbatim, akurat, dan lengkap dalam bahasa aslinya (utamakan ${language === 'id' ? 'Bahasa Indonesia' : 'Bahasa yang digunakan'}). Sertakan tanda baca yang tepat. Jangan tambahkan komentar lain, hanya teks transkripnya saja.`;

    const { text: transcriptText } = await generateContentWithFallback({
      contents: {
        parts: [audioPart, { text: promptText }],
      },
      models: AUDIO_MODELS,
    });

    res.json({
      transcript: transcriptText.trim(),
    });
  } catch (error: any) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({
      error: formatGeminiError(error),
    });
  }
});

// Endpoint: AI Real-Time Chunk Transcription (For live streaming tab/device audio or periodic speech chunks)
app.post('/api/ai/live-chunk', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', language = 'id', previousContext = '' } = req.body;

    if (!audioBase64) {
      return res.json({ transcript: '' });
    }

    const audioPart = {
      inlineData: {
        mimeType: mimeType.split(';')[0] || 'audio/webm',
        data: audioBase64,
      },
    };

    const promptText = `Dengarkan potongan audio singkat ini. Transkripsikan kata-kata yang diucapkan secara akurat dalam ${language === 'id' ? 'Bahasa Indonesia' : 'bahasa aslinya'}.
${previousContext ? `Konteks kalimat sebelumnya: "${previousContext}"` : ''}
Jika hening, tidak ada kata yang terucap, atau hanya suara musik/noise, kembalikan teks kosong "" tanpa penjelasan apapun. Jangan buat teks fiktif.`;

    const { text: transcript } = await generateContentWithFallback({
      contents: {
        parts: [audioPart, { text: promptText }],
      },
      models: AUDIO_MODELS,
    });

    res.json({ transcript: transcript.trim() });
  } catch (error: any) {
    console.warn('Live chunk transcription error:', error?.message);
    res.json({ transcript: '' });
  }
});

// Vite middleware for dev or static for production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`TranskripAI server running on port ${PORT} (NODE_ENV: ${process.env.NODE_ENV || 'development'})`);
  });
}

startServer();
