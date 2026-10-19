// Real-time Speech Recognition Wrapper

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export interface SpeechRecognitionCallbacks {
  onInterimResult: (interimText: string) => void;
  onFinalResult: (finalText: string) => void;
  onError: (error: string) => void;
  onEnd: () => void;
}

export class RealtimeSpeechTranscriber {
  private recognition: any = null;
  private isListening: boolean = false;
  private shouldKeepListening: boolean = false;
  private language: string = 'id-ID';
  private callbacks: SpeechRecognitionCallbacks;
  private secondaryCallbacks: SpeechRecognitionCallbacks | null = null;

  constructor(callbacks: SpeechRecognitionCallbacks, language: string = 'id-ID') {
    this.callbacks = callbacks;
    this.language = language;
    this.initRecognition();
  }

  static isSupported(): boolean {
    return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  setSecondaryCallbacks(callbacks: SpeechRecognitionCallbacks | null) {
    this.secondaryCallbacks = callbacks;
  }

  getSecondaryCallbacks(): SpeechRecognitionCallbacks | null {
    return this.secondaryCallbacks;
  }

  getIsListening(): boolean {
    return this.isListening;
  }

  setLanguage(newLang: string) {
    this.language = newLang;
    if (this.recognition) {
      this.recognition.lang = newLang;
    }
  }

  private initRecognition() {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      return;
    }

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.language;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const text = item[0]?.transcript || '';
          if (item.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        if (finalTranscript.trim()) {
          this.callbacks.onFinalResult(finalTranscript.trim());
          if (this.secondaryCallbacks) {
            this.secondaryCallbacks.onFinalResult(finalTranscript.trim());
          }
        }

        this.callbacks.onInterimResult(interimTranscript);
        if (this.secondaryCallbacks) {
          this.secondaryCallbacks.onInterimResult(interimTranscript);
        }
      };

      this.recognition.onerror = (event: any) => {
        // 'no-speech' is common and harmless during brief pauses
        if (event.error === 'no-speech') {
          return;
        }
        if (event.error === 'aborted') {
          return;
        }
        console.warn('Speech recognition error event:', event.error);
        const errMsg =
          event.error === 'not-allowed'
            ? 'Izin mikrofon ditolak atau diblokir oleh browser.'
            : `Pengenalan suara: ${event.error}`;
        this.callbacks.onError(errMsg);
        if (this.secondaryCallbacks) {
          this.secondaryCallbacks.onError(errMsg);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        // If we should keep listening (user hasn't clicked stop), auto-restart
        if (this.shouldKeepListening) {
          try {
            this.recognition.start();
            this.isListening = true;
          } catch {
            setTimeout(() => {
              if (this.shouldKeepListening) {
                try {
                  this.recognition.start();
                  this.isListening = true;
                } catch (err) {
                  console.warn('Could not restart speech recognition:', err);
                }
              }
            }, 300);
          }
        } else {
          this.callbacks.onEnd();
          if (this.secondaryCallbacks) {
            this.secondaryCallbacks.onEnd();
          }
        }
      };
    } catch (e) {
      console.error('Failed to initialize speech recognition:', e);
    }
  }

  start() {
    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition) {
      this.callbacks.onError(
        'Browser Anda tidak mendukung Web Speech API secara native. Anda tetap dapat merekam audio dan menggunakan Gemini AI untuk transkripsi.'
      );
      return;
    }

    this.shouldKeepListening = true;
    try {
      this.recognition.start();
      this.isListening = true;
    } catch (e: any) {
      if (e.name !== 'InvalidStateError') {
        console.warn('Error starting speech recognition:', e);
      }
    }
  }

  stop() {
    this.shouldKeepListening = false;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.warn('Error stopping recognition:', e);
      }
    }
    this.isListening = false;
  }
}
