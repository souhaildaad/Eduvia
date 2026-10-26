import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { VoicePlaybackService } from '../../../services/voice-playback.service';

type QuizQuestionOption = {
  label: string;
  text: string;
};

type QuizQuestion = {
  id: string;
  prompt: string;
  type: 'single' | 'multiple';
  options: QuizQuestionOption[];
  correctAnswers: string[];
  explanation?: string;
};

type QuizContent = {
  _id: string;
  title: string;
  description?: string;
  courseId?: string;
  chapterId?: string;
  partId?: string;
  fileUrl?: string;
  fileName?: string;
  dueDate?: string;
  quizMode?: string;
  quizDifficulty?: string;
  quizDurationMinutes?: number;
  quizAttempts?: number;
  quizPassingScore?: number;
  quizQuestions: QuizQuestion[];
};

type QuizResult = {
  score: number;
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
};

type StoredQuizAttempt = {
  result: QuizResult;
  answers: Record<string, string[]>;
  submittedAt: string;
  quizFingerprint?: string;
};

@Component({
  selector: 'app-course-quiz',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, MatIconModule],
  templateUrl: './course-quiz.html',
  styleUrl: './course-quiz.css',
})
export class CourseQuiz implements OnInit, OnChanges {
  @Input() studentLevel: 'debutant' | 'intermediaire' | 'avance' = 'debutant';
  @Input() selectedQuizId: string | null = null;
  @Input() standaloneQuizData: any | null = null;
  @Input() standalone = false;
  @Output() closed = new EventEmitter<void>();
  @Output() quizSubmitted = new EventEmitter<string>();
  quizzes: QuizContent[] = [];
  selectedQuiz: QuizContent | null = null;
  answers: Record<string, string[]> = {};
  loading = false;
  error = '';
  submitted = false;
  result: QuizResult | null = null;
  showResultModal = false;
  remainingSeconds: number | null = null;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private syncedQuizIds = new Set<string>();
  screenReaderMessage = '';
  readonly backendBaseUrl =
    `${window.location.protocol}//${window.location.hostname}:3000`;

  constructor(
    private http: HttpClient,
    private voicePlaybackService: VoicePlaybackService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    if (this.standalone && this.standaloneQuizData) {
      this.bootstrapStandaloneQuiz(this.standaloneQuizData);
      return;
    }

    this.loadQuizzes();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['standaloneQuizData'] && this.standalone && this.standaloneQuizData) {
      this.bootstrapStandaloneQuiz(this.standaloneQuizData);
      return;
    }

