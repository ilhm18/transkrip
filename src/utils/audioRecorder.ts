import { AudioSourceType } from '../types';

export interface AudioRecorderController {
  start: (sourceType: AudioSourceType) => Promise<MediaStream>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<{ blob: Blob; url: string; duration: number }>;
  getAnalyser: () => AnalyserNode | null;
  getCurrentDuration: () => number;
}

export class DeviceAudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private activeStreams: MediaStream[] = [];
  private startTime: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;
  private isPaused: boolean = false;

  async start(
    sourceType: AudioSourceType,
    onChunkReady?: (chunkBlob: Blob) => void
  ): Promise<MediaStream> {
    this.stopExisting();
    this.audioChunks = [];
    this.startTime = Date.now();
    this.pausedDuration = 0;
    this.isPaused = false;

    let outputStream: MediaStream;

    // Initialize AudioContext
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();

    if (sourceType === 'mic') {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.activeStreams.push(micStream);
      outputStream = micStream;
    } else if (sourceType === 'device') {
      // Screen/Tab Audio Capture
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      this.activeStreams.push(displayStream);

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        // Stop video tracks immediately if no audio was selected
        displayStream.getTracks().forEach((t) => t.stop());
        throw new Error(
          'Tidak ada audio yang terdeteksi dari perangkat/tab. Pastikan mencentang "Bagikan audio sistem" atau "Share tab audio" saat memilih jendela/tab.'
        );
      }

      outputStream = new MediaStream(audioTracks);
    } else {
      // 'mixed' = Combine Microphone AND Device/Tab Audio via Web Audio API
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: true,
        },
      });
      this.activeStreams.push(micStream);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      this.activeStreams.push(displayStream);

      const displayAudioTracks = displayStream.getAudioTracks();
      if (displayAudioTracks.length === 0) {
        // If user didn't share tab audio, fallback to mic only with warning
        console.warn('Tab audio track not found in mixed mode, falling back to mic');
        outputStream = micStream;
      } else {
        const dest = this.audioContext.createMediaStreamDestination();
        const micSource = this.audioContext.createMediaStreamSource(micStream);
        const displayAudioStream = new MediaStream(displayAudioTracks);
        const displaySource = this.audioContext.createMediaStreamSource(displayAudioStream);

        // Mix both into destination node
        micSource.connect(dest);
        displaySource.connect(dest);
        outputStream = dest.stream;
      }
    }

    // Set up AnalyserNode for audio visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    const sourceNode = this.audioContext.createMediaStreamSource(outputStream);
    sourceNode.connect(this.analyser);

    // Pick best supported MIME type
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else {
        mimeType = '';
      }
    }

    const options = mimeType ? { mimeType } : undefined;
    this.mediaRecorder = new MediaRecorder(outputStream, options);

    let recentBuffer: Blob[] = [];

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
        recentBuffer.push(event.data);
      }
    };

    // Emit accumulated chunk every 4 seconds for live transcription of device/tab audio
    if (onChunkReady) {
      setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording' && recentBuffer.length > 0) {
          const chunkBlob = new Blob(recentBuffer, { type: mimeType || 'audio/webm' });
          recentBuffer = [];
          onChunkReady(chunkBlob);
        }
      }, 4000);
    }

    // Request data every 1 second
    this.mediaRecorder.start(1000);

    return outputStream;
  }

  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.pauseStartTime = Date.now();
    }
  }

  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.pausedDuration += Date.now() - this.pauseStartTime;
    }
  }

  getCurrentDuration(): number {
    if (!this.startTime) return 0;
    if (this.isPaused) {
      return Math.floor((this.pauseStartTime - this.startTime - this.pausedDuration) / 1000);
    }
    return Math.floor((Date.now() - this.startTime - this.pausedDuration) / 1000);
  }

  async stop(): Promise<{ blob: Blob; url: string; duration: number }> {
    return new Promise((resolve) => {
      const finalDuration = this.getCurrentDuration();

      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        const dummyBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.stopExisting();
        resolve({
          blob: dummyBlob,
          url: URL.createObjectURL(dummyBlob),
          duration: finalDuration,
        });
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const finalBlob = new Blob(this.audioChunks, { type: mimeType });
        const url = URL.createObjectURL(finalBlob);
        this.stopExisting();
        resolve({
          blob: finalBlob,
          url,
          duration: finalDuration,
        });
      };

      this.mediaRecorder.stop();
    });
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  private stopExisting() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        console.warn('Error stopping mediaRecorder', e);
      }
    }
    this.activeStreams.forEach((s) => {
      s.getTracks().forEach((t) => t.stop());
    });
    this.activeStreams = [];
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.analyser = null;
  }
}
