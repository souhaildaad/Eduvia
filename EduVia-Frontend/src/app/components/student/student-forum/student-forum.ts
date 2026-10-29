import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { timeout } from 'rxjs';
import { NotificationService } from '../../../services/notification.service';
import { VoiceDictationService } from '../../../services/voice-dictation.service';
import { VoicePlaybackService } from '../../../services/voice-playback.service';

type HelpRequest = {
  id: string;
  author: string;
  authorName?: string;
  authorAvatarDataUrl?: string;
  level: string;
  title: string;
  subject?: string;
  message: string;
  time: string;
  replies: number;
  status: 'En attente' | 'En discussion';
  canDelete: boolean;
  isMine: boolean;
  lastResponderName?: string;
};

type ForumChatMessage = {
  id: string;
  senderType: 'request' | 'author' | 'helper';
  senderName: string;
  senderAvatarDataUrl?: string;
  senderLevel: string;
  text: string;
  attachments?: ForumAttachment[];
  transcript?: string;
  time: string;
};

type ForumAttachment = {
  kind: 'document' | 'video';
  name: string;
  mimeType?: string;
  dataUrl: string;
  fileUrl?: string;
};

@Component({
  selector: 'app-student-forum',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, MatIconModule],
  templateUrl: './student-forum.html',
  styleUrl: './student-forum.css',
})
export class StudentForum implements OnInit, OnDestroy {
  searchTerm = '';
  requestFilter: 'others' | 'mine' = 'others';
  showHelpModal = false;
  openedChatRequest: HelpRequest | null = null;
  responseChoiceRequest: HelpRequest | null = null;
  deleteConfirmRequest: HelpRequest | null = null;
  chatDraft = '';
  chatAttachment: ForumAttachment | null = null;
  videoRecorderOpen = false;
  videoRecording = false;
  videoPreviewUrl = '';
  videoTranscript = '';
  videoErrorMessage = '';
  videoSavedConfirmOpen = false;
  selectedAttachment: ForumAttachment | null = null;
  newOthersCount = 0;
  newMineCount = 0;
  attachmentPdfVoiceLoading = false;
  attachmentPdfVoiceMessage = '';
  helpSubject = '';
  helpMessage = '';
  helpFormErrorMessage = '';
  screenReaderMessage = '';
  loading = false;
  chatLoading = false;
  chatSending = false;
  submitting = false;
  errorMessage = '';
  successMessage = '';
  chatErrorMessage = '';
  showSendSuccessModal = false;
  sendSuccessMessage = '';
  sendSuccessTitle = '';

  requests: HelpRequest[] = [];
  stats = {
    openQuestions: 0,
    repliesToday: 0,
    resolutionRate: 0,
  };
  chatMessages: ForumChatMessage[] = [];
  private refreshIntervalId: number | null = null;
  private chatRefreshIntervalId: number | null = null;
  private retryTimeoutId: number | null = null;
  private bootRetryTimeoutId: number | null = null;
  private delayedBootRetryTimeoutId: number | null = null;
  private successTimeoutId: number | null = null;
  private successModalTimeoutId: number | null = null;
  private consultHighlightTimeoutId: number | null = null;
  private readonly forumCacheKey = 'eduvia-student-forum-cache';
  private readonly forumConsultStorageKey = 'eduvia_forum_consult_action';
  private forumNotificationPrimed = false;
  private forumPreviousById = new Map<string, HelpRequest>();
  private consultHighlightId = '';
  private mediaRecorder: MediaRecorder | null = null;
  videoStream: MediaStream | null = null;
  private recordedVideoChunks: BlobPart[] = [];
  private speechRecognition: any = null;
  private readonly attachmentPdfTextCache = new Map<string, string>();

  constructor(
    private readonly http: HttpClient,
    private readonly notificationService: NotificationService,
    private readonly voiceDictationService: VoiceDictationService,
    private readonly voicePlaybackService: VoicePlaybackService,
    private readonly sanitizer: DomSanitizer,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.restoreCachedForumSnapshot();
    this.loadRequests({ retryCount: 2 });
    this.bootRetryTimeoutId = window.setTimeout(() => {
      this.loadRequests({ retryCount: 2, silent: true });
    }, 500);
    this.delayedBootRetryTimeoutId = window.setTimeout(() => {
      this.loadRequests({ retryCount: 2, silent: true });
    }, 1600);
    this.refreshIntervalId = window.setInterval(() => {
      this.loadRequests({ silent: true });
    }, 3000);
    window.addEventListener('focus', this.handleWindowFocus);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('eduvia-forum-open', this.handleForumConsultEvent as EventListener);
    this.applyPendingConsultActionIfAny();
  }

