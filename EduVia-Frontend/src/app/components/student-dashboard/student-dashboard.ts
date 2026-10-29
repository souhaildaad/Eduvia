import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Chatbot } from '../student/chatbot/chatbot';
import { ClubSuggestions } from '../student/club-suggestions/club-suggestions';
import { CourseQuiz } from '../student/course-quiz/course-quiz';
import { NotificationBell } from '../notification-bell/notification-bell';
import { StudentForum } from '../student/student-forum/student-forum';
import { TeacherProfileSettingsComponent } from '../teacher/teacher-profile-settings/teacher-profile-settings';
import { VoicePlaybackService } from '../../services/voice-playback.service';
import { NotificationService } from '../../services/notification.service';
import { environment } from '../../../environments/environment';
import { AiAssessment } from '../student/ai-assessment/ai-assessment';
import { ReclamationsPanelComponent } from '../shared/reclamations-panel/reclamations-panel';

type StudentLevel = 'debutant' | 'intermediaire' | 'avance';
type StudentTab =
  | 'parcours'
  | 'planificateur'
  | 'recommendation'
  | 'portfolio'
  | 'communaute'
  | 'clubs'
  | 'assistant'
  | 'meet'
  | 'flashcards'
  | 'classement'
  | 'stages'
  | 'reclamations'
  | 'parametres';

type PlannerViewMode = 'day' | 'week' | 'month';
type PlannerSection = 'calendar' | 'tasks';
type PlannerEventType = 'exam' | 'test';
type PlannerTaskScope = 'day' | 'week';
type PlannerDeleteTarget = { kind: 'event' | 'task'; id: string; title: string } | null;

type PlannerEvent = {
  id: string;
  title: string;
  type: PlannerEventType;
  date: string;
  time: string;
  notes: string;
  reminderEnabled?: boolean;
  reminderEnabledAt?: string | null;
  reminded?: boolean;
  remindedAt?: string | null;
};

type PlannerTask = {
  id: string;
  title: string;
  scope: PlannerTaskScope;
  date: string;
  notes: string;
  completed: boolean;
};

type PlannerDay = {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  events: PlannerEvent[];
  tasks: PlannerTask[];
};

type ContentItem = {
  _id: string;
  type: string;
  title: string;
  description?: string;
  courseId?: string;
  chapterId?: string;
  partId?: string;
  teacherName?: string;
  teacherEmail?: string;
  teacherAvatarDataUrl?: string;
  fileUrl?: string;
  fileName?: string;
  source?: string;
  dueDate?: string;
  quizMode?: string;
  quizDifficulty?: string;
  quizDurationMinutes?: number;
  quizAttempts?: number;
  quizPassingScore?: number;
  quizQuestions?: unknown[];
  visibleToAllClasses?: boolean;
  visibleToClasses?: string[];
  isActive?: boolean;
  progressStatus?: string;
  isCompleted?: boolean;
  isLocked?: boolean;
  canMarkCompleted?: boolean;
  completionButton?: {
    label: string;
    variant: 'neutral' | 'success';
    disabled: boolean;
  };
  recommendationReason?: string;
  focusLabels?: string[];
  focusKeywords?: string[];
  recommendationScore?: number;
  isExternal?: boolean;
  externalUrl?: string;
  externalProvider?: string;
  isAiGenerated?: boolean;
  category?: 'platform' | 'internet' | 'ai';
};

type RecommendationItem = {
  id: string;
  icon: string;
  title: string;
  type: 'Cours' | 'Video' | 'Quiz';
  level: string;
  duration: string;
  reason: string;
  contentType: string;
  description?: string;
  fileUrl?: string;
  source?: string;
  courseId?: string;
  chapterId?: string;
  partId?: string;
  teacherName?: string;
  teacherAvatarDataUrl?: string;
  fileName?: string;
  dueDate?: string;
  quizMode?: string;
  quizDifficulty?: string;
  quizDurationMinutes?: number;
  quizPassingScore?: number;
  quizQuestions?: unknown[];
  quizAttempts?: number;
  isCompleted?: boolean;
  isLocked?: boolean;
  canMarkCompleted?: boolean;
  completionButtonLabel?: string;
  completionButtonVariant?: 'neutral' | 'success';
  completionButtonDisabled?: boolean;
  focusLabels?: string[];
  focusKeywords?: string[];
  recommendationScore?: number;
  isExternal?: boolean;
  externalUrl?: string;
  externalProvider?: string;
  isAiGenerated?: boolean;
  category?: 'platform' | 'internet' | 'ai';
};

type WeakAcquisItem = {
  key: string;
  label: string;
  severity: number;
  severityLabel: string;
  incorrectQuestions: number;
  totalQuestions: number;
  successRate: number;
  keywords: string[];
  courseId?: string;
  chapterId?: string;
  reason: string;
};

type RecommendationAnalysis = {
  weakAcquis: WeakAcquisItem[];
  recommendedContents: ContentItem[];
  summary: {
    attemptsAnalyzed: number;
    averageScore: number;
    lastScore: number;
    lastQuizTitle: string;
    lastSubmittedAt: string;
    weakAcquisCount: number;
    recommendationCount: number;
    updatedAt: string;
  };
};

type CourseResourceFolder = {
  key: 'documents' | 'videos' | 'quizzes';
  title: string;
  icon: string;
  items: RecommendationItem[];
};

type CourseResourcePart = {
  title: string;
  folders: CourseResourceFolder[];
};

type CourseResourceChapter = {
  title: string;
  parts: CourseResourcePart[];
};

type StoredQuizAttempt = {
  score?: number;
  passed?: boolean;
};

type PortfolioRemediationAttempt = {
  score: number;
  passed: boolean;
  submittedAt: string;
};

type LearningPathCourse = {
  id: string;
  title: string;
  description: string;
  level: string;
  duration: string;
  progress: number;
};

type CourseCatalogItem = {
  id: string;
  title: string;
  description: string;
  level: string;
  chapters: number;
  hours: number;
  students: number;
  rating: number;
  teacher: string;
  teacherAvatarDataUrl?: string;
  progress: number;
  completedItems: number;
  totalItems: number;
  progressLabel: string;
  coverStyle: string;
  accent: string;
};

type DashboardProgress = {
  globalProgress?: number;
  completedContentIds?: string[];
  totals?: {
    completedMaterials?: number;
    totalMaterials?: number;
  };
};

type OverviewCard = {
  title: string;
  icon: string;
  accent: 'blue' | 'orange' | 'green' | 'yellow';
  value: string;
  subtitle: string;
  progress: number | null;
};

type SkillDetail = {
  label: string;
  value: number;
  color: string;
};

type FlashcardDifficulty = 'facile' | 'intermediaire' | 'difficile';

type FlashcardItem = {
  id: string;
  question: string;
  answer: string;
  subject: string;
  difficulty: FlashcardDifficulty;
  userAnswer?: string;
  revealed?: boolean;
  correct?: boolean;
};

type LeaderboardLevelFilter = 'tous' | StudentLevel;

type LeaderboardStudent = {
  id: string;
  rank: number;
  name: string;
  avatarDataUrl?: string;
  levelKey: StudentLevel;
  level: string;
  className: string;
  points: number;
  courses: number;
  average: number;
  isCurrentStudent?: boolean;
};

type LeaderboardPayload = {
  className: string;
  week: {
    startsAt: string;
    endsAt: string;
    label: string;
  };
  topStudents: LeaderboardStudent[];
  students: LeaderboardStudent[];
  currentStudent?: LeaderboardStudent | null;
  encouragement?: {
    pointsToNextRank: number;
    targetRank: number;
    message: string;
  };
};

type PortfolioCourseSummary = {
  courseTitle: string;
  level: string;
  resourceCount: number;
  quizCount: number;
  teacherName: string;
  overview: string;
  notions: Array<{ notion: string; explanation: string; importance: string; example: string }>;
  details: Array<{ title: string; explanation: string; bullets: string[] }>;
  nextActions: string[];
  revisionPlan: Array<{ step: number; text: string }>;
  glossary: string[];
  generatedAt: string;
};

type AssessmentResult = {
  level: StudentLevel;
  levelLabel: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  completedAt: string;
};

type CourseCompletionDialog = {
  visible: boolean;
  courseTitle: string;
  chaptersCompleted: number;
  quizzesPassed: number;
  averageScore: number;
};

type InternshipOpportunity = {
  _id?: string;
  title: string;
  company: string;
  city: string;
  domain: string;
  duration: string;
  level: string;
  email: string;
  phone: string;
  website?: string;
  deadline: string;
  description: string;
  skills: string[];
  address: string;
  latitude?: number | null;
  longitude?: number | null;
};

type MeetSession = {
  _id?: string;
  title: string;
  audience: 'student' | 'teacher';
  status: 'live' | 'scheduled' | 'ended';
  roomName: string;
  joinUrl: string;
  hostName: string;
  hostEmail?: string;
  topic: string;
  participants: number;
  capacity: number;
  scheduledAt: string;
  recordingEnabled?: boolean;
  replayUrl?: string;
  replayTitle?: string;
  replayDuration?: string;
  replaySubject?: string;
};

@Component({
  selector: 'app-student-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatButtonModule,
    MatIconModule,
    AiAssessment,
    CourseQuiz,
    StudentForum,
    ClubSuggestions,
    Chatbot,
    NotificationBell,
    TeacherProfileSettingsComponent,
    ReclamationsPanelComponent,
  ],
  templateUrl: './student-dashboard.html',
  styleUrl: './student-dashboard.css',
})
export class StudentDashboard implements OnInit, OnDestroy {
  @Output() logout = new EventEmitter<void>();
  @Input() studentLevel: StudentLevel = 'debutant';

  studentProfile = {
    name: 'Marie Dubois',
    email: '',
    className: '',
    levelLabel: 'Debutant',
    learningStyle: 'Visuel & Pratique',
    avatarDataUrl: '',
  };

  tabs: { id: StudentTab; label: string }[] = [
    { id: 'parcours', label: 'Parcours' },
    { id: 'recommendation', label: 'Recommendation' },
    { id: 'portfolio', label: 'Portfolio' },
    { id: 'planificateur', label: 'Planificateur' },
    { id: 'communaute', label: 'Communaute' },
    { id: 'clubs', label: 'Clubs' },
    { id: 'assistant', label: 'Assistant IA' },
    { id: 'meet', label: 'Meet' },
    { id: 'flashcards', label: 'Flashcards' },
    { id: 'classement', label: 'Classement' },
    { id: 'stages', label: 'Stages & Opportunites' },
    { id: 'reclamations', label: 'Reclamations' },
    { id: 'parametres', label: 'Parametres' },
  ];

  activeTab: StudentTab = 'parcours';
  loading = false;
  error = '';
  chatbotPopupOpen = false;
  selectedRecommendation: RecommendationItem | null = null;
  previewUrl: SafeResourceUrl | null = null;
  previewDocumentLoading = false;
  previewDocumentError = '';
  private previewDocumentObjectUrl: string | null = null;
  previewVideoUrl: string | null = null;
  previewVideoEmbedUrl: SafeResourceUrl | null = null;
  previewVideoFailed = false;
  previewDocumentVoiceLoading = false;
  previewDocumentVoiceMessage = '';
  readonly backendBaseUrl = environment.backendUrl;

  overviewCards: OverviewCard[] = [];
  recommendations: RecommendationItem[] = [];
  recommendationAnalysis: RecommendationAnalysis | null = null;
  selectedRecFilter: 'all' | 'platform' | 'internet' | 'ai' = 'all';

  readonly internetRecommendations: RecommendationItem[] = [
    {
      id: 'net-rec-c-quiz',
      icon: 'quiz',
      title: 'Quiz interactif Langage C & Algorithmique (W3Schools)',
      type: 'Quiz',
      level: 'Intermédiaire',
      duration: '15 min',
      reason: 'Quiz en ligne interactif de 25 questions pour valider vos connaissances en syntaxe C, boucles, conditions et pointeurs.',
      contentType: 'quiz',
      isExternal: true,
      externalUrl: 'https://www.w3schools.com/c/c_quiz.php',
      externalProvider: 'W3Schools',
      category: 'internet',
      focusKeywords: ['Langage C', 'Algorithmique', 'Boucles', 'Pointeurs'],
      recommendationScore: 96,
    },
    {
      id: 'net-rec-c-course',
      icon: 'menu_book',
      title: 'Cours complet : Apprenez à programmer en C (OpenClassrooms)',
      type: 'Cours',
      level: 'Tous niveaux',
      duration: '45 min',
      reason: 'Cours de référence en ligne : variables, mémoire, conditions, fonctions, pointeurs et allocation dynamique.',
      contentType: 'document',
      isExternal: true,
      externalUrl: 'https://openclassrooms.com/fr/courses/19980-apprenez-a-programmer-en-c',
      externalProvider: 'OpenClassrooms',
      category: 'internet',
      focusKeywords: ['Programmation C', 'Mémoire', 'Structures'],
      recommendationScore: 94,
    },
    {
      id: 'net-rec-net-quiz',
      icon: 'quiz',
      title: 'Quiz Réseaux Informatiques & Modèle OSI (GeeksforGeeks)',
      type: 'Quiz',
      level: 'Intermédiaire',
      duration: '20 min',
      reason: 'Évaluation ciblée sur les couches OSI, TCP/IP, masques de sous-réseau et protocoles de routage.',
      contentType: 'quiz',
      isExternal: true,
      externalUrl: 'https://www.geeksforgeeks.org/quizzes/computer-network-gq/',
      externalProvider: 'GeeksforGeeks',
      category: 'internet',
      focusKeywords: ['Systèmes Réseaux', 'Modèle OSI', 'TCP/IP'],
      recommendationScore: 92,
    },
    {
      id: 'net-rec-net-course',
      icon: 'menu_book',
      title: 'Architecture Web & Protocoles Réseaux (MDN Web Docs)',
      type: 'Cours',
      level: 'Débutant à Intermédiaire',
      duration: '25 min',
      reason: 'Guide officiel Mozilla expliquant le fonctionnement d’Internet, des requêtes DNS, adresses IP et protocoles clients/serveurs.',
      contentType: 'document',
      isExternal: true,
      externalUrl: 'https://developer.mozilla.org/fr/docs/Learn/Common_questions/Web_mechanisms/How_does_the_Internet_work',
      externalProvider: 'MDN Web Docs',
      category: 'internet',
      focusKeywords: ['Réseaux', 'DNS', 'IP', 'Internet'],
      recommendationScore: 90,
    },
    {
      id: 'net-rec-info-course',
      icon: 'menu_book',
      title: 'Fondamentaux du Design Graphique & Médias (OpenClassrooms)',
      type: 'Cours',
      level: 'Débutant',
      duration: '30 min',
      reason: 'Comprendre la composition visuelle, la théorie des couleurs, la typographie et la retouche multimédia.',
      contentType: 'document',
      isExternal: true,
      externalUrl: 'https://openclassrooms.com/fr/courses/6081446-initiez-vous-au-design-graphique',
      externalProvider: 'OpenClassrooms',
      category: 'internet',
      focusKeywords: ['Infographie', 'Montage Vidéo', 'Design Visuel'],
      recommendationScore: 88,
    },
    {
      id: 'net-rec-info-quiz',
      icon: 'quiz',
      title: 'Quiz Web Design & Styles Multimédias (W3Schools)',
      type: 'Quiz',
      level: 'Débutant',
      duration: '15 min',
      reason: 'Testez vos compétences sur la mise en page responsive, l’ergonomie visuelle et les styles multimédias.',
      contentType: 'quiz',
      isExternal: true,
      externalUrl: 'https://www.w3schools.com/quiztest/quiztest.asp?qtest=CSS',
      externalProvider: 'W3Schools',
      category: 'internet',
      focusKeywords: ['Infographie', 'Design Web', 'Multimédia'],
      recommendationScore: 86,
    },
    {
      id: 'net-rec-math-course',
      icon: 'menu_book',
      title: 'Algèbre, Logique Binaire et Ensembles (Khan Academy)',
      type: 'Cours',
      level: 'Tous niveaux',
      duration: '35 min',
      reason: 'Notions mathématiques fondamentales pour l’ingénieur : logique propositionnelle, binaire et algèbre.',
      contentType: 'document',
      isExternal: true,
      externalUrl: 'https://fr.khanacademy.org/math/algebra',
      externalProvider: 'Khan Academy',
      category: 'internet',
      focusKeywords: ['Mathématiques', 'Logique booléenne', 'Algèbre'],
      recommendationScore: 89,
    },
    {
      id: 'net-rec-math-quiz',
      icon: 'quiz',
      title: 'Quiz de Logique et Calcul Binaire (Khan Academy)',
      type: 'Quiz',
      level: 'Intermédiaire',
      duration: '15 min',
      reason: 'Exercices et auto-évaluation sur les opérations logiques, les fractions et le calcul binaire.',
      contentType: 'quiz',
      isExternal: true,
      externalUrl: 'https://fr.khanacademy.org/math/arithmetic',
      externalProvider: 'Khan Academy',
      category: 'internet',
      focusKeywords: ['Mathématiques', 'Binaire', 'Arithmétique'],
      recommendationScore: 85,
    },
  ];
  learningPath: LearningPathCourse[] = [];
  courseCatalog: CourseCatalogItem[] = [];
  filteredCourseCatalog: CourseCatalogItem[] = [];
  allVisibleContents: ContentItem[] = [];
  selectedCourse: CourseCatalogItem | null = null;
  selectedCourseResources: RecommendationItem[] = [];
  selectedCourseResourceFolders: CourseResourceFolder[] = [];
  selectedCourseResourceChapters: CourseResourceChapter[] = [];
  selectedStandaloneQuizId: string | null = null;
  selectedStandaloneQuiz: RecommendationItem | null = null;
  completedQuizIds = new Set<string>();
  completedContentIds = new Set<string>();
  dashboardProgressPercent = 0;
  dashboardCompletedItems = 0;
  dashboardTotalItems = 0;
  private quizProgressSyncInFlight = false;
  searchTerm = '';
  selectedLevelFilter = 'Tous les niveaux';
  selectedSort = 'Plus populaires';
  readonly levelFilters = ['Tous les niveaux', 'Debutant', 'Intermediaire', 'Avance'];
  readonly sortOptions = ['Plus populaires', 'Mieux notes', 'A continuer', 'Ordre alphabetique'];
  plannerSection: PlannerSection = 'calendar';
  plannerViewMode: PlannerViewMode = 'month';
  plannerTaskListScope: PlannerTaskScope = 'day';
  plannerCurrentDate = new Date();
  plannerSelectedDate = this.nextPlannerEventDateKey(new Date());
  plannerEvents: PlannerEvent[] = [];
  plannerTasks: PlannerTask[] = [];
  private plannerReminderIntervalId: number | null = null;
  plannerEventForm = {
    id: '',
    title: '',
    type: 'exam' as PlannerEventType,
    date: this.nextPlannerEventDateKey(new Date()),
    time: '09:00',
    notes: '',
  };
  plannerEventPickerDate = this.parseDateKey(this.nextPlannerEventDateKey(new Date()));
  plannerEventDatePickerOpen = false;
  plannerTaskForm = {
    id: '',
    title: '',
    scope: 'day' as PlannerTaskScope,
    date: this.dateKey(new Date()),
    notes: '',
  };
  plannerCelebration: { visible: boolean; message: string } = {
    visible: false,
    message: '',
  };
  plannerEventDialogOpen = false;
  plannerTaskDialogOpen = false;
  plannerDeleteTarget: PlannerDeleteTarget = null;
  plannerReminderSendingId = '';
  flashcardResultDialog: { visible: boolean; score: number; correct: number; total: number; badge: string } = {
    visible: false,
    score: 0,
    correct: 0,
    total: 0,
    badge: 'Badge Revision',
  };
  leaderboardLoading = false;
  leaderboardError = '';
  leaderboardFilter: LeaderboardLevelFilter = 'tous';
  leaderboard: LeaderboardPayload | null = null;
  leaderboardLevels: { id: LeaderboardLevelFilter; label: string }[] = [
    { id: 'tous', label: 'Tous les niveaux' },
  ];
  portfolioSummaryLoading = false;
  portfolioSummaryError = '';
  portfolioSummary: PortfolioCourseSummary | null = null;
  portfolioSummaryOpen = false;
  portfolioSummaryCourse: CourseCatalogItem | null = null;
  remediationCenterOpen = false;
  remediationDirectQuizOpen = false;
  remediationQuizLoadingKey = '';
  private portfolioRemediationScores: Record<string, number | PortfolioRemediationAttempt> = {};
  private passedPortfolioRemediationKeys = new Set<string>();
  levelRetakeOpen = false;
  internshipsLoading = false;
  internshipsError = '';
  internships: InternshipOpportunity[] = [];
  internshipSearchTerm = '';
  internshipDomainFilter = 'Tous les domaines';
  internshipDomainDropdownOpen = false;
  selectedInternship: InternshipOpportunity | null = null;
  selectedInternshipMapUrl: SafeResourceUrl | null = null;
  meetLoading = false;
  meetCreating = false;
  meetError = '';
  meetView: 'students' | 'teachers' | 'replays' = 'students';
  meetReplayFilter: 'student' | 'teacher' = 'student';
  meetCreateDialogOpen = false;
  meetFrameOpen = false;
  meetFrameTitle = '';
  meetFrameUrl: SafeResourceUrl | null = null;
  meetFrameReplay: MeetSession | null = null;
  meetSessions: MeetSession[] = [];
  meetReplays: MeetSession[] = [];
  pendingMeetInterfaceDelete: MeetSession | null = null;
  private hiddenMeetInterfaceIds = new Set<string>();
  readonly meetApiBaseUrl = `${this.backendBaseUrl}/api/meet`;
  meetForm = {
    title: '',
    topic: '',
    capacity: 8,
    recordingEnabled: true,
  };
  courseCompletionDialog: CourseCompletionDialog = {
    visible: false,
    courseTitle: '',
    chaptersCompleted: 0,
    quizzesPassed: 0,
    averageScore: 0,
  };
  flashcardSubject = 'all';
  flashcardDifficulty: FlashcardDifficulty = 'facile';
  flashcardSubjectDropdownOpen = false;
  flashcardDifficultyDropdownOpen = false;
  flashcardLoading = false;
  flashcardError = '';
  flashcardSessionActive = false;
  flashcardSessionId = '';
  flashcardSessionSaved = false;
  flashcards: FlashcardItem[] = [];
  currentFlashcardIndex = 0;
  flashcardUserAnswer = '';
  flashcardSecondsRemaining = 0;
  flashcardVoiceEnabled = true;
  private flashcardTimer?: number;
  private flashcardAutoAdvanceTimer?: number;
  private flashcardQuestionVoiceTimer?: number;

  skillDetails: SkillDetail[] = [
    { label: 'Programmation', value: 75, color: '#3b82f6' },
    { label: 'Mathematiques', value: 60, color: '#22c55e' },
    { label: 'Algorithmique', value: 50, color: '#a855f7' },
    { label: 'Base de donnees', value: 40, color: '#f97316' },
    { label: 'Reseaux', value: 35, color: '#ef4444' },
  ];

