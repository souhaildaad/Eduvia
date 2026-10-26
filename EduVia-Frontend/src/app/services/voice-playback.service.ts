import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class VoicePlaybackService {
  private activeKey: string | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;

  toggle(key: string, text: string): boolean {
    if (!this.isSupported()) {
      return false;
    }

    const synthesis = window.speechSynthesis;
    const isSameSourceActive =
      this.activeKey === key && (synthesis.speaking || synthesis.pending);

    if (isSameSourceActive) {
      this.stop();
      return false;
    }

    this.speak(text, key);
    return true;
  }

  speak(
    text: string,
    key?: string,
    callbacks?: { onStart?: () => void; onEnd?: () => void },
  ): boolean {
    if (!this.isSupported()) {
      return false;
    }

    const synthesis = window.speechSynthesis;
    synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.rate = 1;
    utterance.volume = 1;

    this.activeKey = key || null;
    this.activeUtterance = utterance;

    utterance.onstart = () => callbacks?.onStart?.();
    utterance.onend = () => {
      this.clearActiveUtterance(utterance);
      callbacks?.onEnd?.();
    };
    utterance.onerror = () => {
      this.clearActiveUtterance(utterance);
      callbacks?.onEnd?.();
    };

    synthesis.speak(utterance);
    return true;
  }

  isActive(key: string): boolean {
    if (!this.isSupported()) {
      return false;
    }

    return this.activeKey === key && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  }

  stop() {
    if (!this.isSupported()) {
      return;
    }

    window.speechSynthesis.cancel();
    this.activeKey = null;
    this.activeUtterance = null;
  }

  private clearActiveUtterance(utterance: SpeechSynthesisUtterance) {
    if (this.activeUtterance !== utterance) {
      return;
    }

    this.activeKey = null;
    this.activeUtterance = null;
  }

  private isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }
}