  ngOnDestroy() {
    if (this.refreshIntervalId !== null) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    if (this.chatRefreshIntervalId !== null) {
      window.clearInterval(this.chatRefreshIntervalId);
      this.chatRefreshIntervalId = null;
    }

    if (this.retryTimeoutId !== null) {
      window.clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    if (this.bootRetryTimeoutId !== null) {
      window.clearTimeout(this.bootRetryTimeoutId);
      this.bootRetryTimeoutId = null;
    }
    if (this.delayedBootRetryTimeoutId !== null) {
      window.clearTimeout(this.delayedBootRetryTimeoutId);
      this.delayedBootRetryTimeoutId = null;
    }
    if (this.successTimeoutId !== null) {
      window.clearTimeout(this.successTimeoutId);
      this.successTimeoutId = null;
    }
    if (this.successModalTimeoutId !== null) {
      window.clearTimeout(this.successModalTimeoutId);
      this.successModalTimeoutId = null;
    }
    if (this.consultHighlightTimeoutId !== null) {
      window.clearTimeout(this.consultHighlightTimeoutId);
      this.consultHighlightTimeoutId = null;
    }

    try {
      window.speechSynthesis.cancel();
    } catch {
      // Voice guidance is optional.
    }

    window.removeEventListener('focus', this.handleWindowFocus);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('eduvia-forum-open', this.handleForumConsultEvent as EventListener);
    this.stopVideoRecorderTools();
  }

  get filteredRequests() {
    const term = this.normalizeSearchText(this.searchTerm);
    const scopeFiltered = this.requestFilter === 'mine'
      ? this.requests.filter(request => request.isMine)
      : this.requests;

    if (!term) {
      return scopeFiltered;
    }

    return scopeFiltered.filter(request => {
      const author = this.normalizeSearchText(request.author);
      const title = this.normalizeSearchText(request.title);
      const message = this.normalizeSearchText(request.message);
      const level = this.normalizeSearchText(request.level);
      const words = `${author} ${title} ${message} ${level}`
        .split(/\s+/)
        .filter(Boolean);

      if (term.length === 1) {
        return words.some(word => word.startsWith(term));
      }

      return (
        author.includes(term) ||
        title.includes(term) ||
        message.includes(term) ||
        level.includes(term) ||
        words.some(word => word.startsWith(term))
      );
    });
  }

  setRequestFilter(filter: 'others' | 'mine') {
    this.requestFilter = filter;
  }

  isConsultHighlighted(requestId: string) {
    return this.consultHighlightId === requestId;
  }

  get myRequestsCount() {
    return this.requests.filter(request => request.isMine).length;
  }

  get totalRequestsCount() {
    return this.requests.length;
  }

  get openQuestionsCount() {
    if (typeof this.stats?.openQuestions === 'number' && this.stats.openQuestions > 0) {
      return this.stats.openQuestions;
    }
    return this.requests.filter(r => r.status !== 'En discussion').length;
  }

  get repliesTodayCount() {
    if (typeof this.stats?.repliesToday === 'number' && this.stats.repliesToday > 0) {
      return this.stats.repliesToday;
    }
    return this.requests.reduce((sum, r) => sum + (Number(r.replies) || 0), 0);
  }

  get resolutionRate() {
    return this.stats.resolutionRate;
  }

  classLabel(value: string) {
    const tokens = String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(Boolean);

    if (tokens.length === 0) {
      return '';
    }

    const deduplicated: string[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
      const normalized = token.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduplicated.push(token);
    }

    return deduplicated.join(' ');
  }

  openHelpModal() {
    this.showHelpModal = true;
    this.helpFormErrorMessage = '';
    this.loadRequests({ silent: true });
  }

  closeHelpModal() {
    this.showHelpModal = false;
    this.helpFormErrorMessage = '';
    this.helpSubject = '';
    this.helpMessage = '';
    this.stopHelpVoiceTools();
  }

  submitHelpRequest() {
    const subject = this.helpSubject.trim();
    const message = this.helpMessage.trim();
    if (!subject || !message || this.submitting) {
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.helpFormErrorMessage = '';
    this.showHelpModal = false;
    this.openSendSuccessModal('Envoi en cours...', 'Traitement');
    this.http
      .post<{ request: HelpRequest }>('/api/student/forum/requests', {
        subject,
        message,
      })
      .pipe(timeout(20000))
      .subscribe({
        next: () => {
          this.submitting = false;
          this.helpSubject = '';
          this.helpMessage = '';
          this.openSendSuccessModal('Votre demande a ete envoyee avec succes.', 'Demande envoyee');
          this.loadRequests({ retryCount: 2 });
        },
        error: error => {
          this.submitting = false;
          this.closeSendSuccessModal();
          this.showHelpModal = true;
          const timedOut = error?.name === 'TimeoutError';
          this.helpFormErrorMessage = timedOut
            ? "Le serveur ne repond pas. Verifiez votre connexion, puis reessayez."
            : String(error?.error?.message || "Echec d'envoi de la demande. Verifiez votre connexion puis reessayez.");
          this.errorMessage = this.helpFormErrorMessage;
        },
      });
  }

  closeSendSuccessModal() {
    this.showSendSuccessModal = false;
    this.sendSuccessMessage = '';
    if (this.successModalTimeoutId !== null) {
      window.clearTimeout(this.successModalTimeoutId);
      this.successModalTimeoutId = null;
    }
  }

  openResponseChoice(request: HelpRequest) {
    this.responseChoiceRequest = request;
  }

  closeResponseChoice() {
    this.responseChoiceRequest = null;
  }

  chooseNormalResponse() {
    if (!this.responseChoiceRequest) {
      return;
    }
    const request = this.responseChoiceRequest;
    this.responseChoiceRequest = null;
    this.openChat(request);
  }

  chooseVideoResponse() {
    if (!this.responseChoiceRequest) {
      return;
    }
    const request = this.responseChoiceRequest;
    this.responseChoiceRequest = null;
    this.openChat(request);
    this.openVideoRecorder();
    this.announceVideoInstructions();
  }

  openChat(request: HelpRequest) {
    const authorName = request.author || (request as any).authorName || 'Étudiant';
    const messageText = request.message || (request as any).content || '';
    const reqTime = request.time || '10:00';
    const reqLevel = this.classLabel(request.level);

    this.openedChatRequest = {
      ...request,
      author: authorName,
      message: messageText,
      time: reqTime,
    };
    this.chatDraft = '';
    this.chatAttachment = null;
    this.chatSending = false;
    this.chatMessages = [
      {
        id: `initial-${request.id}`,
        senderType: 'request',
        senderName: authorName,
        senderAvatarDataUrl: request.authorAvatarDataUrl,
        senderLevel: reqLevel,
        text: messageText,
        time: reqTime,
      },
    ];
    this.chatLoading = true;
    this.errorMessage = '';
    this.chatErrorMessage = '';

    this.loadChatMessages(request.id);
    if (this.chatRefreshIntervalId !== null) {
      window.clearInterval(this.chatRefreshIntervalId);
    }
    this.chatRefreshIntervalId = window.setInterval(() => {
      if (this.openedChatRequest?.id) {
        this.loadChatMessages(this.openedChatRequest.id, true);
      }
    }, 3000);
  }

  closeChat() {
    this.openedChatRequest = null;
    this.chatDraft = '';
    this.chatAttachment = null;
    this.chatMessages = [];
    this.chatErrorMessage = '';
    this.chatSending = false;
    this.closeVideoRecorder();
    if (this.chatRefreshIntervalId !== null) {
      window.clearInterval(this.chatRefreshIntervalId);
      this.chatRefreshIntervalId = null;
    }
  }

  private focusChatComposer() {
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('.forum-composer-zone')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 80);
  }

  sendChatMessage() {
    const text = this.chatDraft.trim();
    if ((!text && !this.chatAttachment) || !this.openedChatRequest || this.chatSending) {
      return;
    }

    const requestId = this.openedChatRequest.id;
    const authorName = this.openedChatRequest.author || 'Étudiant';
    const messageText = this.openedChatRequest.message || '';
    const reqTime = this.openedChatRequest.time || '10:00';
    const reqLevel = this.classLabel(this.openedChatRequest.level);

    const payload = {
      message: text || this.videoTranscript || this.chatAttachment?.name || 'Réponse vidéo enregistrée.',
      attachments: this.chatAttachment ? [this.chatAttachment] : [],
      transcript: this.videoTranscript,
    };

    this.chatSending = true;
    this.chatErrorMessage = '';

    this.http
      .post<{ request: HelpRequest; messages: ForumChatMessage[] }>(
        `/api/student/forum/requests/${requestId}/chat/messages`,
        payload,
      )
      .subscribe({
        next: response => {
          this.chatSending = false;
          const initialMessage: ForumChatMessage = {
            id: `initial-${requestId}`,
            senderType: 'request',
            senderName: authorName,
            senderAvatarDataUrl: this.openedChatRequest?.authorAvatarDataUrl,
            senderLevel: reqLevel,
            text: messageText,
            time: reqTime,
          };

          const rawBackendMessages = Array.isArray(response.messages) ? response.messages : [];
          const repliesOnly = rawBackendMessages.filter(m => m.id !== initialMessage.id && m.text !== initialMessage.text);
          this.chatMessages = [initialMessage, ...repliesOnly];

          this.chatDraft = '';
          this.chatAttachment = null;
          this.videoTranscript = '';
          this.videoPreviewUrl = '';
          this.loadRequests();
        },
        error: err => {
          this.chatSending = false;
          this.chatErrorMessage = err?.error?.message || "Échec d'envoi du message. Veuillez réessayer.";
        },
      });
  }

  askDeleteRequest(request: HelpRequest) {
    if (!request.canDelete) {
      return;
    }
    this.deleteConfirmRequest = request;
  }

  closeDeleteConfirm() {
    this.deleteConfirmRequest = null;
  }

  confirmDeleteRequest() {
    if (!this.deleteConfirmRequest) {
      return;
    }
    this.deleteRequest(this.deleteConfirmRequest);
    this.deleteConfirmRequest = null;
  }

  private deleteRequest(request: HelpRequest) {
    if (!request.canDelete) {
      return;
    }

    const previousRequests = [...this.requests];
    const previousStats = { ...this.stats };
    this.requests = this.requests.filter(item => item.id !== request.id);
    this.stats = {
      ...this.stats,
      openQuestions: Math.max(0, this.stats.openQuestions - 1),
    };

    this.http
      .delete<{ success: boolean }>(`/api/student/forum/requests/${request.id}`)
      .subscribe({
        next: () => {
          if (this.openedChatRequest?.id === request.id) {
            this.closeChat();
          }

          this.loadRequests();
        },
        error: () => {
          this.requests = previousRequests;
          this.stats = previousStats;
          this.errorMessage = "Echec de suppression de la demande.";
        },
      });
  }

  onChatAttachmentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      this.chatErrorMessage = 'Document trop volumineux. Taille maximale: 4 Mo.';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.chatAttachment = {
        kind: 'document',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl: String(reader.result || ''),
      };
    };
    reader.onerror = () => {
      this.chatErrorMessage = 'Impossible de lire ce document.';
    };
    reader.readAsDataURL(file);
  }

  removeChatAttachment() {
    this.chatAttachment = null;
  }

  async openVideoRecorder() {
    this.videoErrorMessage = '';
    this.videoRecorderOpen = true;
    this.videoTranscript = '';
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      window.setTimeout(() => {
        const video = document.querySelector<HTMLVideoElement>('#forum-video-preview');
        if (video && this.videoStream) {
          video.srcObject = this.videoStream;
        }
      });
    } catch {
      this.videoErrorMessage = "Impossible d'ouvrir la camera. Verifiez l'autorisation du navigateur.";
    }
  }

  async startVideoRecording() {
    if (this.videoRecording) {
      return;
    }

    if (!this.videoStream) {
      await this.openVideoRecorder();
    }

    if (!this.videoStream) {
      this.videoErrorMessage = "La camera n'est pas encore disponible. Verifiez l'autorisation du navigateur.";
      return;
    }

    this.recordedVideoChunks = [];
    this.videoTranscript = '';
    const recorderOptions = MediaRecorder.isTypeSupported('video/webm')
      ? { mimeType: 'video/webm' }
      : undefined;
    this.mediaRecorder = recorderOptions
      ? new MediaRecorder(this.videoStream, recorderOptions)
      : new MediaRecorder(this.videoStream);
    this.mediaRecorder.ondataavailable = event => {
      if (event.data?.size) {
        this.recordedVideoChunks.push(event.data);
      }
    };
    this.mediaRecorder.onstop = () => this.captureRecordedVideo();
    this.mediaRecorder.start();
    this.videoRecording = true;
    this.startSpeechTranscription();
  }

  stopVideoRecording() {
    if (this.mediaRecorder && this.videoRecording) {
      this.mediaRecorder.stop();
    }
    this.videoRecording = false;
    this.stopSpeechTranscription();
  }

  closeVideoRecorder() {
    if (this.videoRecording) {
      this.stopVideoRecording();
    }
    this.videoRecorderOpen = false;
    this.videoErrorMessage = '';
    this.videoSavedConfirmOpen = false;
    this.stopVideoRecorderTools();
  }

  closeVideoSavedConfirm() {
    this.videoSavedConfirmOpen = false;
  }

  openAttachmentPreview(attachment: ForumAttachment, event?: Event) {
    event?.preventDefault();
    this.selectedAttachment = attachment;
  }

  closeAttachmentPreview() {
    this.stopAttachmentPdfVoice();
    this.selectedAttachment = null;
  }

  isImageAttachment(attachment: ForumAttachment | null) {
    return !!attachment?.mimeType?.startsWith('image/');
  }

  isPdfAttachment(attachment: ForumAttachment | null) {
    return attachment?.mimeType === 'application/pdf' || attachment?.name.toLowerCase().endsWith('.pdf');
  }

  isOfficeAttachment(attachment: ForumAttachment | null) {
    const name = attachment?.name.toLowerCase() || '';
    return /\.(doc|docx|ppt|pptx|xls|xlsx)$/.test(name);
  }

  attachmentExtension(attachment: ForumAttachment | null) {
    const name = attachment?.name || '';
    const extension = name.includes('.') ? name.split('.').pop() : '';
    return extension ? extension.toUpperCase() : 'FICHIER';
  }

  attachmentSizeLabel(attachment: ForumAttachment | null) {
    const dataUrl = attachment?.dataUrl || '';
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const estimatedBytes = Math.max(0, Math.floor((base64.length * 3) / 4));
    if (!estimatedBytes) {
      return 'Taille non disponible';
    }
    if (estimatedBytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(estimatedBytes / 1024))} Ko`;
    }
    return `${(estimatedBytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  canPreviewAttachment(attachment: ForumAttachment | null) {
    return !!attachment && (
      attachment.kind === 'video' ||
      this.isImageAttachment(attachment) ||
      this.isPdfAttachment(attachment) ||
      attachment.mimeType?.startsWith('text/') ||
      this.isOfficeAttachment(attachment)
    );
  }

  trustedAttachmentUrl(attachment: ForumAttachment): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(attachment.dataUrl);
  }

  isAttachmentPdfVoiceActive(attachment: ForumAttachment | null) {
    return !!attachment && this.voicePlaybackService.isActive(this.attachmentVoiceKey(attachment));
  }

  async toggleAttachmentPdfVoice(attachment: ForumAttachment) {
    if (!this.isPdfAttachment(attachment) || this.attachmentPdfVoiceLoading) {
      return;
    }

    const voiceKey = this.attachmentVoiceKey(attachment);
    if (this.voicePlaybackService.isActive(voiceKey)) {
      this.stopAttachmentPdfVoice();
      return;
    }

    this.attachmentPdfVoiceLoading = true;
    this.attachmentPdfVoiceMessage = 'Preparation de la lecture...';
    try {
      const pdfText = await this.loadAttachmentPdfTextContent(attachment);
      const speechText = this.buildAttachmentPdfSpeechText(attachment, pdfText);
      const started = this.voicePlaybackService.toggle(voiceKey, speechText);
      this.attachmentPdfVoiceMessage = started
        ? 'Lecture du PDF en cours.'
        : "Lecture vocale indisponible dans ce navigateur.";
    } catch {
      this.attachmentPdfVoiceMessage = "Impossible de lire le texte de ce PDF.";
    } finally {
      this.attachmentPdfVoiceLoading = false;
    }
  }

  private stopAttachmentPdfVoice() {
    this.voicePlaybackService.stop();
    this.attachmentPdfVoiceLoading = false;
    this.attachmentPdfVoiceMessage = '';
  }

  private attachmentVoiceKey(attachment: ForumAttachment) {
    return `student-forum:attachment:${attachment.name}:${attachment.dataUrl.length}`;
  }

  private async loadAttachmentPdfTextContent(attachment: ForumAttachment): Promise<string> {
    const cacheKey = this.attachmentVoiceKey(attachment);
    if (this.attachmentPdfTextCache.has(cacheKey)) {
      return this.attachmentPdfTextCache.get(cacheKey) || '';
    }

    const response = await fetch(attachment.dataUrl);
    if (!response.ok) {
      throw new Error('pdf_fetch_failed');
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();
    }

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pagesText: string[] = [];

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) {
        pagesText.push(`Page ${pageIndex}. ${pageText}`);
      }
    }

    const mergedText = pagesText.join(' ').trim();
    this.attachmentPdfTextCache.set(cacheKey, mergedText);
    return mergedText;
  }

  private buildAttachmentPdfSpeechText(attachment: ForumAttachment, documentText: string) {
    const cleanedText = documentText.replace(/\s+/g, ' ').trim().slice(0, 12000);
    if (!cleanedText) {
      return `Document ${attachment.name}. Aucun texte lisible na ete detecte dans ce PDF.`;
    }
    return `Lecture du document ${attachment.name}. ${cleanedText}`;
  }

  private captureRecordedVideo() {
    const blob = new Blob(this.recordedVideoChunks, { type: 'video/webm' });
    if (blob.size > 8 * 1024 * 1024) {
      this.videoErrorMessage = 'Video trop volumineuse. Enregistrez une reponse plus courte.';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const transcript = this.videoTranscript.trim();
      this.chatAttachment = {
        kind: 'video',
        name: `reponse-video-${Date.now()}.webm`,
        mimeType: 'video/webm',
        dataUrl: String(reader.result || ''),
      };
      this.chatDraft = transcript
        ? `Reponse video transcrite : ${transcript}`
        : 'Reponse video enregistree.';
      this.videoPreviewUrl = String(reader.result || '');
      this.videoRecorderOpen = false;
      this.videoSavedConfirmOpen = true;
      this.stopVideoRecorderTools();
      this.focusChatComposer();
    };
    reader.readAsDataURL(blob);
  }

  private announceVideoInstructions() {
    const message =
      "Vous avez choisi une reponse video. Autorisez la camera et le micro, cliquez sur demarrer, expliquez votre reponse, puis cliquez sur arreter. La video et le texte seront joints au chat.";
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'fr-FR';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Voice guidance is optional.
    }
  }

  private startSpeechTranscription() {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      this.videoTranscript = 'Transcription automatique non disponible dans ce navigateur.';
      return;
    }

    this.speechRecognition = new SpeechRecognitionClass();
    this.speechRecognition.lang = 'fr-FR';
    this.speechRecognition.continuous = true;
    this.speechRecognition.interimResults = true;
    let finalTranscript = '';
    this.speechRecognition.onresult = (event: any) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const value = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) {
          finalTranscript += `${value} `;
        } else {
          interim += value;
        }
      }
      this.videoTranscript = `${finalTranscript}${interim}`.trim();
    };
    try {
      this.speechRecognition.start();
    } catch {
      this.videoTranscript = '';
    }
  }

  private stopSpeechTranscription() {
    try {
      this.speechRecognition?.stop();
    } catch {
      // Speech recognition is optional.
    }
    this.speechRecognition = null;
  }

  private stopVideoRecorderTools() {
    this.stopSpeechTranscription();
    this.videoStream?.getTracks().forEach(track => track.stop());
    this.videoStream = null;
    this.mediaRecorder = null;
    this.recordedVideoChunks = [];
  }

  private readonly handleWindowFocus = () => {
    this.loadRequests();
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.loadRequests();
    }
  };

  private loadRequests(options?: { retryCount?: number; silent?: boolean }) {
    const retryCount = Number(options?.retryCount || 0);
    const silent = options?.silent === true;

    if (!silent) {
      this.loading = true;
      this.errorMessage = '';
    }

    if (this.retryTimeoutId !== null) {
      window.clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }

    this.http
      .get<{
        stats?: { openQuestions?: number; repliesToday?: number; resolutionRate?: number };
        requests?: HelpRequest[];
      }>('/api/student/forum/requests')
      .subscribe({
        next: response => {
          const nextRequests = Array.isArray(response.requests)
            ? response.requests.map(request => ({
                ...request,
                authorAvatarDataUrl: String(request?.authorAvatarDataUrl || '').trim(),
                isMine: request?.isMine === true,
                lastResponderName: String(request?.lastResponderName || '').trim(),
              }))
            : [];
          this.processForumNotifications(nextRequests);
          this.requests = nextRequests;
          this.stats = {
            openQuestions: Number(response.stats?.openQuestions || 0),
            repliesToday: Number(response.stats?.repliesToday || 0),
            resolutionRate: Number(response.stats?.resolutionRate || 0),
          };
          this.cacheForumSnapshot();
          this.applyPendingConsultActionIfAny();
          this.loading = false;
        },
        error: (error) => {
          this.loading = false;
          const backendMessage = String(error?.error?.message || '').trim();
          this.errorMessage = backendMessage
            ? `Impossible de charger les demandes d'aide (${backendMessage}).`
            : "Impossible de charger les demandes d'aide.";

          if (retryCount > 0) {
            this.retryTimeoutId = window.setTimeout(() => {
              this.loadRequests({ retryCount: retryCount - 1, silent: true });
            }, 700);
          }
        },
      });
  }

  private restoreCachedForumSnapshot() {
    const raw = localStorage.getItem(this.forumCacheKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        requests?: HelpRequest[];
        stats?: { openQuestions?: number; repliesToday?: number; resolutionRate?: number };
      };

      if (Array.isArray(parsed.requests)) {
        this.requests = parsed.requests;
      }
      if (parsed.stats) {
        this.stats = {
          openQuestions: Number(parsed.stats.openQuestions || 0),
          repliesToday: Number(parsed.stats.repliesToday || 0),
          resolutionRate: Number(parsed.stats.resolutionRate || 0),
        };
      }
    } catch {
      localStorage.removeItem(this.forumCacheKey);
    }
  }

  private cacheForumSnapshot() {
    localStorage.setItem(
      this.forumCacheKey,
      JSON.stringify({
        requests: this.requests,
        stats: this.stats,
      }),
    );
  }

  private processForumNotifications(nextRequests: HelpRequest[]) {
    this.notificationService.syncCurrentUserNotifications();
    const previousById = this.forumPreviousById;

    if (!this.forumNotificationPrimed) {
      this.forumNotificationPrimed = true;
      this.forumPreviousById = new Map(nextRequests.map(request => [request.id, request]));
      return;
    }

    nextRequests.forEach(request => {
      const previous = previousById.get(request.id);
      if (!previous) {
        this.newOthersCount += 1;
        if (!request.isMine) {
          this.notificationService.addNotification({
            title: 'Nouvelle demande d aide',
            message: `${request.author} a fait une demande de l'aide.`,
            type: 'info',
            action: {
              kind: 'forum_request',
              requestId: request.id,
            },
          });
        }
      }

      const previousReplies = Number(previous?.replies || 0);
      const currentReplies = Number(request.replies || 0);
      const repliesDelta = Math.max(0, currentReplies - previousReplies);
      if (previous && repliesDelta > 0) {
        this.newOthersCount += repliesDelta;
      }

      if (request.isMine && repliesDelta > 0) {
        this.newMineCount += repliesDelta;
        const responderName = request.lastResponderName || 'Un etudiant';
        this.notificationService.addNotification({
          title: 'Nouvelle reponse',
          message: `${responderName} vous a repondu a votre question.`,
          type: 'success',
          action: {
            kind: 'forum_chat',
            requestId: request.id,
          },
        });
      }
    });

    this.forumPreviousById = new Map(nextRequests.map(request => [request.id, request]));
  }

  private readonly handleForumConsultEvent = () => {
    this.applyPendingConsultActionIfAny();
  };

  private applyPendingConsultActionIfAny() {
    const raw = localStorage.getItem(this.forumConsultStorageKey);
    if (!raw || this.requests.length === 0) {
      return;
    }

    try {
      const action = JSON.parse(raw) as { requestId?: string; openChat?: boolean };
      const requestId = String(action?.requestId || '').trim();
      if (!requestId) {
        localStorage.removeItem(this.forumConsultStorageKey);
        return;
      }

      const target = this.requests.find(request => request.id === requestId);
      if (!target) {
        return;
      }

      this.requestFilter = target.isMine ? 'mine' : 'others';
      this.consultHighlightId = target.id;

      if (this.consultHighlightTimeoutId !== null) {
        window.clearTimeout(this.consultHighlightTimeoutId);
      }
      this.consultHighlightTimeoutId = window.setTimeout(() => {
        this.consultHighlightId = '';
        this.consultHighlightTimeoutId = null;
      }, 3000);

      if (action?.openChat === true) {
        this.openChat(target);
      }

      localStorage.removeItem(this.forumConsultStorageKey);
    } catch {
      localStorage.removeItem(this.forumConsultStorageKey);
    }
  }

  private loadChatMessages(requestId: string, silent = false, retryIfIncomplete = true) {
    if (!silent) {
      this.chatLoading = true;
    }
    this.chatErrorMessage = '';

    this.http
      .get<{ request: HelpRequest; messages: ForumChatMessage[] }>(
        `/api/student/forum/requests/${requestId}/chat?t=${Date.now()}`,
      )
      .subscribe({
        next: response => {
          const authorName = this.openedChatRequest?.author || (response.request as any)?.author || 'Étudiant';
          const messageText = this.openedChatRequest?.message || (response.request as any)?.message || '';
          const reqTime = this.openedChatRequest?.time || (response.request as any)?.time || '10:00';
          const reqLevel = this.classLabel(this.openedChatRequest?.level || (response.request as any)?.level);

          const initialMessage: ForumChatMessage = {
            id: `initial-${requestId}`,
            senderType: 'request',
            senderName: authorName,
            senderAvatarDataUrl: this.openedChatRequest?.authorAvatarDataUrl || response.request?.authorAvatarDataUrl,
            senderLevel: reqLevel,
            text: messageText,
            time: reqTime,
          };

          const rawBackendMessages = Array.isArray(response.messages) ? response.messages : [];
          const repliesOnly = rawBackendMessages.filter(m => m.id !== initialMessage.id && m.text !== initialMessage.text);
          this.chatMessages = [initialMessage, ...repliesOnly];
          this.chatLoading = false;
          this.loadRequests({ silent: true });

          const expectedReplies = Number(this.openedChatRequest?.replies || response.request?.replies || 0);
          const loadedReplies = repliesOnly.length;
          if (retryIfIncomplete && expectedReplies > 0 && loadedReplies < expectedReplies) {
            window.setTimeout(() => {
              if (this.openedChatRequest?.id === requestId) {
                this.loadChatMessages(requestId, true, false);
              }
            }, 500);
          }
        },
        error: () => {
          this.chatLoading = false;
          // Keep whatever is currently in chatMessages so the user never sees an empty screen
        },
      });
  }

  private openSendSuccessModal(message: string, title = 'Demande envoyee') {
    this.showSendSuccessModal = true;
    this.sendSuccessMessage = message;
    this.sendSuccessTitle = title;

    if (this.successModalTimeoutId !== null) {
      window.clearTimeout(this.successModalTimeoutId);
    }

    if (title !== 'Demande envoyee') {
      return;
    }

    this.successModalTimeoutId = window.setTimeout(() => {
      this.closeSendSuccessModal();
    }, 2200);
  }

  private normalizeSearchText(value: string) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  announceHelpTopic(topic: 'note' | 'subject' | 'message' | 'submitHelp') {
    const messages: Record<typeof topic, string> = {
      note: "Cette demande sera envoyee a tous les etudiants de la plateforme. Ceux qui souhaitent vous aider pourront ouvrir un chat prive avec vous.",
      subject: "Champ sujet. Saisissez un titre court et clair pour votre demande d'aide.",
      message: "Champ message. Decrivez votre probleme en detail afin que les autres etudiants puissent mieux vous aider.",
      submitHelp: "Bouton envoyer la demande. Il envoie votre demande d'aide a la plateforme puis ferme la fenetre.",
    };

    const message = messages[topic];
    this.screenReaderMessage = message;
    this.voicePlaybackService.toggle(`student-forum:${topic}`, message);
  }

  isHelpVoiceActive(topic: 'note' | 'subject' | 'message' | 'submitHelp') {
    return this.voicePlaybackService.isActive(`student-forum:${topic}`);
  }

  toggleHelpDictation(field: 'subject' | 'message') {
    this.voiceDictationService.toggle(`student-forum:${field}`, transcript => {
      if (field === 'subject') {
        this.helpSubject = this.mergeDictationText(this.helpSubject, transcript);
        return;
      }

      this.helpMessage = this.mergeDictationText(this.helpMessage, transcript);
    });
  }

  isHelpDictationActive(field: 'subject' | 'message') {
    return this.voiceDictationService.isActive(`student-forum:${field}`);
  }

  avatarInitials(name: string) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length === 0) {
      return 'U';
    }

    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }

    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }

  private stopHelpVoiceTools() {
    this.voiceDictationService.stop();
    this.voicePlaybackService.stop();
  }

  private mergeDictationText(currentValue: string, transcript: string): string {
    return `${currentValue || ''}${currentValue ? ' ' : ''}${transcript}`.trim();
  }
}