  radarPoints = '50,24 72,39 64,66 36,66 28,39';
  private readonly dashboardCacheKeyPrefix = 'eduvia-student-dashboard';
  private readonly localInternshipsKey = 'eduvia-admin-internships-local';
  private previewDocumentTextCache = new Map<string, string>();
  private currentClassStudentCount = 0;

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private voicePlaybackService: VoicePlaybackService,
    private notificationService: NotificationService,
    private cdr: ChangeDetectorRef,
  ) {}

  private refreshView(): void {
    this.cdr.detectChanges();
  }

  ngOnInit(): void {
    this.studentLevel = this.readStoredStudentLevel() || this.studentLevel;
    this.studentProfile.levelLabel = this.levelLabel(this.studentLevel);
    this.studentProfile.className = this.readStoredStudentClass();
    this.loadHeaderProfile();
    this.loadPortfolioRemediationScores();
    this.loadHiddenMeetInterfaceIds();
    this.loadClassStudentCountFallback();
    this.clearCachedDashboard();
    this.loadStudentContent();
    this.loadPlannerState();
    this.plannerReminderIntervalId = window.setInterval(() => this.showDuePlannerReminders(), 15000);
    this.refreshCompletedQuizIds();
    window.addEventListener('eduvia-forum-open', this.handleForumOpenEvent as EventListener);
    window.addEventListener('eduvia-meet-open', this.handleMeetOpenEvent as EventListener);
    window.addEventListener('eduvia-planner-open', this.handlePlannerOpenEvent as EventListener);
  }

  ngOnDestroy(): void {
    if (this.plannerReminderIntervalId !== null) {
      window.clearInterval(this.plannerReminderIntervalId);
      this.plannerReminderIntervalId = null;
    }
    this.stopPreviewVoice();
    this.releasePreviewDocumentUrl();
    this.stopPlannerModalVoice();
    this.stopFlashcardTimer();
    this.clearFlashcardAutoAdvance();
    this.clearFlashcardQuestionVoiceTimer();
    window.removeEventListener('eduvia-forum-open', this.handleForumOpenEvent as EventListener);
    window.removeEventListener('eduvia-meet-open', this.handleMeetOpenEvent as EventListener);
    window.removeEventListener('eduvia-planner-open', this.handlePlannerOpenEvent as EventListener);
  }

  get studentInitials() {
    const fullName = this.studentProfile.name.trim();
    return fullName ? fullName.charAt(0).toUpperCase() : 'E';
  }

  get studentClassLabel() {
    return this.studentProfile.className
      ? this.studentProfile.className
      : 'Classe non attribuee';
  }

  teacherInitials(name?: string) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length === 0) {
      return 'P';
    }

    return parts
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');
  }

  setActiveTab(tabId: StudentTab) {
    this.activeTab = tabId;
    this.closeFlashcardDropdowns();
    this.closeInternshipDomainDropdown();
    if (tabId === 'classement') {
      this.leaderboardFilter = 'tous';
      this.loadLeaderboard();
    }
    if (tabId === 'stages') {
      this.loadInternships();
    }
    if (tabId === 'meet') {
      this.loadMeetData();
    }
  }

  setLeaderboardFilter(filter: LeaderboardLevelFilter) {
    this.leaderboardFilter = filter;
    this.loadLeaderboard();
  }

  get filteredLeaderboardStudents() {
    const students = this.leaderboard?.students || [];
    if (this.leaderboardFilter === 'tous') {
      return students;
    }

    return students.filter(student => student.levelKey === this.leaderboardFilter);
  }

  get filteredLeaderboardTopStudents() {
    return this.filteredLeaderboardStudents.slice(0, 3);
  }

  get currentLeaderboardPosition() {
    const current = this.leaderboard?.currentStudent;
    if (!current) {
      return '-';
    }

    return `#${current.rank}`;
  }

  get internshipDomains() {
    return [
      'Tous les domaines',
      ...Array.from(new Set(this.internships.map(item => item.domain).filter(Boolean))).sort(),
    ];
  }

  get filteredInternships() {
    const search = this.normalizeSearchText(this.internshipSearchTerm);
    return this.internships.filter(internship => {
      const matchesDomain =
        this.internshipDomainFilter === 'Tous les domaines' ||
        internship.domain === this.internshipDomainFilter;
      const haystack = this.normalizeSearchText(internship.title);
      return matchesDomain && (!search || haystack.includes(search));
    });
  }

  clearInternshipSearch() {
    this.internshipSearchTerm = '';
  }

  toggleInternshipDomainDropdown(event?: Event) {
    event?.stopPropagation();
    this.internshipDomainDropdownOpen = !this.internshipDomainDropdownOpen;
  }

  selectInternshipDomain(domain: string) {
    this.internshipDomainFilter = domain;
    this.internshipDomainDropdownOpen = false;
  }

  closeInternshipDomainDropdown() {
    this.internshipDomainDropdownOpen = false;
  }

  get studentMeetSessions() {
    return this.meetSessions.filter(session => session.audience === 'student' && !this.isMeetHiddenFromInterface(session));
  }

  get teacherMeetSessions() {
    return this.meetSessions.filter(session => session.audience === 'teacher' && !this.isMeetHiddenFromInterface(session));
  }

  get filteredMeetReplays() {
    return this.meetReplays.filter(replay => replay.audience === this.meetReplayFilter && !this.isMeetHiddenFromInterface(replay));
  }

  get isMeetFormValid() {
    return (
      this.meetForm.title.trim().length >= 3 &&
      this.meetForm.topic.trim().length >= 3
    );
  }

  openStudentMeetDialog() {
    this.meetError = '';
    this.meetCreateDialogOpen = true;
  }

  closeStudentMeetDialog() {
    if (this.meetCreating) {
      return;
    }
    this.meetCreateDialogOpen = false;
  }

  createStudentMeetRoom() {
    this.meetError = '';
    const title = this.meetForm.title.trim();
    const topic = this.meetForm.topic.trim();
    if (!this.isMeetFormValid) {
      this.meetError = 'Remplissez tous les champs obligatoires pour creer la salle.';
      return;
    }

    this.meetCreating = true;
    this.http.post<MeetSession>(`${this.meetApiBaseUrl}/sessions`, {
      title,
      topic,
      audience: 'student',
      status: 'live',
      hostName: this.studentProfile.name,
      hostEmail: this.studentProfile.email || this.currentStudentEmail(),
      capacity: this.meetForm.capacity,
      recordingEnabled: this.meetForm.recordingEnabled,
      scheduledAt: '',
    }).subscribe({
      next: session => {
        this.meetSessions = [session, ...this.meetSessions];
        this.meetForm = { title: '', topic: '', capacity: 8, recordingEnabled: true };
        this.meetCreating = false;
        this.meetCreateDialogOpen = false;
        this.meetView = 'students';
        setTimeout(() => this.joinMeet(session), 0);
      },
      error: () => {
        this.meetCreating = false;
        this.meetError = 'Impossible de creer la salle meet.';
      },
    });
  }

  joinMeet(session: MeetSession) {
    if (session.replayUrl) {
      this.meetFrameTitle = session.replayTitle || session.title;
      if (this.isPlayableReplayUrl(session.replayUrl)) {
        this.meetFrameUrl = null;
        this.meetFrameReplay = session;
      } else if (/^https?:\/\//i.test(session.replayUrl)) {
        this.meetFrameUrl = this.sanitizer.bypassSecurityTrustResourceUrl(session.replayUrl);
        this.meetFrameReplay = null;
      } else {
        this.meetFrameUrl = null;
        this.meetFrameReplay = session;
      }
      this.meetFrameOpen = true;
      return;
    }

    const roomName = String(session.roomName || '').trim();
    const url = session.replayUrl || session.joinUrl || (roomName
      ? `https://meet.jit.si/${encodeURIComponent(roomName)}#config.prejoinPageEnabled=false`
      : '');
    if (!url) {
      this.meetError = 'Lien meet indisponible.';
      return;
    }

    this.http.patch<MeetSession>(`${this.meetApiBaseUrl}/sessions/${session._id}/join`, {}).subscribe({
      next: updated => {
        this.meetSessions = this.meetSessions.map(item => item._id === updated._id ? updated : item);
      },
      error: () => {
        this.meetError = 'Le compteur des participants n a pas pu etre mis a jour.';
      },
    });

    this.meetFrameTitle = session.title;
    this.meetFrameUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    this.meetFrameReplay = null;
    this.meetFrameOpen = true;
  }

  isPlayableReplayUrl(url?: string) {
    const normalizedUrl = String(url || '').trim().toLowerCase();
    return /^https?:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(normalizedUrl);
  }

  canModerateMeet(session: MeetSession) {
    const currentEmail = this.currentStudentEmail();
    const hostEmail = String(session.hostEmail || '').trim().toLowerCase();
    if (currentEmail && hostEmail) {
      return currentEmail === hostEmail;
    }

    const currentName = this.normalizeSearchText(this.studentProfile.name);
    const hostName = this.normalizeSearchText(session.hostName);
    return !!currentName && !!hostName && currentName === hostName;
  }

  meetHostLabel(session: MeetSession, fallback: string) {
    return this.canModerateMeet(session) ? 'moi meme' : session.hostName || fallback;
  }

  requestMeetInterfaceDelete(session: MeetSession) {
    this.pendingMeetInterfaceDelete = session;
  }

  cancelMeetInterfaceDelete() {
    this.pendingMeetInterfaceDelete = null;
  }

  confirmMeetInterfaceDelete() {
    const session = this.pendingMeetInterfaceDelete;
    if (!session) {
      return;
    }

    this.hiddenMeetInterfaceIds.add(this.meetInterfaceId(session));
    this.saveHiddenMeetInterfaceIds();
    this.meetSessions = this.meetSessions.filter(item => !this.isMeetHiddenFromInterface(item));
    this.meetReplays = this.meetReplays.filter(item => !this.isMeetHiddenFromInterface(item));
    this.pendingMeetInterfaceDelete = null;
  }

  announceMeetField(field: 'title' | 'topic') {
    const messages: Record<'title' | 'topic', string> = {
      title: 'Titre de la salle. Saisir le nom du meet que vous voulez creer.',
      topic: 'Sujet ou description. Saisir le sujet de la reunion meet.',
    };
    this.voicePlaybackService.toggle(`meet:${field}`, messages[field]);
  }

  isMeetFieldVoiceActive(field: 'title' | 'topic') {
    return this.voicePlaybackService.isActive(`meet:${field}`);
  }

  closeMeetFrame() {
    this.meetFrameOpen = false;
    this.meetFrameTitle = '';
    this.meetFrameUrl = null;
    this.meetFrameReplay = null;
  }

  endMeet(session: MeetSession) {
    if (!session._id) {
      return;
    }

    this.http.patch<MeetSession>(`${this.meetApiBaseUrl}/sessions/${session._id}/end`, {}).subscribe({
      next: updated => {
        this.meetSessions = this.meetSessions.filter(item => item._id !== updated._id);
        if (this.shouldShowMeetReplay(updated)) {
          this.meetReplays = [updated, ...this.meetReplays.filter(item => item._id !== updated._id)];
          this.meetView = 'replays';
        }
      },
      error: () => {
        this.meetError = 'Impossible de terminer la session.';
      },
    });
  }

  private loadMeetData() {
    this.loadHiddenMeetInterfaceIds();
    this.meetLoading = true;
    this.meetError = '';
    this.http.get<MeetSession[]>(`${this.meetApiBaseUrl}/sessions`).subscribe({
      next: sessions => {
        this.meetSessions = sessions || [];
        this.loadMeetReplays();
        this.meetLoading = false;
        this.refreshView();
      },
      error: () => {
        this.meetSessions = [];
        this.meetError = '';
        this.meetLoading = false;
        this.refreshView();
      },
    });
  }

  private loadMeetReplays() {
    this.http.get<MeetSession[]>(`${this.meetApiBaseUrl}/replays`).subscribe({
      next: replays => {
        this.meetReplays = replays || [];
        this.refreshView();
      },
      error: () => {
        this.meetReplays = [];
        this.refreshView();
      },
    });
  }

  private shouldShowMeetReplay(session: MeetSession) {
    return session.status === 'ended' && (session.recordingEnabled === true || !!session.replayUrl);
  }

  private isMeetHiddenFromInterface(session: MeetSession) {
    return this.hiddenMeetInterfaceIds.has(this.meetInterfaceId(session));
  }

  private meetInterfaceId(session: MeetSession) {
    return String(session._id || session.joinUrl || session.replayUrl || `${session.audience}:${session.title}:${session.hostEmail || session.hostName}`).trim();
  }

  private hiddenMeetInterfaceKey() {
    return `eduvia-hidden-meet-interface:student:${this.currentStudentEmail() || 'anonymous'}`;
  }

  private loadHiddenMeetInterfaceIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.hiddenMeetInterfaceKey()) || '[]');
      this.hiddenMeetInterfaceIds = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      this.hiddenMeetInterfaceIds = new Set<string>();
    }
  }

  private saveHiddenMeetInterfaceIds() {
    localStorage.setItem(this.hiddenMeetInterfaceKey(), JSON.stringify(Array.from(this.hiddenMeetInterfaceIds)));
  }

  private speakLeaderboardPosition(currentStudent: LeaderboardStudent | null) {
    const rank = Number(currentStudent?.rank);
    const points = Number(currentStudent?.points || 0);
    const name = currentStudent?.name || this.studentProfile.name || 'cher etudiant';

    if (rank === 1) {
      this.voicePlaybackService.speak(
        `Bravo ${name}, tu es premier du classement cette semaine avec ${points} points. Continue comme ca.`,
        'leaderboard-position',
      );
      return;
    }

    if (rank === 2) {
      this.voicePlaybackService.speak(
        `Bravo ${name}, tu es deuxieme du classement cette semaine avec ${points} points. Tu es tres proche de la premiere place.`,
        'leaderboard-position',
      );
      return;
    }

    if (rank === 3) {
      this.voicePlaybackService.speak(
        `Bravo ${name}, tu es troisieme du classement cette semaine avec ${points} points. Continue tes efforts pour monter plus haut.`,
        'leaderboard-position',
      );
      return;
    }

    this.voicePlaybackService.speak(
      `Malheureusement ${name}, tu n'es pas parmi les trois premiers cette semaine. Travaille davantage, termine tes cours et reussis tes quiz pour ameliorer ta position.`,
      'leaderboard-position',
    );
  }

  private speakInternshipDetails(internship: InternshipOpportunity) {
    const skills = (internship.skills || []).filter(Boolean).join(', ');
    const text = [
      `Offre de stage : ${internship.title}.`,
      `Entreprise : ${internship.company}.`,
      internship.domain ? `Domaine : ${internship.domain}.` : '',
      internship.duration ? `Duree : ${internship.duration}.` : '',
      internship.deadline ? `Date limite : ${internship.deadline}.` : '',
      internship.description ? `Description : ${internship.description}.` : '',
      skills ? `Competences demandees : ${skills}.` : '',
      internship.address || internship.city
        ? `Localisation : ${internship.address || internship.city}.`
        : '',
      internship.email ? `Email de contact : ${internship.email}.` : '',
      internship.phone ? `Telephone : ${internship.phone}.` : '',
      internship.website ? `Site web : ${internship.website}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    this.voicePlaybackService.speak(text, `internship-${internship._id || internship.title}`);
  }

  openInternshipDetails(internship: InternshipOpportunity) {
    this.selectedInternship = internship;
    this.selectedInternshipMapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      this.internshipMapUrl(internship),
    );
    this.speakInternshipDetails(internship);
  }

  closeInternshipDetails() {
    this.selectedInternship = null;
    this.selectedInternshipMapUrl = null;
    this.voicePlaybackService.stop();
  }

  contactInternship(internship: InternshipOpportunity) {
    const subject = encodeURIComponent(`Candidature stage - ${internship.title}`);
    const body = encodeURIComponent(
      `Bonjour,\n\nJe souhaite postuler a l'offre de stage "${internship.title}" chez ${internship.company}.\n\nCordialement,\n${this.studentProfile.name}`,
    );
    const to = encodeURIComponent(internship.email || '');
    window.open(
      `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${subject}&body=${body}`,
      '_blank',
    );
  }

  private internshipMapUrl(internship: InternshipOpportunity) {
    const lat = Number(internship.latitude);
    const lng = Number(internship.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const delta = 0.035;
      return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lng}`;
    }

    const locationQuery = [
      internship.address,
      internship.city,
      internship.company,
    ]
      .filter(Boolean)
      .join(', ');

    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(locationQuery)}`;
  }

  leaderboardLevelClass(level?: string) {
    const normalized = this.normalizeLevel(level);
    if (normalized === 'intermediaire') {
      return 'leaderboard-level--intermediate';
    }
    if (normalized === 'avance') {
      return 'leaderboard-level--advanced';
    }

    return 'leaderboard-level--beginner';
  }

  leaderboardAvatarFallback(student: LeaderboardStudent) {
    const name = String(student?.name || '').trim();
    return name ? name.charAt(0).toUpperCase() : 'E';
  }

  announcePlannerField(field: string) {
    this.voicePlaybackService.toggle(this.plannerVoiceKey(field), this.plannerVoiceText(field));
  }

  isPlannerFieldVoiceActive(field: string) {
    return this.voicePlaybackService.isActive(this.plannerVoiceKey(field));
  }

  announcePlannerDialog(kind: 'event' | 'task') {
    this.voicePlaybackService.toggle(
      this.plannerVoiceKey(`${kind}:all`),
      this.plannerDialogVoiceText(kind),
    );
  }

  isPlannerDialogVoiceActive(kind: 'event' | 'task') {
    return this.voicePlaybackService.isActive(this.plannerVoiceKey(`${kind}:all`));
  }

  private stopPlannerModalVoice() {
    this.voicePlaybackService.stop();
  }

  private plannerVoiceKey(field: string) {
    return `student-dashboard:planner:${field}`;
  }

  private plannerVoiceText(field: string) {
    const eventDate = this.formatPlannerDate(this.plannerEventForm.date);
    const taskDate = this.formatPlannerDate(this.plannerTaskForm.date);
    const today = this.formatPlannerDate(this.plannerTaskTodayKey);
    const eventTitle = this.plannerEventForm.title.trim();
    const eventNotes = this.plannerEventForm.notes.trim();
    const taskTitle = this.plannerTaskForm.title.trim();
    const taskNotes = this.plannerTaskForm.notes.trim();

    switch (field) {
      case 'eventTitle':
        return eventTitle
          ? `Titre de l'evenement : ${eventTitle}.`
          : "Champ titre de l'evenement. Saisissez le nom de votre evenement.";
      case 'eventDate':
        return `Date de l'evenement : ${eventDate}. Les jours passes et les week-ends ne sont pas autorises.`;
      case 'eventTime':
        return `Heure de l'evenement : ${this.plannerEventForm.time || '09:00'}.`;
      case 'eventNotes':
        return eventNotes
          ? `Notes de l'evenement : ${eventNotes}.`
          : "Champ notes de l'evenement. Vous pouvez ajouter une description ou une consigne.";
      case 'taskTitle':
        return taskTitle
          ? `Titre de la tache : ${taskTitle}.`
          : 'Champ titre de la tache. Saisissez la tache a faire.';
      case 'taskDate':
        return this.plannerTaskForm.scope === 'day'
          ? `Date automatique de la tache : ${today}.`
          : `Date de la tache : ${taskDate}. Choisissez uniquement une date restante dans cette semaine.`;
      case 'taskNotes':
        return taskNotes
          ? `Notes de la tache : ${taskNotes}.`
          : 'Champ notes de la tache. Vous pouvez ajouter des details pour mieux organiser votre travail.';
      default:
        return 'Champ du planificateur.';
    }
  }

  private plannerDialogVoiceText(kind: 'event' | 'task') {
    if (kind === 'event') {
      return [
        this.plannerEventForm.id ? "Modification de l'evenement." : "Ajout d'un evenement.",
        this.plannerVoiceText('eventTitle'),
        this.plannerVoiceText('eventDate'),
        this.plannerVoiceText('eventTime'),
        this.plannerVoiceText('eventNotes'),
      ].join(' ');
    }

    return [
      this.plannerTaskForm.id ? 'Modification de la tache.' : "Ajout d'une tache.",
      this.plannerVoiceText('taskTitle'),
      this.plannerVoiceText('taskDate'),
      this.plannerVoiceText('taskNotes'),
    ].join(' ');
  }

  private readonly handleForumOpenEvent = () => {
    this.activeTab = 'communaute';
  };

  private readonly handleMeetOpenEvent = (event?: Event) => {
    const detail = (event as CustomEvent<{ audience?: 'student' | 'teacher' }> | undefined)?.detail;
    this.activeTab = 'meet';
    this.meetView = detail?.audience === 'teacher' ? 'teachers' : 'students';
    this.loadMeetData();
  };

  private readonly handlePlannerOpenEvent = (event: Event) => {
    const eventId = (event as CustomEvent<{ eventId?: string }>).detail?.eventId || '';
    this.activeTab = 'planificateur';
    this.plannerSection = 'calendar';
    const plannerEvent = this.plannerEvents.find(item => item.id === eventId);
    if (plannerEvent) {
      this.plannerSelectedDate = plannerEvent.date;
      this.plannerCurrentDate = this.parseDateKey(plannerEvent.date);
    }
  };

  get plannerCurrentLabel() {
    if (this.plannerViewMode === 'day') {
      return this.formatPlannerDate(this.plannerSelectedDate);
    }

    if (this.plannerViewMode === 'week') {
      const range = this.plannerWeekDays();
      return `${this.formatPlannerDate(range[0]?.date || this.plannerSelectedDate)} - ${this.formatPlannerDate(range[6]?.date || this.plannerSelectedDate)}`;
    }

    return this.plannerCurrentDate.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
  }

  get plannerTodayKey() {
    return this.dateKey(new Date());
  }

  get plannerSelectedEvents() {
    return this.plannerEvents
      .filter(event => event.date === this.plannerSelectedDate)
      .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  }

  get plannerUpcomingEvents() {
    const today = this.startOfDay(new Date());
    return this.plannerEvents
      .filter(event => this.parseDateKey(event.date) >= today)
      .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  }

  get plannerVisibleEvents() {
    return this.plannerEvents
      .filter(event => event.date === this.plannerSelectedDate)
      .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  }

  get plannerTaskTodayKey() {
    return this.dateKey(new Date());
  }

  get plannerDayTasks() {
    return this.plannerTasks.filter(
      task => task.scope === 'day' && task.date === this.plannerTaskTodayKey,
    );
  }

  get plannerWeekTasks() {
    const weekKeys = new Set(this.plannerTaskWeekDays().map(day => day.date));
    return this.plannerTasks.filter(task => task.scope === 'week' && weekKeys.has(task.date));
  }

  get plannerTaskWeekMinKey() {
    const weekStart = this.parseDateKey(this.plannerTaskWeekDays()[0]?.date || this.plannerTaskTodayKey);
    const today = this.startOfDay(new Date());
    return this.dateKey(weekStart < today ? today : weekStart);
  }

  get plannerTaskWeekMaxKey() {
    return this.plannerTaskWeekDays()[6]?.date || this.plannerTaskTodayKey;
  }

  get plannerTaskWeekHasAvailableDate() {
    return this.parseDateKey(this.plannerTaskWeekMinKey) <= this.parseDateKey(this.plannerTaskWeekMaxKey);
  }

  get plannerVisibleTasks() {
    return this.plannerTaskListScope === 'day'
      ? this.plannerDayTasks
      : this.plannerWeekTasks;
  }

  get plannerUpcomingReminders() {
    const today = this.startOfDay(new Date());
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 3);

    return this.plannerEvents
      .filter(event => {
        const eventDate = this.parseDateKey(event.date);
        return eventDate >= today && eventDate <= maxDate;
      })
      .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  }

  setPlannerView(mode: PlannerViewMode) {
    this.plannerViewMode = mode;
  }

  setPlannerSection(section: PlannerSection) {
    this.plannerSection = section;
  }

  setPlannerTaskListScope(scope: PlannerTaskScope) {
    this.plannerTaskListScope = scope;
    this.plannerTaskForm.scope = scope;
  }

  movePlannerPeriod(direction: -1 | 1) {
    const next = new Date(this.plannerCurrentDate);
    if (this.plannerViewMode === 'day') {
      next.setDate(next.getDate() + direction);
    } else if (this.plannerViewMode === 'week') {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setMonth(next.getMonth() + direction);
    }

    this.plannerCurrentDate = next;
    this.plannerSelectedDate = this.nextPlannerEventDateKey(next);
    this.syncPlannerFormsToSelectedDate();
  }

  selectPlannerDate(day: PlannerDay) {
    if (day.isPast || day.isWeekend) {
      return;
    }

    this.plannerSelectedDate = day.date;
    this.plannerCurrentDate = this.parseDateKey(day.date);
    this.syncPlannerFormsToSelectedDate();
  }

  plannerMonthDays(): PlannerDay[] {
    const firstOfMonth = new Date(
      this.plannerCurrentDate.getFullYear(),
      this.plannerCurrentDate.getMonth(),
      1,
    );
    const start = new Date(firstOfMonth);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    start.setDate(firstOfMonth.getDate() - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return this.buildPlannerDay(date);
    });
  }

  plannerBusinessMonthDays(): PlannerDay[] {
    return this.plannerMonthDays().filter(day => !day.isWeekend);
  }

  plannerWeekDays(): PlannerDay[] {
    const selected = this.parseDateKey(this.plannerSelectedDate);
    const start = new Date(selected);
    const mondayOffset = (selected.getDay() + 6) % 7;
    start.setDate(selected.getDate() - mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return this.buildPlannerDay(date);
    });
  }

  plannerTaskWeekDays(): PlannerDay[] {
    const today = this.startOfDay(new Date());
    const start = new Date(today);
    const mondayOffset = (today.getDay() + 6) % 7;
    start.setDate(today.getDate() - mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return this.buildPlannerDay(date);
    });
  }

  plannerBusinessWeekDays(): PlannerDay[] {
    return this.plannerWeekDays().filter(day => !day.isWeekend);
  }

  plannerDayView(): PlannerDay {
    return this.buildPlannerDay(this.parseDateKey(this.plannerSelectedDate));
  }

  savePlannerEvent() {
    const title = this.plannerEventForm.title.trim();
    if (!title || !this.isPlannerDateSelectable(this.plannerEventForm.date)) {
      return;
    }

    const eventPayload = {
      title,
      type: this.plannerEventForm.type,
      date: this.plannerEventForm.date,
      time: this.plannerEventForm.time || '09:00',
      notes: this.plannerEventForm.notes.trim(),
    };

    const request = this.plannerEventForm.id
      ? this.http.patch<any>(`/api/student/planner/events/${this.plannerEventForm.id}`, eventPayload)
      : this.http.post<any>('/api/student/planner/events', eventPayload);

    request.subscribe({
      next: response => {
        const saved = this.normalizePlannerEvent(response?.data || response);
        this.plannerEvents = this.plannerEventForm.id
          ? this.plannerEvents.map(item => (item.id === saved.id ? saved : item))
          : [...this.plannerEvents, saved];
        this.resetPlannerEventForm();
        this.plannerEventDialogOpen = false;
        this.plannerEventDatePickerOpen = false;
        this.stopPlannerModalVoice();
      },
      error: () => undefined,
    });
  }

  openPlannerEventDialog() {
    this.resetPlannerEventForm();
    this.plannerEventForm.date = this.isPlannerDateSelectable(this.plannerSelectedDate)
      ? this.plannerSelectedDate
      : this.nextPlannerEventDateKey(new Date());
    this.plannerEventPickerDate = this.parseDateKey(this.plannerEventForm.date);
    this.plannerEventDatePickerOpen = false;
    this.plannerEventDialogOpen = true;
  }

  closePlannerEventDialog() {
    this.plannerEventDialogOpen = false;
    this.plannerEventDatePickerOpen = false;
    this.stopPlannerModalVoice();
    this.resetPlannerEventForm();
  }

  editPlannerEvent(event: PlannerEvent) {
    this.plannerEventForm = { ...event };
    this.plannerSelectedDate = event.date;
    this.plannerEventPickerDate = this.parseDateKey(event.date);
    this.plannerEventDatePickerOpen = false;
    this.plannerEventDialogOpen = true;
  }

  private deletePlannerEvent(eventId: string) {
    const previousEvents = this.plannerEvents;
    this.plannerEvents = this.plannerEvents.filter(event => event.id !== eventId);
    this.cdr.detectChanges();

    this.http.delete<any>(`/api/student/planner/events/${eventId}`).subscribe({
      next: () => undefined,
      error: () => {
        this.plannerEvents = previousEvents;
        this.cdr.detectChanges();
      },
    });
  }

  savePlannerTask() {
    if (this.plannerTaskForm.scope === 'day' && !this.plannerTaskForm.id) {
      this.plannerTaskForm.date = this.dateKey(new Date());
    }

    const title = this.plannerTaskForm.title.trim();
    if (!title || !this.isPlannerTaskDateSelectable(this.plannerTaskForm.date)) {
      return;
    }

    const taskPayload = {
      title,
      scope: this.plannerTaskForm.scope,
      date: this.plannerTaskForm.date,
      notes: this.plannerTaskForm.notes.trim(),
      completed: this.plannerTaskForm.id
        ? this.plannerTasks.find(item => item.id === this.plannerTaskForm.id)?.completed || false
        : false,
    };

    const request = this.plannerTaskForm.id
      ? this.http.patch<any>(`/api/student/planner/tasks/${this.plannerTaskForm.id}`, taskPayload)
      : this.http.post<any>('/api/student/planner/tasks', taskPayload);

    request.subscribe({
      next: response => {
        const saved = this.normalizePlannerTask(response?.data || response);
        this.plannerTasks = this.plannerTaskForm.id
          ? this.plannerTasks.map(item => (item.id === saved.id ? saved : item))
          : [...this.plannerTasks, saved];
        this.resetPlannerTaskForm();
        this.plannerTaskDialogOpen = false;
        this.stopPlannerModalVoice();
      },
      error: () => undefined,
    });
  }

  openPlannerTaskDialog() {
    this.resetPlannerTaskForm();
    this.plannerTaskForm.scope = this.plannerTaskListScope;
    this.plannerTaskForm.date = this.plannerTaskListScope === 'day'
      ? this.dateKey(new Date())
      : this.plannerTaskWeekMinKey;
    this.plannerTaskDialogOpen = true;
  }

  closePlannerTaskDialog() {
    this.plannerTaskDialogOpen = false;
    this.stopPlannerModalVoice();
    this.resetPlannerTaskForm();
  }

  editPlannerTask(task: PlannerTask) {
    this.plannerTaskForm = {
      id: task.id,
      title: task.title,
      scope: task.scope,
      date: task.date,
      notes: task.notes || '',
    };
    this.plannerSelectedDate = task.date;
    this.plannerTaskDialogOpen = true;
  }

  private deletePlannerTask(taskId: string) {
    const previousTasks = this.plannerTasks;
    this.plannerTasks = this.plannerTasks.filter(task => task.id !== taskId);
    this.cdr.detectChanges();

    this.http.delete<any>(`/api/student/planner/tasks/${taskId}`).subscribe({
      next: () => undefined,
      error: () => {
        this.plannerTasks = previousTasks;
        this.cdr.detectChanges();
      },
    });
  }

  requestPlannerDelete(kind: 'event' | 'task', id: string, title: string) {
    this.plannerDeleteTarget = { kind, id, title };
  }

  closePlannerDeleteDialog() {
    this.plannerDeleteTarget = null;
  }

  confirmPlannerDelete() {
    if (!this.plannerDeleteTarget) {
      return;
    }

    if (this.plannerDeleteTarget.kind === 'event') {
      this.deletePlannerEvent(this.plannerDeleteTarget.id);
    } else {
      this.deletePlannerTask(this.plannerDeleteTarget.id);
    }

    this.plannerDeleteTarget = null;
  }

  togglePlannerTask(task: PlannerTask) {
    if (this.isPlannerTaskExpired(task)) {
      return;
    }

    const completed = !task.completed;
    const previousTasks = this.plannerTasks;
    this.plannerTasks = this.plannerTasks.map(item =>
      item.id === task.id ? { ...item, completed } : item,
    );
    this.cdr.detectChanges();

    this.http
      .patch<any>(`/api/student/planner/tasks/${task.id}/toggle`, { completed })
      .subscribe({
        next: response => {
          const saved = this.normalizePlannerTask(response?.data || response);
          this.plannerTasks = this.plannerTasks.map(item =>
            item.id === saved.id ? saved : item,
          );
          if (completed && saved.completed) {
            this.voicePlaybackService.speak('bien tu as finit cette tache');
          }
          this.checkPlannerCompletion(saved.scope);
        },
        error: () => {
          this.plannerTasks = previousTasks;
          this.cdr.detectChanges();
        },
      });
  }

  remindPlannerEvent(event: PlannerEvent) {
    if (event.reminded || this.plannerReminderSendingId) {
      return;
    }

    if (!event.reminderEnabled && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }

    this.plannerReminderSendingId = event.id;
    const request = event.reminderEnabled
      ? this.http.delete<any>(`/api/student/planner/events/${event.id}/reminder`)
      : this.http.post<any>(`/api/student/planner/events/${event.id}/reminder`, {});

    request.subscribe({
      next: response => {
        const saved = this.normalizePlannerEvent(response?.data || response);
        this.plannerEvents = this.plannerEvents.map(item =>
          item.id === saved.id ? saved : item,
        );
        this.plannerReminderSendingId = '';
        this.showDuePlannerReminders();
        this.notificationService.syncCurrentUserNotifications();
      },
      error: () => {
        this.plannerReminderSendingId = '';
      },
    });
  }

  plannerCompletionText(tasks: PlannerTask[]) {
    const total = tasks.length;
    const done = tasks.filter(task => task.completed).length;
    return total ? `${done}/${total} terminee(s)` : 'Aucune tache';
  }

  isPlannerTaskExpired(task: PlannerTask) {
    return !task.completed && this.isPastDate(this.parseDateKey(task.date));
  }

  plannerEventIcon(type: PlannerEventType) {
    return type === 'exam' ? 'menu_book' : 'quiz';
  }

  plannerEventTypeLabel(type: PlannerEventType) {
    return type === 'exam' ? 'Examen' : 'Test';
  }

  get plannerEventPickerLabel() {
    return this.plannerEventPickerDate.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
  }

  togglePlannerEventDatePicker() {
    this.plannerEventPickerDate = this.parseDateKey(this.plannerEventForm.date);
    this.plannerEventDatePickerOpen = !this.plannerEventDatePickerOpen;
  }

  movePlannerEventPickerMonth(direction: -1 | 1) {
    const next = new Date(this.plannerEventPickerDate);
    next.setMonth(next.getMonth() + direction);
    this.plannerEventPickerDate = next;
  }

  plannerEventPickerDays(): PlannerDay[] {
    const firstOfMonth = new Date(
      this.plannerEventPickerDate.getFullYear(),
      this.plannerEventPickerDate.getMonth(),
      1,
    );
    const start = new Date(firstOfMonth);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    start.setDate(firstOfMonth.getDate() - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return this.buildPlannerDay(date);
    });
  }

  selectPlannerEventDate(day: PlannerDay) {
    if (!this.isPlannerDateSelectable(day.date)) {
      return;
    }

    this.plannerEventForm.date = day.date;
    this.plannerSelectedDate = day.date;
    this.plannerEventPickerDate = this.parseDateKey(day.date);
    this.plannerEventDatePickerOpen = false;
  }

  formatPlannerDate(dateKey: string) {
    return this.parseDateKey(dateKey).toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  }

  isPlannerDateSelectable(dateKey: string) {
    const date = this.parseDateKey(dateKey);
    return !this.isPastDate(date) && !this.isWeekendDate(date);
  }

  isPlannerTaskDateSelectable(dateKey: string) {
    if (!dateKey || this.isPastDate(this.parseDateKey(dateKey))) {
      return false;
    }

    if (this.plannerTaskForm.scope !== 'week') {
      return true;
    }

    const date = this.parseDateKey(dateKey);
    return (
      this.plannerTaskWeekHasAvailableDate &&
      date >= this.parseDateKey(this.plannerTaskWeekMinKey) &&
      date <= this.parseDateKey(this.plannerTaskWeekMaxKey)
    );
  }

  private syncPlannerFormsToSelectedDate() {
    this.plannerEventForm.date = this.plannerSelectedDate;
    this.plannerTaskForm.date = this.plannerSelectedDate;
  }

  private buildPlannerDay(date: Date): PlannerDay {
    const key = this.dateKey(date);
    return {
      date: key,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === this.plannerCurrentDate.getMonth(),
      isToday: key === this.dateKey(new Date()),
      isPast: this.isPastDate(date),
      isWeekend: this.isWeekendDate(date),
      events: this.plannerEvents.filter(event => event.date === key),
      tasks: this.plannerTasks.filter(task => task.date === key),
    };
  }

  private resetPlannerEventForm() {
    this.plannerEventForm = {
      id: '',
      title: '',
      type: 'exam',
      date: this.isPlannerDateSelectable(this.plannerSelectedDate)
        ? this.plannerSelectedDate
        : this.nextPlannerEventDateKey(new Date()),
      time: '09:00',
      notes: '',
    };
    this.plannerEventPickerDate = this.parseDateKey(this.plannerEventForm.date);
    this.plannerEventDatePickerOpen = false;
  }

  private resetPlannerTaskForm() {
    this.plannerTaskForm = {
      id: '',
      title: '',
      scope: 'day',
      date: this.plannerSelectedDate,
      notes: '',
    };
  }

  private loadPlannerState() {
    this.http.get<any>('/api/student/planner').subscribe({
      next: response => {
        const data = response?.data || response || {};
        this.plannerEvents = Array.isArray(data.events)
          ? data.events.map((event: any) => this.normalizePlannerEvent(event))
          : [];
        this.plannerTasks = Array.isArray(data.tasks)
          ? data.tasks.map((task: any) => this.normalizePlannerTask(task))
          : [];
        this.showDuePlannerReminders();
        this.refreshView();
      },
      error: () => {
        this.plannerEvents = [];
        this.plannerTasks = [];
        this.refreshView();
      },
    });
  }

  private savePlannerState() {
    // Planner data is persisted through the Django/MongoDB API.
  }

  private plannerStorageKey() {
    const email = (localStorage.getItem('current_user_email') || 'student')
      .trim()
      .toLowerCase();
    return `eduvia-planner-${email || 'student'}`;
  }

  private showDuePlannerReminders() {
    const now = Date.now();
    const catchUpWindowMs = 24 * 60 * 60 * 1000;

    for (const event of this.plannerEvents) {
      if (!event.reminderEnabled || event.reminded || !event.id) continue;

      const dueAt = new Date(`${event.date}T${event.time || '09:00'}`).getTime();
      if (!Number.isFinite(dueAt) || dueAt > now || now - dueAt > catchUpWindowMs) continue;

      const notifiedKey = `eduvia-planner-reminded-${event.id}`;
      if (localStorage.getItem(notifiedKey)) continue;
      localStorage.setItem(notifiedKey, '1');

      const remindedEvent = { ...event, reminderEnabled: false, reminded: true, remindedAt: new Date().toISOString() };
      this.plannerEvents = this.plannerEvents.map(item => item.id === event.id ? remindedEvent : item);
      const message = `${event.title} - ${this.formatPlannerDate(event.date)} a ${event.time}`;
      this.notificationService.addNotification({
        title: 'Rappel : ' + event.title,
        message,
        type: 'warning',
        action: { kind: 'planner_reminder', eventId: event.id },
      });
      this.showBrowserPlannerReminder(event);
      this.refreshView();

      this.http.post<any>(`/api/student/planner/events/${event.id}/reminder/fire`, {}).subscribe({
        next: response => {
          const saved = this.normalizePlannerEvent(response?.data || response);
          this.plannerEvents = this.plannerEvents.map(item => item.id === saved.id ? saved : item);
        },
        error: () => undefined,
      });
    }
  }

  private showBrowserPlannerReminder(event: PlannerEvent) {
    const message = `${event.title} - ${this.formatPlannerDate(event.date)} a ${event.time}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Rappel EduVia', { body: message });
    }
  }

  private normalizePlannerEvent(event: any): PlannerEvent {
    return {
      id: String(event?.id || event?._id || ''),
      title: String(event?.title || ''),
      type: event?.type === 'test' ? 'test' : 'exam',
      date: String(event?.date || this.nextPlannerEventDateKey(new Date())),
      time: String(event?.time || '09:00'),
      notes: String(event?.notes || ''),
      reminderEnabled: event?.reminderEnabled === true,
      reminderEnabledAt: event?.reminderEnabledAt || null,
      reminded: event?.reminded === true,
      remindedAt: event?.remindedAt || null,
    };
  }

  private normalizePlannerTask(task: any): PlannerTask {
    return {
      id: String(task?.id || task?._id || ''),
      title: String(task?.title || ''),
      scope: task?.scope === 'week' ? 'week' : 'day',
      date: String(task?.date || this.dateKey(new Date())),
      notes: String(task?.notes || ''),
      completed: task?.completed === true,
    };
  }

  private checkPlannerCompletion(scope: PlannerTaskScope) {
    const tasks = scope === 'day' ? this.plannerDayTasks : this.plannerWeekTasks;
    if (tasks.length === 0 || tasks.some(task => !task.completed)) {
      return;
    }

    const celebrationKey = `eduvia-planner-celebration-${scope}-${this.dateKey(new Date())}-${this.plannerSelectedDate}`;
    if (localStorage.getItem(celebrationKey)) {
      return;
    }

    localStorage.setItem(celebrationKey, 'shown');
    this.plannerCelebration = {
      visible: true,
      message:
        scope === 'day'
          ? 'Bravo, toutes les taches du jour sont terminees !'
          : 'Excellent, toutes les taches de la semaine sont terminees !',
    };
    this.playPlannerApplause();
    window.setTimeout(() => {
      this.plannerCelebration = { visible: false, message: '' };
    }, 4200);
  }

  private playPlannerApplause() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const context = new AudioContextClass();
      const now = context.currentTime;

      for (let index = 0; index < 9; index += 1) {
        const buffer = context.createBuffer(1, context.sampleRate * 0.06, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let sample = 0; sample < data.length; sample += 1) {
          data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length);
        }

        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.setValueAtTime(0.14, now + index * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.11 + 0.08);
        source.connect(gain);
        gain.connect(context.destination);
        source.start(now + index * 0.11);
      }
    } catch {
      // Audio feedback is optional.
    }
  }

  private createPlannerId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  dateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateKey(value: string) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
  }

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private isPastDate(date: Date) {
    return this.startOfDay(date).getTime() < this.startOfDay(new Date()).getTime();
  }

  private isWeekendDate(date: Date) {
    return date.getDay() === 0 || date.getDay() === 6;
  }

  private nextPlannerEventDateKey(startDate: Date) {
    const date = this.startOfDay(startDate);
    while (this.isPastDate(date) || this.isWeekendDate(date)) {
      date.setDate(date.getDate() + 1);
    }

    return this.dateKey(date);
  }

  onSearchInput(value: string) {
    this.searchTerm = value ?? '';
    this.updateFilteredCourseCatalog();
  }

  onLogout() {
    this.logout.emit();
  }

  toggleChatbotPopup() {
    this.chatbotPopupOpen = !this.chatbotPopupOpen;
  }

  get flashcardSubjects() {
    const subjects = new Map<string, string>();
    this.courseCatalog.forEach(course => subjects.set(course.id, course.title));
    return Array.from(subjects.entries()).map(([id, label]) => ({ id, label }));
  }

  get flashcardDurationSeconds() {
    return this.flashcardDifficulty === 'facile'
      ? 180
      : this.flashcardDifficulty === 'intermediaire'
        ? 120
        : 60;
  }

  get flashcardReviewedCount() {
    return this.flashcards.filter(card => card.revealed).length;
  }

  get flashcardCorrectCount() {
    return this.flashcards.filter(card => card.correct).length;
  }

  get flashcardScorePercent() {
    return this.flashcards.length
      ? Math.round((this.flashcardCorrectCount / this.flashcards.length) * 100)
      : 0;
  }

  get currentFlashcard() {
    return this.flashcards[this.currentFlashcardIndex] || null;
  }

  get flashcardProgressPercent() {
    return this.flashcards.length
      ? Math.round((this.flashcardReviewedCount / this.flashcards.length) * 100)
      : 0;
  }

  get flashcardTimerLabel() {
    const minutes = Math.floor(this.flashcardSecondsRemaining / 60);
    const seconds = this.flashcardSecondsRemaining % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  get flashcardSetupTimerLabel() {
    const secondsSource = this.flashcardSessionActive
      ? this.flashcardSecondsRemaining
      : this.flashcardDurationSeconds;
    const minutes = Math.floor(secondsSource / 60);
    const seconds = secondsSource % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  get flashcardSubjectLabel() {
    if (this.flashcardSubject === 'all') {
      return 'Toutes les matieres';
    }
    return this.flashcardSubjects.find(subject => subject.id === this.flashcardSubject)?.label || 'Matiere';
  }

  get flashcardDifficultyLabel() {
    if (this.flashcardDifficulty === 'intermediaire') {
      return 'Intermediaire';
    }

    if (this.flashcardDifficulty === 'difficile') {
      return 'Difficile';
    }

    return 'Facile';
  }

  get flashcardSubjectOptions() {
    return [{ id: 'all', label: 'Toutes les matieres' }, ...this.flashcardSubjects];
  }

  toggleFlashcardSubjectDropdown(event: Event) {
    event.stopPropagation();
    this.flashcardSubjectDropdownOpen = !this.flashcardSubjectDropdownOpen;
    this.flashcardDifficultyDropdownOpen = false;
  }

  toggleFlashcardDifficultyDropdown(event: Event) {
    event.stopPropagation();
    this.flashcardDifficultyDropdownOpen = !this.flashcardDifficultyDropdownOpen;
    this.flashcardSubjectDropdownOpen = false;
  }

  selectFlashcardSubject(subjectId: string, event?: Event) {
    event?.stopPropagation();
    this.flashcardSubject = subjectId;
    this.flashcardSubjectDropdownOpen = false;
  }

  selectFlashcardDifficulty(difficulty: FlashcardDifficulty, event?: Event) {
    event?.stopPropagation();
    this.flashcardDifficulty = difficulty;
    this.flashcardDifficultyDropdownOpen = false;
  }

  @HostListener('document:click')
  closeFlashcardDropdowns() {
    this.flashcardSubjectDropdownOpen = false;
    this.flashcardDifficultyDropdownOpen = false;
  }

  startFlashcardSession() {
    if (this.flashcardLoading) {
      return;
    }

    this.flashcardLoading = true;
    this.flashcardError = '';
    this.flashcardSessionId = '';
    this.flashcardSessionSaved = false;
    this.flashcardResultDialog.visible = false;
    this.closeFlashcardDropdowns();
    const selectedSubject = this.flashcardSubjectLabel;

    this.http
      .post<any>('/api/student/flashcards/start', {
        subject: selectedSubject,
        difficulty: this.flashcardDifficulty,
        questionCount: 10,
      })
      .subscribe({
        next: response => {
          const cards = Array.isArray(response?.cards)
            ? response.cards
            : [];
          this.flashcards = cards
            .slice(0, 10)
            .map((card: any, index: number) => ({
              id: String(card?.id || `flashcard-${index + 1}`),
              question: String(card?.question || '').trim(),
              answer: String(card?.answer || '').trim(),
              subject: selectedSubject,
              difficulty: this.flashcardDifficulty,
              userAnswer: '',
              revealed: false,
              correct: false,
            }))
            .filter((card: FlashcardItem) => card.question && card.answer);

          if (this.flashcards.length === 0) {
            this.flashcardError = 'Aucune flashcard disponible pour cette matiere.';
            this.flashcardSessionActive = false;
          } else {
            this.flashcardSessionId = String(response?.id || '').trim();
            this.flashcardSessionSaved = false;
            this.currentFlashcardIndex = 0;
            this.flashcardUserAnswer = '';
            this.flashcardSecondsRemaining =
              Number(response?.durationSeconds) || this.flashcardDurationSeconds;
            this.flashcardSessionActive = true;
            this.startFlashcardTimer();
            this.speakFlashcardWelcomeAndQuestion();
          }
          this.flashcardLoading = false;
        },
        error: () => {
          this.flashcardError = 'Impossible de generer les flashcards pour le moment.';
          this.flashcardSessionId = '';
          this.flashcardLoading = false;
        },
      });
  }

  revealFlashcardAnswer(autoAdvance = true) {
    const card = this.currentFlashcard;
    const answer = this.flashcardUserAnswer.trim();
    if (!card || !answer) {
      this.flashcardError = 'Entrez votre reponse avant de tourner la carte.';
      return;
    }

    card.userAnswer = answer;
    card.revealed = true;
    card.correct = this.isFlashcardAnswerCorrect(answer, card.answer);
    this.flashcardError = '';
    if (autoAdvance) {
      this.scheduleFlashcardAutoAdvance();
    }
  }

  nextFlashcard() {
    this.clearFlashcardAutoAdvance();
    if (!this.currentFlashcard?.revealed) {
      this.revealFlashcardAnswer(false);
      if (!this.currentFlashcard?.revealed) {
        return;
      }
    }

    if (this.currentFlashcardIndex >= this.flashcards.length - 1) {
      this.finishFlashcardSession();
      return;
    }

    this.currentFlashcardIndex += 1;
    this.flashcardUserAnswer = this.currentFlashcard?.userAnswer || '';
    this.flashcardError = '';
    this.speakCurrentFlashcardQuestion();
  }

  previousFlashcard() {
    this.clearFlashcardAutoAdvance();
    if (this.currentFlashcardIndex <= 0) {
      return;
    }
    this.currentFlashcardIndex -= 1;
    this.flashcardUserAnswer = this.currentFlashcard?.userAnswer || '';
    this.speakCurrentFlashcardQuestion();
  }

  finishFlashcardSession(timedOut = false) {
    this.clearFlashcardAutoAdvance();
    this.clearFlashcardQuestionVoiceTimer();
    this.stopFlashcardTimer();
    this.flashcardSessionActive = false;
    this.saveFlashcardSession(timedOut);
    this.showFlashcardResultDialog();
    window.setTimeout(() => this.speakFlashcardScore(), 150);
    if (this.flashcards.length === 10 && this.flashcardCorrectCount === 10) {
      this.playPlannerApplause();
    }
  }

  closeFlashcardResultDialog() {
    this.flashcardResultDialog.visible = false;
  }

  toggleFlashcardVoice() {
    this.flashcardVoiceEnabled = !this.flashcardVoiceEnabled;
    if (!this.flashcardVoiceEnabled) {
      this.voicePlaybackService.stop();
      this.clearFlashcardQuestionVoiceTimer();
      return;
    }
    this.speakCurrentFlashcardQuestion();
  }

  isFlashcardVoiceActive() {
    return this.voicePlaybackService.isActive(this.flashcardVoiceKey());
  }

  private startFlashcardTimer() {
    this.stopFlashcardTimer();
    this.flashcardTimer = window.setInterval(() => {
      this.flashcardSecondsRemaining = Math.max(0, this.flashcardSecondsRemaining - 1);
      if (this.flashcardSecondsRemaining <= 0) {
        this.finishFlashcardSession(true);
      }
    }, 1000);
  }

  private stopFlashcardTimer() {
    if (this.flashcardTimer) {
      window.clearInterval(this.flashcardTimer);
      this.flashcardTimer = undefined;
    }
  }

  private scheduleFlashcardAutoAdvance() {
    this.clearFlashcardAutoAdvance();
    this.flashcardAutoAdvanceTimer = window.setTimeout(() => {
      this.flashcardAutoAdvanceTimer = undefined;
      if (!this.flashcardSessionActive) {
        return;
      }
      if (this.currentFlashcardIndex >= this.flashcards.length - 1) {
        this.finishFlashcardSession();
        return;
      }
      this.currentFlashcardIndex += 1;
      this.flashcardUserAnswer = this.currentFlashcard?.userAnswer || '';
      this.flashcardError = '';
      this.speakCurrentFlashcardQuestion();
    }, 950);
  }

  private clearFlashcardAutoAdvance() {
    if (this.flashcardAutoAdvanceTimer) {
      window.clearTimeout(this.flashcardAutoAdvanceTimer);
      this.flashcardAutoAdvanceTimer = undefined;
    }
  }

  private speakFlashcardWelcomeAndQuestion() {
    if (!this.flashcardVoiceEnabled) {
      return;
    }
    this.voicePlaybackService.speak(
      `Bienvenue dans la session de flashcards. Matiere ${this.flashcardSubjectLabel}. Niveau ${this.flashcardDifficultyLabel}.`,
      'flashcards:welcome',
    );
    this.clearFlashcardQuestionVoiceTimer();
    this.flashcardQuestionVoiceTimer = window.setTimeout(() => {
      this.flashcardQuestionVoiceTimer = undefined;
      this.speakCurrentFlashcardQuestion();
    }, 2300);
  }

  private speakCurrentFlashcardQuestion() {
    const card = this.currentFlashcard;
    if (!this.flashcardVoiceEnabled || !this.flashcardSessionActive || !card || card.revealed) {
      return;
    }
    this.voicePlaybackService.speak(
      `Question ${this.currentFlashcardIndex + 1}. ${card.question}`,
      this.flashcardVoiceKey(),
    );
  }

  private speakFlashcardScore() {
    if (!this.flashcardVoiceEnabled) {
      return;
    }
    this.voicePlaybackService.speak(
      `Session terminee. Votre score est ${this.flashcardScorePercent} pour cent. ${this.flashcardCorrectCount} reponses correctes sur ${this.flashcards.length}.`,
      'flashcards:score',
    );
  }

  private flashcardVoiceKey() {
    return `flashcards:question:${this.currentFlashcardIndex}`;
  }

  private clearFlashcardQuestionVoiceTimer() {
    if (this.flashcardQuestionVoiceTimer) {
      window.clearTimeout(this.flashcardQuestionVoiceTimer);
      this.flashcardQuestionVoiceTimer = undefined;
    }
  }

  private showFlashcardResultDialog() {
    const total = this.flashcards.length;
    const correct = this.flashcardCorrectCount;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const badge = score >= 90
      ? 'Badge Champion'
      : score >= 60
        ? 'Badge Progression'
        : 'Badge Courage';
    this.flashcardResultDialog = {
      visible: true,
      score,
      correct,
      total,
      badge,
    };
  }

  private isFlashcardAnswerCorrect(userAnswer: string, expectedAnswer: string) {
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const user = normalize(userAnswer);
    const expected = normalize(expectedAnswer);

    if (expected.length > 0 && expected.length < 3) {
      return user.split(' ').includes(expected) || user.includes(expected);
    }

    if (user.length < 3 || expected.length < 3) {
      return false;
    }

    if (expected.includes(user) || user.includes(expected)) {
      return true;
    }

    const stopWords = new Set([
      'avec', 'aux', 'bonne', 'ces', 'cite', 'comme', 'dans', 'definit', 'des',
      'donc', 'donne', 'elle', 'est', 'etre', 'exemple', 'faire', 'lie', 'les',
      'leur', 'leurs', 'notion', 'par', 'pas', 'plus', 'pour', 'que', 'qui',
      'reponse', 'role', 'son', 'sont', 'sur', 'une', 'utilise', 'utiliser',
    ]);
    const toKeywords = (value: string) =>
      value
        .split(' ')
        .filter(word => word.length >= 4 && !stopWords.has(word));
    const userKeywords = new Set(toKeywords(user));
    const expectedKeywords = toKeywords(expected);
    if (userKeywords.size === 0 || expectedKeywords.length === 0) {
      return false;
    }

    const sharedCount = expectedKeywords.filter(word => userKeywords.has(word)).length;
    const expectedRatio = sharedCount / expectedKeywords.length;
    const userRatio = sharedCount / userKeywords.size;
    return sharedCount >= 1 && user.length >= 12 && (expectedRatio >= 0.2 || userRatio >= 0.2);
  }

  private saveFlashcardSession(timedOut: boolean) {
    if (!this.flashcardSessionId || this.flashcardSessionSaved) {
      return;
    }

    this.flashcardSessionSaved = true;
    const answers = this.flashcards.map(card => ({
      cardId: card.id,
      userAnswer: card.userAnswer || '',
      revealed: card.revealed === true,
    }));

    this.http
      .post(`/api/student/flashcards/${this.flashcardSessionId}/submit`, {
        answers,
        remainingSeconds: this.flashcardSecondsRemaining,
        timedOut,
      })
      .subscribe({
        next: (response: any) => {
          if (typeof response?.score === 'number') {
            this.flashcards = this.flashcards.map(card => {
              const savedCard = Array.isArray(response?.cards)
                ? response.cards.find((item: any) => String(item?.id || '') === card.id)
                : null;
              return savedCard
                ? {
                    ...card,
                    userAnswer: String(savedCard.userAnswer || card.userAnswer || ''),
                    revealed: savedCard.revealed === true,
                    correct: savedCard.correct === true,
                  }
                : card;
            });
          }
        },
        error: () => {
          this.flashcardSessionSaved = false;
          this.flashcardError = "La session est terminee, mais l'enregistrement a echoue.";
        },
      });
  }

  startRecommendation(item: RecommendationItem) {
    this.stopPreviewVoice();
    if (item.isLocked) {
      return;
    }

    if (item.isExternal && item.externalUrl) {
      window.open(item.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    if (item.isAiGenerated) {
      this.generateAiRecommendationQuiz(item.focusKeywords?.[0] || item.title);
      return;
    }

    if (item.type === 'Quiz') {
      if (this.recommendationActionDisabled(item)) {
        return;
      }

      this.selectedStandaloneQuizId = item.id;
      this.selectedStandaloneQuiz = item;
      return;
    }

    this.selectedRecommendation = item;
    this.releasePreviewDocumentUrl();
    this.previewDocumentLoading = false;
    this.previewDocumentError = '';
    const documentUrl = this.resolveMediaUrl(item);
    const documentName = String(item.fileName || item.fileUrl || item.source || '');
    if (this.normalizedContentType(item.contentType) === 'document' && /\.pdf(?:$|[?#])/i.test(documentName) && documentUrl) {
      this.previewUrl = null;
      this.previewDocumentLoading = true;
      this.http.get(documentUrl, { responseType: 'blob' }).subscribe({
        next: blob => {
          if (this.selectedRecommendation?.id !== item.id) {
            return;
          }
          const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
          this.previewDocumentObjectUrl = URL.createObjectURL(pdfBlob);
          this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewDocumentObjectUrl);
          this.previewDocumentLoading = false;
        },
        error: () => {
          if (this.selectedRecommendation?.id !== item.id) {
            return;
          }
          this.previewDocumentLoading = false;
          this.previewDocumentError = 'Impossible de charger ce PDF. Verifiez que le fichier existe sur le serveur.';
        },
      });
    } else {
      this.previewUrl = this.buildPreviewUrl(item);
    }
    this.previewVideoEmbedUrl = this.buildVideoEmbedUrl(item);
    this.previewVideoUrl = this.previewVideoEmbedUrl ? null : this.resolveMediaUrl(item);
    this.previewVideoFailed = false;
  }

  recommendationActionLabel(item: RecommendationItem) {
    if (item.isLocked) {
      return 'Verrouillé';
    }

    if (item.isExternal) {
      return item.type === 'Quiz' ? 'Passer le quiz en ligne' : 'Ouvrir la ressource';
    }

    if (item.isAiGenerated) {
      return 'Démarrer le Quiz IA';
    }

    if (item.type !== 'Quiz') {
      return item.isCompleted ? 'Consulter' : 'Commencer';
    }

    if (this.canStartQuizAttempt(item)) {
      return this.hasSubmittedQuizAttempt(item.id, item) ? 'Recommencer' : 'Commencer';
    }

    return this.hasSubmittedQuizAttempt(item.id, item) ? 'Consulter' : 'Tentatives épuisées';
  }

  recommendationActionDisabled(item: RecommendationItem) {
    if (item.isLocked) {
      return true;
    }

    if (item.isExternal || item.isAiGenerated) {
      return false;
    }

    if (item.type !== 'Quiz') {
      return false;
    }

    return !this.canStartQuizAttempt(item) && !this.hasSubmittedQuizAttempt(item.id, item);
  }

  recommendationQuizDurationLabel(item: RecommendationItem): string {
    const minutes = this.normalizedQuizDurationMinutes(item.quizDurationMinutes);
    return `${minutes || 15} min`;
  }

  recommendationDueDateLabel(item: RecommendationItem): string | null {
    const rawDueDate = String(item.dueDate || '').trim();
    if (!rawDueDate) {
      return null;
    }

    const parsedDate = new Date(rawDueDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return rawDueDate;
    }

    return parsedDate.toLocaleDateString('fr-FR');
  }

  quizResultSummary(item: RecommendationItem): StoredQuizAttempt | null {
    if (item.type !== 'Quiz') {
      return null;
    }

    const parsedResult = this.findAnyStoredQuizResult(item.id, item);
    if (parsedResult) {
      return parsedResult;
    }

    if (!this.canStartQuizAttempt(item)) {
      return {
        score: 0,
        passed: false,
      };
    }

    return null;
  }

  closeRecommendationPreview() {
    this.stopPreviewVoice();
    this.releasePreviewDocumentUrl();
    this.selectedRecommendation = null;
    this.previewUrl = null;
    this.previewDocumentLoading = false;
    this.previewDocumentError = '';
    this.previewVideoUrl = null;
    this.previewVideoEmbedUrl = null;
    this.previewVideoFailed = false;
    this.previewDocumentVoiceLoading = false;
    this.previewDocumentVoiceMessage = '';
  }

  private releasePreviewDocumentUrl(): void {
    if (this.previewDocumentObjectUrl) {
      URL.revokeObjectURL(this.previewDocumentObjectUrl);
      this.previewDocumentObjectUrl = null;
    }
  }

  onPreviewVideoError() {
    this.previewVideoFailed = true;
  }

  onPreviewVideoReady() {
    this.previewVideoFailed = false;
  }

  async togglePreviewDocumentVoice(item: RecommendationItem) {
    const voiceKey = this.previewDocumentVoiceKey(item);
    if (this.voicePlaybackService.isActive(voiceKey)) {
      this.stopPreviewVoice();
      this.previewDocumentVoiceMessage = 'Lecture vocale arretee.';
      return;
    }

    const documentUrl = this.resolveMediaUrl(item);
    if (!documentUrl) {
      this.previewDocumentVoiceMessage = 'Document indisponible pour la lecture vocale.';
      return;
    }

    this.previewDocumentVoiceLoading = true;
    this.previewDocumentVoiceMessage = 'Preparation de la lecture du document...';

    try {
      const text = await this.loadPdfTextContent(documentUrl);
      const speechText = this.buildDocumentSpeechText(item, text);
      const didSpeak = this.voicePlaybackService.speak(speechText, voiceKey);

      this.previewDocumentVoiceMessage = didSpeak
        ? 'Lecture vocale du document en cours.'
        : 'La lecture vocale nest pas prise en charge par ce navigateur.';
    } catch {
      this.previewDocumentVoiceMessage =
        'Impossible dextraire le texte du PDF pour la lecture vocale.';
    } finally {
      this.previewDocumentVoiceLoading = false;
    }
  }

  isPreviewDocumentVoiceActive(item: RecommendationItem) {
    return this.voicePlaybackService.isActive(this.previewDocumentVoiceKey(item));
  }

  previewVideoMimeType(url: string | null): string {
    const value = (url || '').toLowerCase();
    if (value.endsWith('.webm')) {
      return 'video/webm';
    }
    if (value.endsWith('.ogg') || value.endsWith('.ogv')) {
      return 'video/ogg';
    }
    if (value.endsWith('.m3u8')) {
      return 'application/x-mpegURL';
    }

    return 'video/mp4';
  }

  recommendationTypeClass(type: RecommendationItem['type']) {
    switch (type) {
      case 'Cours':
        return 'course';
      case 'Video':
        return 'video';
      default:
        return 'quiz';
    }
  }

  courseTrackColor(level: string) {
    return this.normalizeLevel(level) === 'intermediaire' ? 'gold' : 'green';
  }

  courseLevelClass(level: string) {
    const normalized = this.normalizeLevel(level);
    if (normalized === 'intermediaire') {
      return 'course-pill--intermediate';
    }
    if (normalized === 'avance') {
      return 'course-pill--advanced';
    }

    return 'course-pill--beginner';
  }

  openCourse(course: CourseCatalogItem) {
    this.selectedCourse = course;
    this.selectedCourseResources = this.buildCourseResources(course.id);
    this.selectedCourseResourceFolders = this.buildCourseResourceFolders(this.selectedCourseResources);
    this.selectedCourseResourceChapters = this.buildCourseResourceChapters(this.selectedCourseResources);
  }

  closeSelectedCourse() {
    this.selectedCourse = null;
    this.selectedCourseResources = [];
    this.selectedCourseResourceFolders = [];
    this.selectedCourseResourceChapters = [];
    this.selectedStandaloneQuizId = null;
    this.selectedStandaloneQuiz = null;
  }

  closeStandaloneQuiz() {
    const wasDirectPortfolioQuiz =
      this.remediationDirectQuizOpen &&
      this.selectedStandaloneQuiz?.quizMode === 'portfolio-remediation';

    this.selectedStandaloneQuizId = null;
    this.selectedStandaloneQuiz = null;

    if (wasDirectPortfolioQuiz) {
      this.remediationCenterOpen = false;
      this.remediationDirectQuizOpen = false;
      this.remediationQuizLoadingKey = '';
    }
  }

  onQuizSubmitted(quizId: string) {
    const courseBefore = this.selectedCourse
      ? { id: this.selectedCourse.id, progress: this.selectedCourse.progress }
      : null;
    const resolvedQuizId = String(
      quizId || this.selectedStandaloneQuizId || this.selectedStandaloneQuiz?.id || '',
    ).trim();
    this.markQuizCompleted(resolvedQuizId);
    const attempt = this.readStoredQuizAttempt(resolvedQuizId);
    const result = attempt ? this.parseStoredQuizResult(attempt) : null;

    if (result && this.selectedStandaloneQuiz?.quizMode === 'portfolio-remediation') {
      this.savePortfolioRemediationScore(this.selectedStandaloneQuiz, result.score ?? 0, result.passed === true);
    }

    if (resolvedQuizId && result) {
      const status = result.passed ? 'passed' : 'completed';
      this.writeLocalContentProgress(resolvedQuizId, status);
      this.completedContentIds = new Set([...this.completedContentIds, resolvedQuizId]);
      this.refreshProgressDecorations();
      this.maybeShowCourseCompletionDialog(courseBefore);
      this.http
        .post('/api/student/progress', {
          contentId: resolvedQuizId,
          status,
          score: result.score ?? 0,
        })
        .subscribe({
          next: () => this.loadStudentContent(),
          error: () => this.loadStudentContent(),
        });
    }

    window.setTimeout(() => this.loadStudentContent(), 350);
  }

  cleanEncoding(text?: string | null): string {
    if (!text) return '';
    let str = String(text);
    str = str.replace(/\ufffd/g, 'é');
    str = str.replace(/Ã©/g, 'é').replace(/Ã¨/g, 'è').replace(/Ãª/g, 'ê')
             .replace(/Ã /g, 'à').replace(/Ã§/g, 'ç').replace(/Ã´/g, 'ô')
             .replace(/Ã¹/g, 'ù').replace(/Ã®/g, 'î').replace(/Ã¯/g, 'ï')
             .replace(/â€™/g, "'").replace(/â€“/g, '–').replace(/â€”/g, '—')
             .replace(/â€¦/g, '…').replace(/Â«/g, '«').replace(/Â»/g, '»');

    const wordFixes: [RegExp, string][] = [
      [/\bdeuxime\b/gi, 'deuxième'],
      [/\btape\b/g, 'étape'],
      [/\bTape\b/g, 'Étape'],
      [/\btapes\b/g, 'étapes'],
      [/\bTapes\b/g, 'Étapes'],
      [/\bdmarche\b/gi, 'démarche'],
      [/\brsolution\b/gi, 'résolution'],
      [/\brsoudre\b/gi, 'résoudre'],
      [/\bproblme\b/gi, 'problème'],
      [/\bproblmes\b/gi, 'problèmes'],
      [/\bspcification\b/gi, 'spécification'],
      [/\bspcifier\b/gi, 'spécifier'],
      [/\bmodlisation\b/gi, 'modélisation'],
      [/\bexcutable\b/gi, 'exécutable'],
      [/\bexcution\b/gi, 'exécution'],
      [/\bexcuter\b/gi, 'exécuter'],
      [/\bcriture\b/gi, 'écriture'],
      [/\blment\b/gi, 'élément'],
      [/\blments\b/gi, 'éléments'],
      [/\bnonc\b/gi, 'énoncé'],
      [/\bdonnes\b/gi, 'données'],
      [/\bpremire\b/gi, 'première'],
      [/\bcinquime\b/gi, 'cinquième'],
      [/\baprs\b/gi, 'après'],
      [/\bdbut\b/gi, 'début'],
      [/\bsystme\b/gi, 'système'],
      [/\brseau\b/gi, 'réseau'],
      [/\brseaux\b/gi, 'réseaux'],
      [/\bmathmatique\b/gi, 'mathématique'],
      [/\bmathmatiques\b/gi, 'mathématiques'],
      [/\bvido\b/gi, 'vidéo'],
      [/\bvidos\b/gi, 'vidéos'],
      [/\brsum\b/gi, 'résumé'],
      [/\brvision\b/gi, 'révision'],
      [/\brvisions\b/gi, 'révisions'],
      [/\brgle\b/gi, 'règle'],
      [/\brgles\b/gi, 'règles'],
      [/\bdcision\b/gi, 'décision'],
      [/\bdcisions\b/gi, 'décisions'],
      [/\bmmoire\b/gi, 'mémoire'],
      [/\bparamtre\b/gi, 'paramètre'],
      [/\bparamtres\b/gi, 'paramètres'],
      [/\bmodle\b/gi, 'modèle'],
      [/\bmodles\b/gi, 'modèles'],
      [/\bintrt\b/gi, 'intérêt'],
      [/\bcontrle\b/gi, 'contrôle'],
      [/\bdfini\b/gi, 'défini'],
      [/\bdfinie\b/gi, 'définie'],
      [/\bdfinir\b/gi, 'définir'],
      [/\bdclaration\b/gi, 'déclaration'],
      [/\bpdagogique\b/gi, 'pédagogique'],
    ];

    for (const [pattern, replacement] of wordFixes) {
      str = str.replace(pattern, replacement);
    }
    return str;
  }

  get portfolioQuizHistory(): Array<{
    title: string;
    subtitle: string;
    score: number;
    date: string;
    status: string;
  }> {
    const list: Array<{
      title: string;
      subtitle: string;
      score: number;
      date: string;
      status: string;
    }> = [];

    // 1. Initial Assessment
    const initial = this.initialAssessmentResult();
    const initialScore = initial && typeof initial.score === 'number' && initial.score > 0
      ? Math.round(initial.score)
      : (this.studentLevel === 'avance' ? 85 : this.studentLevel === 'debutant' ? 60 : 75);

    list.push({
      title: 'Test de niveau initial',
      subtitle: initial?.completedAt
        ? `Diagnostic EduVia - ${new Date(initial.completedAt).toLocaleDateString('fr-FR')} - ${Math.round(initialScore / 10)}/10 réponses justes`
        : 'Diagnostic EduVia - Évaluation initiale',
      score: initialScore,
      date: initial?.completedAt ? new Date(initial.completedAt).toLocaleDateString('fr-FR') : 'Diagnostic EduVia',
      status: initialScore >= 50 ? 'Validé' : 'À renforcer',
    });

    // 2. Course quizzes taken from local storage or progress
    const seen = new Set<string>();
    this.allVisibleContents
      .filter(item => this.isQuiz(item) && item.courseId?.toLowerCase() !== 'test' && item.title?.toLowerCase() !== 'test')
      .forEach(quiz => {
        const attempt = this.findAnyStoredQuizResult(quiz._id || '', quiz);
        if (attempt && typeof attempt.score === 'number') {
          const title = this.cleanEncoding(quiz.title || quiz.courseId || 'Quiz');
          if (!seen.has(title)) {
            seen.add(title);
            list.push({
              title,
              subtitle: quiz.courseId ? `Cours : ${this.cleanEncoding(quiz.courseId)}` : 'Évaluation de cours',
              score: Math.max(0, Math.min(100, Math.round(attempt.score))),
              date: new Date().toLocaleDateString('fr-FR'),
              status: (attempt.score >= (quiz.quizPassingScore || 70)) ? 'Réussi' : 'À revoir',
            });
          }
        }
      });

    // 3. Portfolio remediation quizzes
    Object.entries(this.portfolioRemediationScores).forEach(([key, attempt]) => {
      const score = typeof attempt === 'number' ? attempt : attempt?.score ?? 0;
      const cleanKey = this.cleanEncoding(key);
      if (!seen.has(cleanKey)) {
        seen.add(cleanKey);
        list.push({
          title: `Remédiation : ${cleanKey}`,
          subtitle: 'Quiz ciblé sur point faible',
          score: Math.max(0, Math.min(100, Math.round(score))),
          date: new Date().toLocaleDateString('fr-FR'),
          status: score >= 70 ? 'Maîtrisé' : 'En cours',
        });
      }
    });

    // 4. Active course milestones to display score progression
    this.courseCatalog
      .filter(c => c.id.toLowerCase() !== 'test' && c.title.toLowerCase() !== 'test' && c.progress > 0)
      .forEach(course => {
        const courseTitle = `Progression : ${this.cleanEncoding(course.title)}`;
        if (!seen.has(courseTitle)) {
          seen.add(courseTitle);
          list.push({
            title: courseTitle,
            subtitle: `${course.completedItems}/${course.totalItems} éléments complétés`,
            score: course.progress,
            date: new Date().toLocaleDateString('fr-FR'),
            status: course.progress >= 70 ? 'Avancé' : 'En cours',
          });
        }
      });

    return list;
  }

  get portfolioAverageScore(): number {
    const list = this.portfolioQuizHistory.filter(q => q.status !== 'En attente' || q.score > 0);
    if (list.length > 0) {
      const sum = list.reduce((acc, curr) => acc + curr.score, 0);
      return Math.round(sum / list.length);
    }
    const scores = this.collectStoredQuizScores();
    if (scores.length > 0) {
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
    if (this.recommendationAnalysis?.summary?.averageScore) {
      return Math.round(this.recommendationAnalysis.summary.averageScore);
    }
    return this.dashboardProgressPercent || 0;
  }

  get portfolioCompletedCourses() {
    return this.courseCatalog.filter(course => course.progress >= 100).length;
  }

  get portfolioWeakAcquis() {
    return this.recommendationAnalysis?.weakAcquis || [];
  }

  get portfolioQuizTraceCount() {
    return this.portfolioQuizHistory.length;
  }

  get portfolioWeakLabels() {
    return (this.portfolioWeaknesses || []).slice(0, 6).join(', ');
  }

  get portfolioStrengths(): string[] {
    const strengths: string[] = [];
    const assessmentStrengths = this.initialAssessmentResult()?.strengths || [];
    assessmentStrengths.forEach(s => {
      const clean = this.cleanEncoding(s).trim();
      if (clean && !strengths.includes(clean)) strengths.push(clean);
    });

    // Courses with good progress
    this.courseCatalog
      .filter(c => c.progress >= 40 && c.title.toLowerCase() !== 'test')
      .forEach(c => {
        const label = `${this.cleanEncoding(c.title)} (${c.progress}% maîtrisé - ${c.completedItems}/${c.totalItems} éléments)`;
        if (!strengths.includes(label)) strengths.push(label);
      });

    // Quizzes passed
    this.allVisibleContents
      .filter(item => this.isQuiz(item))
      .forEach(quiz => {
        const attempt = this.findAnyStoredQuizResult(quiz._id || '', quiz);
        if (attempt && (attempt.score ?? 0) >= 70) {
          const label = `${this.cleanEncoding(quiz.title)} (${attempt.score}%)`;
          if (!strengths.includes(label)) strengths.push(label);
        }
      });

    if (strengths.length === 0) {
      if (this.courseCatalog.length > 0) {
        strengths.push(`Inscrit dans ${this.courseCatalog.length} cours actifs`);
      }
      strengths.push(`Niveau actuel : ${this.studentProfile.levelLabel}`);
      strengths.push('Motivation et régularité sur la plateforme');
    }

    return strengths.slice(0, 6);
  }

  get portfolioWeaknesses(): string[] {
    const weaknesses: string[] = [];
    const assessmentWeaknesses = this.initialAssessmentResult()?.weaknesses || [];
    assessmentWeaknesses.forEach(w => {
      const clean = this.cleanEncoding(w).trim();
      if (clean && clean.toLowerCase() !== 'test' && !weaknesses.includes(clean)) weaknesses.push(clean);
    });

    // Weak cards
    this.portfolioWeakCards.forEach(c => {
      const label = this.cleanEncoding(c.label || c.chapterId || '').trim();
      if (label && label.toLowerCase() !== 'test' && !weaknesses.includes(label)) {
        weaknesses.push(`${c.courseId ? this.cleanEncoding(c.courseId) + ' : ' : ''}${label}`);
      }
    });

    // Courses in progress < 40%
    this.courseCatalog
      .filter(c => c.progress < 40 && c.title.toLowerCase() !== 'test')
      .forEach(c => {
        const label = `${this.cleanEncoding(c.title)} (${c.progress}% complété - ${c.totalItems - c.completedItems} éléments restants)`;
        if (!weaknesses.includes(label)) weaknesses.push(label);
      });

    // Failed quizzes
    this.allVisibleContents
      .filter(item => this.isQuiz(item))
      .forEach(quiz => {
        const attempt = this.findAnyStoredQuizResult(quiz._id || '', quiz);
        if (attempt && (attempt.score ?? 0) < 70) {
          const label = `Quiz ${this.cleanEncoding(quiz.title)} (${attempt.score}%)`;
          if (!weaknesses.includes(label)) weaknesses.push(label);
        }
      });

    if (weaknesses.length === 0) {
      weaknesses.push('Aucune faiblesse critique identifiée');
      weaknesses.push('Continuer la pratique des quiz réguliers');
    }

    return weaknesses.slice(0, 6);
  }

  get portfolioWeakCards(): WeakAcquisItem[] {
    let cards: WeakAcquisItem[] = [];
    if (this.portfolioWeakAcquis.length > 0) {
      cards = this.portfolioWeakAcquis
        .map((item, index) => {
          const displayLabel = this.cleanEncoding(this.portfolioWeakDisplayLabel(item, index));
          return {
            ...item,
            label: displayLabel,
            courseId: this.cleanEncoding(item.courseId),
            chapterId: this.cleanEncoding(item.chapterId),
            key: item.key || this.portfolioWeakKey(item, displayLabel, index),
            keywords: [item.label, ...(item.keywords || [])],
          };
        })
        .filter(item => !this.isPortfolioRemediationPassed(item))
        .map(item => {
        const attempt = this.portfolioRemediationAttemptFor(item);
        return !attempt
          ? item
          : {
              ...item,
              successRate: attempt.score,
              reason: `Dernier score du quiz ciblé sur ${item.label}: ${attempt.score}%.`,
            };
      });
    } else {
      const assessment = this.initialAssessmentResult();
      if (assessment) {
        cards = assessment.weaknesses
          .map((label, index) => {
          const cleanLabel = this.cleanEncoding(this.namedInitialWeakness(label, index));
          const weak: WeakAcquisItem = {
            key: `initial-${this.normalizeSearchText(label)}-${index}`,
            label: cleanLabel,
            severity: 100 - assessment.score,
            severityLabel: 'À renforcer',
            incorrectQuestions: 1,
            totalQuestions: 1,
            successRate: assessment.score,
            keywords: [label],
            courseId: 'Test de niveau initial',
            chapterId: cleanLabel,
            reason: `Point faible détecté dans le test de niveau: ${cleanLabel}.`,
          };
          const attempt = this.portfolioRemediationAttemptFor(weak);
          return {
            ...weak,
            successRate: attempt?.score ?? weak.successRate,
            reason: attempt
              ? `Dernier score du quiz ciblé sur ${weak.label}: ${attempt.score}%.`
              : weak.reason,
          };
        })
          .filter(item => !this.isPortfolioRemediationPassed(item));
      }
    }

    return cards.filter(item => {
      const label = (item.label || '').trim().toLowerCase();
      const course = (item.courseId || '').trim().toLowerCase();
      return label !== 'test' && course !== 'test';
    });
  }

  get portfolioEvaluationCount() {
    return this.portfolioQuizHistory.length;
  }

  get portfolioInitialAssessmentDate() {
    const result = this.initialAssessmentResult();
    return result?.completedAt || this.recommendationAnalysis?.summary.lastSubmittedAt || '';
  }

  get portfolioInitialAssessmentLabel() {
    const result = this.initialAssessmentResult();
    if (!result) {
      return 'Diagnostic EduVia - session locale';
    }

    return `Diagnostic EduVia - ${new Date(result.completedAt).toLocaleDateString('fr-FR')} - ${result.correctCount}/${result.totalQuestions} réponses justes`;
  }

  get portfolioRecommendations(): string[] {
    const recs: string[] = [];
    const weakList = this.portfolioWeaknesses;
    if (weakList.length > 0) {
      recs.push(`Priorité : Travailler sur ${weakList[0]}`);
      if (weakList.length > 1) {
        recs.push(`Consolider les bases de : ${weakList[1]}`);
      }
    }
    const uncompleted = this.courseCatalog.find(c => c.progress < 100 && c.title.toLowerCase() !== 'test');
    if (uncompleted) {
      recs.push(`Poursuivre le cours « ${this.cleanEncoding(uncompleted.title)} » (${uncompleted.progress}% atteint)`);
    }
    recs.push('Passer les quiz de chapitre pour valider vos compétences et mettre à jour votre profil');
    return recs.slice(0, 4);
  }

  portfolioCourseResourceCount(courseId: string) {
    return this.buildCourseResources(courseId).length;
  }

  retakeLevelTest() {
    this.levelRetakeOpen = true;
    this.closeRemediationCenter();
    this.closePortfolioCourseSummary();
    this.stopPreviewVoice();
  }

  onLevelRetakeCompleted(result: AssessmentResult) {
    this.levelRetakeOpen = false;
    this.studentLevel = result.level;
    this.studentProfile.levelLabel = result.levelLabel;
    localStorage.setItem(this.studentLevelStorageKey(), result.level);
    localStorage.setItem(this.assessmentStorageKey(), JSON.stringify(result));
    this.http.post('/api/student/level', {
      level: result.level,
      assessmentResult: result,
    }).subscribe({
      next: () => this.loadStudentContent(),
      error: () => this.loadStudentContent(),
    });
  }

  openPortfolioCourseSummary(course: CourseCatalogItem) {
    this.portfolioSummaryCourse = course;
    this.portfolioSummaryOpen = true;
    this.portfolioSummary = this.readCachedPortfolioSummary(course.id);
    this.portfolioSummaryError = '';
    this.portfolioSummaryLoading = !this.portfolioSummary;
    this.http
      .post<PortfolioCourseSummary>('/api/student/portfolio/course-summary', {
        courseId: course.id,
        level: this.studentLevel,
      })
      .subscribe({
        next: summary => {
          this.portfolioSummary = summary;
          this.writeCachedPortfolioSummary(course.id, summary);
          this.portfolioSummaryLoading = false;
          this.refreshView();
        },
        error: () => {
          this.portfolioSummaryError = 'Impossible de generer le resume de ce cours pour le moment.';
          this.portfolioSummaryLoading = false;
          this.refreshView();
        },
      });
  }

  closePortfolioCourseSummary() {
    this.portfolioSummaryOpen = false;
    this.portfolioSummary = null;
    this.portfolioSummaryCourse = null;
    this.portfolioSummaryError = '';
  }

  downloadPortfolioSummaryPdf() {
    if (!this.portfolioSummary) {
      return;
    }

    const summary = this.portfolioSummary;
    const lines = [
      `Resume IA du cours: ${summary.courseTitle}`,
      `Niveau: ${summary.level}`,
      `Ressources: ${summary.resourceCount} - Quiz: ${summary.quizCount}`,
      `Enseignant: ${summary.teacherName}`,
      '',
      'Vue d ensemble',
      summary.overview,
      '',
      'Tableau des notions importantes',
      ...summary.notions.flatMap(notion => [
        `- ${notion.notion}`,
        `  Explication: ${notion.explanation}`,
        `  Importance: ${notion.importance}`,
        `  Exemple: ${notion.example}`,
      ]),
      '',
      'Resume detaille',
      ...summary.details.flatMap(detail => [
        detail.title,
        detail.explanation,
        ...detail.bullets.map(bullet => `- ${bullet}`),
      ]),
      '',
      'Prochaines actions',
      ...summary.nextActions.map(action => `- ${action}`),
      '',
      'Plan de revision',
      ...summary.revisionPlan.map(step => `${step.step}. ${step.text}`),
      '',
      'Glossaire',
      ...summary.glossary.map(item => `- ${item}`),
    ];
    const pdfBytes = this.buildSimplePdf(lines);
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfBuffer).set(pdfBytes);
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${summary.courseTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'resume'}-portfolio.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private portfolioSummaryCacheKey(courseId: string) {
    return `eduvia-portfolio-summary:${this.currentStudentEmail() || 'anonymous'}:${this.studentLevel}:${courseId}`;
  }

  private readCachedPortfolioSummary(courseId: string): PortfolioCourseSummary | null {
    try {
      const raw = localStorage.getItem(this.portfolioSummaryCacheKey(courseId));
      if (!raw) {
        return null;
      }
      const cached = JSON.parse(raw);
      return cached?.summary || null;
    } catch {
      return null;
    }
  }

  private writeCachedPortfolioSummary(courseId: string, summary: PortfolioCourseSummary) {
    localStorage.setItem(
      this.portfolioSummaryCacheKey(courseId),
      JSON.stringify({ savedAt: new Date().toISOString(), summary }),
    );
  }

  private portfolioRemediationScoresKey() {
    return `eduvia-portfolio-remediation-scores:${this.currentStudentEmail() || 'anonymous'}`;
  }

  private loadPortfolioRemediationScores() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.portfolioRemediationScoresKey()) || '{}');
      this.portfolioRemediationScores = parsed && typeof parsed === 'object' ? parsed : {};
      this.passedPortfolioRemediationKeys = new Set(
        Object.entries(this.portfolioRemediationScores)
          .filter(([, value]) => typeof value === 'object' && value !== null && (value as PortfolioRemediationAttempt).passed === true)
          .map(([key]) => key),
      );
    } catch {
      this.portfolioRemediationScores = {};
      this.passedPortfolioRemediationKeys = new Set<string>();
    }
  }

  private savePortfolioRemediationScore(quiz: RecommendationItem, score: number, passed: boolean) {
    const attempt: PortfolioRemediationAttempt = {
      score: Math.max(0, Math.min(100, Math.round(Number(score) || 0))),
      passed,
      submittedAt: new Date().toISOString(),
    };
    const labels = [
      ...(quiz.focusLabels || []),
      quiz.title.replace(/^Renforcer l'acquis\s+/i, ''),
      quiz.title.replace(/^Renforcer\s+/i, ''),
    ].filter(Boolean);

    labels.forEach(label => {
      const key = this.normalizeSearchText(String(label));
      this.portfolioRemediationScores[key] = attempt;
      if (passed) {
        this.passedPortfolioRemediationKeys.add(key);
      }
    });
    localStorage.setItem(this.portfolioRemediationScoresKey(), JSON.stringify(this.portfolioRemediationScores));
  }

  private portfolioRemediationAttemptFor(weak: Pick<WeakAcquisItem, 'key' | 'label' | 'chapterId' | 'courseId'>): PortfolioRemediationAttempt | null {
    const labels = [weak.key, weak.label].filter(Boolean);
    for (const label of labels) {
      const stored = this.portfolioRemediationScores[this.normalizeSearchText(String(label))];
      if (typeof stored === 'number') {
        return {
          score: stored,
          passed: stored >= 70,
          submittedAt: '',
        };
      }
      if (stored && typeof stored === 'object' && Number.isFinite(Number(stored.score))) {
        return {
          score: Math.max(0, Math.min(100, Math.round(Number(stored.score)))),
          passed: stored.passed === true,
          submittedAt: String(stored.submittedAt || ''),
        };
      }
    }

    return null;
  }

  private isPortfolioRemediationPassed(weak: Pick<WeakAcquisItem, 'key' | 'label' | 'chapterId' | 'courseId'>): boolean {
    const labels = [weak.key, weak.label].filter(Boolean);
    return labels.some(label => this.passedPortfolioRemediationKeys.has(this.normalizeSearchText(String(label)))) ||
      this.portfolioRemediationAttemptFor(weak)?.passed === true;
  }

  private portfolioWeakKey(weak: WeakAcquisItem, label: string, index: number) {
    return [
      weak.key,
      weak.courseId,
      weak.chapterId,
      label,
      index,
    ].filter(Boolean).map(value => this.normalizeSearchText(String(value))).join(':');
  }

  private portfolioWeakDisplayLabel(weak: WeakAcquisItem, index: number) {
    const baseLabel = String(weak.label || weak.chapterId || weak.courseId || `acquis ${index + 1}`).trim();
    const scope = [weak.courseId, weak.chapterId]
      .map(value => String(value || '').trim())
      .filter(value => value && this.normalizeSearchText(value) !== this.normalizeSearchText(baseLabel))
      .slice(0, 2)
      .join(' - ');

    return scope ? `${baseLabel} (${scope})` : `${baseLabel} #${index + 1}`;
  }

  private namedInitialWeakness(label: string, index: number) {
    return `Point faible ${index + 1}: ${label}`;
  }

  openRemediationCenter() {
    this.remediationCenterOpen = true;
    this.remediationDirectQuizOpen = false;
  }

  closeRemediationCenter() {
    this.remediationCenterOpen = false;
    this.remediationDirectQuizOpen = false;
    this.remediationQuizLoadingKey = '';
    if (this.selectedStandaloneQuiz?.quizMode === 'portfolio-remediation') {
      this.closeStandaloneQuiz();
    }
  }

  startPortfolioRemediationQuiz(weak: WeakAcquisItem) {
    const key = weak.key || weak.label;
    this.remediationCenterOpen = true;
    this.remediationDirectQuizOpen = true;
    this.selectedStandaloneQuizId = null;
    this.selectedStandaloneQuiz = null;
    this.remediationQuizLoadingKey = key;
    this.http
      .post<any>('/api/student/portfolio/remediation-quiz', {
        acquis: weak.keywords?.[0] || weak.label,
        courseId: weak.courseId,
        chapterId: weak.chapterId,
        level: this.studentLevel,
      })
      .subscribe({
        next: quiz => {
          const mappedQuiz = this.mapGeneratedQuizToRecommendation(quiz);
          mappedQuiz.id = `portfolio-remediation-${this.normalizeSearchText(key) || Date.now()}`;
          mappedQuiz.title = `Renforcer ${weak.label}`;
          mappedQuiz.focusLabels = [weak.key, weak.label].filter(Boolean) as string[];
          this.selectedStandaloneQuiz = mappedQuiz;
          this.selectedStandaloneQuizId = mappedQuiz.id;
          this.remediationQuizLoadingKey = '';
          this.refreshView();
        },
        error: () => {
          this.remediationQuizLoadingKey = '';
          this.refreshView();
        },
      });
  }

  private applyLevelFromPortfolioScore(score: number) {
    const nextLevel: StudentLevel = score >= 75 ? 'avance' : score >= 45 ? 'intermediaire' : 'debutant';
    this.studentLevel = nextLevel;
    this.studentProfile.levelLabel = this.levelLabel(nextLevel);
    localStorage.setItem(this.studentLevelStorageKey(), nextLevel);
    this.http.post('/api/student/level', {
      level: nextLevel,
      assessmentResult: {
        source: 'portfolio-remediation',
        score,
        completedAt: new Date().toISOString(),
      },
    }).subscribe({ error: () => undefined });
  }

  private mapGeneratedQuizToRecommendation(item: ContentItem | any): RecommendationItem {
    return {
      id: String(item?._id || item?.id || `portfolio-remediation-${Date.now()}`),
      icon: 'quiz',
      title: String(item?.title || 'Quiz cible'),
      type: 'Quiz',
      level: this.levelLabel(this.studentLevel),
      duration: `${this.normalizedQuizDurationMinutes(item?.quizDurationMinutes) || 10} min`,
      reason: String(item?.recommendationReason || item?.description || 'Quiz cible sur vos acquis faibles.'),
      contentType: 'quiz',
      description: item?.description,
      courseId: item?.courseId,
      chapterId: item?.chapterId,
      partId: item?.partId,
      quizMode: item?.quizMode || 'portfolio-remediation',
      quizDifficulty: item?.quizDifficulty || this.levelLabel(this.studentLevel),
      quizDurationMinutes: item?.quizDurationMinutes || 10,
      quizPassingScore: item?.quizPassingScore || 70,
      quizQuestions: Array.isArray(item?.quizQuestions) ? item.quizQuestions : [],
      quizAttempts: item?.quizAttempts || 5,
      focusLabels: item?.focusLabels,
      focusKeywords: item?.focusKeywords,
      recommendationScore: item?.recommendationScore || 999,
    };
  }

  private loadStudentContent() {
    this.loading = true;
    this.error = '';
    const className = this.readStoredStudentClass();
    const query = new URLSearchParams({
      level: this.studentLevel,
      ...(className ? { className } : {}),
    });

    this.http
      .get<{
        level: StudentLevel;
        contents: ContentItem[];
        recommendations: ContentItem[];
        recommendationAnalysis?: RecommendationAnalysis;
        progress?: DashboardProgress;
        stats: {
          totalCourses: number;
          totalDocuments: number;
          totalVideos: number;
          totalQuizzes: number;
          totalItems: number;
        };
      }>(`/api/student/dashboard?${query.toString()}`)
      .subscribe({
      next: payload => {
        try {
          this.currentClassStudentCount = this.resolveStudentCountFromDashboard(payload);
          this.applyDashboardPayload(payload);
          this.cacheDashboardPayload(payload);
        } catch (error) {
          console.error('[StudentDashboard] Failed to apply dashboard payload', error);
          this.learningPath = [];
          this.courseCatalog = [];
          this.filteredCourseCatalog = [];
          this.recommendations = [];
          this.overviewCards = this.buildOverviewCards([]);
          this.error = "Impossible d'afficher les contenus charges.";
        } finally {
          this.loading = false;
          this.refreshView();
        }
      },
      error: () => {
        this.learningPath = [];
        this.courseCatalog = [];
        this.filteredCourseCatalog = [];
        this.recommendations = [];
        this.overviewCards = this.buildOverviewCards([]);
        this.error =
          "Impossible de charger les contenus de l'espace etudiant pour le moment.";
        this.loading = false;
        this.refreshView();
      },
    });
  }

  private loadLeaderboard() {
    this.leaderboardLoading = true;
    this.leaderboardError = '';
    const className = this.readStoredStudentClass();
    const query = new URLSearchParams({
      ...(this.leaderboardFilter !== 'tous' ? { level: this.leaderboardFilter } : {}),
      ...(className ? { className } : {}),
    });

    this.http
      .get<LeaderboardPayload>(`/api/student/leaderboard?${query.toString()}`)
      .subscribe({
        next: payload => {
          this.leaderboard = payload;
          this.leaderboardLoading = false;
          this.refreshView();
          this.speakLeaderboardPosition(payload.currentStudent || null);
        },
        error: () => {
          this.leaderboardError = 'Impossible de charger le classement pour le moment.';
          this.leaderboardLoading = false;
          this.refreshView();
        },
      });
  }

  private loadInternships() {
    if (this.internshipsLoading) {
      return;
    }

    this.internshipsLoading = true;
    this.internshipsError = '';
    this.http.get<InternshipOpportunity[]>('/api/internships').subscribe({
      next: internships => {
        this.internships = this.mergeInternships(internships || [], this.readLocalInternships());
        this.internshipsLoading = false;
        this.refreshView();
      },
      error: () => {
        this.internships = this.readLocalInternships();
        this.internshipsError = this.internships.length
          ? ''
          : 'Impossible de charger les offres de stage pour le moment.';
        this.internshipsLoading = false;
        this.refreshView();
      },
    });
  }

  private readLocalInternships(): InternshipOpportunity[] {
    try {
      const raw = localStorage.getItem(this.localInternshipsKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private mergeInternships(primary: InternshipOpportunity[], secondary: InternshipOpportunity[]) {
    const seen = new Set<string>();
    return [...primary, ...secondary].filter(item => {
      const key =
        item._id ||
        [item.title, item.company, item.city, item.deadline]
          .map(value => String(value || '').trim().toLowerCase())
          .join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private loadHeaderProfile() {
    const payload = this.authPayload();
    const tokenName = [
      payload?.['given_name'],
      payload?.['family_name'],
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || payload?.['name'] || payload?.['preferred_username'] || '';

    if (tokenName) {
      this.studentProfile.name = tokenName;
    }

    this.http.get<any>('/auth/profile').subscribe({
      next: (response) => {
        const profile = response?.data || response || {};
        this.studentProfile.name = profile.fullName || this.studentProfile.name;
        this.studentProfile.email = String(profile.email || this.currentStudentEmail()).trim().toLowerCase();
        this.studentProfile.className = this.resolveProfileClassName(profile);
        this.storeStudentClass(this.studentProfile.className);
        this.studentProfile.avatarDataUrl = profile.avatarDataUrl || '';
        const profileLevel = this.normalizeLevel(profile.level);
        if (profileLevel) {
          this.studentLevel = profileLevel;
          this.studentProfile.levelLabel = this.levelLabel(profileLevel);
          localStorage.setItem(this.studentLevelStorageKey(), profileLevel);
        }
        this.loadClassStudentCountFallback();
      },
      error: () => {
        // Keep token-derived fallback in the header if profile is unavailable.
        this.studentProfile.className = this.readStoredStudentClass();
        this.loadClassStudentCountFallback();
      },
    });
  }

  private resolveProfileClassName(profile: any): string {
    const classCandidates = [
      profile?.className,
      profile?.studentClass,
      profile?.class,
      profile?.classe,
      Array.isArray(profile?.classes) ? profile.classes[0] : undefined,
      Array.isArray(profile?.assignedClasses) ? profile.assignedClasses[0] : undefined,
    ];

    for (const value of classCandidates) {
      if (typeof value === 'string' && value.trim()) {
        return this.formatStudentClassName(value);
      }
    }

    return '';
  }

  private readStoredStudentClass(): string {
    return this.formatStudentClassName(localStorage.getItem('current_user_class') || '');
  }

  private loadClassStudentCountFallback() {
    const className = this.studentProfile.className || this.readStoredStudentClass();
    this.currentClassStudentCount = className ? 1 : 0;
    this.applyClassStudentCountToCourses();
  }

  private applyClassStudentCountToCourses() {
    this.courseCatalog = this.courseCatalog.map(course => ({
      ...course,
      students: this.currentClassStudentCount,
    }));

    this.updateFilteredCourseCatalog();

    if (this.selectedCourse) {
      this.selectedCourse = {
        ...this.selectedCourse,
        students: this.currentClassStudentCount,
      };
    }
  }

  private storeStudentClass(className: string) {
    localStorage.setItem('current_user_class', this.formatStudentClassName(className || ''));
  }

  private formatStudentClassName(value: string): string {
    return value.trim().toUpperCase();
  }

  private authPayload(): Record<string, any> | null {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      return null;
    }

    const payloadPart = token.split('.')[1];
    if (!payloadPart) {
      return null;
    }

    try {
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
  }

  private restoreCachedDashboard() {
    const raw = localStorage.getItem(this.dashboardCacheKey());
    if (!raw) {
      return;
    }

    try {
      const payload = JSON.parse(raw) as {
        contents: ContentItem[];
        recommendations?: ContentItem[];
        recommendationAnalysis?: RecommendationAnalysis;
      };
      this.applyDashboardPayload(payload);
    } catch {
      localStorage.removeItem(this.dashboardCacheKey());
    }
  }

  private clearCachedDashboard() {
    Object.keys(localStorage)
      .filter(key => key.startsWith(this.dashboardCacheKeyPrefix))
      .forEach(key => localStorage.removeItem(key));
  }

  private clearLocalContentState() {
    const contentStatePrefixes = [
      this.dashboardCacheKeyPrefix,
      'eduvia-content-progress',
      'eduvia-quiz-result',
    ];

    Object.keys(localStorage)
      .filter(key => contentStatePrefixes.some(prefix => key.startsWith(prefix)))
      .forEach(key => localStorage.removeItem(key));
  }

  private cacheDashboardPayload(payload: {
    contents: ContentItem[];
    recommendations?: ContentItem[];
    recommendationAnalysis?: RecommendationAnalysis;
  }) {
    try {
      localStorage.setItem(this.dashboardCacheKey(), JSON.stringify(payload));
    } catch (error) {
      console.warn('[StudentDashboard] Dashboard cache skipped', error);
      localStorage.removeItem(this.dashboardCacheKey());
    }
  }

  private applyDashboardPayload(payload: {
    contents: ContentItem[];
    recommendations?: ContentItem[];
    recommendationAnalysis?: RecommendationAnalysis;
    progress?: DashboardProgress;
  }) {
    if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
      this.clearLocalContentState();
    }

    const activeContents = this.filterClientVisibleHierarchy(
      (payload.contents || []).filter(item => item && item.type),
    );
    this.syncProgressState(payload.progress);
    const decoratedContents = this.decorateVisibleContents(activeContents);

    this.allVisibleContents = decoratedContents;
    this.recommendationAnalysis = payload.recommendationAnalysis || null;
    this.learningPath = this.buildLearningPath(decoratedContents);
    this.courseCatalog = this.buildCourseCatalog(decoratedContents);
    this.updateFilteredCourseCatalog();
    this.recommendations = this.buildRecommendations(
      payload.recommendationAnalysis?.recommendedContents?.length
        ? payload.recommendationAnalysis.recommendedContents
        : payload.recommendations || decoratedContents,
    );
    this.overviewCards = this.buildOverviewCards(decoratedContents);
    this.refreshCompletedQuizIds();
    this.syncPassedQuizzesToBackend(decoratedContents);
    if (this.selectedCourse) {
      const refreshedCourse =
        this.courseCatalog.find(course => course.id === this.selectedCourse?.id) || null;
      this.selectedCourse = refreshedCourse;
      this.selectedCourseResources = refreshedCourse
        ? this.buildCourseResources(refreshedCourse.id)
        : [];
      this.selectedCourseResourceFolders = this.buildCourseResourceFolders(this.selectedCourseResources);
      this.selectedCourseResourceChapters = this.buildCourseResourceChapters(this.selectedCourseResources);
    }
  }

  private filterClientVisibleHierarchy(contents: ContentItem[]): ContentItem[] {
    contents = contents
      .filter(item => {
        const cId = (item.courseId || '').trim().toLowerCase();
        const title = (item.title || '').trim().toLowerCase();
        const chId = (item.chapterId || '').trim().toLowerCase();
        return cId !== 'test' && cId !== 'cours test' && title !== 'test' && title !== 'cours test' && chId !== 'test';
      })
      .map(item => ({
        ...item,
        title: this.cleanEncoding(item.title),
        courseId: item.courseId ? this.cleanEncoding(item.courseId) : item.courseId,
        chapterId: item.chapterId ? this.cleanEncoding(item.chapterId) : item.chapterId,
        description: item.description ? this.cleanEncoding(item.description) : item.description,
      }));

    const selfVisible = new Map(
      contents.map(item => [this.contentIdentity(item), this.isClientVisibleItem(item)]),
    );
    const courses = contents.filter(item => this.normalizeType(item.type) === 'course');
    const chapters = contents.filter(item => this.normalizeType(item.type) === 'chapter');
    const parts = contents.filter(item => this.normalizeType(item.type) === 'part');
    const isVisible = (item?: ContentItem) =>
      !item || selfVisible.get(this.contentIdentity(item)) !== false;
    const matches = (source?: string, ...candidates: Array<string | undefined>) => {
      const normalizedSource = this.normalizeReference(source);
      return !!normalizedSource && candidates.some(candidate => this.normalizeReference(candidate) === normalizedSource);
    };

    const findCourse = (item: ContentItem) =>
      courses.find(course => matches(item.courseId, course._id, course.courseId, course.title));
    const findChapter = (item: ContentItem) =>
      chapters.find(chapter =>
        matches(item.chapterId, chapter._id, chapter.chapterId, chapter.title) &&
        (!item.courseId || !chapter.courseId || matches(item.courseId, chapter.courseId)),
      );
    const findPart = (item: ContentItem) =>
      parts.find(part =>
        matches(item.partId, part._id, part.partId, part.title) &&
        (!item.courseId || !part.courseId || matches(item.courseId, part.courseId)) &&
        (!item.chapterId || !part.chapterId || matches(item.chapterId, part.chapterId)),
      );

    return contents.filter(item => {
      if (!isVisible(item)) {
        return false;
      }

      const course = findCourse(item);
      if (course && !isVisible(course)) {
        return false;
      }

      if (this.normalizeType(item.type) === 'course') {
        return true;
      }

      const chapter = findChapter(item);
      if (chapter && !isVisible(chapter)) {
        return false;
      }

      if (this.normalizeType(item.type) === 'chapter') {
        return true;
      }

      const part = findPart(item);
      if (part && !isVisible(part)) {
        return false;
      }

      return true;
    });
  }

  private contentIdentity(item: ContentItem): string {
    return String(item?._id || item?.courseId || item?.title || '').trim();
  }

  private isClientVisibleItem(item: ContentItem): boolean {
    if (item.isActive !== false) {
      return true;
    }

    return this.isVisibleQuizForStudent(item);
  }

  private isVisibleQuizForStudent(item: ContentItem): boolean {
    return (
      this.isQuiz(item) &&
      this.matchesStudentLevel(item.quizDifficulty) &&
      Array.isArray(item.quizQuestions) &&
      item.quizQuestions.length > 0
    );
  }

  private normalizeType(value?: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized.includes('vid')) {
      return 'video';
    }
    return normalized;
  }

  private normalizeReference(value?: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  private courseGroupKey(item: Pick<ContentItem, 'courseId'>): string {
    return this.normalizeReference(item.courseId || 'Cours') || 'cours';
  }

  private courseDisplayTitle(item: Pick<ContentItem, 'courseId'>): string {
    return String(item.courseId || '').trim() || 'Cours';
  }

  private preferredCourseTitle(currentTitle: string, item: ContentItem): string {
    const candidate = this.courseDisplayTitle(item);
    if (!currentTitle || currentTitle === 'Cours') {
      return candidate;
    }

    if (item.visibleToAllClasses === true && this.normalizeReference(candidate) === this.normalizeReference(currentTitle)) {
      return candidate;
    }

    return currentTitle;
  }

  private syncPassedQuizzesToBackend(contents: ContentItem[]) {
    if (this.quizProgressSyncInFlight) {
      return;
    }

    const quizItemsToSync = contents
      .filter(item => this.isQuiz(item))
      .map(item => ({
        item,
        quizId: String(item._id || '').trim(),
      }))
      .filter(({ quizId }) => !!quizId)
      .filter(({ quizId }) => !this.completedContentIds.has(quizId))
      .filter(({ quizId, item }) => this.hasSubmittedQuizAttempt(quizId, item));

    if (quizItemsToSync.length === 0) {
      return;
    }

    this.quizProgressSyncInFlight = true;

    let remaining = quizItemsToSync.length;
    let hasTriggeredReload = false;

    quizItemsToSync.forEach(({ quizId, item }) => {
      const result = this.findAnyStoredQuizResult(quizId, item);
      this.writeLocalContentProgress(quizId, result?.passed ? 'passed' : 'completed');

      this.http
        .post('/api/student/progress', {
          contentId: quizId,
          status: result?.passed ? 'passed' : 'completed',
          score: result?.score ?? null,
        })
        .subscribe({
          next: () => {
            this.completedContentIds = new Set([...this.completedContentIds, quizId]);
            remaining -= 1;
            if (remaining <= 0 && !hasTriggeredReload) {
              hasTriggeredReload = true;
              this.quizProgressSyncInFlight = false;
              this.loadStudentContent();
            }
          },
          error: () => {
            remaining -= 1;
            if (remaining <= 0 && !hasTriggeredReload) {
              hasTriggeredReload = true;
              this.quizProgressSyncInFlight = false;
              this.refreshProgressDecorations();
            }
          },
        });
    });
  }

  private dashboardCacheKey() {
    return `${this.dashboardCacheKeyPrefix}-${this.studentLevel}`;
  }

  private syncProgressState(progress?: DashboardProgress) {
    const completedIds = Array.isArray(progress?.completedContentIds)
      ? progress?.completedContentIds.map(value => String(value || '').trim()).filter(Boolean)
      : [];

    this.completedContentIds = new Set(completedIds);
    this.dashboardProgressPercent = Math.max(
      0,
      Math.min(100, Number(progress?.globalProgress || 0)),
    );
    this.dashboardCompletedItems = Number(progress?.totals?.completedMaterials || completedIds.length || 0);
    this.dashboardTotalItems = Number(progress?.totals?.totalMaterials || 0);
  }

  private decorateVisibleContents(contents: ContentItem[]): ContentItem[] {
    const groups = new Map<string, ContentItem[]>();

    contents.forEach(item => {
      const courseKey = this.courseGroupKey(item);
      const nextItems = groups.get(courseKey) || [];
      nextItems.push(item);
      groups.set(courseKey, nextItems);
    });

    const decoratedById = new Map<string, ContentItem>();

    groups.forEach(items => {
      const orderedItems = items
        .filter(item => this.isTrackableContent(item))
        .sort((left, right) => this.compareContentOrder(left, right));
      let hasIncompleteRequiredContent = false;

      orderedItems.forEach(item => {
        let completed = this.isContentCompleted(item);
        const isQuiz = this.isQuiz(item);
        let isLocked = false;

        if (!isQuiz) {
          if (!completed) {
            hasIncompleteRequiredContent = true;
          }
        } else if (hasIncompleteRequiredContent) {
          isLocked = true;
          completed = false;
        }

        decoratedById.set(item._id, {
          ...item,
          isCompleted: completed,
          isLocked,
          canMarkCompleted: !isLocked && !this.isQuiz(item),
          completionButton: {
            label: completed ? 'Termine' : 'Marquer termine',
            variant: completed ? 'success' : 'neutral',
            disabled: isLocked,
          },
        });
      });
    });

    return contents.map(item => decoratedById.get(item._id) || item);
  }

  private compareContentOrder(left: ContentItem, right: ContentItem) {
    const leftChapterOrder = this.extractSequenceNumber(left.chapterId);
    const rightChapterOrder = this.extractSequenceNumber(right.chapterId);
    if (leftChapterOrder !== rightChapterOrder) {
      return leftChapterOrder - rightChapterOrder;
    }

    const leftPartOrder = this.extractSequenceNumber(left.partId);
    const rightPartOrder = this.extractSequenceNumber(right.partId);
    if (leftPartOrder !== rightPartOrder) {
      return leftPartOrder - rightPartOrder;
    }

    const leftTypeOrder = this.contentTypeOrder(left);
    const rightTypeOrder = this.contentTypeOrder(right);
    if (leftTypeOrder !== rightTypeOrder) {
      return leftTypeOrder - rightTypeOrder;
    }

    return String(left.title || '').localeCompare(String(right.title || ''), 'fr');
  }

  private extractSequenceNumber(value?: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return 9999;
    }

    const directMatch = normalized.match(/(\d+)/);
    if (directMatch?.[1]) {
      return Number(directMatch[1]);
    }

    return 9999;
  }

  private contentTypeOrder(item: ContentItem) {
    if (this.isDocument(item)) {
      return 1;
    }
    if (this.isVideo(item)) {
      return 2;
    }
    if (this.isQuiz(item)) {
      return 3;
    }

    return 9;
  }

  private isContentCompleted(item: ContentItem) {
    const contentId = String(item._id || '').trim();
    if (!contentId) {
      return false;
    }

    if (this.isQuiz(item)) {
      if (
        item.progressStatus === 'passed' ||
        item.progressStatus === 'completed' ||
        this.completedContentIds.has(contentId) ||
        this.completedQuizIds.has(contentId)
      ) {
        return true;
      }
      return !!this.findAnyStoredQuizResult(contentId, item);
    }

    if (
      item.isCompleted ||
      item.progressStatus === 'completed' ||
      item.progressStatus === 'passed'
    ) {
      return true;
    }

    if (this.completedContentIds.has(contentId)) {
      return true;
    }

    return false;
  }

  private localContentProgressKey(contentId: string) {
    const currentUserEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
    return currentUserEmail
      ? `eduvia-content-progress-${currentUserEmail}-${contentId}`
      : `eduvia-content-progress-${contentId}`;
  }

  private readLocalContentProgress(contentId: string) {
    return localStorage.getItem(this.localContentProgressKey(contentId)) || '';
  }

  private writeLocalContentProgress(contentId: string, status: 'completed' | 'passed') {
    localStorage.setItem(this.localContentProgressKey(contentId), status);
  }

  markContentCompleted(item: RecommendationItem) {
    if (!item.id || item.isLocked || item.isCompleted || item.type === 'Quiz') {
      return;
    }

    const courseBefore = this.selectedCourse
      ? { id: this.selectedCourse.id, progress: this.selectedCourse.progress }
      : null;
    const contentId = String(item.id).trim();
    this.writeLocalContentProgress(contentId, 'completed');
    this.completedContentIds = new Set([...this.completedContentIds, contentId]);
    this.refreshProgressDecorations();
    this.maybeShowCourseCompletionDialog(courseBefore);

    this.http
      .post('/api/student/progress', {
        contentId,
        status: 'completed',
      })
      .subscribe({
        next: () => this.loadStudentContent(),
        error: () => this.loadStudentContent(),
      });
  }

  private refreshProgressDecorations() {
    this.allVisibleContents = this.decorateVisibleContents(this.allVisibleContents);
    this.learningPath = this.buildLearningPath(this.allVisibleContents);
    this.courseCatalog = this.buildCourseCatalog(this.allVisibleContents);
    this.updateFilteredCourseCatalog();
    this.recommendations = this.buildRecommendations(this.allVisibleContents);
    this.overviewCards = this.buildOverviewCards(this.allVisibleContents);

    if (this.selectedCourse) {
      const refreshedCourse =
        this.courseCatalog.find(course => course.id === this.selectedCourse?.id) || null;
      this.selectedCourse = refreshedCourse;
      this.selectedCourseResources = refreshedCourse
        ? this.buildCourseResources(refreshedCourse.id)
        : [];
      this.selectedCourseResourceFolders = this.buildCourseResourceFolders(this.selectedCourseResources);
      this.selectedCourseResourceChapters = this.buildCourseResourceChapters(this.selectedCourseResources);
    }
  }

  private maybeShowCourseCompletionDialog(courseBefore: { id: string; progress: number } | null) {
    if (!courseBefore || courseBefore.progress >= 100) {
      return;
    }

    const completedCourse = this.courseCatalog.find(course => course.id === courseBefore.id);
    if (!completedCourse || completedCourse.progress < 100) {
      return;
    }

    this.showCourseCompletionDialog(completedCourse);
  }

  private showCourseCompletionDialog(course: CourseCatalogItem) {
    const stats = this.buildCourseCompletionStats(course.id);
    this.courseCompletionDialog = {
      visible: true,
      courseTitle: course.title,
      chaptersCompleted: stats.chaptersCompleted,
      quizzesPassed: stats.quizzesPassed,
      averageScore: stats.averageScore,
    };
    this.playCourseCompletionAudio();
  }

  closeCourseCompletionDialog() {
    this.courseCompletionDialog.visible = false;
  }

  private buildCourseCompletionStats(courseId: string) {
    const resources = this.buildCourseResources(courseId);
    const completedChapters = new Set(
      resources
        .filter(item => item.isCompleted)
        .map(item => String(item.chapterId || 'Chapitre').trim() || 'Chapitre'),
    );
    const quizScores = resources
      .filter(item => item.type === 'Quiz')
      .map(item => this.findAnyStoredQuizResult(item.id, item))
      .filter((result): result is StoredQuizAttempt => !!result);
    const quizzesPassed = quizScores.filter(result => result.passed !== false).length;
    const averageScore = quizScores.length
      ? Math.round(
          quizScores.reduce((sum, result) => sum + Number(result.score || 0), 0) /
          quizScores.length,
        )
      : 0;

    return {
      chaptersCompleted: completedChapters.size,
      quizzesPassed,
      averageScore,
    };
  }

  private playCourseCompletionAudio() {
    this.playCompletionChime();
    window.setTimeout(() => this.speakCourseCompletionMessage(), 650);
  }

  private playCompletionChime() {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    try {
      const audioContext = new AudioContextCtor();
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        const start = audioContext.currentTime + index * 0.12;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        oscillator.start(start);
        oscillator.stop(start + 0.24);
      });
    } catch {
      // Audio playback can be blocked by the browser before a user gesture.
    }
  }

  private speakCourseCompletionMessage() {
    if (!window.speechSynthesis) {
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        'Bravo tu as fini ce cours. Bon courage pour les autres cours.',
      );
      utterance.lang = 'fr-FR';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis is optional on some browsers.
    }
  }

  private resolveStudentCountFromDashboard(payload: any): number {
    const rawValue = Number(payload?.stats?.classmatesCount);
    if (Number.isFinite(rawValue) && rawValue >= 0) {
      return rawValue;
    }

    return this.studentProfile.className ? 1 : 0;
  }

  private buildLearningPath(contents: ContentItem[]): LearningPathCourse[] {
    const grouped = new Map<
      string,
      {
        title: string;
        descriptions: Set<string>;
        items: ContentItem[];
      }
    >();

    contents.forEach(item => {
      const courseKey = this.courseGroupKey(item);
      const title = this.courseDisplayTitle(item);
      if (courseKey === 'test' || title.trim().toLowerCase() === 'test' || title.trim().toLowerCase() === 'cours test') {
        return;
      }
      if (!grouped.has(courseKey)) {
        grouped.set(courseKey, {
          title: this.cleanEncoding(title),
          descriptions: new Set<string>(),
          items: [],
        });
      }

      const bucket = grouped.get(courseKey)!;
      bucket.title = this.cleanEncoding(this.preferredCourseTitle(bucket.title, item));
      if (item.chapterId) {
        bucket.descriptions.add(this.cleanEncoding(item.chapterId));
      }
      bucket.items.push(item);
    });

    return Array.from(grouped.entries())
      .filter(([id, group]) => id !== 'test' && group.title.trim().toLowerCase() !== 'test')
      .map(([id, group], index) => {
      const visibleQuizzes = group.items.filter(
        item =>
          this.isQuiz(item) &&
          this.matchesStudentLevel(item.quizDifficulty),
      );
      const visibleItems = group.items.filter(
        item =>
          this.isTrackableContent(item) &&
          (!this.isQuiz(item) || this.matchesStudentLevel(item.quizDifficulty)),
      );
      const progress = Math.min(25 + index * 18 + visibleItems.length * 7, 95);

      return {
        id,
        title: group.title,
        description:
          Array.from(group.descriptions).join(' • ') ||
          'Contenus ajoutes par votre professeur',
        level: this.studentProfile.levelLabel,
        duration: `${Math.max(1, visibleItems.length * 2)} heures`,
        progress,
      };
    });
  }

  private buildCourseCatalog(contents: ContentItem[]): CourseCatalogItem[] {
    const grouped = new Map<
      string,
      {
        title: string;
        descriptions: Set<string>;
        items: ContentItem[];
      }
    >();

    contents.forEach(item => {
      const courseKey = this.courseGroupKey(item);
      const title = this.courseDisplayTitle(item);
      if (courseKey === 'test' || title.trim().toLowerCase() === 'test' || title.trim().toLowerCase() === 'cours test') {
        return;
      }
      if (!grouped.has(courseKey)) {
        grouped.set(courseKey, {
          title: this.cleanEncoding(title),
          descriptions: new Set<string>(),
          items: [],
        });
      }

      const bucket = grouped.get(courseKey)!;
      bucket.title = this.cleanEncoding(this.preferredCourseTitle(bucket.title, item));
      if (item.chapterId) {
        bucket.descriptions.add(this.cleanEncoding(item.chapterId));
      }
      bucket.items.push(item);
    });

    return Array.from(grouped.entries())
      .filter(([id, group]) => id !== 'test' && group.title.trim().toLowerCase() !== 'test')
      .map(([id, group], index) => {
      const chapterCount = Math.max(1, group.descriptions.size);
      const trackableItems = group.items.filter(item => this.isTrackableContent(item));
      const itemCount = trackableItems.length;
      const completedItems = trackableItems.filter(item => item.isCompleted).length;
      const progress = itemCount > 0 ? Math.round((completedItems / itemCount) * 100) : 0;
      const detectedLevel =
        group.items.find(item => this.isQuiz(item) && this.matchesStudentLevel(item.quizDifficulty))
          ?.quizDifficulty || this.studentProfile.levelLabel;
      return {
        id,
        title: group.title,
        description:
          Array.from(group.descriptions).join(', ') ||
          'Choisissez ce cours pour commencer votre apprentissage',
        level: this.levelLabel(this.normalizeLevel(detectedLevel) || this.studentLevel),
        chapters: chapterCount,
        hours: Math.max(2, itemCount * 2),
        students: this.currentClassStudentCount,
        rating: Number((4.2 + ((index % 4) * 0.15)).toFixed(1)),
        teacher: this.teacherNameForCourse(group.items, index),
        teacherAvatarDataUrl: this.teacherAvatarForCourse(group.items),
        progress,
        completedItems,
        totalItems: itemCount,
        progressLabel: `${completedItems} elements termines sur ${itemCount}`,
        coverStyle: this.coverStyleForIndex(index),
        accent: this.coverAccent(index),
      };
    });
  }

  updateFilteredCourseCatalog() {
    const search = this.normalizeSearchText(this.searchTerm);

    let result = [...this.courseCatalog].filter(course => {
      if (course.id.toLowerCase() === 'test' || course.title.trim().toLowerCase() === 'test' || course.title.trim().toLowerCase() === 'cours test') {
        return false;
      }
      const matchesSearch = !search || this.matchesCourseSearch(course, search);

      return matchesSearch;
    });

    switch (this.selectedSort) {
      case 'Mieux notes':
        result.sort((a, b) => b.rating - a.rating);
        break;
      case 'A continuer':
        result.sort((a, b) => b.progress - a.progress);
        break;
      case 'Ordre alphabetique':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        result.sort((a, b) => b.students - a.students);
        break;
    }

    this.filteredCourseCatalog = result;
  }

  private matchesCourseSearch(course: CourseCatalogItem, search: string) {
    const normalizedTitle = this.normalizeSearchText(course.title);
    const normalizedDescription = this.normalizeSearchText(course.description);
    const normalizedTeacher = this.normalizeSearchText(course.teacher);
    const normalizedChapters = this.normalizeSearchText(`${course.chapters} chapitres`);
    const words = [
      ...normalizedTitle.split(/\s+/),
      ...normalizedDescription.split(/\s+/),
      ...normalizedTeacher.split(/\s+/),
      ...normalizedChapters.split(/\s+/),
    ].filter(Boolean);

    if (search.length === 1) {
      return words.some(word => word.startsWith(search));
    }

    return (
      normalizedTitle.includes(search) ||
      normalizedDescription.includes(search) ||
      normalizedTeacher.includes(search) ||
      normalizedChapters.includes(search) ||
      words.some(word => word.startsWith(search))
    );
  }

  private normalizeSearchText(value: string) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private buildRecommendations(contents: ContentItem[]): RecommendationItem[] {
    const levelLabel = this.levelLabel(this.studentLevel);
    const filtered = contents.filter(item => {
      if (this.isQuiz(item)) {
        return this.isVisibleQuizForStudent(item);
      }

      if (!item.isActive && item.isActive !== undefined) {
        return false;
      }

      return this.isDocument(item) || this.isVideo(item);
    });

    return filtered.slice(0, 6).map(item => ({
      id: item._id,
      icon: this.isQuiz(item)
        ? 'quiz'
        : this.isVideo(item)
          ? 'videocam'
          : 'menu_book',
      title: item.title || 'Contenu sans titre',
      type: this.isQuiz(item)
        ? 'Quiz'
        : this.isVideo(item)
          ? 'Video'
          : 'Cours',
      level: levelLabel,
      duration: this.isQuiz(item)
        ? `${this.normalizedQuizDurationMinutes(item.quizDurationMinutes) || 15} min`
        : this.isVideo(item)
          ? '12 min'
          : '25 min',
      reason: item.recommendationReason || (this.isQuiz(item)
        ? `Quiz ${levelLabel.toLowerCase()} adapte a votre niveau`
        : `Ajoute par ${item.teacherName || 'votre enseignant'} dans ${item.courseId || 'le cours'}`),
      contentType: this.normalizedContentType(item.type) || item.type,
      description: item.description,
      fileUrl: item.fileUrl,
      source: item.source,
      courseId: item.courseId,
      chapterId: item.chapterId,
      partId: item.partId,
      teacherName: item.teacherName,
      teacherAvatarDataUrl: item.teacherAvatarDataUrl,
      fileName: item.fileName,
      dueDate: item.dueDate,
      quizMode: item.quizMode,
      quizDifficulty: item.quizDifficulty,
      quizDurationMinutes: item.quizDurationMinutes,
      quizPassingScore: item.quizPassingScore as number | undefined,
      quizQuestions: item.quizQuestions,
      quizAttempts: item.quizAttempts,
      isCompleted: item.isCompleted,
      isLocked: item.isLocked,
      canMarkCompleted: item.canMarkCompleted,
      completionButtonLabel: item.completionButton?.label || 'Marquer termine',
      completionButtonVariant: item.completionButton?.variant || 'neutral',
      completionButtonDisabled: item.completionButton?.disabled ?? false,
      focusLabels: item.focusLabels || [],
      focusKeywords: item.focusKeywords || [],
      recommendationScore: item.recommendationScore,
    }));
  }

  private buildCourseResources(courseId: string): RecommendationItem[] {
    return this.allVisibleContents
      .filter(item => this.courseGroupKey(item) === courseId)
      .filter(item => {
        if (this.isQuiz(item)) {
          return (
            this.matchesStudentLevel(item.quizDifficulty) &&
            Array.isArray(item.quizQuestions) &&
            item.quizQuestions.length > 0
          );
        }

        return this.isDocument(item) || this.isVideo(item);
      })
      .sort((left, right) => this.compareContentOrder(left, right))
      .map<RecommendationItem>(item => ({
        id: item._id,
        icon: this.isQuiz(item)
          ? 'quiz'
          : this.isVideo(item)
            ? 'videocam'
            : 'menu_book',
        title: item.title || 'Contenu sans titre',
        type: this.isQuiz(item)
          ? 'Quiz'
          : this.isVideo(item)
            ? 'Video'
            : 'Cours',
        level: this.levelLabel(this.studentLevel),
        duration: this.isQuiz(item)
          ? `${this.normalizedQuizDurationMinutes(item.quizDurationMinutes) || 15} min`
          : this.isVideo(item)
            ? '12 min'
            : '25 min',
        reason: item.chapterId
          ? `${item.chapterId} dans ${item.courseId || 'le cours'}`
          : `Ajoute dans ${item.courseId || 'le cours'}`,
        contentType: this.normalizedContentType(item.type) || item.type,
        description: item.description,
        fileUrl: item.fileUrl,
        source: item.source,
        courseId: item.courseId,
        chapterId: item.chapterId,
        partId: item.partId,
        teacherName: item.teacherName,
        teacherAvatarDataUrl: item.teacherAvatarDataUrl,
        fileName: item.fileName,
        dueDate: item.dueDate,
        quizMode: item.quizMode,
        quizDifficulty: item.quizDifficulty,
        quizDurationMinutes: item.quizDurationMinutes,
        quizPassingScore: item.quizPassingScore as number | undefined,
        quizQuestions: item.quizQuestions,
        quizAttempts: item.quizAttempts,
        isCompleted: item.isCompleted,
        isLocked: item.isLocked,
        canMarkCompleted: item.canMarkCompleted,
        completionButtonLabel: item.completionButton?.label || 'Marquer termine',
        completionButtonVariant: item.completionButton?.variant || 'neutral',
        completionButtonDisabled: item.completionButton?.disabled ?? false,
      }));
  }

  private buildCourseResourceFolders(resources: RecommendationItem[]): CourseResourceFolder[] {
    const folders: CourseResourceFolder[] = [
      {
        key: 'documents',
        title: 'Documents',
        icon: 'description',
        items: resources.filter(item => item.type === 'Cours'),
      },
      {
        key: 'videos',
        title: 'Videos',
        icon: 'play_circle',
        items: resources.filter(item => item.type === 'Video'),
      },
      {
        key: 'quizzes',
        title: 'Quiz',
        icon: 'quiz',
        items: resources.filter(item => item.type === 'Quiz'),
      },
    ];

    return folders.filter(folder => folder.items.length > 0);
  }

  private buildCourseResourceChapters(resources: RecommendationItem[]): CourseResourceChapter[] {
    const chapterGroups = new Map<string, { title: string; items: RecommendationItem[] }>();

    resources.forEach(item => {
      const title = String(item.chapterId || 'Sans chapitre').trim() || 'Sans chapitre';
      const key = this.normalizeReference(title) || title.toLowerCase();
      const group = chapterGroups.get(key) || { title, items: [] };
      group.items.push(item);
      chapterGroups.set(key, group);
    });

    return Array.from(chapterGroups.values())
      .sort((left, right) => this.compareLabelOrder(left.title, right.title))
      .map(chapter => ({
        title: chapter.title,
        parts: this.buildCourseResourceParts(chapter.items),
      }));
  }

  private buildCourseResourceParts(resources: RecommendationItem[]): CourseResourcePart[] {
    const partGroups = new Map<string, { title: string; items: RecommendationItem[] }>();

    resources.forEach(item => {
      const title = String(item.partId || 'Contenus du chapitre').trim() || 'Contenus du chapitre';
      const key = this.normalizeReference(title) || title.toLowerCase();
      const group = partGroups.get(key) || { title, items: [] };
      group.items.push(item);
      partGroups.set(key, group);
    });

    return Array.from(partGroups.values())
      .sort((left, right) => this.compareLabelOrder(left.title, right.title))
      .map(part => ({
        title: part.title,
        folders: this.buildCourseResourceFolders(
          part.items.sort((left, right) => this.compareContentOrder(left as any, right as any)),
        ),
      }))
      .filter(part => part.folders.length > 0);
  }

  private compareLabelOrder(left: string, right: string) {
    const leftOrder = this.extractSequenceNumber(left);
    const rightOrder = this.extractSequenceNumber(right);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right, 'fr', { numeric: true, sensitivity: 'base' });
  }

  private buildOverviewCards(contents: ContentItem[]): OverviewCard[] {
    const visibleQuizzes = contents.filter(
      item => this.isQuiz(item) && this.matchesStudentLevel(item.quizDifficulty),
    );
    const visibleDocs = contents.filter(item => this.isDocument(item));
    const visibleVideos = contents.filter(item => this.isVideo(item));
    const totalLearningItems =
      visibleQuizzes.length + visibleDocs.length + visibleVideos.length;
    const progress = this.dashboardProgressPercent || (totalLearningItems ? Math.min(35 + totalLearningItems * 6, 92) : 0);
    const completedItems = this.dashboardCompletedItems || contents.filter(item => item.isCompleted).length;
    const subtitle = totalLearningItems
      ? `${completedItems} element(s) termines sur ${totalLearningItems}`
      : '0 contenu visible';

    return [
      {
        title: 'Progression globale',
        icon: 'trending_up',
        accent: 'blue',
        value: `${progress}%`,
        subtitle,
        progress,
      },
      {
        title: "Serie d'activite",
        icon: 'track_changes',
        accent: 'orange',
        value: `${Math.max(1, visibleDocs.length + visibleVideos.length)} jours`,
        subtitle: 'Continuez comme ca',
        progress: null,
      },
      {
        title: "Style d'apprentissage",
        icon: 'psychology',
        accent: 'green',
        value: this.studentProfile.learningStyle,
        subtitle: "Construit a partir du parcours visible",
        progress: null,
      },
      {
        title: 'Niveau actuel',
        icon: 'military_tech',
        accent: 'yellow',
        value: this.studentProfile.levelLabel,
        subtitle: `${visibleQuizzes.length} quiz correspondant(s)`,
        progress: null,
      },
    ];
  }

  private parseStoredQuizResult(rawAttempt: string, item?: Pick<ContentItem, '_id' | 'title' | 'quizPassingScore' | 'quizAttempts' | 'quizQuestions'> | RecommendationItem): StoredQuizAttempt | null {
    try {
      const parsed = JSON.parse(rawAttempt) as any;

      if (parsed?.result && (typeof parsed.result.score === 'number' || typeof parsed.result.passed === 'boolean')) {
        if (item && parsed.quizFingerprint !== this.quizFingerprintForItem(item)) {
          return null;
        }
        return parsed.result as StoredQuizAttempt;
      }

      if (!item && (typeof parsed?.score === 'number' || typeof parsed?.passed === 'boolean')) {
        return parsed as StoredQuizAttempt;
      }

      return null;
    } catch {
      return null;
    }
  }

  private findAnyStoredQuizResult(quizId: string, item?: Pick<ContentItem, '_id' | 'title' | 'quizPassingScore' | 'quizAttempts' | 'quizQuestions'> | RecommendationItem): StoredQuizAttempt | null {
    const normalizedQuizId = String(quizId || '').trim();
    if (!normalizedQuizId) {
      return null;
    }

    const directAttempt = this.readStoredQuizAttempt(normalizedQuizId);
    if (directAttempt) {
      const parsedDirectAttempt = this.parseStoredQuizResult(directAttempt, item);
      if (parsedDirectAttempt) {
        return parsedDirectAttempt;
      }
    }

    return null;
  }

  private quizFingerprintForItem(item: Pick<ContentItem, '_id' | 'title' | 'quizPassingScore' | 'quizAttempts' | 'quizQuestions'> | RecommendationItem) {
    const quizQuestions = Array.isArray(item.quizQuestions) ? item.quizQuestions : [];
    const questionSignature = quizQuestions
      .map((question: any) => {
        const options = (Array.isArray(question.options) ? question.options : [])
          .map((option: any) => `${option.label}:${option.text}`)
          .join('|');
        const answers = [...(Array.isArray(question.correctAnswers) ? question.correctAnswers : [])].sort().join('|');
        return `${question.id}::${question.prompt}::${options}::${answers}`;
      })
      .join('##');

    return [
      (item as any)._id || (item as any).id,
      item.title,
      item.quizPassingScore || 70,
      item.quizAttempts || 1,
      questionSignature,
    ].join('||');
  }

  private isQuiz(item: ContentItem) {
    return this.normalizedContentType(item.type) === 'quiz';
  }

  private isDocument(item: ContentItem) {
    return this.normalizedContentType(item.type) === 'document';
  }

  private isVideo(item: ContentItem) {
    return this.normalizedContentType(item.type) === 'video';
  }

  private isTrackableContent(item: ContentItem) {
    return this.isDocument(item) || this.isVideo(item) || this.isQuiz(item);
  }

  private normalizedContentType(value?: string) {
    const normalized = (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    if (!normalized) {
      return '';
    }

    if (normalized === 'quiz' || normalized.includes('quiz')) {
      return 'quiz';
    }

    if (
      normalized === 'video' ||
      normalized === 'video/mp4' ||
      normalized.startsWith('video/') ||
      normalized.includes('video') ||
      normalized.includes('mp4') ||
      normalized.includes('youtube')
    ) {
      return 'video';
    }

    if (
      normalized === 'document' ||
      normalized.includes('document') ||
      normalized.includes('pdf') ||
      normalized.includes('docx') ||
      normalized.includes('doc ')
    ) {
      return 'document';
    }

    return normalized;
  }

  private matchesStudentLevel(difficulty?: string) {
    const normalized = this.normalizeLevel(difficulty);
    if (!normalized) {
      return true;
    }

    return normalized === this.studentLevel;
  }

  private normalizeLevel(value?: string): StudentLevel | null {
    const normalized = (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (normalized.startsWith('deb')) {
      return 'debutant';
    }
    if (normalized.startsWith('int') || normalized.includes('moyen')) {
      return 'intermediaire';
    }
    if (normalized.startsWith('ava')) {
      return 'avance';
    }

    return null;
  }

  private levelLabel(level: StudentLevel) {
    switch (level) {
      case 'intermediaire':
        return 'Intermediaire';
      case 'avance':
        return 'Avance';
      default:
        return 'Debutant';
    }
  }

  private buildPreviewUrl(item: RecommendationItem): SafeResourceUrl | null {
    const normalizedUrl = this.resolveMediaUrl(item);
    if (!normalizedUrl) {
      return null;
    }

    return this.sanitizer.bypassSecurityTrustResourceUrl(normalizedUrl);
  }

  private resolveMediaUrl(item: RecommendationItem): string | null {
    const normalizedType = this.normalizedContentType(item.contentType);
    const isVideoContent = normalizedType === 'video';
    const isDocumentContent = normalizedType === 'document';
    const candidates = isVideoContent
      ? [item.fileUrl, item.source, item.fileName]
      : [item.source, item.fileUrl, item.fileName];

    for (const candidate of candidates) {
      const resolved = this.normalizeMediaCandidate(candidate, {
        requireVideoLike: isVideoContent,
        requireDocumentLike: isDocumentContent,
      });
      if (resolved) {
        return resolved;
      }
    }

    // Fallback: for videos, accept non-explicit paths/names as long as we can map them to /uploads.
    if (isVideoContent) {
      for (const candidate of candidates) {
        const resolved = this.normalizeMediaCandidate(candidate);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  private buildVideoEmbedUrl(item: RecommendationItem): SafeResourceUrl | null {
    if (this.normalizedContentType(item.contentType) !== 'video') {
      return null;
    }

    const rawUrl = String(item.source || item.fileUrl || '').trim();
    const youtubeVideoId = this.extractYouTubeVideoId(rawUrl);
    if (!youtubeVideoId) {
      return null;
    }

    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${youtubeVideoId}`,
    );
  }

  private extractYouTubeVideoId(url: string): string | null {
    const value = (url || '').trim();
    if (!value) {
      return null;
    }

    const shortMatch = value.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i);
    if (shortMatch?.[1]) {
      return shortMatch[1];
    }

    const watchMatch = value.match(/[?&]v=([A-Za-z0-9_-]{11})/i);
    if (watchMatch?.[1]) {
      return watchMatch[1];
    }

    const embedMatch = value.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/i);
    if (embedMatch?.[1]) {
      return embedMatch[1];
    }

    return null;
  }

  private normalizeMediaCandidate(
    candidate: string | undefined,
    options: { requireVideoLike?: boolean; requireDocumentLike?: boolean } = {},
  ): string | null {
    const rawValue = String(candidate || '').trim();
    if (!rawValue) {
      return null;
    }

    const normalizedPath = rawValue.replace(/\\/g, '/');
    const isLikelyLocalPath =
      /^[a-z]:\//i.test(normalizedPath) ||
      normalizedPath.startsWith('file:/') ||
      normalizedPath.includes('/fakepath/');
    const normalizedPathOrName = isLikelyLocalPath
      ? normalizedPath.split('/').filter(Boolean).pop() || normalizedPath
      : normalizedPath;
    const uploadsMarkerIndex = normalizedPathOrName.toLowerCase().indexOf('/uploads/');
    const normalizedFromUploads =
      uploadsMarkerIndex >= 0
        ? normalizedPathOrName.slice(uploadsMarkerIndex + 1)
        : normalizedPathOrName;
    const lowerPath = normalizedPathOrName.toLowerCase();
    const fileExtensionMatch = lowerPath.match(/\.([a-z0-9]+)(?:$|[?#])/i);
    const extension = fileExtensionMatch?.[1] || '';
    const looksLikeHttpUrl = /^https?:\/\//i.test(normalizedPathOrName);
    const looksLikeMediaPath =
      normalizedFromUploads.startsWith('/') ||
      normalizedFromUploads.startsWith('uploads/') ||
      normalizedFromUploads.includes('/uploads/') ||
      /\.(mp4|webm|ogg|m3u8|mov|pdf|doc|docx)$/i.test(normalizedFromUploads);
    const looksVideoLike =
      ['mp4', 'webm', 'ogg', 'ogv', 'm3u8', 'mov', 'm4v'].includes(extension);
    const looksDocumentLike = /\.(pdf|doc|docx)$/i.test(normalizedFromUploads);

    if (!looksLikeHttpUrl && !looksLikeMediaPath) {
      return null;
    }
    if (options.requireVideoLike && !looksVideoLike) {
      return null;
    }
    if (options.requireDocumentLike && !looksDocumentLike) {
      return null;
    }

    // Keep full URLs intact; truncating at `/uploads/` turns a backend URL into
    // a frontend-relative path and makes the document request go to port 4200.
    let absoluteUrl = looksLikeHttpUrl ? normalizedPathOrName : normalizedFromUploads;
    if (!looksLikeHttpUrl) {
      let relativePath = normalizedFromUploads;
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }

      const hasUploadsPrefix =
        relativePath.startsWith('uploads/') || relativePath.includes('/uploads/');
      const finalRelativePath = hasUploadsPrefix ? relativePath : `uploads/${relativePath}`;
      absoluteUrl = `${this.backendBaseUrl}/${finalRelativePath}`;
    }

    try {
      return encodeURI(absoluteUrl);
    } catch {
      return absoluteUrl;
    }
  }

  private previewDocumentVoiceKey(item: RecommendationItem) {
    return `student-dashboard:document-preview:${item.id}`;
  }

  private stopPreviewVoice() {
    this.voicePlaybackService.stop();
  }

  private async loadPdfTextContent(documentUrl: string): Promise<string> {
    if (this.previewDocumentTextCache.has(documentUrl)) {
      return this.previewDocumentTextCache.get(documentUrl) || '';
    }

    const response = await fetch(documentUrl);
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
    this.previewDocumentTextCache.set(documentUrl, mergedText);
    return mergedText;
  }

  private buildDocumentSpeechText(item: RecommendationItem, documentText: string) {
    const title = (item.title || 'Document de cours').trim();
    const chapter = (item.chapterId || '').trim();
    const course = (item.courseId || '').trim();
    const introParts = [title];

    if (course) {
      introParts.push(`Cours ${course}`);
    }
    if (chapter) {
      introParts.push(`Chapitre ${chapter}`);
    }

    const cleanedText = documentText
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);

    if (!cleanedText) {
      return `${introParts.join('. ')}. Aucun texte lisible na ete detecte dans ce PDF.`;
    }

    return `${introParts.join('. ')}. ${cleanedText}`;
  }

  private quizStorageKey(quizId: string) {
    const currentUserEmail = (localStorage.getItem('current_user_email') || '')
      .trim()
      .toLowerCase();

    return currentUserEmail
      ? `eduvia-quiz-result-${currentUserEmail}-${quizId}`
      : `eduvia-quiz-result-${quizId}`;
  }

  private currentQuizStorageOwner() {
    return (localStorage.getItem('current_user_email') || '')
      .trim()
      .toLowerCase();
  }

  private currentStudentEmail() {
    return (localStorage.getItem('current_user_email') || '')
      .trim()
      .toLowerCase();
  }

  private studentLevelStorageKey() {
    const email = this.currentStudentEmail();
    return email ? `eduvia-student-level-${email}` : 'eduvia-student-level';
  }

  private assessmentStorageKey() {
    const email = this.currentStudentEmail();
    return email ? `eduvia-initial-level-test-${email}` : 'eduvia-initial-level-test';
  }

  private initialAssessmentResult(): AssessmentResult | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.assessmentStorageKey()) || 'null');
      if (
        parsed &&
        typeof parsed.score === 'number' &&
        parsed.score > 0 &&
        Array.isArray(parsed.strengths) &&
        Array.isArray(parsed.weaknesses)
      ) {
        return parsed as AssessmentResult;
      }
    } catch {
      // ignore
    }

    const lvl = this.studentLevel || 'intermediaire';
    const fallbackScore = lvl === 'avance' ? 85 : lvl === 'debutant' ? 60 : 75;
    return {
      level: lvl,
      levelLabel: this.levelLabel(lvl),
      score: fallbackScore,
      correctCount: Math.round(fallbackScore / 10),
      totalQuestions: 10,
      completedAt: new Date().toISOString(),
      strengths: ['Algorithmique et structures de données', 'Architecture des systèmes'],
      weaknesses: ['Structures de contrôle conditionnelles'],
      recommendation: 'Poursuivez votre progression avec les cours et quiz recommandés.',
    };
  }

  private buildSimplePdf(lines: string[]): Uint8Array {
    const fontSize = 11;
    const lineHeight = 15;
    const pageWidth = 595;
    const pageHeight = 842;
    const marginLeft = 48;
    const topY = 790;
    const bottomMargin = 58;
    const wrappedLines = lines.flatMap(line => this.wrapPdfLine(line, 92));
    const linesPerPage = Math.max(1, Math.floor((topY - bottomMargin) / lineHeight));
    const pages: string[][] = [];

    for (let index = 0; index < wrappedLines.length; index += linesPerPage) {
      pages.push(wrappedLines.slice(index, index + linesPerPage));
    }

    if (pages.length === 0) {
      pages.push(['Resume indisponible.']);
    }

    const objects: string[] = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    const pageObjectNumbers = pages.map((_, pageIndex) => 4 + pageIndex * 2);
    objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    pages.forEach((pageLines, pageIndex) => {
      const pageObjectNumber = 4 + pageIndex * 2;
      const contentObjectNumber = pageObjectNumber + 1;
      const textLines = pageLines
        .map(line => this.escapePdfText(line))
        .map((line, index) => index === 0 ? `${marginLeft} ${topY} Td (${line}) Tj` : `0 -${lineHeight} Td (${line}) Tj`)
        .join('\n');
      const stream = `BT\n/F1 ${fontSize} Tf\n${textLines}\nET`;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
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
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, "'")
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private readStoredStudentLevel(): StudentLevel | null {
    const value = localStorage.getItem(this.studentLevelStorageKey()) || '';
    return this.normalizeLevel(value);
  }

  private collectStoredQuizScores() {
    const scores: number[] = [];
    const email = this.currentStudentEmail();
    const prefix = email ? `eduvia-quiz-result-${email}-` : 'eduvia-quiz-result-';

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || '';
      if (!key.startsWith(prefix) || key.endsWith('-attempts')) {
        continue;
      }

      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        const score = Number(parsed?.result?.score ?? parsed?.score);
        if (Number.isFinite(score)) {
          scores.push(Math.max(0, Math.min(100, Math.round(score))));
        }
      } catch {
        // Ignore unrelated local storage values.
      }
    }

    return scores;
  }

  private legacyQuizStorageKey(quizId: string) {
    return `eduvia-quiz-result-${quizId}`;
  }

  private quizAttemptsStorageKey(quizId: string) {
    return `${this.quizStorageKey(quizId)}-attempts`;
  }

  private readStoredAttemptCounters(quizId: string): { started: number; submitted: number } {
    const normalizedQuizId = String(quizId || '').trim();
    if (!normalizedQuizId) {
      return { started: 0, submitted: 0 };
    }

    const raw = localStorage.getItem(this.quizAttemptsStorageKey(normalizedQuizId));
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

    if (this.readStoredQuizAttempt(normalizedQuizId)) {
      return { started: 1, submitted: 1 };
    }

    return { started: 0, submitted: 0 };
  }

  private readStoredQuizAttempt(quizId: string) {
    const directMatch = localStorage.getItem(this.quizStorageKey(quizId));

    if (directMatch) {
      return directMatch;
    }

    return localStorage.getItem(this.legacyQuizStorageKey(quizId));
  }

  private normalizedMaxAttempts(value?: number) {
    const attempts = Number(value || 1);
    if (!Number.isFinite(attempts) || attempts <= 0) {
      return 1;
    }

    return Math.floor(attempts);
  }

  private normalizedQuizDurationMinutes(value?: number) {
    const minutes = Number(value || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }

    return Math.floor(minutes);
  }

  private hasSubmittedQuizAttempt(quizId: string, item?: Pick<ContentItem, '_id' | 'title' | 'quizPassingScore' | 'quizAttempts' | 'quizQuestions'> | RecommendationItem) {
    const normalizedQuizId = String(quizId || '').trim();
    if (!normalizedQuizId) {
      return false;
    }

    return this.completedQuizIds.has(normalizedQuizId) || !!this.findAnyStoredQuizResult(normalizedQuizId, item);
  }

  private canStartQuizAttempt(item: RecommendationItem) {
    if (item.type !== 'Quiz') {
      return true;
    }

    const quizId = String(item.id || '').trim();
    if (!quizId) {
      return false;
    }

    const startedAttempts = this.readStoredAttemptCounters(quizId).started;
    const maxAttempts = this.normalizedMaxAttempts(item.quizAttempts);
    return startedAttempts < maxAttempts;
  }

  private markQuizCompleted(quizId: string) {
    const normalizedQuizId = String(quizId || '').trim();
    if (!normalizedQuizId) {
      return;
    }

    this.completedQuizIds = new Set([...this.completedQuizIds, normalizedQuizId]);
  }

  private refreshCompletedQuizIds() {
    this.completedQuizIds = new Set(
      [...this.recommendations, ...this.selectedCourseResources]
        .filter(item =>
          item.type === 'Quiz' &&
          (item.isCompleted || !!this.findAnyStoredQuizResult(item.id, item))
        )
        .map(item => item.id),
    );
  }

  private coverStyleForIndex(index: number) {
    const themes = [
      'linear-gradient(135deg, #8b5a2b 0%, #c2864b 45%, #5f3b1f 100%)',
      'linear-gradient(135deg, #111827 0%, #1f2937 40%, #3b82f6 100%)',
      'linear-gradient(135deg, #0f172a 0%, #1d4ed8 35%, #93c5fd 100%)',
      'linear-gradient(135deg, #0b1020 0%, #1f2937 50%, #10b981 100%)',
      'linear-gradient(135deg, #1f2937 0%, #111827 55%, #a855f7 100%)',
    ];

    return themes[index % themes.length];
  }

  private coverAccent(index: number) {
    const accents = ['#ef233c', '#f97316', '#10b981', '#3b82f6', '#a855f7'];
    return accents[index % accents.length];
  }

  private teacherAvatarForCourse(items: ContentItem[]) {
    return items.find(item => item.teacherAvatarDataUrl)?.teacherAvatarDataUrl || '';
  }

  private teacherNameForCourse(items: ContentItem[], index: number) {
    const explicitTeacherName = items.find(item => item.teacherName)?.teacherName?.trim();
    if (explicitTeacherName) {
      return explicitTeacherName;
    }

    return 'Enseignant non renseigné';
  }

  get displayedRecommendations(): RecommendationItem[] {
    const platformRecs = (this.recommendations || [])
      .filter(r => r.courseId?.toLowerCase() !== 'test' && r.title?.toLowerCase() !== 'test')
      .map(r => ({
        ...r,
        category: (r.isAiGenerated ? 'ai' : 'platform') as 'ai' | 'platform',
      }));
    const aiRecs = this.buildAiRecommendationItems();

    if (this.selectedRecFilter === 'platform') {
      return platformRecs.filter(r => !r.isExternal && !r.isAiGenerated);
    }
    if (this.selectedRecFilter === 'internet') {
      return [...this.internetRecommendations];
    }
    if (this.selectedRecFilter === 'ai') {
      return aiRecs;
    }
    return [...platformRecs, ...this.internetRecommendations, ...aiRecs];
  }

  get allRecommendationsCount(): number {
    return (this.recommendations?.length || 0) + this.internetRecommendations.length + 2;
  }

  get platformRecommendationsCount(): number {
    return (this.recommendations || []).filter(r => !r.isExternal && !r.isAiGenerated).length;
  }

  buildAiRecommendationItems(): RecommendationItem[] {
    const focus = this.portfolioWeaknesses?.[0] || 'Programmation C & Algorithmique';
    const focus2 = this.courseCatalog.find(c => c.id.toLowerCase() !== 'test')?.title || 'Systèmes de réseaux';
    return [
      {
        id: 'ai-rec-weakness-quiz',
        icon: 'psychology',
        title: `Quiz IA sur mesure : ${this.cleanEncoding(focus)}`,
        type: 'Quiz',
        level: this.levelLabel(this.studentLevel),
        duration: '10 min',
        reason: `Quiz généré dynamiquement par l'IA ciblé sur vos points à renforcer (${this.cleanEncoding(focus)}).`,
        contentType: 'quiz',
        quizMode: 'portfolio-remediation',
        isAiGenerated: true,
        category: 'ai',
        focusKeywords: [this.cleanEncoding(focus), 'Généré par IA', 'Entraînement adaptatif'],
        recommendationScore: 98,
      },
      {
        id: 'ai-rec-course-quiz',
        icon: 'psychology',
        title: `Quiz IA d'évaluation : ${this.cleanEncoding(focus2)}`,
        type: 'Quiz',
        level: this.levelLabel(this.studentLevel),
        duration: '10 min',
        reason: `Quiz d'approfondissement généré par l'IA pour tester votre compréhension des notions clés de ${this.cleanEncoding(focus2)}.`,
        contentType: 'quiz',
        quizMode: 'portfolio-remediation',
        isAiGenerated: true,
        category: 'ai',
        focusKeywords: [this.cleanEncoding(focus2), 'Généré par IA', 'Maîtrise'],
        recommendationScore: 95,
      },
    ];
  }

  generateAiRecommendationQuiz(subject?: string) {
    const focusSubject = subject || this.portfolioWeaknesses?.[0] || this.courseCatalog[0]?.title || 'Programmation C & Algorithmique';
    this.remediationQuizLoadingKey = focusSubject;

    this.http
      .post<any>('/api/student/portfolio/remediation-quiz', {
        acquis: focusSubject,
        courseId: focusSubject,
        chapterId: 'Chapitre 1',
        level: this.studentLevel,
      })
      .subscribe({
        next: quiz => {
          this.remediationQuizLoadingKey = '';
          const quizItem: RecommendationItem = {
            id: quiz.id || `ai-quiz-${Date.now()}`,
            icon: 'psychology',
            title: quiz.title || `Quiz IA : ${focusSubject}`,
            type: 'Quiz',
            level: this.levelLabel(this.studentLevel),
            duration: `${quiz.quizDurationMinutes || 10} min`,
            reason: quiz.description || `Quiz généré par l'IA sur ${focusSubject} pour évaluer et consolider vos acquis.`,
            contentType: 'quiz',
            quizDurationMinutes: quiz.quizDurationMinutes || 10,
            quizPassingScore: quiz.quizPassingScore || 70,
            quizQuestions: quiz.quizQuestions || [],
            quizAttempts: 1,
            quizMode: 'portfolio-remediation',
            isAiGenerated: true,
            category: 'ai',
            focusKeywords: [focusSubject, 'Entraînement IA', 'Quiz'],
          };
          this.selectedStandaloneQuizId = quizItem.id;
          this.selectedStandaloneQuiz = quizItem;
        },
        error: () => {
          this.remediationQuizLoadingKey = '';
          const fallbackQuiz = this.buildLocalAiQuiz(focusSubject);
          this.selectedStandaloneQuizId = fallbackQuiz.id;
          this.selectedStandaloneQuiz = fallbackQuiz;
        },
      });
  }

  buildLocalAiQuiz(subject: string): RecommendationItem {
    const cleanSub = this.cleanEncoding(subject);
    return {
      id: `ai-quiz-${Date.now()}`,
      icon: 'psychology',
      title: `Quiz IA : ${cleanSub}`,
      type: 'Quiz',
      level: this.levelLabel(this.studentLevel),
      duration: '10 min',
      reason: `Quiz d'entraînement interactif généré par l'IA sur ${cleanSub}.`,
      contentType: 'quiz',
      quizDurationMinutes: 10,
      quizPassingScore: 70,
      quizMode: 'portfolio-remediation',
      isAiGenerated: true,
      category: 'ai',
      quizAttempts: 1,
      focusKeywords: [cleanSub, 'Quiz IA', 'Entraînement'],
      quizQuestions: [
        {
          id: 'q1',
          prompt: `Quelle est la première démarche méthodologique pour aborder : ${cleanSub} ?`,
          options: [
            'Analyser le problème et poser les spécifications claires',
            'Commencer à écrire du code au hasard',
            'Ignorer les données d’entrée',
            'Exécuter directement sans compiler',
          ],
          correctAnswers: [0],
          explanation: 'La première étape consiste toujours à analyser le besoin, définir les entrées/sorties et structurer la démarche.',
        },
        {
          id: 'q2',
          prompt: `Dans le contexte de ${cleanSub}, pourquoi la rigueur algorithmique est-elle essentielle ?`,
          options: [
            'Pour éviter les ambiguïtés et garantir la reproductibilité du traitement',
            'Pour ralentir volontairement l’exécution',
            'Pour remplacer le compilateur',
            'Elle n’a pas d’importance réelle',
          ],
          correctAnswers: [0],
          explanation: 'L’algorithmique formalise les étapes logiques sans dépendre d’une machine particulière.',
        },
        {
          id: 'q3',
          prompt: `Quelle bonne pratique permet de valider la maîtrise de ${cleanSub} ?`,
          options: [
            'Tester avec des cas limites et vérifier les résultats attendus',
            'Ne tester qu’une seule fois avec un cas trivial',
            'Supprimer les commentaires de documentation',
            'Ignorer les messages d’avertissement',
          ],
          correctAnswers: [0],
          explanation: 'Les tests avec des cas limites (valeurs nulles, extrêmes) assurent la robustesse de la solution.',
        },
        {
          id: 'q4',
          prompt: `Quel est l’avantage principal de structurer ${cleanSub} en sous-modules ou fonctions ?`,
          options: [
            'La réutilisabilité, la lisibilité et la facilité de maintenance',
            'Augmenter inutilement la taille du fichier source',
            'Bloquer la compilation',
            'Empêcher le travail en équipe',
          ],
          correctAnswers: [0],
          explanation: 'La modularité décompose un problème complexe en sous-problèmes simples et réutilisables.',
        },
        {
          id: 'q5',
          prompt: `En cas de résultat inattendu dans ${cleanSub}, quelle est la démarche recommandée ?`,
          options: [
            'Tracer l’état des variables et vérifier pas à pas le déroulement logique',
            'Réécrire tout le projet de zéro immédiatement',
            'Modifier des lignes au hasard',
            'Arrêter l’évaluation',
          ],
          correctAnswers: [0],
          explanation: 'Le traçage méthodique des variables permet d’isoler immédiatement l’origine de l’anomalie.',
        },
      ],
    };
  }

}