    if (changes['selectedQuizId'] && !changes['selectedQuizId'].firstChange) {
      this.tryOpenSelectedQuiz();
    }
  }

  loadQuizzes() {
    this.loading = true;
    this.error = '';
    const className = (localStorage.getItem('current_user_class') || '').trim();
    const query = new URLSearchParams({
      level: this.studentLevel,
      ...(className ? { className } : {}),
    });

    this.http.get<any[]>(`/api/student/quizzes?${query.toString()}`).subscribe({
      next: data => {
        this.quizzes = data
          .map(item => this.mapQuiz(item))
          .filter(
            (item): item is QuizContent =>
              !!item &&
              item.quizQuestions.length > 0 &&
              this.matchesStudentLevel(item.quizDifficulty),
          );
        this.syncExistingPassedQuizzes();
        this.tryOpenSelectedQuiz();
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.error = "Impossible de charger les quiz pour l'instant.";
        this.cdr.detectChanges();
      },
    });
  }

  startQuiz(quiz: QuizContent) {
    const previousAttempt = this.previousAttempt(quiz);
    const canStartNewAttempt = this.canStartAttempt(quiz);
    if (!canStartNewAttempt) {
      if (previousAttempt) {
        this.openAttemptReview(quiz, previousAttempt);
      }
      return;
    }

    this.registerAttemptStart(quiz);
    this.selectedQuiz = quiz;
    this.answers = {};
    this.submitted = false;
    this.result = null;
    this.showResultModal = false;
    this.startTimerForQuiz(quiz);
  }

  closeQuiz() {
    this.stopTimer();
    if (this.standalone) {
      this.closed.emit();
    }
    this.selectedQuiz = null;
    this.answers = {};
    this.submitted = false;
    this.result = null;
    this.showResultModal = false;
  }

  toggleAnswer(question: QuizQuestion, optionLabel: string, checked: boolean) {
    if (!this.selectedQuiz || this.submitted) {
      return;
    }

    const currentAnswers = this.answers[question.id] || [];

    if (question.type === 'single') {
      this.answers[question.id] = [optionLabel];
      return;
    }

    this.answers[question.id] = checked
      ? [...currentAnswers, optionLabel]
      : currentAnswers.filter(answer => answer !== optionLabel);
  }

  isChecked(question: QuizQuestion, optionLabel: string): boolean {
    return (this.answers[question.id] || []).includes(optionLabel);
  }

  submitQuiz() {
    if (!this.selectedQuiz) {
      return;
    }
    if (this.submitted) {
      return;
    }

    let correctCount = 0;

    this.selectedQuiz.quizQuestions.forEach(question => {
      const selectedAnswers = [...(this.answers[question.id] || [])].sort();
      const expectedAnswers = [...question.correctAnswers].sort();
      const isCorrect =
        selectedAnswers.length === expectedAnswers.length &&
        selectedAnswers.every((answer, index) => answer === expectedAnswers[index]);

      if (isCorrect) {
        correctCount += 1;
      }
    });

    const totalQuestions = this.selectedQuiz.quizQuestions.length;
    const score = Math.round((correctCount / totalQuestions) * 100);
    const passed = score >= (this.selectedQuiz.quizPassingScore || 70);

    this.stopTimer();
    this.submitted = true;
    this.result = {
      score,
      correctCount,
      totalQuestions,
      passed,
    };
    this.showResultModal = true;

    localStorage.setItem(
      this.storageKey(this.selectedQuiz._id),
      JSON.stringify({
        result: this.result,
        answers: this.answers,
        submittedAt: new Date().toISOString(),
        quizFingerprint: this.quizFingerprint(this.selectedQuiz),
      } satisfies StoredQuizAttempt),
    );
    this.registerAttemptSubmit(this.selectedQuiz);
    this.syncQuizProgressToBackend(this.selectedQuiz._id, this.result);

    this.quizSubmitted.emit(this.selectedQuiz._id);
  }

  closeResultModal() {
    this.showResultModal = false;
    this.closeQuiz();
  }

  downloadSolvedQuiz() {
    if (!this.selectedQuiz || !this.result) {
      return;
    }

    const lines = [
      `Titre du quiz: ${this.selectedQuiz.title}`,
      `Cours: ${this.selectedQuiz.courseId || '-'}`,
      `Chapitre: ${this.selectedQuiz.chapterId || '-'}`,
      `Date de soumission: ${new Date().toLocaleString('fr-FR')}`,
      `Score: ${this.result.score}%`,
      `Reponses justes: ${this.result.correctCount} / ${this.result.totalQuestions}`,
      `Statut: ${this.result.passed ? 'Quiz reussi' : 'Quiz non reussi'}`,
      '',
      'Details des reponses:',
      '',
    ];

    this.selectedQuiz.quizQuestions.forEach((question, index) => {
      lines.push(`${index + 1}. ${question.prompt}`);
      lines.push(`Type: ${question.type === 'multiple' ? 'Choix multiples' : 'Choix unique'}`);

      question.options.forEach(option => {
        lines.push(`- ${option.label}. ${option.text}`);
      });

      lines.push(`Votre reponse: ${this.selectedAnswerLabels(question)}`);
      lines.push(`Bonne reponse: ${question.correctAnswers.join(', ')}`);
      if (question.explanation) {
        lines.push(`Explication: ${question.explanation}`);
      }
      lines.push(`Resultat: ${this.questionAnsweredCorrectly(question) ? 'Correct' : 'Incorrect'}`);
      lines.push('');
    });

    const pdfBytes = this.buildPdfDocument(lines);
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfBuffer).set(pdfBytes);
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeTitle = (this.selectedQuiz.title || 'quiz')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    anchor.href = url;
    anchor.download = `${safeTitle || 'quiz'}-reponses.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  previousResult(quiz: QuizContent): QuizResult | null {
    return this.previousAttempt(quiz)?.result || null;
  }

  hasReachedAttemptLimit(quiz: QuizContent): boolean {
    return !this.canStartAttempt(quiz);
  }

  primaryActionLabel(quiz: QuizContent): string {
    if (this.canStartAttempt(quiz)) {
      return 'Commencer';
    }

    return this.previousAttempt(quiz) ? 'Consulter' : 'Tentatives epuisees';
  }

  primaryActionDisabled(quiz: QuizContent): boolean {
    return !this.canStartAttempt(quiz) && !this.previousAttempt(quiz);
  }

  questionAnsweredCorrectly(question: QuizQuestion): boolean {
    const selectedAnswers = [...(this.answers[question.id] || [])].sort();
    const expectedAnswers = [...question.correctAnswers].sort();

    return (
      selectedAnswers.length === expectedAnswers.length &&
      selectedAnswers.every((answer, index) => answer === expectedAnswers[index])
    );
  }

  selectedAnswerLabels(question: QuizQuestion): string {
    const selectedAnswers = this.answers[question.id] || [];
    return selectedAnswers.length > 0 ? selectedAnswers.join(', ') : 'Aucune reponse';
  }

  downloadUrl(quiz: QuizContent): string | null {
    if (!quiz.fileUrl) {
      return null;
    }

    return quiz.fileUrl.startsWith('http')
      ? quiz.fileUrl
      : `${this.backendBaseUrl}${quiz.fileUrl}`;
  }

  displayDurationMinutes(quiz: QuizContent): number | null {
    const duration = Number(quiz?.quizDurationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    return Math.floor(duration);
  }

  displayRemainingTime(): string {
    if (this.remainingSeconds === null || this.remainingSeconds < 0) {
      return '--:--';
    }

    const total = Math.max(0, this.remainingSeconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  announceQuizSummary(quiz: QuizContent) {
    const parts = [
      `Quiz ${quiz.title}.`,
      quiz.courseId ? `Cours ${quiz.courseId}.` : '',
      quiz.chapterId ? `Chapitre ${quiz.chapterId}.` : '',
      `Questions ${quiz.quizQuestions.length}.`,
      `Score minimum ${quiz.quizPassingScore || 70} pourcent.`,
      `Tentatives ${quiz.quizAttempts || 1}.`,
      this.displayDurationMinutes(quiz) ? `Chronometre ${this.displayDurationMinutes(quiz)} minutes.` : '',
    ].filter(Boolean);

    const message = parts.join(' ');
    this.screenReaderMessage = message;
    this.voicePlaybackService.toggle(`course-quiz:summary:${quiz._id}`, message);
  }

  isQuizSummaryVoiceActive(quiz: QuizContent) {
    return this.voicePlaybackService.isActive(`course-quiz:summary:${quiz._id}`);
  }

  announceQuestion(question: QuizQuestion, index: number) {
    const optionsText = question.options
      .map(option => `${option.label}. ${option.text}.`)
      .join(' ');
    const message =
      `Question ${index + 1}. ${question.type === 'multiple' ? 'Choix multiples.' : 'Choix unique.'} ` +
      `${question.prompt} ${optionsText}`;

    this.screenReaderMessage = message;
    this.voicePlaybackService.toggle(`course-quiz:question:${question.id}`, message);
  }

  isQuestionVoiceActive(question: QuizQuestion) {
    return this.voicePlaybackService.isActive(`course-quiz:question:${question.id}`);
  }

  openSourceFile(quiz: QuizContent) {
    if (!this.submitted) {
      return;
    }

    const url = this.downloadUrl(quiz);
    if (!url) {
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private mapQuiz(item: any): QuizContent | null {
    if (!Array.isArray(item.quizQuestions)) {
      return null;
    }

    const resolvedQuizId = String(item._id || item.id || '').trim();
    if (!resolvedQuizId) {
      return null;
    }

    return {
      _id: resolvedQuizId,
      title: item.title || 'Quiz sans titre',
      description: item.description || '',
      courseId: item.courseId || '',
      chapterId: item.chapterId || '',
      partId: item.partId || '',
      fileUrl: item.fileUrl || undefined,
      fileName: item.fileName || undefined,
      dueDate: item.dueDate || undefined,
      quizMode: item.quizMode || 'generated',
      quizDifficulty: item.quizDifficulty || undefined,
      quizDurationMinutes: item.quizDurationMinutes || undefined,
      quizAttempts: item.quizAttempts || 1,
      quizPassingScore: item.quizPassingScore || 70,
      quizQuestions: item.quizQuestions,
    };
  }

  private matchesStudentLevel(difficulty?: string): boolean {
    const normalized = this.normalizeLevel(difficulty);
    if (!normalized) {
      return true;
    }

    return normalized === this.studentLevel;
  }

  private normalizeLevel(value?: string): 'debutant' | 'intermediaire' | 'avance' | null {
    const normalized = (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (normalized.startsWith('deb') || normalized.includes('facile')) {
      return 'debutant';
    }
    if (normalized.startsWith('int') || normalized.includes('moyen')) {
      return 'intermediaire';
    }
    if (normalized.startsWith('ava') || normalized.includes('difficile')) {
      return 'avance';
    }

    return null;
  }

  private storageKey(quizId: string): string {
    const currentUserEmail = (localStorage.getItem('current_user_email') || '')
      .trim()
      .toLowerCase();

    return currentUserEmail
      ? `eduvia-quiz-result-${currentUserEmail}-${quizId}`
      : `eduvia-quiz-result-${quizId}`;
  }

  private currentStorageOwner(): string {
    return (localStorage.getItem('current_user_email') || '')
      .trim()
      .toLowerCase();
  }

  private attemptsStorageKey(quizId: string): string {
    return `${this.storageKey(quizId)}-attempts`;
  }

  private readAttemptCounters(quiz: QuizContent): { started: number; submitted: number } {
    const raw = localStorage.getItem(this.attemptsStorageKey(quiz._id));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { started?: number; submitted?: number };
        const started = Number(parsed?.started || 0);
        const submitted = Number(parsed?.submitted || 0);
        return {
          started: Number.isFinite(started) && started >= 0 ? Math.floor(started) : 0,
          submitted: Number.isFinite(submitted) && submitted >= 0 ? Math.floor(submitted) : 0,
        };
      } catch {
        // Fallback below.
      }
    }

    const legacySubmission = this.previousAttempt(quiz);
    if (legacySubmission) {
      return { started: 1, submitted: 1 };
    }

    return { started: 0, submitted: 0 };
  }

  private writeAttemptCounters(quiz: QuizContent, counters: { started: number; submitted: number }) {
    localStorage.setItem(
      this.attemptsStorageKey(quiz._id),
      JSON.stringify({
        started: Math.max(0, Math.floor(counters.started)),
        submitted: Math.max(0, Math.floor(counters.submitted)),
      }),
    );
  }

  private maxAttempts(quiz: QuizContent): number {
    const attempts = Number(quiz?.quizAttempts);
    if (!Number.isFinite(attempts) || attempts <= 0) {
      return 1;
    }

    return Math.floor(attempts);
  }

  private canStartAttempt(quiz: QuizContent): boolean {
    const counters = this.readAttemptCounters(quiz);
    return counters.started < this.maxAttempts(quiz);
  }

  private registerAttemptStart(quiz: QuizContent) {
    const counters = this.readAttemptCounters(quiz);
    this.writeAttemptCounters(quiz, {
      started: counters.started + 1,
      submitted: counters.submitted,
    });
  }

  private registerAttemptSubmit(quiz: QuizContent) {
    const counters = this.readAttemptCounters(quiz);
    this.writeAttemptCounters(quiz, {
      started: counters.started,
      submitted: counters.submitted + 1,
    });
  }

  private startTimerForQuiz(quiz: QuizContent) {
    this.stopTimer();

    const durationMinutes = this.displayDurationMinutes(quiz);
    if (!durationMinutes) {
      this.remainingSeconds = null;
      return;
    }

    this.remainingSeconds = durationMinutes * 60;
    this.timerHandle = setInterval(() => {
      if (this.remainingSeconds === null) {
        return;
      }

      if (this.remainingSeconds <= 1) {
        this.remainingSeconds = 0;
        this.cdr.detectChanges();
        this.submitQuiz();
        return;
      }

      this.remainingSeconds -= 1;
      this.cdr.detectChanges();
    }, 1000);
  }

  private stopTimer() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private legacyStorageKey(quizId: string): string {
    return `eduvia-quiz-result-${quizId}`;
  }

  private previousAttempt(quiz: QuizContent): StoredQuizAttempt | null {
    let raw = localStorage.getItem(this.storageKey(quiz._id));

    if (!raw) {
      raw = localStorage.getItem(this.legacyStorageKey(quiz._id));
    }

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StoredQuizAttempt | QuizResult;
      if ('result' in parsed && 'answers' in parsed) {
        if (
          parsed.quizFingerprint &&
          parsed.quizFingerprint !== this.quizFingerprint(quiz)
        ) {
          return null;
        }

        if (!parsed.quizFingerprint) {
          return null;
        }

        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  }

  private quizFingerprint(quiz: QuizContent): string {
    const questionSignature = quiz.quizQuestions
      .map(question => {
        const options = question.options
          .map(option => `${option.label}:${option.text}`)
          .join('|');
        const answers = [...question.correctAnswers].sort().join('|');
        return `${question.id}::${question.prompt}::${options}::${answers}`;
      })
      .join('##');

    return [
      quiz._id,
      quiz.title,
      quiz.quizPassingScore || 70,
      quiz.quizAttempts || 1,
      questionSignature,
    ].join('||');
  }

  private buildPdfDocument(lines: string[]): Uint8Array {
    const fontSize = 12;
    const lineHeight = 16;
    const pageWidth = 595;
    const pageHeight = 842;
    const marginLeft = 50;
    const topY = 790;
    const bottomMargin = 60;
    const usableWidth = 80;
    const wrappedLines = lines.flatMap(line => this.wrapPdfLine(line, usableWidth));
    const linesPerPage = Math.max(1, Math.floor((topY - bottomMargin) / lineHeight));
    const pages: string[][] = [];

    for (let index = 0; index < wrappedLines.length; index += linesPerPage) {
      pages.push(wrappedLines.slice(index, index + linesPerPage));
    }

    if (pages.length === 0) {
      pages.push(['Resultat du quiz indisponible.']);
    }

    const objects: string[] = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');

    const pageObjectNumbers = pages.map((_, pageIndex) => 4 + pageIndex * 2);
    objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    pages.forEach((pageLines, pageIndex) => {
      const pageObjectNumber = 4 + pageIndex * 2;
      const contentObjectNumber = pageObjectNumber + 1;
      const contentStream = this.buildPdfContentStream(
        pageLines,
        marginLeft,
        topY,
        fontSize,
        lineHeight,
      );

      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      );
      objects.push(
        `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
      );
    });

    let pdf = '%PDF-1.4\n';
    const offsets = [0];

    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    offsets.slice(1).forEach(offset => {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Uint8Array.from(Array.from(pdf).map(character => character.charCodeAt(0) & 0xff));
  }

  private buildPdfContentStream(
    lines: string[],
    marginLeft: number,
    topY: number,
    fontSize: number,
    lineHeight: number,
  ): string {
    const escapedLines = lines.map(line => this.escapePdfText(line));
    const textLines = escapedLines
      .map((line, index) => {
        if (index === 0) {
          return `${marginLeft} ${topY} Td (${line}) Tj`;
        }

        return `0 -${lineHeight} Td (${line}) Tj`;
      })
      .join('\n');

    return `BT\n/F1 ${fontSize} Tf\n${textLines}\nET`;
  }

  private wrapPdfLine(line: string, maxChars: number): string[] {
    const normalized = (line || '').trimEnd();
    if (!normalized) {
      return [' '];
    }

    const words = normalized.split(/\s+/);
    const result: string[] = [];
    let current = '';

    words.forEach(word => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) {
        current = candidate;
        return;
      }

      if (current) {
        result.push(current);
      }

      current = word;
    });

    if (current) {
      result.push(current);
    }

    return result;
  }

  private escapePdfText(value: string): string {
    return (value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private openAttemptReview(quiz: QuizContent, attempt: StoredQuizAttempt) {
    this.stopTimer();
    this.remainingSeconds = null;
    this.selectedQuiz = quiz;
    this.answers = attempt.answers || {};
    this.submitted = true;
    this.result = attempt.result;
    this.showResultModal = false;
  }

  private bootstrapStandaloneQuiz(item: any) {
    const mapped = this.mapQuiz(item);
    this.loading = false;
    this.error = '';

    if (!mapped || mapped.quizQuestions.length === 0) {
      this.quizzes = [];
      this.selectedQuiz = null;
      this.error = "Impossible de charger ce quiz pour le moment.";
      return;
    }

    this.quizzes = [mapped];
    this.syncExistingPassedQuizzes();
    this.startQuiz(mapped);
  }

  private syncExistingPassedQuizzes() {
    this.quizzes.forEach(quiz => {
      const previousAttempt = this.previousAttempt(quiz);
      if (previousAttempt?.result) {
        this.syncQuizProgressToBackend(quiz._id, previousAttempt.result);
      }
    });
  }

  private syncQuizProgressToBackend(quizId: string, result: QuizResult | null) {
    const normalizedQuizId = String(quizId || '').trim();
    if (
      !normalizedQuizId ||
      !result ||
      !this.isMongoObjectId(normalizedQuizId) ||
      this.syncedQuizIds.has(normalizedQuizId)
    ) {
      return;
    }

    this.syncedQuizIds.add(normalizedQuizId);
    const quiz = this.quizzes.find(item => item._id === normalizedQuizId) || this.selectedQuiz;
    this.http
      .post('/api/student/progress', {
        contentId: normalizedQuizId,
        status: result.passed ? 'passed' : 'completed',
        score: result.score ?? 0,
        submittedAt: new Date().toISOString(),
        questionAttempts: quiz ? this.buildQuestionAttemptsPayload(quiz) : [],
      })
      .subscribe({
        error: () => {
          this.syncedQuizIds.delete(normalizedQuizId);
        },
      });
  }

  private isMongoObjectId(value: string) {
    return /^[a-f0-9]{24}$/i.test(String(value || '').trim());
  }

  private buildQuestionAttemptsPayload(quiz: QuizContent) {
    return quiz.quizQuestions.map(question => {
      const selectedLabels = this.answers[question.id] || [];
      const selectedAnswerText = question.options
        .filter(option => selectedLabels.includes(option.label))
        .map(option => option.text)
        .join(', ');

      return {
        questionId: question.id,
        prompt: question.prompt,
        explanation: question.explanation || '',
        courseId: quiz.courseId || '',
        chapterId: quiz.chapterId || '',
        selectedAnswers: selectedLabels,
        selectedAnswerText,
        correctAnswers: question.correctAnswers,
        isCorrect: this.questionAnsweredCorrectly(question),
      };
    });
  }

  private tryOpenSelectedQuiz() {
    if (!this.selectedQuizId) {
      return;
    }

    const targetQuiz = this.quizzes.find(quiz => quiz._id === this.selectedQuizId);
    if (!targetQuiz) {
      return;
    }

    if (this.selectedQuiz?._id === targetQuiz._id) {
      return;
    }

    this.startQuiz(targetQuiz);
  }
}

