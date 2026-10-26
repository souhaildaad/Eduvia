import { Injectable, NgZone } from '@angular/core';

type DictationCallback = (transcript: string) => void;

@Injectable({
  providedIn: 'root',
})
export class VoiceDictationService {
  private activeKey: string | null = null;
  private recognition: any = null;
  private transcriptCallback: DictationCallback | null = null;

  constructor(private zone: NgZone) {}

  toggle(key: string, onTranscript: DictationCallback): boolean {
    if (!this.isSupported()) {
      return false;
    }

    if (this.activeKey === key) {
      this.stop();
      return false;
    }

    this.start(key, onTranscript);
    return true;
  }

  isActive(key: string): boolean {
    return this.activeKey === key;
  }

  stop() {
    if (this.recognition) {
      this.recognition.stop();
    }
    this.clear();
  }

  private start(key: string, onTranscript: DictationCallback) {
    this.stop();

    const RecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!RecognitionCtor) {
      return;
    }

    this.recognition = new RecognitionCtor();
    this.transcriptCallback = onTranscript;
    this.activeKey = key;

    this.recognition.lang = 'fr-FR';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event: any) => {
      let transcript = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        transcript += `${result?.[0]?.transcript || ''} `;
      }

      const normalized = transcript.trim();
      if (normalized && this.transcriptCallback) {
        this.zone.run(() => {
          this.transcriptCallback?.(normalized);
        });
      }
    };

    this.recognition.onend = () => {
      this.zone.run(() => {
        this.clear();
      });
    };

    this.recognition.onerror = () => {
      this.zone.run(() => {
        this.clear();
      });
    };

    this.recognition.start();
  }

  private clear() {
    this.activeKey = null;
    this.transcriptCallback = null;
    this.recognition = null;
  }

  private isSupported(): boolean {
    return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }
}
