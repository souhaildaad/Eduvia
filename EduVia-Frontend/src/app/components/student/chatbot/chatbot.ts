import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { VoicePlaybackService } from '../../../services/voice-playback.service';

type ChatMessage = {
  sender: 'assistant' | 'student';
  text: string;
  time: string;
};

type ChatPresentation = 'chat' | 'avatar';
type ChatPair = {
  question: ChatMessage;
  answer?: ChatMessage;
};
type ChatHistorySession = {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
};

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.css',
})
export class Chatbot implements OnInit, OnDestroy {
  @Input() compact = false;
  @Input() presentation: ChatPresentation = 'chat';
  @ViewChild('messagesViewport') private messagesViewport?: ElementRef<HTMLElement>;

  draftMessage = '';
  sending = false;
  assistantSpeaking = false;
  historyOpen = true;
  chatHistory: ChatHistorySession[] = [];
  private readonly aiChatUrl = '/ai/chat';
  private readonly assistantVoiceKey = 'student-assistant-ia:avatar';
  private activeHistoryId = '';
  private readonly greetingMessage: ChatMessage = {
    sender: 'assistant',
    text: "Bonjour! Je suis votre assistant d'apprentissage IA. Comment puis-je vous aider aujourd'hui?",
    time: '12:38',
  };
  messages: ChatMessage[] = [{ ...this.greetingMessage }];

  quickReplies = [
    "Explique-moi ce chapitre",
    'Donne-moi un resume',
    'Propose un exercice',
  ];

  constructor(
    private readonly http: HttpClient,
    private readonly voicePlaybackService: VoicePlaybackService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (this.isAvatarMode) {
      this.messages = [];
      this.loadChatHistory();
    } else {
      this.messages = [{ ...this.greetingMessage }];
    }
  }

  ngOnDestroy(): void {
    if (this.presentation === 'avatar') {
      this.saveCurrentAvatarSession();
      this.voicePlaybackService.stop();
    }
  }

  async sendMessage() {
    const text = this.draftMessage.trim();
    if (!text || this.sending) {
      return;
    }

    this.messages.push({
      sender: 'student',
      text,
      time: this.currentTime(),
    });

    const thinkingMessage: ChatMessage = {
      sender: 'assistant',
      text: "L'IA reflechit...",
      time: this.currentTime(),
    };
      this.messages.push(thinkingMessage);
      this.scrollMessagesToBottom();
      this.cdr.detectChanges();

      this.draftMessage = '';
      this.sending = true;
      this.cdr.detectChanges();

    try {
      const payload = await firstValueFrom(
        this.http.post<any>(this.aiChatUrl, { message: text }),
      );
      const reply =
        payload?.reply ||
        payload?.data?.reply ||
        payload?.response ||
        payload?.answer ||
        payload?.message ||
        '';

      thinkingMessage.text = reply || this.buildAiUnavailableMessage();
      thinkingMessage.time = this.currentTime();
      this.cdr.detectChanges();
      this.speakAssistantReply(thinkingMessage.text);
      await this.saveCurrentAvatarSession();
    } catch {
      thinkingMessage.text = this.buildAiUnavailableMessage();
      thinkingMessage.time = this.currentTime();
      this.cdr.detectChanges();
      this.speakAssistantReply(thinkingMessage.text);
    } finally {
      this.sending = false;
      this.cdr.detectChanges();
      this.scrollMessagesToBottom();
    }
  }

  useQuickReply(message: string) {
    this.draftMessage = message;
    this.sendMessage();
  }

  get conversationPairs(): ChatPair[] {
    const pairs: ChatPair[] = [];
    let currentPair: ChatPair | null = null;

    for (const message of this.messages) {
      if (message.sender === 'student') {
        currentPair = { question: message };
        pairs.push(currentPair);
      } else if (currentPair && !currentPair.answer) {
        currentPair.answer = message;
      }
    }

    return pairs;
  }

  get latestAssistantMessage() {
    return [...this.messages].reverse().find((message) => message.sender === 'assistant');
  }

  get latestStudentMessage() {
    return [...this.messages].reverse().find((message) => message.sender === 'student');
  }

  get isAvatarMode() {
    return this.presentation === 'avatar';
  }

  startNewAvatarChat() {
    if (!this.isAvatarMode) {
      return;
    }

    this.saveCurrentAvatarSession();
    this.messages = [];
    this.activeHistoryId = '';
    this.draftMessage = '';
    this.assistantSpeaking = false;
    this.voicePlaybackService.stop();
    this.cdr.detectChanges();
  }

  toggleHistory() {
    this.historyOpen = !this.historyOpen;
  }

  openHistorySession(session: ChatHistorySession) {
    this.saveCurrentAvatarSession();
    this.activeHistoryId = session.id;
    this.messages = session.messages.map((message) => ({ ...message }));
    this.cdr.detectChanges();
    this.scrollMessagesToBottom();
  }

  async deleteHistorySession(event: Event, session: ChatHistorySession) {
    event.stopPropagation();

    try {
      await firstValueFrom(this.http.delete<any>(`/ai/chat/history/${session.id}`));
      this.chatHistory = this.chatHistory.filter((item) => item.id !== session.id);
      if (this.activeHistoryId === session.id) {
        this.activeHistoryId = '';
        this.messages = [];
      }
      this.cdr.detectChanges();
    } catch {
      return;
    }
  }

  private currentTime() {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private scrollMessagesToBottom() {
    window.setTimeout(() => {
      const viewport = this.messagesViewport?.nativeElement;
      if (!viewport) {
        return;
      }

      viewport.scrollTop = viewport.scrollHeight;
    }, 0);
  }

  private speakAssistantReply(text: string) {
    if (!this.isAvatarMode) {
      return;
    }

    const didStart = this.voicePlaybackService.speak(text, this.assistantVoiceKey, {
      onStart: () => {
        this.assistantSpeaking = true;
        this.cdr.detectChanges();
      },
      onEnd: () => {
        this.assistantSpeaking = false;
        this.cdr.detectChanges();
      },
    });

    this.assistantSpeaking = didStart;
    this.cdr.detectChanges();
  }

  private buildAiUnavailableMessage() {
    return "Le chatbot est connecte au service IA, mais la reponse prend trop de temps. Verifiez que le serveur Python/Ollama a termine la generation, puis reessayez.";
  }

  private async saveCurrentAvatarSession() {
    if (!this.isAvatarMode || !this.messages.some((message) => message.sender === 'student')) {
      return;
    }

    const title =
      this.messages.find((message) => message.sender === 'student')?.text.slice(0, 52) ||
      'Nouvelle conversation';

    try {
      const response = await firstValueFrom(
        this.http.post<any>('/ai/chat/history', {
          id: this.activeHistoryId || undefined,
          title,
          messages: this.messages,
        }),
      );
      const saved = response?.data;
      if (saved?.id) {
        this.activeHistoryId = saved.id;
      }
      await this.loadChatHistory();
    } catch {
      return;
    }
  }

  private async loadChatHistory() {
    try {
      const response = await firstValueFrom(this.http.get<any>('/ai/chat/history'));
      this.chatHistory = Array.isArray(response?.data) ? response.data : [];
      this.cdr.detectChanges();
    } catch {
      this.chatHistory = [];
    }
  }
}
