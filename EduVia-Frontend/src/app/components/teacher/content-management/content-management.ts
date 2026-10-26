import { ChangeDetectorRef, Component, HostListener, Input, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { VoiceDictationService } from '../../../services/voice-dictation.service';
import { VoicePlaybackService } from '../../../services/voice-playback.service';

type WizardMode = 'existing' | 'new';
type ContentType = 'Cours' | 'Chapitre' | 'Partie' | 'Vidéo' | 'Quiz' | 'Exercice' | 'Document';
type QuizMode = 'existing' | 'generated';
type QuizDifficulty = 'facile' | 'moyen' | 'difficile';
type LinkedContentType = 'document' | 'video' | 'quiz';

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

type ContentItem = {
  _id?: string;
  type: ContentType;
  courseId: string;
  chapterId: string;
  partId: string;
  title: string;
  description?: string;
  teacherName?: string;
  teacherEmail?: string;
  teacherAvatarDataUrl?: string;
  visibleToAllClasses?: boolean;
  visibleToClasses?: string[];
  dueDate?: string;
  dueDateTime?: string;
  fileName?: string;
  source?: string;
  fileUrl?: string;
  quizMode?: QuizMode;
  quizDifficulty?: QuizDifficulty;
  quizSourceChapter?: string;
  quizAttempts?: number;
  quizPassingScore?: number;
  quizQuestionCount?: number;
  quizDurationMinutes?: number;
  quizQuestions?: QuizQuestion[];
  quizDisplayMode?: 'scoped' | 'standalone';
  completed: boolean;
};

type CourseMember = {
  id: string;
  fullName: string;
  email: string;
  className: string;
  avatarDataUrl?: string;
};

type DeleteTarget =
  | { type: 'course'; course: string }
  | { type: 'chapter'; course: string; chapter: string }
  | { type: 'part'; course: string; chapter: string; part: string }
  | { type: 'content'; item: ContentItem };

type PartContentGroup = {
  key: 'document' | 'video' | 'quiz';
  label: string;
  icon: string;
  items: ContentItem[];
};

@Component({
  selector: 'app-content-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTimepickerModule,
  ],
  templateUrl: './content-management.html',
  styleUrls: ['./content-management.css'],
})
export class ContentManagement implements OnInit {
  @Input()
  set requestedCourseView(course: string | null) {
    this.pendingRequestedCourseView = (course || '').trim() || null;
    this.tryOpenRequestedCourseView();
  }

  showModal = false;
  currentStep = 1;
  creationMode: 'full' | 'quiz_only' | 'linked' = 'full';
  linkedContentType: LinkedContentType = 'document';
  addingChapterFromCourseMenu = false;
  private _formError = '';
  displayedFormError = '';
  private formErrorRenderTimer: ReturnType<typeof setTimeout> | null = null;
  isSaving = false;
  isQuizPreviewLoading = false;
  courseExpanded: Record<string, boolean> = {};
  chapterExpanded: Record<string, boolean> = {};
  partExpanded: Record<string, boolean> = {};
  partTypeGroupCollapsed: Record<string, boolean> = {};
  selectedPreviewItem: ContentItem | null = null;
  showCourseMembersModal = false;
  showDeleteModal = false;
  showSuccessModal = false;
  successMessage = '';
  courseMembersLoading = false;
  courseMembersError = '';
  courseMembers: CourseMember[] = [];
  courseMemberClasses: string[] = [];
  selectedCourseMemberClass = 'all';
  openedCourseMenu: string | null = null;
  openedChapterMenu: string | null = null;
  openedPartMenu: string | null = null;
  openedItemMenu: string | null = null;
  openedVisibilityMenu: string | null = null;
  openedLinkedContentSubmenu: string | null = null;
  selectedCourseView: string | null = null;
  groupedContentsMap: Record<string, Record<string, ContentItem[]>> = {};
  courseLevelContentsByCourseMap: Record<string, ContentItem[]> = {};
  standaloneQuizzesByCourseMap: Record<string, ContentItem[]> = {};
  courseKeysList: string[] = [];
  displayedCourseKeysList: string[] = [];
  chapterKeysByCourseMap: Record<string, string[]> = {};
  partKeysByChapterMap: Record<string, string[]> = {};
  readonly backendBaseUrl =
    `${window.location.protocol}//${window.location.hostname}:3000`;
  currentTeacherName = 'Enseignant';
  currentTeacherEmail = '';
  currentTeacherAvatarDataUrl = '';
  teacherAssignedClasses: string[] = [];
  selectedClassFilter = 'all';
  visibilitySavingKey: string | null = null;
  courses: string[] = [];
  chaptersByCourse: Record<string, string[]> = {};
  partsByChapter: Record<string, string[]> = {};

  contentTypes: ContentType[] = ['Document', 'Vidéo', 'Quiz'];
  contentTypeCounts: Partial<Record<ContentType, number>> = {
    Document: 0,
    Vidéo: 0,
    Quiz: 0,
  };
  displayedContentTypeCounts: Partial<Record<ContentType, number>> = {
    Document: 0,
    Vidéo: 0,
    Quiz: 0,
  };
  contentStatsReady = true;

  get formError() {
    return this._formError;
  }

  set formError(value: string) {
    this._formError = value || '';
    this.scheduleDisplayedFormError();
  }

  private scheduleDisplayedFormError() {
    if (this.formErrorRenderTimer) {
      clearTimeout(this.formErrorRenderTimer);
    }

    this.formErrorRenderTimer = setTimeout(() => {
      this.displayedFormError = this._formError;
      this.formErrorRenderTimer = null;
      this.cdr.detectChanges();
    }, 16);
  }

  contentTypeIcon(type: ContentType): string {
    switch (type) {
      case 'Cours':
        return 'menu_book';
      case 'Vidéo':
        return 'play_circle';
      case 'Quiz':
        return 'quiz';
      case 'Exercice':
        return 'edit_note';
      case 'Document':
        return 'description';
      default:
        return 'article';
    }
  }

  contentTypeTone(type: ContentType): string {
    switch (type) {
      case 'Cours':
        return 'icon-blue';
      case 'Vidéo':
        return 'icon-red';
      case 'Quiz':
        return 'icon-green';
      case 'Exercice':
        return 'icon-purple';
      case 'Document':
        return 'icon-indigo';
      default:
        return 'icon-blue';
    }
  }

  contentForm = {
    courseMode: 'existing' as WizardMode,
    selectedCourse: '',
    newCourse: '',
    chapterMode: 'existing' as WizardMode,
    selectedChapter: '',
    newChapter: '',
    partMode: 'existing' as WizardMode,
    selectedPart: '',
    newPart: '',
    contentTitle: '',
    documentFileName: '',
    documentFile: null as File | null,
    videoFileName: '',
    videoFile: null as File | null,
    videoLink: '',
    quizMode: 'existing' as QuizMode,
    quizTitle: '',
    quizDescription: '',
    quizFileName: '',
    quizFile: null as File | null,
    quizKeywords: '',
    quizChapterFileNames: [] as string[],
    quizChapterFiles: [] as File[],
    quizSourceChapter: '',
    quizDifficulty: 'moyen' as QuizDifficulty,
    quizQuestions: 10,
    quizAttempts: 3,
    quizScore: 70,
    quizDueDate: '',
    quizDueTime: '',
    quizDurationMinutes: null as number | null,
  };

  contents: ContentItem[] = [];
  editingContent: ContentItem | null = null;
  editingCourseName: string | null = null;
  editingCourseItems: ContentItem[] = [];
  pendingDeleteTarget: DeleteTarget | null = null;
  wizardVoiceMessage = '';
  quizFieldErrors: Record<string, string> = {};
  editableQuizQuestions: QuizQuestion[] = [];
  draggingContentId: string | null = null;
  activeCourseDropKey: string | null = null;
  activeDropPartKey: string | null = null;
  activeDropPartTypeKey: string | null = null;
  activeStandaloneDropCourse: string | null = null;
  private dragPreviewElement: HTMLElement | null = null;
  private pendingGeneratedQuizQuestions: QuizQuestion[] | null = null;
  private quizGenerationInFlight = false;
  private canSaveAfterQuizPreview = false;
  private quizPreviewOpenedAt = 0;
  private lastPrimaryActionAt = 0;
  private lastPrimaryActionStep = 0;
  private pendingRequestedCourseView: string | null = null;

  get isWizardBusy() {
    return this.isSaving || this.isQuizPreviewLoading || this.quizGenerationInFlight;
  }

  get wizardLoadingMessage() {
    if (this.isSaving && this.quizGenerationInFlight) {
      return 'Generation du quiz en cours...';
    }

    if (this.quizGenerationInFlight) {
      return 'Generation du quiz en cours...';
    }

    if (this.isQuizPreviewLoading) {
      return 'Analyse du quiz en cours...';
    }

    if (this.isSaving) {
      return 'Enregistrement en cours...';
    }

    return '';
  }

  get primaryActionDisplayLabel() {
    return this.isWizardBusy ? this.wizardLoadingMessage : this.primaryActionLabel;
  }

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private voiceDictationService: VoiceDictationService,
    private voicePlaybackService: VoicePlaybackService,
  ) {}

  ngOnInit() {
    this.loadCurrentTeacherProfile();
  }

  @HostListener('document:click')
  closeItemMenuOnOutsideClick() {
    this.openedItemMenu = null;
    this.openedVisibilityMenu = null;
    this.openedLinkedContentSubmenu = null;
  }

  @HostListener('document:keydown.escape')
  closeDialogsOnEscape() {
    this.showCourseMembersModal = false;
    this.selectedPreviewItem = null;
    this.showDeleteModal = false;
    this.showSuccessModal = false;
    this.openedVisibilityMenu = null;
    this.openedLinkedContentSubmenu = null;
  }

  loadContents() {
    const params = new URLSearchParams();
    if (this.currentTeacherEmail) {
      params.set('teacherEmail', this.currentTeacherEmail);
    }
    if (this.selectedClassFilter !== 'all') {
      params.set('className', this.selectedClassFilter);
    }
    const requestUrl = params.toString() ? `/api/contents?${params.toString()}` : '/api/contents';

    this.http.get<any[]>(requestUrl).subscribe(
      data => {
        this.scheduleUiUpdate(() => {
          const mappedItems = data
            .map(item => this.mapApiItemToContentItem(item))
            .filter((item): item is ContentItem => item !== null);
          this.contents = this.deduplicateContents(mappedItems);
          this.syncStructureFromContents();
          this.tryOpenRequestedCourseView();
          this.contentStatsReady = true;
        });
      },
      () => {
        this.scheduleUiUpdate(() => {
          this.formError = "Impossible de charger les contenus depuis l'API.";
          this.contentStatsReady = true;
        });
      },
    );
  }

  private loadCurrentTeacherProfile() {
    this.http.get<any>('/auth/profile').subscribe({
      next: response => {
        const profile = response?.data || response || {};
        this.currentTeacherName =
          profile.fullName ||
          [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
          this.currentTeacherName;
        this.currentTeacherEmail =
          profile.email || localStorage.getItem('current_user_email') || '';
        this.currentTeacherEmail = this.currentTeacherEmail.trim().toLowerCase();
        this.currentTeacherAvatarDataUrl = profile.avatarDataUrl || '';
        this.teacherAssignedClasses = this.resolveTeacherAssignedClasses(profile);
        this.loadContents();
      },
      error: () => {
        this.currentTeacherEmail = localStorage.getItem('current_user_email') || '';
        this.currentTeacherEmail = this.currentTeacherEmail.trim().toLowerCase();
        this.teacherAssignedClasses = [];
        this.loadContents();
      },
    });
  }

  openModal() {
    this.creationMode = 'full';
    this.linkedContentType = 'document';
    this.addingChapterFromCourseMenu = false;
    this.showModal = true;
    this.currentStep = 1;
    this.formError = '';
    this.editingContent = null;
    this.editingCourseName = null;
    this.editingCourseItems = [];
    this.canSaveAfterQuizPreview = false;
    this.resetForm();
    if (this.selectedCourseView) {
      this.contentForm.courseMode = 'existing';
      this.setCourse(this.selectedCourseView);
    }
  }

  openAutoQuizModal() {
    this.creationMode = 'quiz_only';
    this.linkedContentType = 'quiz';
    this.addingChapterFromCourseMenu = false;
    this.showModal = true;
    this.currentStep = 5;
    this.formError = '';
    this.editingContent = null;
    this.editingCourseName = null;
    this.editingCourseItems = [];
    this.canSaveAfterQuizPreview = false;
    this.resetForm();
    if (this.selectedCourseView) {
      this.contentForm.courseMode = 'existing';
      this.contentForm.selectedCourse = this.selectedCourseView;
      this.contentForm.selectedChapter = '';
      this.contentForm.selectedPart = '';
    }
    this.contentForm.quizMode = 'generated';
  }

  editContent(content: ContentItem) {
    this.editingContent = content;
    this.showModal = true;
    this.currentStep =
      content.type === 'Quiz' ? 5 : content.type === 'Vidéo' ? 4 : content.type === 'Document' ? 3 : 1;
    this.formError = '';
    this.canSaveAfterQuizPreview = false;
    this.contentForm = {
      courseMode: 'existing',
      selectedCourse: content.courseId,
      newCourse: '',
      chapterMode: 'existing',
      selectedChapter: content.chapterId,
      newChapter: '',
      partMode: 'existing',
      selectedPart: content.partId,
      newPart: '',
      contentTitle: content.title || '',
      documentFileName: content.type === 'Document' ? content.fileName || '' : '',
      documentFile: null,
      videoFileName: content.type === 'Vidéo' ? content.fileName || '' : '',
      videoFile: null,
      videoLink: content.type === 'Vidéo' ? content.source || '' : '',
      quizMode: content.type === 'Quiz' ? content.quizMode || 'existing' : 'existing',
      quizTitle: content.type === 'Quiz' ? content.title : '',
      quizDescription: content.type === 'Quiz' ? content.description || '' : '',
      quizFileName: content.type === 'Quiz' ? content.fileName || '' : '',
      quizFile: null,
      quizKeywords: '',
      quizChapterFileNames: [],
      quizChapterFiles: [],
      quizSourceChapter:
        content.type === 'Quiz' ? content.quizSourceChapter || content.chapterId : '',
      quizDifficulty:
        content.type === 'Quiz' ? content.quizDifficulty || 'moyen' : 'moyen',
      quizQuestions:
        content.type === 'Quiz'
          ? (content.quizQuestionCount ||
              (content.description?.match(/questions:\s*(\d+)/)?.[1]
              ? Number(content.description.match(/questions:\s*(\d+)/)?.[1])
              : 10))
          : 10,
      quizAttempts: content.type === 'Quiz' ? content.quizAttempts || 3 : 3,
      quizScore: content.type === 'Quiz' ? content.quizPassingScore || 70 : 70,
      quizDueDate:
        content.type === 'Quiz'
          ? this.toDateInputValue(content.dueDateTime || content.dueDate)
          : '',
      quizDueTime:
        content.type === 'Quiz'
          ? this.toTimeInputValue(content.dueDateTime)
          : '',
      quizDurationMinutes:
        content.type === 'Quiz' ? content.quizDurationMinutes || null : null,
    };
    this.editableQuizQuestions =
      content.type === 'Quiz'
        ? this.cloneQuizQuestions(content.quizQuestions)
        : [];
  }

  closeModal(force = false) {
    if (!force && this.isWizardBusy) {
      return;
    }

    this.showModal = false;
    this.currentStep = 1;
    this.creationMode = 'full';
    this.linkedContentType = 'document';
    this.addingChapterFromCourseMenu = false;
    this.formError = '';
    this.editingContent = null;
    this.editingCourseName = null;
    this.editingCourseItems = [];
    this.quizFieldErrors = {};
    this.editableQuizQuestions = [];
    this.pendingGeneratedQuizQuestions = null;
    this.quizGenerationInFlight = false;
    this.isQuizPreviewLoading = false;
    this.canSaveAfterQuizPreview = false;
  }

  openDeleteModal(target: DeleteTarget) {
    this.pendingDeleteTarget = target;
    this.showDeleteModal = true;
  }

  closeDeleteModal() {
    this.showDeleteModal = false;
    this.pendingDeleteTarget = null;
  }

  closeSuccessModal() {
    this.showSuccessModal = false;
    this.successMessage = '';
  }

  onContentDragStart(item: ContentItem, event: DragEvent) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId || !event.dataTransfer) {
      return;
    }

    this.draggingContentId = itemId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
    this.attachDragPreview(event);
  }

  onContentDragEnd() {
    this.draggingContentId = null;
    this.activeCourseDropKey = null;
    this.activeDropPartKey = null;
    this.activeDropPartTypeKey = null;
    this.activeStandaloneDropCourse = null;
    this.removeDragPreview();
  }

  private attachDragPreview(event: DragEvent) {
    this.removeDragPreview();

    const sourceElement = (event.currentTarget as HTMLElement | null)?.closest('.part-item') as HTMLElement | null;
    if (!sourceElement || !event.dataTransfer) {
      return;
    }

    const sourceRect = sourceElement.getBoundingClientRect();
    const previewElement = sourceElement.cloneNode(true) as HTMLElement;
    previewElement.classList.add('part-item--drag-preview');
    previewElement.style.width = `${sourceRect.width}px`;
    previewElement.style.position = 'fixed';
    previewElement.style.top = '-1000px';
    previewElement.style.left = '-1000px';
    previewElement.style.pointerEvents = 'none';

    document.body.appendChild(previewElement);
    this.dragPreviewElement = previewElement;
    event.dataTransfer.setDragImage(previewElement, Math.min(32, sourceRect.width / 2), Math.min(24, sourceRect.height / 2));
  }

  private removeDragPreview() {
    this.dragPreviewElement?.remove();
    this.dragPreviewElement = null;
  }

  onCourseContentDragOver(course: string, event: DragEvent) {
    if (!this.draggingContentId) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('.chapter-card')) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.activeCourseDropKey = course;
    this.activeDropPartKey = null;
    this.activeStandaloneDropCourse = null;
  }

  onCourseContentDragLeave(course: string) {
    if (this.activeCourseDropKey === course) {
      this.activeCourseDropKey = null;
    }
  }

  onCourseContentDrop(course: string, event: DragEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.chapter-card')) {
      return;
    }

    event.preventDefault();
    const draggedContentId =
      event.dataTransfer?.getData('text/plain') || this.draggingContentId || '';

    this.activeCourseDropKey = null;
    this.activeDropPartKey = null;
    this.activeStandaloneDropCourse = null;

    if (!draggedContentId) {
      return;
    }

    const draggedItem = this.contents.find(
      content => this.normalizeContentId(content._id) === draggedContentId,
    );

    if (!draggedItem) {
      this.draggingContentId = null;
      return;
    }

    const isSameLocation =
      draggedItem.courseId === course &&
      !`${draggedItem.chapterId || ''}`.trim() &&
      !`${draggedItem.partId || ''}`.trim();

    if (isSameLocation) {
      this.draggingContentId = null;
      return;
    }

    this.moveContentToCourse(draggedItem, course);
  }

  onPartDragOver(course: string, chapter: string, part: string, event: DragEvent) {
    if (!this.draggingContentId) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.activeCourseDropKey = null;
    this.activeDropPartKey = this.partKey(course, chapter, part);
    this.activeDropPartTypeKey = null;
    this.activeStandaloneDropCourse = null;
  }

  onPartTypeDragOver(
    course: string,
    chapter: string,
    part: string,
    groupKey: string,
    event: DragEvent,
  ) {
    const draggedItem = this.getDraggedContent(event);
    if (!draggedItem || !this.canDropItemInGroup(draggedItem, groupKey)) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.activeCourseDropKey = null;
    this.activeDropPartKey = this.partKey(course, chapter, part);
    this.activeDropPartTypeKey = this.partTypeGroupKey(course, chapter, part, groupKey);
    this.activeStandaloneDropCourse = null;
  }

  onPartTypeDragLeave(course: string, chapter: string, part: string, groupKey: string) {
    const targetKey = this.partTypeGroupKey(course, chapter, part, groupKey);
    if (this.activeDropPartTypeKey === targetKey) {
      this.activeDropPartTypeKey = null;
    }
  }

  onPartTypeDrop(
    course: string,
    chapter: string,
    part: string,
    groupKey: string,
    event: DragEvent,
  ) {
    event.stopPropagation();
    event.preventDefault();
    const draggedItem = this.getDraggedContent(event);

    this.activeDropPartKey = null;
    this.activeDropPartTypeKey = null;
    this.activeStandaloneDropCourse = null;

    if (!draggedItem) {
      return;
    }

    if (!this.canDropItemInGroup(draggedItem, groupKey)) {
      this.draggingContentId = null;
      this.formError = this.dropTypeErrorMessage(draggedItem, groupKey);
      return;
    }

    const isSameLocation =
      this.normalizeDropScope(draggedItem.courseId) === this.normalizeDropScope(course) &&
      this.normalizeDropScope(draggedItem.chapterId) === this.normalizeDropScope(chapter) &&
      this.normalizeDropScope(draggedItem.partId) === this.normalizeDropScope(part);

    if (isSameLocation) {
      this.draggingContentId = null;
      return;
    }

    this.partTypeGroupCollapsed[this.partTypeGroupKey(course, chapter, part, groupKey)] = false;
    this.moveContentToPart(draggedItem, course, chapter, part);
  }

  onPartDragLeave(course: string, chapter: string, part: string) {
    const targetKey = this.partKey(course, chapter, part);
    if (this.activeDropPartKey === targetKey) {
      this.activeDropPartKey = null;
    }
  }

  onStandaloneQuizDragOver(course: string, event: DragEvent) {
    const draggedContentId =
      event.dataTransfer?.getData('text/plain') || this.draggingContentId || '';
    const draggedItem = this.contents.find(
      content => this.normalizeContentId(content._id) === draggedContentId,
    );

    if (!draggedItem || draggedItem.type !== 'Quiz') {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.activeDropPartKey = null;
    this.activeStandaloneDropCourse = course;
  }

  onStandaloneQuizDragLeave(course: string) {
    if (this.activeStandaloneDropCourse === course) {
      this.activeStandaloneDropCourse = null;
    }
  }

  onPartDrop(course: string, chapter: string, part: string, event: DragEvent) {
    event.stopPropagation();
    event.preventDefault();
    const draggedContentId =
      event.dataTransfer?.getData('text/plain') || this.draggingContentId || '';

    this.activeDropPartKey = null;
    this.activeDropPartTypeKey = null;
    this.activeStandaloneDropCourse = null;

    if (!draggedContentId) {
      return;
    }

    const draggedItem = this.contents.find(
      content => this.normalizeContentId(content._id) === draggedContentId,
    );

    if (!draggedItem) {
      this.draggingContentId = null;
      return;
    }

    const isSameLocation =
      this.normalizeDropScope(draggedItem.courseId) === this.normalizeDropScope(course) &&
      this.normalizeDropScope(draggedItem.chapterId) === this.normalizeDropScope(chapter) &&
      this.normalizeDropScope(draggedItem.partId) === this.normalizeDropScope(part);

    if (isSameLocation) {
      this.draggingContentId = null;
      return;
    }

    this.moveContentToPart(draggedItem, course, chapter, part);
  }

  isDropTargetActive(course: string, chapter: string, part: string) {
    return this.activeDropPartKey === this.partKey(course, chapter, part);
  }

  isPartTypeDropTargetActive(course: string, chapter: string, part: string, groupKey: string) {
    return this.activeDropPartTypeKey === this.partTypeGroupKey(course, chapter, part, groupKey);
  }

  canDropCurrentItemInGroup(groupKey: string): boolean {
    const draggedItem = this.getDraggedContent();
    return !!draggedItem && this.canDropItemInGroup(draggedItem, groupKey);
  }

  isCourseDropTargetActive(course: string) {
    return this.activeCourseDropKey === course;
  }

  onStandaloneQuizDrop(course: string, event: DragEvent) {
    event.stopPropagation();
    event.preventDefault();
    const draggedContentId =
      event.dataTransfer?.getData('text/plain') || this.draggingContentId || '';

    this.activeDropPartKey = null;
    this.activeStandaloneDropCourse = null;

    if (!draggedContentId) {
      return;
    }

    const draggedItem = this.contents.find(
      content => this.normalizeContentId(content._id) === draggedContentId,
    );

    if (!draggedItem || draggedItem.type !== 'Quiz') {
      this.draggingContentId = null;
      return;
    }

    const isAlreadyStandalone =
      draggedItem.courseId === course &&
      !`${draggedItem.chapterId || ''}`.trim() &&
      !`${draggedItem.partId || ''}`.trim() &&
      draggedItem.quizDisplayMode === 'standalone';

    if (isAlreadyStandalone) {
      this.draggingContentId = null;
      return;
    }

    this.moveQuizToStandalone(draggedItem, course);
  }

  isStandaloneDropTargetActive(course: string) {
    return this.activeStandaloneDropCourse === course;
  }

  get minQuizDueDate(): string {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.formatDateForInput(tomorrow);
  }

  get quizDueDateValue(): Date | null {
    return this.contentForm.quizDueDate
      ? this.toLocalDate(this.contentForm.quizDueDate)
      : null;
  }

  get quizDueTimeValue(): Date | null {
    return this.contentForm.quizDueTime
      ? this.toLocalTime(this.contentForm.quizDueTime)
      : null;
  }

  onQuizDueDateSelected(value: Date | null) {
    this.contentForm.quizDueDate = value ? this.formatDateForInput(value) : '';
  }

  onQuizDueTimeSelected(value: Date | null) {
    this.contentForm.quizDueTime = value ? this.formatTimeForInput(value) : '';
  }

  selectQuizMode(mode: QuizMode) {
    this.contentForm.quizMode = mode;
    this.clearQuizFieldError('quizMode');
  }

  clearQuizFieldError(field: string) {
    if (!this.quizFieldErrors[field]) {
      return;
    }

    const nextErrors = { ...this.quizFieldErrors };
    delete nextErrors[field];
    this.quizFieldErrors = nextErrors;
  }

  getQuizFieldError(field: string): string {
    return this.quizFieldErrors[field] || '';
  }

  deleteModalTitle(): string {
    switch (this.pendingDeleteTarget?.type) {
      case 'course':
        return 'Supprimer ce cours';
      case 'chapter':
        return 'Supprimer ce chapitre';
      case 'part':
        return 'Supprimer cette partie';
      case 'content':
        return 'Supprimer ce contenu';
      default:
        return 'Supprimer cet element';
    }
  }

  deleteModalMessage(): string {
    switch (this.pendingDeleteTarget?.type) {
      case 'course':
        return `Voulez-vous vraiment supprimer le cours "${this.pendingDeleteTarget.course}" et tous ses contenus ?`;
      case 'chapter':
        return `Voulez-vous vraiment supprimer le chapitre "${this.pendingDeleteTarget.chapter}" et tous ses contenus ?`;
      case 'part':
        return `Voulez-vous vraiment supprimer la partie "${this.pendingDeleteTarget.part}" et tous ses contenus ?`;
      case 'content':
        return `Voulez-vous vraiment supprimer le contenu "${this.pendingDeleteTarget.item.title}" ?`;
      default:
        return 'Cette action est irreversible.';
    }
  }

  confirmDeleteAction() {
    const target = this.pendingDeleteTarget;
    if (!target) {
      return;
    }

    this.closeDeleteModal();

    switch (target.type) {
      case 'course':
        this.executeDeleteCourse(target.course);
        break;
      case 'chapter':
        this.executeDeleteChapter(target.course, target.chapter);
        break;
      case 'part':
        this.executeDeletePart(target.course, target.chapter, target.part);
        break;
      case 'content':
        this.executeDeleteContent(target.item);
        break;
    }
  }

  onPrimaryAction() {
    if (this.isWizardBusy) {
      return;
    }

    const now = Date.now();
    const actionStep = this.currentStep;
    const previewJustOpened =
      actionStep === 6 &&
      this.lastPrimaryActionStep === 5 &&
      now - this.lastPrimaryActionAt < 800;

    if (previewJustOpened) {
      return;
    }

    this.lastPrimaryActionAt = now;
    this.lastPrimaryActionStep = actionStep;

    if (actionStep === 6) {
      const previewOpenedRecently = Date.now() - this.quizPreviewOpenedAt < 600;
      if (!this.canSaveAfterQuizPreview || previewOpenedRecently) {
        return;
      }
      this.saveWizard();
      return;
    }

    if (!this.isDirectEditMode && actionStep === 5) {
      this.openQuizPreview();
      return;
    }

    this.goNext();
  }

  goNext() {
    this.formError = '';
    this.quizFieldErrors = {};

    if (this.currentStep === 1) {
      const course =
        this.contentForm.courseMode === 'existing'
          ? this.contentForm.selectedCourse
          : this.contentForm.newCourse;
      const chapter =
        this.contentForm.chapterMode === 'existing'
          ? this.contentForm.selectedChapter
          : this.contentForm.newChapter;

      if (!course || !chapter) {
        this.formError = 'Sélectionnez ou créez un cours et un chapitre.';
        return;
      }

      if (this.isDirectEditMode) {
        this.saveWizard();
        return;
      }

    }

    if (this.currentStep === 2) {
      const part =
        this.contentForm.partMode === 'existing'
          ? this.contentForm.selectedPart
          : this.contentForm.newPart;

      if (!part) {
        this.formError = 'Sélectionnez ou créez une partie.';
        return;
      }

      if (this.isDirectEditMode) {
        this.saveWizard();
        return;
      }

      if (this.creationMode === 'linked') {
        this.currentStep = this.linkedStepForType(this.linkedContentType);
        return;
      }
    }

    if (
      !this.isDirectEditMode &&
      this.creationMode === 'full' &&
      this.currentStep === 3 &&
      !this.contentForm.documentFileName
    ) {
      this.formError = 'Ajoutez un document de cours (PDF/DOCX).';
      return;
    }

    if (
      this.creationMode === 'linked' &&
      this.currentStep === 3 &&
      this.linkedContentType === 'document' &&
      !this.hasDocumentSource()
    ) {
      this.formError = 'Ajoutez un document de cours (PDF/DOCX).';
      return;
    }

    if (
      this.creationMode === 'linked' &&
      this.currentStep === 3 &&
      this.linkedContentType === 'document'
    ) {
      this.saveWizard();
      return;
    }

    if (
      !this.isDirectEditMode &&
      this.creationMode === 'full' &&
      this.currentStep === 4 &&
      !this.hasVideoSource()
    ) {
      this.formError = 'Ajoutez une vidéo ou un lien vidéo (YouTube/Vimeo).';
      return;
    }

    if (
      this.creationMode === 'linked' &&
      this.currentStep === 4 &&
      this.linkedContentType === 'video' &&
      !this.hasVideoSource()
    ) {
      this.formError = 'Ajoutez une vidéo ou un lien vidéo (YouTube/Vimeo).';
      return;
    }

    if (
      this.creationMode === 'linked' &&
      this.currentStep === 4 &&
      this.linkedContentType === 'video'
    ) {
      this.saveWizard();
      return;
    }

    if (this.isDirectEditMode && this.currentStep === 4 && !this.hasVideoSource()) {
      this.formError = 'Ajoutez une video locale ou un lien video.';
      return;
    }

    if (
      this.isDirectEditMode &&
      (
        this.currentStep === 3 ||
        this.currentStep === 4 ||
        (this.currentStep === 5 && this.isSingleContentTitleEditOnlyMode)
      )
    ) {
      this.saveWizard();
      return;
    }

    if (this.currentStep === 5) {
      this.openQuizPreview();
      return;
    }

    if (this.isDirectEditMode) {
      this.saveWizard();
      return;
    }

    this.currentStep++;
  }

  private openQuizPreview() {
    this.formError = '';
    this.quizFieldErrors = {};

    if (this.currentStep !== 5) {
      return;
    }

      const hasDocument = this.hasDocumentSource();
      const hasVideo = this.hasVideoSource();
      const hasQuizTitle = !!this.contentForm.quizTitle.trim();
      const hasQuizSource =
        this.contentForm.quizMode === 'generated'
          ? !!this.contentForm.quizSourceChapter.trim()
          : !!this.contentForm.quizFileName;
      const hasQuiz = hasQuizTitle && hasQuizSource;

      if (this.creationMode === 'linked' && this.linkedContentType === 'quiz' && !hasQuiz) {
        this.validateQuizStep();
        return;
      }

      if (this.creationMode === 'linked' && !hasDocument && !hasVideo && !hasQuiz) {
        this.formError =
          'Ajoutez au moins un document, une vidéo ou un quiz lié avant de continuer.';
        return;
      }

      if (this.creationMode !== 'linked' && !this.validateQuizStep()) {
        return;
      }

      if (
        hasQuizTitle &&
        this.contentForm.quizMode === 'generated' &&
        !this.contentForm.quizSourceChapter.trim()
      ) {
        this.formError = 'Selectionnez un chapitre source pour generer le quiz.';
        return;
      }
      if (
        hasQuizTitle &&
        this.contentForm.quizMode === 'existing' &&
        !this.contentForm.quizFileName
      ) {
        this.formError = 'Téléchargez un quiz PDF ou Word.';
        return;
      }
      if (
        this.contentForm.quizMode === 'generated' &&
        this.contentForm.quizChapterFiles.length > 0 &&
        !this.hasEditableQuizQuestions()
      ) {
        if (this.quizGenerationInFlight) {
          return;
        }

        this.quizGenerationInFlight = true;
        const courseId =
          this.contentForm.courseMode === 'existing'
            ? this.contentForm.selectedCourse
            : this.contentForm.newCourse;
        const chapterId =
          this.contentForm.chapterMode === 'existing'
            ? this.contentForm.selectedChapter
            : this.contentForm.newChapter;
        const partId =
          this.contentForm.partMode === 'existing'
            ? this.contentForm.selectedPart
            : this.contentForm.newPart;

        this.requestGeneratedQuizQuestions(courseId, chapterId, partId).subscribe({
          next: questions => {
            this.scheduleUiUpdate(() => {
              this.editableQuizQuestions = this.cloneQuizQuestions(questions);
              this.syncQuizQuestionCountFromEditor();
              this.quizGenerationInFlight = false;
              this.openQuizPreviewStep();
            });
          },
          error: error => {
            this.scheduleUiUpdate(() => {
              this.quizGenerationInFlight = false;
              this.formError = this.resolveContentErrorMessage(
                error,
                'La generation du quiz a echoue.',
              );
            });
          },
        });
        return;
      }

      if (
        this.contentForm.quizMode === 'existing' &&
        this.contentForm.quizFile &&
        !this.hasEditableQuizQuestions()
      ) {
        this.isQuizPreviewLoading = true;
        this.requestExistingQuizQuestions(this.contentForm.quizFile).subscribe({
          next: questions => {
            this.scheduleUiUpdate(() => {
              this.isQuizPreviewLoading = false;
              this.editableQuizQuestions = this.cloneQuizQuestions(questions);
              this.syncQuizQuestionCountFromEditor();
              this.openQuizPreviewStep();
            });
          },
          error: error => {
            this.scheduleUiUpdate(() => {
              this.isQuizPreviewLoading = false;
              this.formError = this.resolveContentErrorMessage(
                error,
                "L'apercu du quiz existant n'a pas pu etre genere.",
              );
            });
          },
        });
        return;
      }

      this.openQuizPreviewStep();
      return;
  }

  goBack() {
    if (this.currentStep > 1) {
      this.formError = '';
      if (this.currentStep === 6) {
        this.canSaveAfterQuizPreview = false;
        this.quizPreviewOpenedAt = 0;
      }
      this.currentStep--;
    }
  }

  resetForm() {
    const defaultCourse = this.selectedCourseView || this.courses[0] || '';
    const defaultChapter = this.chaptersByCourse[defaultCourse]?.[0] || '';
    this.contentForm = {
      courseMode: 'existing',
      selectedCourse: defaultCourse,
      newCourse: '',
      chapterMode: defaultChapter ? 'existing' : 'new',
      selectedChapter: defaultChapter,
      newChapter: '',
      partMode: 'existing',
      selectedPart:
        this.partsByChapter[
          `${defaultCourse}|${defaultChapter}`
        ]?.[0] || '',
      newPart: '',
      contentTitle: '',
      documentFileName: '',
      documentFile: null,
      videoFileName: '',
      videoFile: null,
      videoLink: '',
      quizMode: 'existing',
      quizTitle: '',
      quizDescription: '',
      quizFileName: '',
      quizFile: null,
      quizKeywords: '',
      quizChapterFileNames: [],
      quizChapterFiles: [],
      quizSourceChapter: '',
      quizDifficulty: 'moyen',
      quizQuestions: 10,
      quizAttempts: 3,
      quizScore: 70,
      quizDueDate: '',
      quizDueTime: '',
      quizDurationMinutes: null,
    };
    this.quizFieldErrors = {};
    this.editableQuizQuestions = [];
    this.canSaveAfterQuizPreview = false;
    this.quizPreviewOpenedAt = 0;
  }

  private validateQuizStep(): boolean {
    const errors: Record<string, string> = {};
    const resolvedCourseId =
      this.contentForm.courseMode === 'existing'
        ? this.contentForm.selectedCourse
        : this.contentForm.newCourse;

    if (this.creationMode === 'quiz_only' && !resolvedCourseId.trim()) {
      errors['selectedCourse'] = 'Le cours du quiz est obligatoire.';
    }

    if (!this.contentForm.quizMode) {
      errors['quizMode'] = 'Le type de quiz est obligatoire.';
    }

    if (!this.contentForm.quizTitle.trim()) {
      errors['quizTitle'] = 'Le titre du quiz est obligatoire.';
    }

    if (!this.contentForm.quizDescription.trim()) {
      errors['quizDescription'] = 'La description du quiz est obligatoire.';
    }

    if (!this.contentForm.quizDifficulty) {
      errors['quizDifficulty'] = 'Le niveau de difficulte est obligatoire.';
    }

    if (
      !Number.isInteger(Number(this.contentForm.quizQuestions)) ||
      Number(this.contentForm.quizQuestions) < 1
    ) {
      errors['quizQuestions'] = 'Le nombre de questions est obligatoire.';
    }

    if (
      !Number.isInteger(Number(this.contentForm.quizAttempts)) ||
      Number(this.contentForm.quizAttempts) < 1
    ) {
      errors['quizAttempts'] = 'Le nombre de tentatives est obligatoire.';
    }

    if (
      this.contentForm.quizScore === null ||
      this.contentForm.quizScore === undefined ||
      Number(this.contentForm.quizScore) < 0 ||
      Number(this.contentForm.quizScore) > 100
    ) {
      errors['quizScore'] = 'Le score de reussite est obligatoire.';
    }

    if (
      this.contentForm.quizDurationMinutes === null ||
      this.contentForm.quizDurationMinutes === undefined ||
      Number(this.contentForm.quizDurationMinutes) < 1
    ) {
      errors['quizDurationMinutes'] = 'Le chronometre est obligatoire.';
    }

    if (!this.contentForm.quizDueDate) {
      errors['quizDueDate'] = 'La date limite est obligatoire.';
    } else {
      const selectedDate = this.toLocalDate(this.contentForm.quizDueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (!selectedDate || selectedDate.getTime() <= today.getTime()) {
        errors['quizDueDate'] =
          "La date limite doit etre strictement superieure a la date d'aujourd'hui.";
      }
    }

    if (!this.contentForm.quizDueTime) {
      errors['quizDueTime'] = "L'heure limite est obligatoire.";
    }

    if (this.contentForm.quizMode === 'existing') {
      if (!this.contentForm.quizFileName && !this.contentForm.quizFile) {
        errors['quizFile'] = 'Le fichier du quiz est obligatoire.';
      }
    }

    if (this.contentForm.quizMode === 'generated') {
      if (this.contentForm.quizChapterFiles.length === 0 && !this.hasEditableQuizQuestions()) {
        errors['quizChapterFiles'] = 'Le fichier du chapitre source est obligatoire.';
      }
    }

    const quizQuestionValidationError = this.validateEditableQuizQuestions();
    if (quizQuestionValidationError) {
      errors['quizQuestionEditor'] = quizQuestionValidationError;
    }

    this.quizFieldErrors = errors;
    return Object.keys(errors).length === 0;
  }

  setCourse(course: string) {
    this.contentForm.selectedCourse = course;
    if (this.creationMode === 'quiz_only') {
      this.contentForm.selectedChapter = '';
      this.contentForm.selectedPart = '';
      return;
    }
    this.contentForm.selectedChapter = this.chaptersByCourse[course]?.[0] || '';
    this.contentForm.chapterMode = this.contentForm.selectedChapter ? 'existing' : 'new';
    const partKey = `${course}|${this.contentForm.selectedChapter}`;
    this.contentForm.selectedPart = this.partsByChapter[partKey]?.[0] || '';
  }

  onClassFilterChange(className: string) {
    this.selectedClassFilter = className || 'all';
    this.loadContents();
  }

  setChapter(chapter: string) {
    this.contentForm.selectedChapter = chapter;
    const course = this.contentForm.selectedCourse;
    const partKey = `${course}|${chapter}`;
    this.contentForm.selectedPart = this.partsByChapter[partKey]?.[0] || '';
  }

  handleDocumentInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const validDocument = /\.(pdf|docx)$/i.test(file.name);
      if (!validDocument) {
        this.contentForm.documentFile = null;
        this.contentForm.documentFileName = '';
        this.formError = 'Le document doit être au format PDF ou DOCX.';
        input.value = '';
        return;
      }

      this.formError = '';
      this.contentForm.documentFile = file;
      this.contentForm.documentFileName = file.name;
    }
  }

  handleVideoInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const validVideo = /\.(mp4|mov|avi|webm|mkv)$/i.test(file.name);
      if (!validVideo) {
        this.contentForm.videoFile = null;
        this.contentForm.videoFileName = '';
        this.formError = 'La video doit etre au format MP4, MOV, AVI, WebM ou MKV.';
        input.value = '';
        return;
      }

      this.formError = '';
      this.contentForm.videoFile = file;
      this.contentForm.videoFileName = file.name;
      this.contentForm.videoLink = '';
    }
  }

  clearVideoFileSelection() {
    this.contentForm.videoFile = null;
    this.contentForm.videoFileName = '';
  }

  clearVideoLink() {
    this.contentForm.videoLink = '';
  }

  handleQuizInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const validQuizFile = /\.(pdf|doc|docx)$/i.test(file.name);
      if (!validQuizFile) {
        this.contentForm.quizFile = null;
        this.contentForm.quizFileName = '';
        this.quizFieldErrors = {
          ...this.quizFieldErrors,
          quizFile: 'Le quiz doit etre au format PDF, DOC ou DOCX.',
        };
        input.value = '';
        return;
      }

      this.formError = '';
      this.clearQuizFieldError('quizFile');
      this.contentForm.quizFile = file;
      this.contentForm.quizFileName = file.name;
    }
  }

  handleQuizChapterInputs(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []).slice(0, 1);

    if (files.length === 0) {
      this.contentForm.quizChapterFiles = [];
      this.contentForm.quizChapterFileNames = [];
      this.contentForm.quizSourceChapter = '';
      return;
    }

    const invalidFile = files.find(file => !/\.(pdf|docx)$/i.test(file.name));
    if (invalidFile) {
      this.contentForm.quizChapterFiles = [];
      this.contentForm.quizChapterFileNames = [];
      this.contentForm.quizSourceChapter = '';
      this.quizFieldErrors = {
        ...this.quizFieldErrors,
        quizChapterFiles: 'Le chapitre source doit etre au format PDF ou DOCX.',
      };
      input.value = '';
      return;
    }

    this.formError = '';
    this.clearQuizFieldError('quizChapterFiles');
    this.contentForm.quizChapterFiles = files;
    this.contentForm.quizChapterFileNames = files.map(file => file.name);
    this.contentForm.quizSourceChapter = files[0].name.replace(/\.[^.]+$/, '');
  }

  addEditableQuizQuestion() {
    const newQuestion = this.createEmptyQuizQuestion(this.editableQuizQuestions.length + 1);
    this.editableQuizQuestions = [...this.editableQuizQuestions, newQuestion];
    this.contentForm.quizQuestions = this.editableQuizQuestions.length;
    this.clearQuizFieldError('quizQuestionEditor');
    this.scrollToEditableQuizQuestion(newQuestion.id);
  }

  removeEditableQuizQuestion(index: number) {
    this.editableQuizQuestions = this.editableQuizQuestions
      .filter((_, questionIndex) => questionIndex !== index)
      .map((question, questionIndex) => this.normalizeEditableQuizQuestion(question, questionIndex));
    this.syncQuizQuestionCountFromEditor();
    this.clearQuizFieldError('quizQuestionEditor');
  }

  toggleEditableQuizCorrectAnswer(questionIndex: number, optionLabel: string) {
    const currentQuestion = this.editableQuizQuestions[questionIndex];
    if (!currentQuestion) {
      return;
    }

    const normalizedLabel = `${optionLabel || ''}`.trim().toUpperCase();
    const currentAnswers = Array.isArray(currentQuestion.correctAnswers)
      ? currentQuestion.correctAnswers.map(answer => `${answer || ''}`.trim().toUpperCase()).filter(Boolean)
      : [];

    const nextAnswers =
      currentQuestion.type === 'multiple'
        ? currentAnswers.includes(normalizedLabel)
          ? currentAnswers.filter(answer => answer !== normalizedLabel)
          : [...currentAnswers, normalizedLabel]
        : [normalizedLabel];

    this.editableQuizQuestions = this.editableQuizQuestions.map((question, index) =>
      index === questionIndex
        ? {
            ...question,
            correctAnswers: nextAnswers,
          }
        : question,
    );
    this.clearQuizFieldError('quizQuestionEditor');
  }

  isEditableQuizCorrectAnswer(question: QuizQuestion, optionLabel: string): boolean {
    return Array.isArray(question?.correctAnswers)
      ? question.correctAnswers
          .map(answer => `${answer || ''}`.trim().toUpperCase())
          .includes(`${optionLabel || ''}`.trim().toUpperCase())
      : false;
  }

  onEditableQuizQuestionTypeChange(questionIndex: number) {
    const currentQuestion = this.editableQuizQuestions[questionIndex];
    if (!currentQuestion) {
      return;
    }

    this.editableQuizQuestions = this.editableQuizQuestions.map((question, index) =>
      index === questionIndex
        ? {
            ...question,
            correctAnswers:
              question.type === 'multiple'
                ? [...new Set(question.correctAnswers || [])]
                : (question.correctAnswers || []).slice(0, 1),
          }
        : question,
    );
    this.clearQuizFieldError('quizQuestionEditor');
  }

  get progress() {
    return Math.round(((this.currentStep - 1) / 5) * 100);
  }

  get isScopedEditMode() {
    return !!this.editingCourseName && this.editingCourseItems.length > 0;
  }

  get isSingleContentEditMode() {
    return !!this.editingContent?._id && this.editingContent?.type !== 'Quiz';
  }

  get isDirectEditMode() {
    return this.isScopedEditMode || this.isSingleContentEditMode;
  }

  get isSingleContentTitleEditOnlyMode() {
    return this.isSingleContentEditMode && !!this.editingContent;
  }

  get isPartEditOnlyMode() {
    return this.isScopedEditMode && this.currentStep === 2;
  }

  get isSingleStepWizardMode() {
    return this.isPartEditOnlyMode || this.isSingleContentTitleEditOnlyMode;
  }

  get singleStepWizardLabel() {
    if (this.isPartEditOnlyMode) {
      return 'Partie';
    }

    if (!this.editingContent) {
      return 'Contenu';
    }

    return this.singleContentEditLabel;
  }

  get singleContentEditSubtitle() {
    if (!this.editingContent) {
      return 'Modifier le nom du contenu';
    }

    const normalizedType = this.editingContent.type.toLowerCase();
    if (normalizedType.includes('vid')) {
      return 'Modifier le nom de la video';
    }
    if (normalizedType === 'quiz') {
      return 'Modifier le nom du quiz';
    }
    if (normalizedType === 'document') {
      return 'Modifier le nom du document';
    }
    return 'Modifier le nom du contenu';
  }

  get singleContentEditLabel() {
    if (!this.editingContent) {
      return 'Contenu';
    }

    const normalizedType = this.editingContent.type.toLowerCase();
    if (normalizedType.includes('vid')) {
      return 'Video';
    }
    if (normalizedType === 'quiz') {
      return 'Quiz';
    }
    if (normalizedType === 'document') {
      return 'Document';
    }
    return 'Contenu';
  }

  get singleContentEditPlaceholder() {
    if (!this.editingContent) {
      return 'Modifier le nom du contenu';
    }

    const normalizedType = this.editingContent.type.toLowerCase();
    if (normalizedType.includes('vid')) {
      return 'Modifier le nom de la video';
    }
    if (normalizedType === 'quiz') {
      return 'Modifier le nom du quiz';
    }
    if (normalizedType === 'document') {
      return 'Modifier le nom du document';
    }
    return 'Modifier le nom du contenu';
  }

  get wizardModalTitle() {
    if (this.isPartEditOnlyMode) {
      return 'Modifier la partie';
    }

    if (this.editingContent?.type === 'Quiz' && this.creationMode === 'quiz_only') {
      return 'Modifier le quiz';
    }

    if (this.isSingleContentTitleEditOnlyMode) {
      return `Modifier ${this.singleContentEditLabel.toLowerCase()}`;
    }

    return this.editingCourseName ? 'Modifier le cours' : 'Ajouter une nouvelle structure de cours';
  }

  get primaryActionLabel() {
    if (this.isDirectEditMode) {
      return 'Enregistrer';
    }

    if (this.creationMode === 'linked') {
      if (this.linkedContentType === 'quiz') {
        if (this.currentStep < 5) {
          return 'Suivant';
        }
        if (this.currentStep === 5) {
          return 'Apercu';
        }
        if (this.currentStep === 6) {
          return 'Enregistrer';
        }
      }

      return this.currentStep >= this.linkedStepForType(this.linkedContentType)
        ? 'Enregistrer'
        : 'Suivant';
    }

    if (this.currentStep < 5) {
      return 'Suivant';
    }

    if (this.currentStep === 5) {
      return 'Apercu';
    }

    if (this.currentStep === 6) {
      return 'Enregistrer';
    }

    return this.editingCourseName
      ? 'Enregistrer les modifications'
      : 'Enregistrer la structure complete';
  }

  saveWizard() {
    this.scheduleUiUpdate(() => {
      this.isSaving = true;
      this.formError = '';
    });

    if (!this.isDirectEditMode && this.creationMode === 'full' && !this.hasVideoSource()) {
      this.scheduleUiUpdate(() => {
        this.isSaving = false;
        this.formError = 'Ajoutez une video locale ou un lien video valide avant de continuer.';
      });
      return;
    }

    const trimmedVideoLink = this.contentForm.videoLink.trim();

    const courseId =
      this.contentForm.courseMode === 'existing'
        ? this.contentForm.selectedCourse
        : this.contentForm.newCourse;
    const chapterId =
      this.contentForm.chapterMode === 'existing'
        ? this.contentForm.selectedChapter
        : this.contentForm.newChapter;
    const partId =
      this.contentForm.partMode === 'existing'
        ? this.contentForm.selectedPart
        : this.contentForm.newPart;
    const shouldCreateDocument =
      this.creationMode === 'full' ||
      (this.creationMode === 'linked' &&
        this.linkedContentType === 'document' &&
        this.hasDocumentSource());
    const shouldCreateVideo =
      this.creationMode === 'full' ||
      (this.creationMode === 'linked' &&
        this.linkedContentType === 'video' &&
        this.hasVideoSource());
    const shouldCreateQuiz =
      this.creationMode === 'quiz_only' ||
      this.creationMode === 'full' ||
      (this.creationMode === 'linked' &&
        this.linkedContentType === 'quiz' &&
        !!this.contentForm.quizTitle.trim() &&
        (this.contentForm.quizMode === 'generated'
          ? !!this.contentForm.quizSourceChapter.trim()
          : !!this.contentForm.quizFileName));
    const shouldRegenerateQuizQuestions =
      this.contentForm.quizMode === 'generated' &&
      this.contentForm.quizChapterFiles.length > 0 &&
      !this.hasEditableQuizQuestions() &&
      !this.pendingGeneratedQuizQuestions;
    const shouldGenerateQuizForCreation =
      this.contentForm.quizMode === 'generated' &&
      !this.pendingGeneratedQuizQuestions &&
      !this.hasEditableQuizQuestions() &&
      (shouldCreateQuiz || this.creationMode === 'quiz_only');

    const shouldGenerateQuizViaApi =
      shouldRegenerateQuizQuestions || shouldGenerateQuizForCreation;

    if (shouldGenerateQuizViaApi) {
      if (this.quizGenerationInFlight) {
        return;
      }

      this.quizGenerationInFlight = true;
      this.requestGeneratedQuizQuestions(courseId, chapterId, partId).subscribe({
        next: questions => {
          this.scheduleUiUpdate(() => {
            this.pendingGeneratedQuizQuestions = questions;
            this.editableQuizQuestions = this.cloneQuizQuestions(questions);
            this.syncQuizQuestionCountFromEditor();
            this.quizGenerationInFlight = false;
            this.saveWizard();
          });
        },
        error: error => {
          this.scheduleUiUpdate(() => {
            this.quizGenerationInFlight = false;
            this.isSaving = false;
            this.formError = this.resolveContentErrorMessage(
              error,
              'La generation du quiz a echoue.',
            );
          });
        },
      });
      return;
    }

    const quizPayload = this.buildQuizPayload(
      courseId,
      chapterId,
      partId,
      this.pendingGeneratedQuizQuestions || undefined,
    );
    this.pendingGeneratedQuizQuestions = null;

    if (this.isScopedEditMode) {
      if (this.isPartEditOnlyMode) {
        this.updateExistingPartName(courseId, chapterId, partId);
        return;
      }

      this.updateExistingCourse(courseId, chapterId, partId, quizPayload);
      return;
    }

    if (this.editingContent?._id && this.creationMode === 'quiz_only') {
      this.updateExistingQuiz(this.editingContent, quizPayload);
      return;
    }

    if (this.editingContent?._id) {
      this.updateExistingContent(this.editingContent, courseId, chapterId, partId, trimmedVideoLink);
      return;
    }

    if (this.creationMode === 'quiz_only') {
      this.http.post<any>('/api/contents', quizPayload).subscribe({
        next: createdQuiz => {
          this.scheduleUiUpdate(() => {
            this.appendCreatedContents([createdQuiz]);
            this.isSaving = false;
            this.closeModal(true);
            this.showOperationSuccess('Le quiz a ete ajoute avec succes.');
          });
        },
        error: error => {
          this.scheduleUiUpdate(() => {
            this.isSaving = false;
            this.formError =
              error?.error?.message ||
              error?.message ||
              "L'enregistrement du quiz automatique a échoué.";
          });
        },
      });
      return;
    }

    const requests = [];

    if (shouldCreateDocument) {
      requests.push(
        this.http
          .post<any>('/api/contents', {
            type: 'document',
            courseId,
            chapterId,
            partId,
            title: `${partId} - Document`,
            description: 'Document de cours ajouté',
            ...this.buildTeacherMetadata(),
          })
          .pipe(
            switchMap(createdDocument => {
              const createdDocumentId = this.normalizeContentId(createdDocument?._id);
              if (!this.contentForm.documentFile || !createdDocumentId) {
                return of(createdDocument);
              }

              const formData = new FormData();
              formData.append('file', this.contentForm.documentFile);

              return this.http
                .post<any>(`/api/contents/${createdDocumentId}/file`, formData)
                .pipe(map(response => response?.content || createdDocument));
            }),
          ),
      );
    }

    if (shouldCreateVideo) {
      requests.push(
        this.http
          .post<any>('/api/contents', {
            type: 'video',
            courseId,
            chapterId,
            partId,
            title: `${partId} - Vidéo`,
            description: trimmedVideoLink || 'Vidéo ajoutée',
            source: trimmedVideoLink || undefined,
            ...this.buildTeacherMetadata(),
          })
          .pipe(
            switchMap(createdVideo => {
              const createdVideoId = this.normalizeContentId(createdVideo?._id);
              if (!this.contentForm.videoFile || !createdVideoId) {
                return of(createdVideo);
              }

              const formData = new FormData();
              formData.append('file', this.contentForm.videoFile);

              return this.http
                .post<any>(`/api/contents/${createdVideoId}/file`, formData)
                .pipe(
                  map(response => {
                    if (response?.content) {
                      return response.content;
                    }

                    if (response?.fileUrl) {
                      return {
                        ...createdVideo,
                        fileUrl: response.fileUrl,
                        source: response.fileUrl,
                      };
                    }

                    return createdVideo;
                  }),
                );
            }),
          ),
      );
    }

    if (shouldCreateQuiz) {
      requests.push(
        this.http.post<any>('/api/contents', quizPayload).pipe(
          switchMap(createdQuiz => {
            const createdQuizId = this.normalizeContentId(createdQuiz?._id);
            if (!this.contentForm.quizFile || !createdQuizId) {
              return of(createdQuiz);
            }

            const formData = new FormData();
            formData.append('file', this.contentForm.quizFile);

            return this.http
              .post<any>(`/api/contents/${createdQuizId}/file`, formData)
              .pipe(
                map(response => {
                  const parsedQuiz = response?.content || createdQuiz;
                  return {
                    parsedQuiz,
                    parseFailed:
                      this.contentForm.quizMode === 'existing' &&
                      (!parsedQuiz?.quizQuestions || parsedQuiz.quizQuestions.length === 0),
                  };
                }),
              );
          }),
        ),
      );
    }

    forkJoin(requests).subscribe({
      next: results => {
        this.scheduleUiUpdate(() => {
          const quizResult = results.find(
            (result: any) => result?.parsedQuiz || result?.parseFailed,
          ) as
            | { parsedQuiz: any; parseFailed: boolean }
            | undefined;

          if (quizResult?.parseFailed) {
            this.isSaving = false;
            this.formError =
              "Le fichier quiz a ete telecharge, mais aucune question n'a pu etre extraite. Verifiez le format 'Question / A. / B. / C. / D. / Bonne reponse: X'.";
            return;
          }

          this.appendCreatedContents(results);
          this.isSaving = false;
          this.closeModal(true);
          this.showOperationSuccess('Le contenu a ete ajoute avec succes.');
        });
      },
      error: error => {
        this.scheduleUiUpdate(() => {
          this.isSaving = false;
          this.formError = this.resolveContentErrorMessage(
            error,
            "L'enregistrement a échoué. Vérifiez que le backend est démarré et que l'API répond.",
          );
        });
      },
    });
  }

  getChapters(course: string) {
    return this.chapterKeysByCourseMap[course] || [];
  }

  getParts(course: string, chapter: string): string[] {
    return this.partKeysByChapterMap[this.chapterKey(course, chapter)] || [];
  }

  getItemsForPart(course: string, chapter: string, part: string): ContentItem[] {
    const items = this.groupedContentsMap[course]?.[chapter] || [];
    return items.filter(item => item.partId === part);
  }

  getPartContentGroups(course: string, chapter: string, part: string): PartContentGroup[] {
    const items = this.getItemsForPart(course, chapter, part);
    return [
      {
        key: 'document',
        label: 'Documents',
        icon: 'description',
        items: items.filter(item => item.type === 'Document'),
      },
      {
        key: 'video',
        label: 'Videos',
        icon: 'play_circle',
        items: items.filter(item => item.type.toLowerCase().includes('vid')),
      },
      {
        key: 'quiz',
        label: 'Quiz',
        icon: 'quiz',
        items: items.filter(item => item.type === 'Quiz'),
      },
    ];
  }

  partTypeGroupKey(course: string, chapter: string, part: string, groupKey: string): string {
    return `${this.partKey(course, chapter, part)}|${groupKey}`;
  }

  isPartTypeGroupExpanded(course: string, chapter: string, part: string, groupKey: string): boolean {
    return !this.partTypeGroupCollapsed[this.partTypeGroupKey(course, chapter, part, groupKey)];
  }

  togglePartTypeGroup(course: string, chapter: string, part: string, groupKey: string) {
    const key = this.partTypeGroupKey(course, chapter, part, groupKey);
    this.partTypeGroupCollapsed[key] = !this.partTypeGroupCollapsed[key];
  }

  getCourseLevelItems(course: string): ContentItem[] {
    return this.courseLevelContentsByCourseMap[course] || [];
  }

  getStandaloneQuizzes(course: string): ContentItem[] {
    return this.standaloneQuizzesByCourseMap[course] || [];
  }

  getChapterItems(course: string, chapter: string): ContentItem[] {
    return this.groupedContentsMap[course]?.[chapter] || [];
  }

  chapterTotal(course: string, chapter: string): number {
    return this.getChapterItems(course, chapter).length;
  }

  chapterCompleted(course: string, chapter: string): number {
    return this.getChapterItems(course, chapter).filter(item => item.completed).length;
  }

  chapterProgress(course: string, chapter: string): number {
    const total = this.chapterTotal(course, chapter);
    if (!total) {
      return 0;
    }
    return Math.round((this.chapterCompleted(course, chapter) / total) * 100);
  }

  chapterDescription(course: string, chapter: string): string {
    const itemWithDescription = this.getChapterItems(course, chapter).find(item => !!item.description);
    return (
      itemWithDescription?.description ||
      'Introduction au chapitre et aux ressources disponibles (documents, vidéos et quiz).'
    );
  }

  chapterSummary(course: string, chapter: string): string {
    const partCount = this.getParts(course, chapter).length;
    const itemCount = this.getChapterItems(course, chapter).length;
    return `${partCount} partie${partCount > 1 ? 's' : ''} • ${itemCount} contenu${itemCount > 1 ? 's' : ''}`;
  }

  partSummary(course: string, chapter: string, part: string): string {
    const items = this.getItemsForPart(course, chapter, part);
    const labels = Array.from(new Set(items.map(item => item.type.toLowerCase())));
    return labels.length > 0 ? labels.join(' • ') : 'Aucun contenu';
  }

  countByType(type: ContentType): number {
    return this.contentTypeCounts[type] || 0;
  }

  openCourseView(course: string, event?: Event) {
    event?.stopPropagation();
    this.selectedCourseView = course;
    this.openedCourseMenu = null;
    this.openedPartMenu = null;
    this.openedItemMenu = null;
    this.expandFirstChapterAndPart(course);
  }

  private tryOpenRequestedCourseView() {
    const requestedCourse = this.pendingRequestedCourseView;
    if (!requestedCourse) {
      return;
    }

    const hasCourse = this.courseKeysList.includes(requestedCourse);
    if (!hasCourse) {
      return;
    }

    this.openCourseView(requestedCourse);
    this.pendingRequestedCourseView = null;
  }

  closeCourseView() {
    this.selectedCourseView = null;
    this.openedCourseMenu = null;
    this.openedPartMenu = null;
    this.openedItemMenu = null;
  }

  courseChapterCount(course: string): number {
    return this.getChapters(course).length;
  }

  courseTeacherName(course: string): string {
    const firstItem = this.contents.find(item => item.courseId === course);
    return firstItem?.teacherName || this.currentTeacherName || 'Enseignant';
  }

  courseStatusLabel(course: string): string {
    return this.courseTotal(course) > 0 ? 'Ouvert' : 'Brouillon';
  }

  chapterCompletionText(course: string, chapter: string): string {
    return `${this.chapterCompleted(course, chapter)} elements termines sur ${this.chapterTotal(course, chapter)}`;
  }

  partCompletionText(course: string, chapter: string, part: string): string {
    const items = this.getItemsForPart(course, chapter, part);
    const completed = items.filter(item => item.completed).length;
    return `${completed} elements termines sur ${items.length}`;
  }

  partProgress(course: string, chapter: string, part: string): number {
    const items = this.getItemsForPart(course, chapter, part);
    if (!items.length) {
      return 0;
    }

    const completed = items.filter(item => item.completed).length;
    return Math.round((completed / items.length) * 100);
  }

  itemIconClass(item: ContentItem): string {
    if (item.type === 'Document') {
      return 'fa-file-lines';
    }
    if (item.type === 'Vidéo') {
      return 'fa-circle-play';
    }
    if (item.type === 'Quiz') {
      return 'fa-clipboard-check';
    }
    if (item.type === 'Exercice') {
      return 'fa-pen-to-square';
    }
    return 'fa-file';
  }

  teacherInitialsForCourse(course: string): string {
    const teacherName = this.courseTeacherName(course);
    return this.courseAvatarLabel(teacherName);
  }

  courseTeacherAvatar(course: string): string {
    return this.currentTeacherAvatarDataUrl || '';
  }

  sidebarTeacherBadgeLabel(): string {
    if (this.selectedPreviewItem && this.isQuizItem(this.selectedPreviewItem)) {
      return this.quizLevelLabel(this.selectedPreviewItem) || 'Quiz';
    }

    return 'Enseignant';
  }

  sidebarTeacherBadgeClass(): string {
    if (!this.selectedPreviewItem || !this.isQuizItem(this.selectedPreviewItem)) {
      return 'sidebar-teacher__badge';
    }

    switch (this.quizLevelLabel(this.selectedPreviewItem)) {
      case 'Débutant':
        return 'sidebar-teacher__badge sidebar-teacher__badge--beginner';
      case 'Intermédiaire':
        return 'sidebar-teacher__badge sidebar-teacher__badge--intermediate';
      case 'Avancé':
        return 'sidebar-teacher__badge sidebar-teacher__badge--advanced';
      default:
        return 'sidebar-teacher__badge';
    }
  }

  toggleCourse(course: string) {
    this.openedCourseMenu = null;
    this.openedPartMenu = null;
    this.openedItemMenu = null;
    this.courseExpanded[course] = !this.courseExpanded[course];
  }

  toggleCourseMenu(course: string, event: Event) {
    event.stopPropagation();
    this.openedVisibilityMenu = null;
    this.openedCourseMenu = this.openedCourseMenu === course ? null : course;
  }

  addLinkedContent(course: string, event?: Event) {
    event?.stopPropagation();
    this.openedCourseMenu = null;
    this.openModal();
    this.addingChapterFromCourseMenu = true;
    this.contentForm.courseMode = 'existing';
    this.setCourse(course);
    this.contentForm.chapterMode = 'new';
    this.contentForm.selectedChapter = '';
    this.contentForm.newChapter = '';
    this.currentStep = 1;
  }

  addLinkedContentToChapter(course: string, chapter: string, event?: Event) {
    event?.stopPropagation();
    this.openedChapterMenu = null;
    this.openModal();
    this.creationMode = 'full';
    this.contentForm.courseMode = 'existing';
    this.setCourse(course);
    this.contentForm.chapterMode = 'existing';
    this.setChapter(chapter);
    this.currentStep = 2;
  }

  addLinkedContentToPart(course: string, chapter: string, part: string, event?: Event) {
    event?.stopPropagation();
    this.openedPartMenu = null;
    this.openLinkedContentModal(course, chapter, part, 3);
  }

  editCourse(course: string, event?: Event) {
    event?.stopPropagation();
    this.openedCourseMenu = null;

    const courseItems = this.contents.filter(item => item.courseId === course);
    if (courseItems.length === 0) {
      this.formError = `Aucun contenu trouve pour le cours "${course}".`;
      return;
    }

    this.openScopedEditModal(courseItems, course, 1);
  }

  deleteCourse(course: string, event?: Event) {
    event?.stopPropagation();
    this.openedCourseMenu = null;
    this.openDeleteModal({ type: 'course', course });
  }

  toggleChapter(course: string, chapter: string) {
    this.openedChapterMenu = null;
    this.openedPartMenu = null;
    this.openedItemMenu = null;
    const key = this.chapterKey(course, chapter);
    this.chapterExpanded[key] = !this.chapterExpanded[key];

    if (!this.chapterExpanded[key]) {
      this.getParts(course, chapter).forEach(part => {
        delete this.partExpanded[this.partKey(course, chapter, part)];
      });
      return;
    }

    const firstPart = this.getParts(course, chapter)[0];
      if (firstPart) {
        this.partExpanded[this.partKey(course, chapter, firstPart)] = true;
      }
    }

  toggleChapterMenu(course: string, chapter: string, event: Event) {
    event.stopPropagation();
    this.openedVisibilityMenu = null;
    this.openedLinkedContentSubmenu = null;
    const key = this.chapterKey(course, chapter);
    this.openedChapterMenu = this.openedChapterMenu === key ? null : key;
  }

  toggleLinkedContentSubmenu(key: string, event: Event) {
    event.stopPropagation();
    this.openedLinkedContentSubmenu =
      this.openedLinkedContentSubmenu === key ? null : key;
  }

  editChapter(course: string, chapter: string, event?: Event) {
    event?.stopPropagation();
    this.openedChapterMenu = null;
    const chapterItems = this.getChapterItems(course, chapter);
    if (!chapterItems.length) {
      this.formError = `Aucun contenu trouve pour le chapitre "${chapter}".`;
      return;
    }

    this.openScopedEditModal(chapterItems, `${course} - ${chapter}`, 1);
  }

  deleteChapter(course: string, chapter: string, event?: Event) {
    event?.stopPropagation();
    this.openedChapterMenu = null;
    this.openDeleteModal({ type: 'chapter', course, chapter });
  }
  
  togglePart(course: string, chapter: string, part: string) {
    this.openedChapterMenu = null;
    this.openedPartMenu = null;
    this.openedItemMenu = null;
    const key = this.partKey(course, chapter, part);
    this.partExpanded[key] = !this.partExpanded[key];
  }

  togglePartMenu(course: string, chapter: string, part: string, event: Event) {
    event.stopPropagation();
    this.openedVisibilityMenu = null;
    this.openedLinkedContentSubmenu = null;
    const key = this.partKey(course, chapter, part);
    this.openedPartMenu = this.openedPartMenu === key ? null : key;
  }

  chooseLinkedContentTypeForChapter(
    course: string,
    chapter: string,
    type: LinkedContentType,
    event?: Event,
  ) {
    event?.stopPropagation();
    this.openedChapterMenu = null;
    this.openedLinkedContentSubmenu = null;
    this.openLinkedContentModal(course, chapter, undefined, 2, type);
  }

  chooseLinkedContentTypeForPart(
    course: string,
    chapter: string,
    part: string,
    type: LinkedContentType,
    event?: Event,
  ) {
    event?.stopPropagation();
    this.openedPartMenu = null;
    this.openedLinkedContentSubmenu = null;
    this.openLinkedContentModal(course, chapter, part, 3, type);
  }

  editPart(course: string, chapter: string, part: string, event?: Event) {
    event?.stopPropagation();
    this.openedPartMenu = null;
    const partItems = this.getItemsForPart(course, chapter, part);
    if (!partItems.length) {
      this.formError = `Aucun contenu trouve pour la partie "${part}".`;
      return;
    }

    this.openScopedEditModal(partItems, `${course} - ${chapter} - ${part}`, 2);
  }

  deletePart(course: string, chapter: string, part: string, event?: Event) {
    event?.stopPropagation();
    this.openedPartMenu = null;
    this.openDeleteModal({ type: 'part', course, chapter, part });
  }

  openPreview(item: ContentItem) {
    this.openedItemMenu = null;
    this.selectedPreviewItem = item;
  }

  toggleItemMenu(item: ContentItem, event: Event) {
    event.stopPropagation();
    this.openedVisibilityMenu = null;
    const key = item._id || [item.courseId, item.chapterId, item.partId, item.title].join('|');
    this.openedItemMenu = this.openedItemMenu === key ? null : key;
  }

  toggleVisibilityMenu(key: string, event: Event) {
    event.stopPropagation();
    this.openedCourseMenu = null;
    this.openedChapterMenu = null;
    this.openedPartMenu = null;
    this.openedItemMenu = null;
    this.openedVisibilityMenu = this.openedVisibilityMenu === key ? null : key;
  }

  visibilityMenuKeyForCourse(course: string) {
    return `course|${course}`;
  }

  visibilityMenuKeyForChapter(course: string, chapter: string) {
    return `chapter|${course}|${chapter}`;
  }

  visibilityMenuKeyForPart(course: string, chapter: string, part: string) {
    return `part|${course}|${chapter}|${part}`;
  }

  visibilityMenuKeyForItem(item: ContentItem) {
    return `item|${item._id || [item.courseId, item.chapterId, item.partId, item.title].join('|')}`;
  }

  visibilityLabelForItems(items: ContentItem[]) {
    const settings = this.getVisibilityState(items);
    return settings.visibleToAllClasses
      ? 'Toutes les classes'
      : settings.visibleToClasses.length > 0
        ? `${settings.visibleToClasses.length} classe(s)`
        : 'Masque';
  }

  isVisibleToAllClasses(items: ContentItem[]) {
    return this.getVisibilityState(items).visibleToAllClasses;
  }

  visibilityDropdownIcon(items: ContentItem[]) {
    return this.isVisibleToAllClasses(items) ? 'visibility' : 'visibility_off';
  }

  isVisibleToClass(items: ContentItem[], className: string) {
    const settings = this.getVisibilityState(items);
    return !settings.visibleToAllClasses && settings.visibleToClasses.includes(this.normalizeClassName(className));
  }

  setVisibilityForAllClasses(items: ContentItem[], menuKey: string, event?: Event) {
    const settings = this.getVisibilityState(items);

    this.updateVisibilityForItems(
      items,
      settings.visibleToAllClasses
        ? { visibleToAllClasses: false, visibleToClasses: [] }
        : { visibleToAllClasses: true, visibleToClasses: [] },
      menuKey,
      event,
    );
  }

  toggleVisibilityForClass(
    items: ContentItem[],
    className: string,
    menuKey: string,
    event?: Event,
  ) {
    const normalizedClassName = this.normalizeClassName(className);
    const settings = this.getVisibilityState(items);
    const nextVisibleToClasses = settings.visibleToAllClasses
      ? []
      : settings.visibleToClasses.includes(normalizedClassName)
        ? settings.visibleToClasses.filter(value => value !== normalizedClassName)
        : [...settings.visibleToClasses, normalizedClassName];

    this.updateVisibilityForItems(
      items,
      {
        visibleToAllClasses: false,
        visibleToClasses: nextVisibleToClasses,
      },
      menuKey,
      event,
    );
  }

  updateVisibilityForItems(
    items: ContentItem[],
    options: { visibleToAllClasses: boolean; visibleToClasses: string[] },
    menuKey: string,
    event?: Event,
  ) {
    event?.stopPropagation();

    const ids = items
      .map(item => (item._id ? String(item._id) : ''))
      .filter((id): id is string => !!id);
    if (!ids.length) {
      return;
    }

    const normalizedVisibleToClasses = options.visibleToAllClasses
      ? []
      : [...new Set(options.visibleToClasses.map(value => this.normalizeClassName(value)).filter(Boolean))];

    const payload = {
      visibleToAllClasses: options.visibleToAllClasses,
      visibleToClasses: normalizedVisibleToClasses,
    };

    this.visibilitySavingKey = menuKey;

    forkJoin(ids.map(id => this.http.patch<any>(`/api/contents/${id}`, payload))).subscribe({
      next: results => {
        this.scheduleUiUpdate(() => {
          const updatedItems = results
            .map(result => this.mapApiItemToContentItem(result))
            .filter((item): item is ContentItem => item !== null);
          const updatedMap = new Map(updatedItems.map(item => [item._id, item]));

          this.contents = this.deduplicateContents(
            this.contents.map(item => (item._id && updatedMap.has(item._id) ? updatedMap.get(item._id)! : item)),
          );
          this.syncStructureFromContents();
          this.mergeTeacherAssignedClasses(normalizedVisibleToClasses);
          this.visibilitySavingKey = null;
          this.openedVisibilityMenu = menuKey;
        });
      },
      error: () => {
        this.scheduleUiUpdate(() => {
          this.visibilitySavingKey = null;
          this.formError = "La mise a jour de la visibilite a echoue.";
        });
      },
    });
  }

  editQuizItem(item: ContentItem, event?: Event) {
    event?.stopPropagation();
    this.openedItemMenu = null;
    this.editContent(item);
    const isStandaloneQuiz =
      item.quizDisplayMode === 'standalone' ||
      (!`${item.chapterId || ''}`.trim() && !`${item.partId || ''}`.trim());
    this.creationMode = isStandaloneQuiz ? 'quiz_only' : 'linked';
    this.linkedContentType = 'quiz';
    this.currentStep = 5;
  }

  editItemFromMenu(item: ContentItem, event?: Event) {
    event?.stopPropagation();
    if (item.type === 'Quiz') {
      this.editQuizItem(item, event);
      return;
    }

    this.openedItemMenu = null;
    this.editContent(item);
  }

  closePreview() {
    this.selectedPreviewItem = null;
  }

  openCourseMembersDirectory(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    this.scheduleUiUpdate(() => {
      this.showCourseMembersModal = true;
      this.selectedCourseMemberClass = 'all';
      this.courseMembers = [];
      this.courseMembersError = '';
      this.courseMembersLoading = true;
      this.loadCourseMembers();
    });
  }

  closeCourseMembersDirectory() {
    this.showCourseMembersModal = false;
    this.courseMembersError = '';
  }

  loadCourseMembers(selectedClassName?: string) {
    this.scheduleUiUpdate(() => {
      this.courseMembersLoading = true;
      this.courseMembersError = '';
      this.courseMembers = [];
    });

    const requestUrl =
      selectedClassName && selectedClassName !== 'all'
        ? `/auth/teacher-course-members?className=${encodeURIComponent(selectedClassName)}`
        : '/auth/teacher-course-members';

    this.http.get<any>(requestUrl).subscribe({
      next: response => {
        this.scheduleUiUpdate(() => {
          const data = response?.data || response || {};
          this.courseMemberClasses = Array.isArray(data.classes) ? data.classes : [];
          this.mergeTeacherAssignedClasses(this.courseMemberClasses);
          this.courseMembers = Array.isArray(data.students) ? data.students : [];
          this.selectedCourseMemberClass = data.selectedClass || 'all';
          this.courseMembersLoading = false;
        });
      },
      error: error => {
        this.scheduleUiUpdate(() => {
          this.courseMembersLoading = false;
          this.courseMembersError =
            error?.error?.message || error?.message || "Impossible de charger l'annuaire.";
        });
      },
    });
  }

  selectCourseMemberClass(className: string) {
    if (this.selectedCourseMemberClass === className) {
      return;
    }

    this.selectedCourseMemberClass = className;
    this.loadCourseMembers(className === 'all' ? undefined : className);
  }

  courseMemberInitials(member: CourseMember): string {
    return this.courseAvatarLabel(member.fullName || member.email || 'Etudiant');
  }

  previewSource(item: ContentItem): SafeResourceUrl | null {
    if (this.isVideoItem(item) && item.source?.startsWith('http')) {
      const embeddedVideoUrl = this.toEmbeddedVideoUrl(item.source);
      if (embeddedVideoUrl) {
        return this.sanitizer.bypassSecurityTrustResourceUrl(embeddedVideoUrl);
      }
    }

    const rawSource = item.fileUrl || item.source;
    if (!rawSource) {
      return null;
    }

    const resolvedSource = rawSource.startsWith('http')
      ? rawSource
      : `${this.backendBaseUrl}${rawSource}`;

    return this.sanitizer.bypassSecurityTrustResourceUrl(resolvedSource);
  }

  previewVideoUrl(item: ContentItem): string | null {
    if (!this.isVideoItem(item)) {
      return null;
    }

    const rawSource = item.fileUrl || item.source;
    if (!rawSource || rawSource.startsWith('http')) {
      return null;
    }

    return `${this.backendBaseUrl}${rawSource}`;
  }

  isQuizItem(item: ContentItem): boolean {
    return item.type === 'Quiz';
  }

  isVideoItem(item: ContentItem): boolean {
    return item.type.toLowerCase().includes('vid');
  }

  previewQuizQuestions(item: ContentItem): QuizQuestion[] {
    if (!this.isQuizItem(item) || !Array.isArray(item.quizQuestions)) {
      return [];
    }

    return item.quizQuestions;
  }

  private cloneQuizQuestions(questions?: QuizQuestion[]): QuizQuestion[] {
    if (!Array.isArray(questions)) {
      return [];
    }

    return questions.map((question, index) => this.normalizeEditableQuizQuestion(question, index));
  }

  private createEmptyQuizQuestion(index: number): QuizQuestion {
    return {
      id: `manual-question-${Date.now()}-${index}`,
      prompt: '',
      type: 'single',
      options: ['A', 'B', 'C', 'D'].map(label => ({
        label,
        text: '',
      })),
      correctAnswers: [],
      explanation: '',
    };
  }

  private openQuizPreviewStep() {
    this.canSaveAfterQuizPreview = false;
    this.quizPreviewOpenedAt = Date.now();
    this.currentStep = 6;

    window.setTimeout(() => {
      this.canSaveAfterQuizPreview = true;
    }, 150);
  }

  private scrollToEditableQuizQuestion(questionId: string) {
    window.setTimeout(() => {
      const questionElement = document.getElementById(`quiz-editor-question-${questionId}`);
      questionElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  }

  private normalizeEditableQuizQuestion(question: Partial<QuizQuestion> | undefined, index: number): QuizQuestion {
    const labels = ['A', 'B', 'C', 'D'];
    const normalizedOptions = labels.map((label, optionIndex) => {
      const matchingOption = Array.isArray(question?.options)
        ? question?.options.find(option => `${option?.label || ''}`.trim().toUpperCase() === label)
        : undefined;
      const fallbackOption = Array.isArray(question?.options) ? question.options[optionIndex] : undefined;

      return {
        label,
        text: `${matchingOption?.text || fallbackOption?.text || ''}`,
      };
    });

    const normalizedType = question?.type === 'multiple' ? 'multiple' : 'single';
    const normalizedCorrectAnswers = Array.isArray(question?.correctAnswers)
      ? question.correctAnswers
          .map(answer => `${answer || ''}`.trim().toUpperCase())
          .filter(answer => labels.includes(answer))
      : [];

    return {
      id: `${question?.id || `manual-question-${Date.now()}-${index}`}`,
      prompt: `${question?.prompt || ''}`,
      type: normalizedType,
      options: normalizedOptions,
      correctAnswers:
        normalizedType === 'single'
          ? normalizedCorrectAnswers.slice(0, 1)
          : [...new Set(normalizedCorrectAnswers)],
      explanation: `${question?.explanation || ''}`,
    };
  }

  private sanitizeEditableQuizQuestions(questions?: QuizQuestion[]): QuizQuestion[] {
    const sourceQuestions = Array.isArray(questions) ? questions : this.editableQuizQuestions;

    return sourceQuestions
      .map((question, index) => {
        const normalizedQuestion = this.normalizeEditableQuizQuestion(question, index);
        return {
          ...normalizedQuestion,
          prompt: normalizedQuestion.prompt.trim(),
          explanation: normalizedQuestion.explanation?.trim() || undefined,
          options: normalizedQuestion.options.map(option => ({
            label: option.label,
            text: `${option.text || ''}`.trim(),
          })),
        };
      })
      .filter(question => question.prompt && question.options.some(option => option.text));
  }

  private hasEditableQuizQuestions(): boolean {
    return this.sanitizeEditableQuizQuestions().length > 0;
  }

  private syncQuizQuestionCountFromEditor() {
    const editorQuestionCount = Math.max(
      this.editableQuizQuestions.length,
      this.sanitizeEditableQuizQuestions().length,
    );
    if (editorQuestionCount > 0) {
      this.contentForm.quizQuestions = editorQuestionCount;
    }
  }

  private validateEditableQuizQuestions(): string {
    if (!this.editableQuizQuestions.length) {
      return '';
    }

    for (let questionIndex = 0; questionIndex < this.editableQuizQuestions.length; questionIndex += 1) {
      const question = this.normalizeEditableQuizQuestion(
        this.editableQuizQuestions[questionIndex],
        questionIndex,
      );

      if (!question.prompt.trim()) {
        return `La question ${questionIndex + 1} doit contenir un enonce.`;
      }

      const emptyOption = question.options.find(option => !`${option.text || ''}`.trim());
      if (emptyOption) {
        return `Toutes les reponses de la question ${questionIndex + 1} sont obligatoires.`;
      }

      if (!question.correctAnswers.length) {
        return `Choisissez au moins une bonne reponse pour la question ${questionIndex + 1}.`;
      }
    }

    return '';
  }

  quizQuestionTypeLabel(question: QuizQuestion): string {
    return question.type === 'multiple' ? 'Choix multiples' : 'Choix unique';
  }

  isCorrectQuizOption(question: QuizQuestion, optionLabel: string): boolean {
    return question.correctAnswers.includes(optionLabel);
  }

  courseTotal(course: string): number {
    const courseGroup = this.groupedContentsMap[course] || {};
    const chapters = Object.values(courseGroup) as ContentItem[][];
    return chapters.reduce((sum, items) => sum + items.length, 0);
  }

  deleteContent(item: ContentItem) {
    this.openedItemMenu = null;
    this.openDeleteModal({ type: 'content', item });
  }

  private executeDeleteContent(item: ContentItem) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId) {
      this.scheduleUiUpdate(() => {
        this.formError = "Impossible de supprimer ce contenu : identifiant introuvable.";
      });
      return;
    }

    const previousContents = [...this.contents];
    this.contents = this.contents.filter(c => this.normalizeContentId(c._id) !== itemId);
    this.syncStructureFromContents();

    this.http.delete(`/api/contents/${itemId}`).subscribe({
      next: () => {
        this.scheduleUiUpdate(() => {
          this.showOperationSuccess('Le contenu a ete supprime avec succes.');
        });
      },
      error: () => {
        this.scheduleUiUpdate(() => {
          this.contents = previousContents;
          this.syncStructureFromContents();
          this.formError = 'La suppression a échoué.';
        });
      },
    });
  }

  private mapApiItemToContentItem(item: any): ContentItem | null {
    const type = this.fromApiType(item.type);
    if (!type) {
      return null;
    }

    const rawCourseId = this.repairEncoding(item.courseId || item.course || '');
    const rawChapterId = this.repairEncoding(item.chapterId || item.chapter || '');
    const rawPartId = this.repairEncoding(item.partId || item.part || '');
    const quizDisplayMode = item.quizDisplayMode === 'standalone' ? 'standalone' : 'scoped';
    const isStandaloneQuiz =
      type === 'Quiz' &&
      (quizDisplayMode === 'standalone' || (!rawChapterId && !rawPartId));
    const courseId = rawCourseId;
    const chapterId =
      isStandaloneQuiz
        ? ''
        : type === 'Chapitre'
        ? rawChapterId || this.repairEncoding(item.title || '')
        : rawChapterId;
    const partId =
      isStandaloneQuiz
        ? ''
        : type === 'Partie'
        ? rawPartId || this.repairEncoding(item.title || '')
        : rawPartId;
    const title = this.normalizeCorruptedContentTitle(
      type,
      this.repairEncoding(item.title || 'Sans titre'),
      partId,
    );
    const description = this.normalizeCorruptedContentDescription(
      type,
      this.repairEncoding(item.description || ''),
    );

    return {
      _id: this.normalizeContentId(item._id ?? item.id),
      type,
      courseId,
      chapterId,
      partId,
      title,
      description,
      teacherName: this.repairEncoding(item.teacherName || '') || undefined,
      teacherEmail: item.teacherEmail || undefined,
      teacherAvatarDataUrl:
        this.repairEncoding(item.teacherAvatarDataUrl || '') || undefined,
      visibleToAllClasses: item.visibleToAllClasses === true,
      visibleToClasses: this.normalizeVisibilityClasses(item.visibleToClasses),
      dueDate: this.normalizeApiDateValue(item.dueDate),
      dueDateTime: this.normalizeApiDateValue(item.dueDateTime),
      fileName: this.repairEncoding(item.fileName || item.originalName || '') || undefined,
      source: item.source || item.fileUrl || undefined,
      fileUrl: item.fileUrl || undefined,
      quizMode: item.quizMode || undefined,
      quizDifficulty: item.quizDifficulty || undefined,
      quizSourceChapter: this.repairEncoding(item.quizSourceChapter || '') || undefined,
      quizAttempts: item.quizAttempts || undefined,
      quizPassingScore: item.quizPassingScore || undefined,
      quizQuestionCount: item.quizQuestionCount || undefined,
      quizDurationMinutes: item.quizDurationMinutes || undefined,
      quizDisplayMode,
      quizQuestions: Array.isArray(item.quizQuestions)
        ? item.quizQuestions.map((question: any) => ({
            ...question,
            prompt: this.repairEncoding(question?.prompt || ''),
            explanation: this.repairEncoding(question?.explanation || ''),
            options: Array.isArray(question?.options)
              ? question.options.map((option: any) => ({
                  ...option,
                  text: this.repairEncoding(option?.text || ''),
                }))
              : [],
          }))
        : [],
      completed: item.completed ?? false,
    };
  }

  private moveContentToPart(item: ContentItem, courseId: string, chapterId: string, partId: string) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId) {
      this.formError = "Impossible de deplacer ce contenu : identifiant introuvable.";
      this.draggingContentId = null;
      return;
    }

    const payload =
      item.type === 'Quiz'
        ? {
            courseId,
            chapterId,
            partId,
            quizDisplayMode: 'scoped',
          }
        : {
            courseId,
            chapterId,
            partId,
        };

    const applyMovedContent = (updatedContent: any) =>
      this.mapApiItemToContentItem({
        ...item,
        ...payload,
        ...(updatedContent || {}),
        courseId,
        chapterId,
        partId,
        quizDisplayMode: item.type === 'Quiz' ? 'scoped' : item.quizDisplayMode,
      });
    const previousContents = [...this.contents];
    const optimisticContent = applyMovedContent({});

    if (optimisticContent) {
      this.scheduleUiUpdate(() => {
        this.contents = this.deduplicateContents(
          this.contents.map(content =>
            this.normalizeContentId(content._id) === itemId ? optimisticContent : content,
          ),
        );
        this.syncStructureFromContents();
        this.draggingContentId = null;
        this.activeDropPartKey = null;
        this.activeDropPartTypeKey = null;
        this.activeStandaloneDropCourse = null;
      });
    }

    this.http.patch<any>(`/api/contents/${itemId}`, payload).subscribe({
      next: updatedContent => {
        this.scheduleUiUpdate(() => {
          this.contents = this.deduplicateContents(
            this.contents.map(content =>
              this.normalizeContentId(content._id) === itemId
                ? (applyMovedContent(updatedContent) || content)
                : content,
            ),
          );
          this.syncStructureFromContents();
          this.draggingContentId = null;
          this.activeDropPartKey = null;
          this.activeDropPartTypeKey = null;
          this.activeStandaloneDropCourse = null;
          this.showOperationSuccess('Le contenu a ete deplace avec succes.');
        });
      },
      error: error => {
        this.scheduleUiUpdate(() => {
          this.contents = previousContents;
          this.syncStructureFromContents();
          this.draggingContentId = null;
          this.activeDropPartKey = null;
          this.activeDropPartTypeKey = null;
          this.activeStandaloneDropCourse = null;
          this.formError = this.resolveContentErrorMessage(
            error,
            'Le deplacement du contenu a echoue.',
          );
        });
      },
    });
  }

  private getDraggedContent(event?: DragEvent): ContentItem | null {
    const draggedContentId =
      event?.dataTransfer?.getData('text/plain') || this.draggingContentId || '';
    if (!draggedContentId) {
      return null;
    }

    return (
      this.contents.find(
        content => this.normalizeContentId(content._id) === draggedContentId,
      ) || null
    );
  }

  private canDropItemInGroup(item: ContentItem, groupKey: string): boolean {
    const normalizedGroup = `${groupKey || ''}`.trim().toLowerCase();
    if (normalizedGroup === 'document') {
      return item.type === 'Document';
    }
    if (normalizedGroup === 'video') {
      return item.type.toLowerCase().includes('vid');
    }
    if (normalizedGroup === 'quiz') {
      return item.type === 'Quiz';
    }

    return false;
  }

  private dropTypeErrorMessage(item: ContentItem, groupKey: string): string {
    const labels: Record<string, string> = {
      document: 'Documents',
      video: 'Videos',
      quiz: 'Quiz',
    };

    return `Le contenu "${item.title}" ne correspond pas au dossier ${labels[groupKey] || groupKey}.`;
  }

  private normalizeDropScope(value: unknown): string {
    return `${value || ''}`
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  private moveContentToCourse(item: ContentItem, courseId: string) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId) {
      this.formError = "Impossible de deplacer ce contenu : identifiant introuvable.";
      this.draggingContentId = null;
      return;
    }

    const payload =
      item.type === 'Quiz'
        ? {
            courseId,
            chapterId: '',
            partId: '',
            quizDisplayMode: 'standalone',
          }
        : {
            courseId,
            chapterId: '',
            partId: '',
        };

    const applyMovedContent = (updatedContent: any) =>
      this.mapApiItemToContentItem({
        ...item,
        ...payload,
        ...(updatedContent || {}),
        courseId,
        chapterId: '',
        partId: '',
        quizDisplayMode: item.type === 'Quiz' ? 'standalone' : item.quizDisplayMode,
      });
    const previousContents = [...this.contents];
    const optimisticContent = applyMovedContent({});

    if (optimisticContent) {
      this.scheduleUiUpdate(() => {
        this.contents = this.deduplicateContents(
          this.contents.map(content =>
            this.normalizeContentId(content._id) === itemId ? optimisticContent : content,
          ),
        );
        this.syncStructureFromContents();
        this.draggingContentId = null;
        this.activeCourseDropKey = null;
        this.activeDropPartKey = null;
        this.activeStandaloneDropCourse = null;
      });
    }

    this.http.patch<any>(`/api/contents/${itemId}`, payload).subscribe({
      next: updatedContent => {
        this.scheduleUiUpdate(() => {
          this.contents = this.deduplicateContents(
            this.contents.map(content =>
              this.normalizeContentId(content._id) === itemId
                ? (applyMovedContent(updatedContent) || content)
                : content,
            ),
          );
          this.syncStructureFromContents();
          this.draggingContentId = null;
          this.activeCourseDropKey = null;
          this.activeDropPartKey = null;
          this.activeStandaloneDropCourse = null;
          this.showOperationSuccess('Le contenu a ete deplace hors du chapitre avec succes.');
        });
      },
      error: error => {
        this.scheduleUiUpdate(() => {
          this.contents = previousContents;
          this.syncStructureFromContents();
          this.draggingContentId = null;
          this.activeCourseDropKey = null;
          this.activeDropPartKey = null;
          this.activeStandaloneDropCourse = null;
          this.formError = this.resolveContentErrorMessage(
            error,
            'Le deplacement du contenu hors du chapitre a echoue.',
          );
        });
      },
    });
  }

  private moveQuizToStandalone(item: ContentItem, courseId: string) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId) {
      this.formError = "Impossible de deplacer ce quiz : identifiant introuvable.";
      this.draggingContentId = null;
      return;
    }

    const previousContents = [...this.contents];
    const optimisticQuiz = this.mapApiItemToContentItem({
      ...item,
      courseId,
      chapterId: '',
      partId: '',
      quizDisplayMode: 'standalone',
    });

    if (optimisticQuiz) {
      this.scheduleUiUpdate(() => {
        this.contents = this.deduplicateContents(
          this.contents.map(content =>
            this.normalizeContentId(content._id) === itemId ? optimisticQuiz : content,
          ),
        );
        this.syncStructureFromContents();
        this.draggingContentId = null;
        this.activeCourseDropKey = null;
        this.activeDropPartKey = null;
        this.activeStandaloneDropCourse = null;
      });
    }

    this.http
      .patch<any>(`/api/contents/${itemId}`, {
        courseId,
        chapterId: '',
        partId: '',
        quizDisplayMode: 'standalone',
      })
      .subscribe({
        next: updatedContent => {
          const movedQuiz = this.mapApiItemToContentItem({
            ...item,
            ...(updatedContent || {}),
            courseId,
            chapterId: '',
            partId: '',
            quizDisplayMode: 'standalone',
          });
          this.scheduleUiUpdate(() => {
            this.contents = this.deduplicateContents(
              this.contents.map(content =>
                this.normalizeContentId(content._id) === itemId
                  ? (movedQuiz || content)
                  : content,
              ),
            );
            this.syncStructureFromContents();
            this.draggingContentId = null;
            this.activeCourseDropKey = null;
            this.activeDropPartKey = null;
            this.activeStandaloneDropCourse = null;
            this.showOperationSuccess('Le quiz a ete deplace hors chapitre avec succes.');
          });
        },
        error: error => {
          this.scheduleUiUpdate(() => {
            this.contents = previousContents;
            this.syncStructureFromContents();
            this.draggingContentId = null;
            this.activeCourseDropKey = null;
            this.activeDropPartKey = null;
            this.activeStandaloneDropCourse = null;
            this.formError = this.resolveContentErrorMessage(
              error,
              'Le deplacement du quiz hors chapitre a echoue.',
            );
          });
        },
      });
  }

  private repairEncoding(value: string): string {
    if (!value) {
      return value;
    }

    let repaired = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

    for (let index = 0; index < 3; index += 1) {
      if (!this.looksCorrupted(repaired)) {
        break;
      }

      try {
        const bytes = Uint8Array.from(
          Array.from(repaired).map(character => character.charCodeAt(0) & 0xff),
        );
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

        if (!decoded || decoded === repaired) {
          break;
        }

        repaired = decoded;
      } catch {
        break;
      }
    }

    return repaired
      .replace(/Vid[^a-zA-Z0-9]{0,6}(?:o|éo|eo)/gi, 'Vid\u00e9o')
      .replace(/ajout[^a-zA-Z0-9]{0,6}(?:e|ee)/gi, 'ajout\u00e9e')
      .replace(/Document de cours ajout[^a-zA-Z0-9]{0,6}/gi, 'Document de cours ajout\u00e9')
      .replace(/cr[^a-zA-Z0-9]{0,6}/gi, 'cr\u00e9')
      .replace(/Ã©|Ã¨|Ãª|Ã |Ã§|Ã¹|Ã´|Ã«|Ã¯|\?/g, '\u00e9')
      .replace(/Vidé+o/gi, 'Vid\u00e9o')
      .replace(/ajouté+e/gi, 'ajout\u00e9e')
      .trim();
  }

  private resolveTeacherAssignedClasses(profile: any): string[] {
    return this.normalizeVisibilityClasses([
      ...(Array.isArray(profile?.assignedClasses) ? profile.assignedClasses : []),
      profile?.className,
    ]);
  }

  private mergeTeacherAssignedClasses(classNames: string[]) {
    this.teacherAssignedClasses = this.normalizeVisibilityClasses([
      ...this.teacherAssignedClasses,
      ...classNames,
    ]);
  }

  private normalizeVisibilityClasses(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .flatMap(item => `${item || ''}`.split(/[;,]/))
          .map(item => this.normalizeClassName(item))
          .filter(Boolean),
      ),
    ];
  }

  private normalizeClassName(value?: string) {
    return (value || '').trim().toUpperCase();
  }

  private normalizeContentId(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed && trimmed !== '[object Object]' ? trimmed : undefined;
    }

    if (typeof value === 'object') {
      const raw = value as {
        $oid?: unknown;
        _id?: unknown;
        id?: unknown;
        buffer?: Record<string, unknown> | ArrayLike<number>;
      };
      const nestedValue = raw.$oid ?? raw._id ?? raw.id;
      if (typeof nestedValue === 'string') {
        const trimmed = nestedValue.trim();
        return trimmed && trimmed !== '[object Object]' ? trimmed : undefined;
      }

      const bufferValue = raw.buffer;
      if (bufferValue && typeof bufferValue === 'object') {
        const byteValues = Object.values(bufferValue)
          .map(entry => Number(entry))
          .filter(entry => Number.isInteger(entry) && entry >= 0 && entry <= 255);

        if (byteValues.length === 12) {
          return byteValues
            .map(entry => entry.toString(16).padStart(2, '0'))
            .join('');
        }
      }
    }

    return undefined;
  }

  private getVisibilityState(items: ContentItem[]) {
    const firstItem = items[0];

    return {
      visibleToAllClasses: firstItem?.visibleToAllClasses === true,
      visibleToClasses: this.normalizeVisibilityClasses(firstItem?.visibleToClasses || []),
    };
  }

  private normalizeCorruptedContentTitle(
    type: ContentType,
    title: string,
    partId: string,
  ): string {
    if (type === 'Vidéo' && partId && (this.looksCorrupted(title) || /vid/i.test(title))) {
      return `${partId} - Vid\u00e9o`;
    }

    if (!this.looksCorrupted(title)) {
      return title;
    }

    if (type === 'Document' && partId) {
      return `${partId} - Document`;
    }

    return title;
  }

  private normalizeCorruptedContentDescription(
    type: ContentType,
    description: string,
  ): string {
    if (type === 'Vidéo' && (this.looksCorrupted(description) || /vid|ajout/i.test(description))) {
      return 'Vid\u00e9o ajout\u00e9e';
    }

    if (!this.looksCorrupted(description)) {
      return description;
    }

    if (type === 'Document') {
      return 'Document de cours ajout\u00e9';
    }

    return description;
  }

  private looksCorrupted(value: string): boolean {
    return (
      /[ÃÂâ?]/.test(value) ||
      /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
      value.includes('VidÃ') ||
      value.includes('ajoutÃ') ||
      value.includes('Vid?') ||
      value.includes('ajout?')
    );
  }

  private fromApiType(type: string): ContentType | null {
    const normalizedType = (type || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

    if (normalizedType.includes('document')) {
      return 'Document';
    }

    if (normalizedType.includes('chap')) {
      return 'Chapitre';
    }

    if (normalizedType.includes('part')) {
      return 'Partie';
    }

    if (normalizedType.includes('video') || normalizedType.includes('vid')) {
      return 'Vidéo';
    }

    if (normalizedType.includes('quiz')) {
      return 'Quiz';
    }

    if (normalizedType.includes('course') || normalizedType.includes('cours')) {
      return 'Cours';
    }

    return null;
  }

  private deduplicateContents(items: ContentItem[]): ContentItem[] {
    const bestByKey = new Map<string, ContentItem>();

    items.forEach(item => {
      const key =
        item._id ||
        [
          item.type,
          item.courseId,
          item.chapterId,
          item.partId,
          item.title,
        ].join('|');
      const current = bestByKey.get(key);
      const candidateScore = this.contentPriority(item);
      const currentScore = current ? this.contentPriority(current) : -1;

      if (!current || candidateScore >= currentScore) {
        bestByKey.set(key, item);
      }
    });

    return Array.from(bestByKey.values());
  }

  private appendCreatedContents(results: any[]) {
    const createdItems = results
      .map(result => result?.parsedQuiz || result?.content || result)
      .map(result => this.mapApiItemToContentItem(result))
      .filter((item): item is ContentItem => item !== null);

    if (!createdItems.length) {
      return;
    }

    this.contents = this.deduplicateContents([...this.contents, ...createdItems]);
    this.syncStructureFromContents();
  }

  private executeDeleteCourse(course: string) {
    const courseItems = this.contents.filter(item => item.courseId === course);
    const ids = [...new Set(
      courseItems
        .map(item => this.normalizeContentId(item._id))
        .filter((id): id is string => !!id),
    )];

    if (ids.length === 0) {
      this.scheduleUiUpdate(() => {
        this.formError = "Impossible de supprimer ce cours : aucun identifiant valide n'a ete trouve.";
      });
      return;
    }

    forkJoin(ids.map(id => this.http.delete(`/api/contents/${id}`))).subscribe({
      next: () => {
        this.scheduleUiUpdate(() => {
          this.contents = this.contents.filter(item => item.courseId !== course);
          this.syncStructureFromContents();
          this.showOperationSuccess('Le cours a ete supprime avec succes.');
        });
      },
      error: deleteError => {
        this.scheduleUiUpdate(() => {
          this.formError =
            deleteError?.error?.message ||
            deleteError?.message ||
            'La suppression du cours a echoue.';
        });
      },
    });
  }

  private executeDeleteChapter(course: string, chapter: string) {
    const chapterItems = this.contents.filter(
      item => item.courseId === course && item.chapterId === chapter,
    );
    if (!chapterItems.length) {
      return;
    }

    const ids = [...new Set(
      chapterItems
        .map(item => this.normalizeContentId(item._id))
        .filter((id): id is string => !!id),
    )];

    if (!ids.length) {
      this.scheduleUiUpdate(() => {
        this.formError = "Impossible de supprimer ce chapitre : aucun identifiant valide n'a ete trouve.";
      });
      return;
    }

    forkJoin(ids.map(id => this.http.delete(`/api/contents/${id}`))).subscribe({
      next: () => {
        this.scheduleUiUpdate(() => {
          this.contents = this.contents.filter(
            item => !(item.courseId === course && item.chapterId === chapter),
          );
          delete this.chapterExpanded[this.chapterKey(course, chapter)];
          this.syncStructureFromContents();
          this.showOperationSuccess('Le chapitre a ete supprime avec succes.');
        });
      },
      error: () => {
        this.scheduleUiUpdate(() => {
          this.formError = 'La suppression du chapitre a echoue.';
        });
      },
    });
  }

  private executeDeletePart(course: string, chapter: string, part: string) {
    const key = this.partKey(course, chapter, part);
    const partItems = this.contents.filter(
      item =>
        item.courseId === course &&
        item.chapterId === chapter &&
        item.partId === part,
    );
    if (partItems.length === 0) {
      return;
    }

    const ids = [...new Set(
      partItems
        .map(item => this.normalizeContentId(item._id))
        .filter((id): id is string => !!id),
    )];

    if (ids.length === 0) {
      this.scheduleUiUpdate(() => {
        this.formError = "Impossible de supprimer cette partie : aucun identifiant valide n'a ete trouve.";
      });
      return;
    }

    forkJoin(ids.map(id => this.http.delete(`/api/contents/${id}`))).subscribe({
      next: () => {
        this.scheduleUiUpdate(() => {
          this.contents = this.contents.filter(
            item =>
              !(
                item.courseId === course &&
                item.chapterId === chapter &&
                item.partId === part
              ),
          );
          delete this.partExpanded[key];
          this.syncStructureFromContents();
          this.showOperationSuccess('La partie a ete supprimee avec succes.');
        });
      },
      error: deleteError => {
        this.scheduleUiUpdate(() => {
          this.formError =
            deleteError?.error?.message ||
            deleteError?.message ||
            'La suppression de la partie a echoue.';
        });
      },
    });
  }

  private contentPriority(item: ContentItem): number {
    if (item.fileUrl) {
      return 3;
    }

    if (item.source) {
      return 2;
    }

    return 1;
  }

  private syncStructureFromContents() {
    this.contentTypeCounts = {
      Document: this.contents.filter(item => item.type === 'Document').length,
      Vidéo: this.contents.filter(item => item.type === 'Vidéo').length,
      Quiz: this.contents.filter(item => item.type === 'Quiz').length,
    };

    this.scheduleUiUpdate(() => {
      this.displayedContentTypeCounts = { ...this.contentTypeCounts };
    });

    const courseSet = new Set<string>();
    const chaptersByCourse: Record<string, Set<string>> = {};
    const partsByChapter: Record<string, Set<string>> = {};
    const courseLevelContents: Record<string, ContentItem[]> = {};
    const grouped: Record<string, Record<string, ContentItem[]>> = {};
    const standaloneQuizzes: Record<string, ContentItem[]> = {};

    this.contents.forEach(item => {
      if (!item.courseId) {
        return;
      }

      courseSet.add(item.courseId);

      if (!item.chapterId) {
        if (item.type === 'Cours') {
          return;
        }

        if (!courseLevelContents[item.courseId]) {
          courseLevelContents[item.courseId] = [];
        }
        courseLevelContents[item.courseId].push(item);

        if (item.type === 'Quiz') {
          if (!standaloneQuizzes[item.courseId]) {
            standaloneQuizzes[item.courseId] = [];
          }
          standaloneQuizzes[item.courseId].push(item);
        }
        return;
      }

      if (!chaptersByCourse[item.courseId]) {
        chaptersByCourse[item.courseId] = new Set<string>();
      }
      chaptersByCourse[item.courseId].add(item.chapterId);

      if (item.type === 'Chapitre') {
        return;
      }

      if (item.type === 'Partie') {
        return;
      }

      if (!grouped[item.courseId]) {
        grouped[item.courseId] = {};
      }
      if (!grouped[item.courseId][item.chapterId]) {
        grouped[item.courseId][item.chapterId] = [];
      }
      grouped[item.courseId][item.chapterId].push(item);

      if (!item.partId) {
        return;
      }

      const partKey = `${item.courseId}|${item.chapterId}`;
      if (!partsByChapter[partKey]) {
        partsByChapter[partKey] = new Set<string>();
      }
      partsByChapter[partKey].add(item.partId);
    });

    this.courseLevelContentsByCourseMap = courseLevelContents;
    this.groupedContentsMap = grouped;
    this.standaloneQuizzesByCourseMap = standaloneQuizzes;
    this.courseKeysList = Array.from(courseSet);
    this.scheduleUiUpdate(() => {
      this.displayedCourseKeysList = [...this.courseKeysList];
      this.cdr.detectChanges();
    });
    this.chapterKeysByCourseMap = Object.fromEntries(
      Object.entries(chaptersByCourse).map(([course, chapters]) => [
        course,
        Array.from(chapters),
      ]),
    ) as Record<string, string[]>;
    this.partKeysByChapterMap = Object.fromEntries(
      Object.entries(partsByChapter).map(([key, parts]) => [
        key,
        Array.from(parts),
      ]),
    ) as Record<string, string[]>;

    if (courseSet.size === 0) {
      this.selectedCourseView = null;
      this.openedCourseMenu = null;
      this.openedChapterMenu = null;
      this.openedPartMenu = null;
      this.openedItemMenu = null;
      this.openedVisibilityMenu = null;
      this.courses = [];
      this.displayedCourseKeysList = [];
      this.chaptersByCourse = {};
      this.partsByChapter = {};
      this.standaloneQuizzesByCourseMap = {};
      return;
    }

    if (this.selectedCourseView && !courseSet.has(this.selectedCourseView)) {
      this.selectedCourseView = null;
      this.openedCourseMenu = null;
      this.openedChapterMenu = null;
      this.openedPartMenu = null;
      this.openedItemMenu = null;
      this.openedVisibilityMenu = null;
      this.openedLinkedContentSubmenu = null;
      this.pendingRequestedCourseView = null;
    }

    this.courses = [...this.courseKeysList];
    this.chaptersByCourse = Object.fromEntries(
      Object.entries(chaptersByCourse).map(([course, chapters]) => [
        course,
        Array.from(chapters),
      ]),
    );
    this.partsByChapter = Object.fromEntries(
      Object.entries(partsByChapter).map(([key, parts]) => [
        key,
        Array.from(parts),
      ]),
    );

    if (this.selectedCourseView) {
      const selectedCourse = this.selectedCourseView;
      this.scheduleUiUpdate(() => {
        if (this.selectedCourseView === selectedCourse) {
          this.expandFirstChapterAndPart(selectedCourse);
        }
      });
    }
  }

  private expandFirstChapterAndPart(course: string) {
    const chapters = this.getChapters(course);
    if (!chapters.length) {
      return;
    }

    const firstChapter = chapters[0];
    this.chapterExpanded[this.chapterKey(course, firstChapter)] = true;

    const firstPart = this.getParts(course, firstChapter)[0];
    if (firstPart) {
      this.partExpanded[this.partKey(course, firstChapter, firstPart)] = true;
    }
  }

  private chapterKey(course: string, chapter: string): string {
    return `${course}|${chapter}`;
  }

  private partKey(course: string, chapter: string, part: string): string {
    return `${course}|${chapter}|${part}`;
  }

  private scheduleUiUpdate(update: () => void) {
    setTimeout(() => {
      this.zone.run(() => {
        update();
        this.cdr.detectChanges();
      });
    }, 0);
  }

  announceWizardHelp(field: string) {
    const messages: Record<string, string> = {
      course: "Champ cours. Selectionnez un cours existant ou creez un nouveau cours.",
      chapter: "Champ chapitre. Selectionnez un chapitre existant ou saisissez un nouveau chapitre.",
      part: "Champ partie. Selectionnez une partie existante ou saisissez une nouvelle partie.",
      document: "Champ document. Ajoutez un fichier PDF ou DOCX pour le document de cours.",
      videoFile: "Champ video. Ajoutez un fichier video MP4, MOV, AVI, WebM ou MKV.",
      videoLink: "Champ lien video. Vous pouvez coller un lien YouTube ou Vimeo.",
      quizMode: "Champ type de quiz. Choisissez quiz existant ou generation automatique.",
      quizTitle: "Champ titre du quiz. Saisissez le titre du quiz.",
      quizDescription: "Champ description du quiz. Decrivez les objectifs du quiz.",
      quizFile: "Champ fichier du quiz. Ajoutez un fichier PDF, DOC ou DOCX.",
      quizDifficulty: "Champ niveau de difficulte. Choisissez facile, moyen ou difficile.",
      quizSources: "Champ chapitres sources. Importez un ou plusieurs chapitres pour generer le quiz.",
      quizQuestions: "Champ nombre de questions. Indiquez combien de questions doivent etre generees ou attendues.",
      quizAttempts: "Champ tentatives maximum. Indiquez le nombre de tentatives autorisees.",
      quizScore: "Champ score de reussite. Indiquez le pourcentage minimal pour reussir.",
      quizDueDate: "Champ date limite. Choisissez la date d echeance du quiz.",
      quizDueTime: "Champ heure limite. Choisissez l heure d echeance du quiz.",
      quizDuration: "Champ chronometre. Indiquez la duree du quiz en minutes.",
    };

    const message = messages[field];
    if (!message) {
      return;
    }

    this.wizardVoiceMessage = message;
    this.voicePlaybackService.toggle(`content-management:${field}`, message);
  }

  isWizardVoiceActive(field: string): boolean {
    return this.voicePlaybackService.isActive(`content-management:${field}`);
  }

  toggleWizardDictation(field: 'newCourse' | 'newChapter' | 'newPart' | 'contentTitle' | 'videoLink' | 'quizTitle' | 'quizDescription' | 'quizKeywords') {
    this.voiceDictationService.toggle(`content-management:${field}`, transcript => {
      const currentValue = String((this.contentForm as any)[field] || '');
      (this.contentForm as any)[field] = this.mergeDictationText(currentValue, transcript);
    });
  }

  isWizardDictationActive(field: 'newCourse' | 'newChapter' | 'newPart' | 'contentTitle' | 'videoLink' | 'quizTitle' | 'quizDescription' | 'quizKeywords'): boolean {
    return this.voiceDictationService.isActive(`content-management:${field}`);
  }

  private speakText(text: string) {
    this.voicePlaybackService.speak(text);
  }

  private mergeDictationText(currentValue: string, transcript: string): string {
    return `${currentValue || ''}${currentValue ? ' ' : ''}${transcript}`.trim();
  }

  private hasVideoSource(): boolean {
    return (
      !!this.contentForm.videoFile ||
      !!this.contentForm.videoLink.trim() ||
      !!this.contentForm.videoFileName.trim()
    );
  }

  private hasDocumentSource(): boolean {
    return !!this.contentForm.documentFile || !!this.contentForm.documentFileName.trim();
  }

  quizSourceChapters(): string[] {
    const selectedCourse =
      this.contentForm.courseMode === 'existing'
        ? this.contentForm.selectedCourse
        : this.contentForm.newCourse;
    return this.chaptersByCourse[selectedCourse] || [];
  }

  quizKeywordsList(): string[] {
    return Array.from(
      new Set(
        this.contentForm.quizKeywords
          .split(/[\n,;|]+/)
          .map(keyword => keyword.trim())
          .filter(Boolean),
      ),
    );
  }

  formatDueDateLabel(item: ContentItem): string {
    const candidate = this.normalizeApiDateValue(item.dueDateTime || item.dueDate);
    if (!candidate) {
      return '';
    }

    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
      return candidate;
    }

    const day = `${parsed.getDate()}`.padStart(2, '0');
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const year = parsed.getFullYear();
    const rawHours = parsed.getHours();
    const period = rawHours >= 12 ? 'PM' : 'AM';
    const hours12 = rawHours % 12 || 12;
    const hours = `${hours12}`.padStart(2, '0');
    const minutes = `${parsed.getMinutes()}`.padStart(2, '0');

    return item.dueDateTime
      ? `${day}/${month}/${year} a ${hours}:${minutes} ${period}`
      : `${day}/${month}/${year}`;
  }

  private normalizeApiDateValue(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }

    if (typeof value === 'object') {
      const raw = value as { $date?: unknown; date?: unknown; iso?: unknown };
      const nestedValue = raw.$date ?? raw.date ?? raw.iso;

      if (typeof nestedValue === 'string') {
        return nestedValue;
      }

      if (nestedValue instanceof Date) {
        return Number.isNaN(nestedValue.getTime()) ? undefined : nestedValue.toISOString();
      }
    }

    return undefined;
  }

  formatQuizDurationLabel(item: ContentItem): string {
    if (!item.quizDurationMinutes) {
      return '';
    }

    return `${item.quizDurationMinutes} min`;
  }

  quizLevelLabel(item: ContentItem): string {
    if (!this.isQuizItem(item) || !item.quizDifficulty) {
      return '';
    }

    switch (item.quizDifficulty) {
      case 'facile':
        return 'Débutant';
      case 'moyen':
        return 'Intermédiaire';
      case 'difficile':
        return 'Avancé';
      default:
        return item.quizDifficulty;
    }
  }

  courseAvatarLabel(course: string): string {
    const words = (course || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (words.length >= 2) {
      return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
    }

    const compact = (course || '').replace(/\s+/g, '');
    return compact.slice(0, 2).toUpperCase() || 'CR';
  }

  private buildTeacherMetadata() {
    return {
      teacherName: this.currentTeacherName || 'Enseignant',
      teacherEmail: this.currentTeacherEmail || undefined,
      teacherAvatarDataUrl: this.currentTeacherAvatarDataUrl || undefined,
    };
  }

  generatedQuizTopics(): string[] {
    const sourceChapter = String(this.contentForm.quizSourceChapter || '').trim();
    return sourceChapter ? [sourceChapter] : [];
  }

  private extractTopicsFromFileName(fileName: string): string[] {
    const baseName = fileName.replace(/\.[^.]+$/, '').trim();
    return this.extractTopicsFromText(baseName);
  }

  private extractTopicsFromText(value: string): string[] {
    const raw = (value || '').trim();
    if (!raw) {
      return [];
    }

    const compact = raw
      .replace(/\.[^.]+$/, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const stopWords = new Set([
      'la',
      'le',
      'les',
      'de',
      'des',
      'du',
      'd',
      'et',
      'ou',
      'a',
      'au',
      'aux',
      'pour',
      'sur',
      'dans',
      'avec',
      'chapitre',
      'quiz',
      'cours',
      'partie',
    ]);

    const words = compact
      .split(/[^\p{L}\p{N}+#]+/u)
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 1 && !/^\d+(\.\d+)*$/.test(chunk))
      .filter(chunk => !stopWords.has(chunk.toLowerCase()));

    const pairs = words
      .slice(0, Math.max(0, words.length - 1))
      .map((word, index) => `${word} ${words[index + 1]}`.trim())
      .filter(pair => pair.split(' ').length === 2);

    return Array.from(new Set([compact, ...words, ...pairs])).filter(Boolean);
  }

  private openScopedEditModal(
    items: ContentItem[],
    label: string,
    preferredStep = 1,
  ) {
    const documentItem = items.find(item => item.type === 'Document');
    const videoItem = items.find(item => item.type.toLowerCase().includes('vid'));
    const quizItem = items.find(item => item.type === 'Quiz');
    const anchorItem = documentItem || videoItem || quizItem || items[0];

    if (!anchorItem) {
      return;
    }

    this.showModal = true;
    this.currentStep = preferredStep;
    this.formError = '';
    this.editingContent = null;
    this.editingCourseName = label;
    this.editingCourseItems = items;

    this.contentForm = {
      courseMode: 'existing',
      selectedCourse: anchorItem.courseId,
      newCourse: '',
      chapterMode: 'existing',
      selectedChapter: anchorItem.chapterId,
      newChapter: '',
      partMode: 'existing',
      selectedPart: anchorItem.partId,
      newPart: '',
      contentTitle: anchorItem.title || '',
      documentFileName: documentItem?.fileName || '',
      documentFile: null,
      videoFileName: videoItem?.fileName || '',
      videoFile: null,
      videoLink: videoItem?.source || '',
      quizMode: quizItem?.quizMode || 'existing',
      quizTitle: quizItem?.title || '',
      quizDescription: quizItem?.description?.replace(/\s*\(questions:\s*\d+\)\s*$/, '') || '',
      quizFileName: quizItem?.fileName || '',
      quizFile: null,
      quizKeywords: '',
      quizChapterFileNames: [],
      quizChapterFiles: [],
      quizSourceChapter: quizItem?.quizSourceChapter || anchorItem.chapterId,
      quizDifficulty: quizItem?.quizDifficulty || 'moyen',
      quizQuestions: quizItem?.quizQuestionCount ||
        (quizItem?.description?.match(/questions:\s*(\d+)/)?.[1]
          ? Number(quizItem.description.match(/questions:\s*(\d+)/)?.[1])
          : 10),
      quizAttempts: quizItem?.quizAttempts || 3,
      quizScore: quizItem?.quizPassingScore || 70,
      quizDueDate: this.toDateInputValue(quizItem?.dueDateTime || quizItem?.dueDate),
      quizDueTime: this.toTimeInputValue(quizItem?.dueDateTime),
      quizDurationMinutes: quizItem?.quizDurationMinutes || null,
    };
    this.editableQuizQuestions = this.cloneQuizQuestions(quizItem?.quizQuestions);
  }

  private openLinkedContentModal(
    course: string,
    chapter?: string,
    part?: string,
    step = 2,
    linkedContentType: LinkedContentType = 'document',
  ) {
    this.openModal();
    this.creationMode = 'linked';
    this.linkedContentType = linkedContentType;
    this.contentForm.courseMode = 'existing';
    this.setCourse(course);

    if (chapter) {
      this.contentForm.chapterMode = 'existing';
      this.setChapter(chapter);
    }

    if (part) {
      this.contentForm.partMode = 'existing';
      this.contentForm.selectedPart = part;
    }

    this.currentStep = part ? this.linkedStepForType(linkedContentType) : step;
  }

  private linkedStepForType(type: LinkedContentType) {
    switch (type) {
      case 'document':
        return 3;
      case 'video':
        return 4;
      case 'quiz':
        return 5;
      default:
        return 3;
    }
  }

  private buildQuizPayload(
    courseId: string,
    chapterId: string,
    partId: string,
    generatedQuestions?: QuizQuestion[],
  ) {
    const isStandaloneQuiz = this.creationMode === 'quiz_only';
    const sourceChapter =
      this.contentForm.quizSourceChapter ||
      this.contentForm.quizChapterFileNames[0]?.replace(/\.[^.]+$/, '') ||
      chapterId ||
      courseId;
    const dueDateTime = this.combineQuizDueDateTime(
      this.contentForm.quizDueDate,
      this.contentForm.quizDueTime,
    );
    const quizQuestions = this.hasEditableQuizQuestions()
      ? this.sanitizeEditableQuizQuestions()
      : this.sanitizeEditableQuizQuestions(
          generatedQuestions && generatedQuestions.length ? generatedQuestions : undefined,
        );

    return {
      type: 'quiz',
      courseId,
      chapterId: isStandaloneQuiz ? undefined : chapterId,
      partId: isStandaloneQuiz ? undefined : partId,
      ...this.buildTeacherMetadata(),
      title: this.contentForm.quizTitle,
      description:
        this.contentForm.quizDescription ||
        `Quiz ${this.contentForm.quizMode === 'generated' ? 'auto-genere' : 'lie'} pour ${sourceChapter}`,
      dueDate: this.contentForm.quizDueDate || undefined,
      dueDateTime,
      quizMode: this.contentForm.quizMode,
      quizDifficulty: this.contentForm.quizDifficulty,
      quizDisplayMode: isStandaloneQuiz ? 'standalone' : 'scoped',
      quizSourceChapter: sourceChapter,
      quizAttempts: this.contentForm.quizAttempts,
      quizDurationMinutes: this.contentForm.quizDurationMinutes || undefined,
      quizPassingScore: this.contentForm.quizScore,
      quizQuestionCount: quizQuestions.length || this.contentForm.quizQuestions || undefined,
      quizQuestions,
    };
  }

  private requestGeneratedQuizQuestions(
    courseId: string,
    chapterId: string,
    partId: string,
  ) {
    const isStandaloneQuiz = this.creationMode === 'quiz_only';
    const formData = new FormData();
    formData.append('title', this.contentForm.quizTitle);
    formData.append('description', this.contentForm.quizDescription);
    formData.append('difficulty', this.contentForm.quizDifficulty);
    formData.append('questionCount', String(Math.max(1, this.contentForm.quizQuestions || 1)));
    formData.append(
      'sourceChapter',
      this.contentForm.quizSourceChapter ||
        this.contentForm.quizChapterFileNames[0]?.replace(/\.[^.]+$/, '') ||
        chapterId ||
        courseId,
    );
    formData.append('courseId', courseId);
    if (!isStandaloneQuiz && chapterId) {
      formData.append('chapterId', chapterId);
    }
    if (!isStandaloneQuiz && partId) {
      formData.append('partId', partId);
    }

    if (this.contentForm.quizChapterFiles[0]) {
      formData.append('chapterFile', this.contentForm.quizChapterFiles[0]);
    }

    return this.http
      .post<any>('/api/contents/generate-quiz', formData)
      .pipe(
        map(response => {
          const questions = Array.isArray(response?.questions)
            ? response.questions
            : [];

          if (questions.length === 0) {
            throw new Error("Aucune question n'a ete generee pour ce chapitre.");
          }

          return questions as QuizQuestion[];
        }),
      );
  }

  private requestExistingQuizQuestions(file: File) {
    const formData = new FormData();
    formData.append('quizFile', file);

    return this.http
      .post<any>('/api/contents/parse-quiz', formData)
      .pipe(
        map(response => {
          const questions = Array.isArray(response?.questions)
            ? response.questions
            : [];

          if (questions.length === 0) {
            throw new Error("Aucune question n'a pu etre extraite de ce fichier quiz.");
          }

          return questions as QuizQuestion[];
        }),
      );
  }

  private combineQuizDueDateTime(dateValue?: string, timeValue?: string): string | undefined {
    if (!dateValue) {
      return undefined;
    }

    const normalizedTime = timeValue?.trim() ? timeValue.trim() : '23:59';
    const combined = new Date(`${dateValue}T${normalizedTime}:00`);

    if (Number.isNaN(combined.getTime())) {
      return undefined;
    }

    return combined.toISOString();
  }

  private toDateInputValue(value?: string): string {
    if (!value) {
      return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return parsed.toISOString().slice(0, 10);
  }

  private toTimeInputValue(value?: string): string {
    if (!value) {
      return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return parsed.toISOString().slice(11, 16);
  }

  private toLocalDate(value: string): Date | null {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) {
      return null;
    }

    return new Date(year, month - 1, day);
  }

  private toLocalTime(value: string): Date | null {
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  private formatDateForInput(value: Date): string {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTimeForInput(value: Date): string {
    const hours = `${value.getHours()}`.padStart(2, '0');
    const minutes = `${value.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private generateQuizQuestions(
    courseId: string,
    chapterId: string,
    keywords: string[],
    questionCount: number,
    difficulty: QuizDifficulty,
  ): QuizQuestion[] {
    const normalizedKeywords = keywords.length ? keywords : [chapterId];
    const targetCount = Math.max(1, questionCount || 1);
    const topicSignature = this.buildTopicSignature(
      this.contentForm.quizTitle,
      normalizedKeywords,
      chapterId,
    );

    const topicTemplates = this.generateTopicSpecificQuestions(
      topicSignature,
      normalizedKeywords,
      difficulty,
    );
    if (topicTemplates.length > 0) {
      return this.deduplicateQuizQuestions(topicTemplates).slice(0, targetCount);
    }

    return this.deduplicateQuizQuestions(
      this.generateGenericKeywordQuestions(
        normalizedKeywords,
        targetCount,
        difficulty,
        this.contentForm.quizTitle.trim() || chapterId,
      ),
    ).slice(0, targetCount);
  }

  private computeGeneratedQuizQuestions(courseId: string, chapterId: string): QuizQuestion[] {
    const keywords = this.generatedQuizTopics();
    return this.generateQuizQuestions(
      courseId,
      chapterId,
      keywords,
      this.contentForm.quizQuestions,
      this.contentForm.quizDifficulty,
    );
  }

  private buildTopicSignature(title: string, keywords: string[], chapterId: string): string {
    return [title, chapterId, ...keywords]
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private generateTopicSpecificQuestions(
    topicSignature: string,
    keywords: string[],
    difficulty: QuizDifficulty,
  ): QuizQuestion[] {
    const normalizedKeywords = keywords.map(keyword =>
      keyword
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(),
    );

    const isForLoopTopic =
      topicSignature.includes('boucle for') ||
      topicSignature.includes('for loop') ||
      topicSignature.includes('for i in') ||
      (topicSignature.includes('boucle') && topicSignature.includes(' for')) ||
      normalizedKeywords.some(keyword =>
        keyword.includes('boucle for') ||
        keyword === 'for' ||
        keyword.includes('for loop') ||
        keyword.includes('for i in'),
      );

    if (isForLoopTopic) {
      return [
        this.createSingleChoiceQuestion(
          'for-1',
          "Quel est le role principal d'une boucle 'for' ?",
          [
            'Executer une instruction une seule fois',
            'Repeter un bloc d’instructions un nombre connu de fois ou sur une sequence',
            'Arreter definitivement le programme',
            'Declarer une fonction',
          ],
          'B',
          "Une boucle 'for' sert a repeter des instructions selon un compteur ou une sequence.",
        ),
        this.createSingleChoiceQuestion(
          'for-2',
          "Dans 'for i in range(5)', combien de fois la boucle s'execute-t-elle ?",
          ['4 fois', '5 fois', '6 fois', 'Selon la valeur de i avant la boucle'],
          'B',
          "range(5) produit 5 valeurs: 0, 1, 2, 3 et 4.",
        ),
        this.createSingleChoiceQuestion(
          'for-3',
          "Dans une boucle 'for', la variable 'i' represente generalement :",
          [
            'Le nom du fichier ouvert',
            "L'indice ou la valeur courante parcourue par la boucle",
            'Le type de la boucle',
            "La condition d'arret du programme",
          ],
          'B',
          "La variable de boucle stocke en general la valeur ou l'indice courant.",
        ),
        this.createSingleChoiceQuestion(
          'for-4',
          "Quelle ecriture est correcte en Python pour parcourir les nombres de 0 a 4 ?",
          [
            'for i to 5:',
            'for (i = 0; i < 5; i++):',
            'for i in range(5):',
            'foreach i from 0 until 5:',
          ],
          'C',
          "En Python, on utilise 'for i in range(5):'.",
        ),
        this.createSingleChoiceQuestion(
          'for-5',
          "Quel resultat produit ce code ? for i in range(3): print(i)",
          ['1 2 3', '0 1 2', '0 1 2 3', '3 2 1'],
          'B',
          'La boucle affiche successivement 0, 1 puis 2.',
        ),
        this.createSingleChoiceQuestion(
          'for-6',
          "Pourquoi utilise-t-on souvent 'range()' avec une boucle 'for' en Python ?",
          [
            'Pour ouvrir un fichier',
            'Pour generer une suite de valeurs a parcourir',
            'Pour convertir une chaine en entier',
            'Pour definir une condition booleenne',
          ],
          'B',
          "range() fournit une suite de valeurs que la boucle 'for' peut parcourir.",
        ),
        this.createSingleChoiceQuestion(
          'for-7',
          "Quelle instruction permet de sortir immediatement d'une boucle 'for' ?",
          ['skip', 'break', 'continue', 'return False'],
          'B',
          "L'instruction 'break' interrompt immediatement la boucle.",
        ),
        this.createSingleChoiceQuestion(
          'for-8',
          "Quelle instruction passe directement a l'iteration suivante dans une boucle 'for' ?",
          ['next', 'break', 'continue', 'pass'],
          'C',
          "'continue' saute le reste du bloc courant et passe a l'iteration suivante.",
        ),
        this.createSingleChoiceQuestion(
          'for-9',
          "Si une liste contient ['a', 'b', 'c'], que parcourt 'for lettre in liste' ?",
          [
            'Les adresses memoire uniquement',
            'Les elements a, b et c',
            'Seulement les indices 1, 2 et 3',
            'Uniquement le premier element',
          ],
          'B',
          'La boucle parcourt directement les elements de la liste.',
        ),
        this.createSingleChoiceQuestion(
          'for-10',
          "Quelle affirmation est vraie a propos de la boucle 'for' ?",
          [
            "Elle ne peut parcourir que des nombres",
            'Elle sert a repeter du code sur une sequence ou un ensemble de valeurs',
            "Elle remplace toujours la boucle 'while'",
            "Elle s'utilise sans variable de parcours",
          ],
          'B',
          "La boucle 'for' sert a parcourir des sequences ou a repeter du code sur des valeurs.",
        ),
      ];
    }

    const isArrayTopic =
      topicSignature.includes('tableau unidimensionnel') ||
      topicSignature.includes('tableaux unidimensionnels') ||
      topicSignature.includes('tableau') ||
      topicSignature.includes('array') ||
      normalizedKeywords.some(keyword =>
        keyword.includes('tableau unidimensionnel') ||
        keyword.includes('tableaux unidimensionnels') ||
        keyword === 'tableau' ||
        keyword === 'tableaux' ||
        keyword.includes('array'),
      );

    if (isArrayTopic) {
      return [
        this.createSingleChoiceQuestion(
          'array-1',
          "Qu'est-ce qu'un tableau unidimensionnel ?",
          [
            'Une structure qui contient une seule valeur',
            'Une structure de donnees qui stocke plusieurs elements dans une seule dimension',
            'Une fonction qui trie automatiquement des nombres',
            'Un type de boucle conditionnelle',
          ],
          'B',
          "Un tableau unidimensionnel stocke plusieurs elements accessibles dans une seule dimension.",
        ),
        this.createSingleChoiceQuestion(
          'array-2',
          "Dans un tableau, l'indice sert a :",
          [
            'Calculer la taille en octets du programme',
            'Repeter automatiquement une boucle',
            'Acceder a la position d’un element',
            'Supprimer toutes les valeurs nulles',
          ],
          'C',
          "L'indice permet de designer la position d'un element dans le tableau.",
        ),
        this.createSingleChoiceQuestion(
          'array-3',
          "Dans la plupart des langages, le premier element d'un tableau se trouve a l'indice :",
          ['0', '1', '-1', 'Cela depend toujours du nombre d’elements'],
          'A',
          "Dans la plupart des langages comme C, Java, JavaScript ou Python, le premier indice est 0.",
        ),
        this.createSingleChoiceQuestion(
          'array-4',
          'Que represente la taille d’un tableau ?',
          [
            'Le nombre total d’elements qu’il contient',
            'Le nombre de boucles utilisees',
            'Le type des variables stockees',
            'La derniere valeur du tableau',
          ],
          'A',
          "La taille correspond au nombre total d'elements du tableau.",
        ),
        this.createSingleChoiceQuestion(
          'array-5',
          "Si tab = [10, 20, 30], quelle valeur retourne tab[1] ?",
          ['10', '20', '30', 'Erreur car le tableau commence a 1'],
          'B',
          "L'indice 1 correspond au deuxieme element, donc 20.",
        ),
        this.createSingleChoiceQuestion(
          'array-6',
          "Quelle instruction modifie le troisieme element du tableau tab en 99 ?",
          ['tab[3] = 99', 'tab[2] = 99', 'tab(2) = 99', 'tab = 99[2]'],
          'B',
          "Le troisieme element est a l'indice 2 si l'indexation commence a 0.",
        ),
        this.createSingleChoiceQuestion(
          'array-7',
          "Quel est l'avantage principal d'un tableau unidimensionnel ?",
          [
            'Stocker des donnees du meme type de maniere ordonnee et accessible par indice',
            'Remplacer toutes les fonctions du programme',
            'Eviter completement l’utilisation des variables',
            'Creer automatiquement une base de donnees',
          ],
          'A',
          "Un tableau permet de stocker et manipuler facilement une serie de valeurs ordonnees.",
        ),
        this.createSingleChoiceQuestion(
          'array-8',
          "Que se passe-t-il si on essaie d'acceder a un indice inexistant dans un tableau ?",
          [
            'Le programme ajoute automatiquement la valeur manquante',
            'On obtient generalement une erreur ou une valeur invalide selon le langage',
            'Le tableau se trie automatiquement',
            'La taille du tableau double',
          ],
          'B',
          "Un acces hors limites provoque en general une erreur ou un resultat invalide.",
        ),
        this.createSingleChoiceQuestion(
          'array-9',
          "Pourquoi parcourt-on souvent un tableau avec une boucle ?",
          [
            'Pour visiter chaque element un a un',
            'Pour transformer le tableau en fonction',
            'Pour supprimer automatiquement les indices',
            'Pour changer le type du tableau',
          ],
          'A',
          "Une boucle permet de traiter successivement chaque element du tableau.",
        ),
        this.createSingleChoiceQuestion(
          'array-10',
          "Quelle affirmation est vraie a propos d'un tableau unidimensionnel ?",
          [
            'Il ne peut contenir qu’un seul element',
            'Ses elements sont organises sur une seule ligne logique d’indices',
            'Il remplace toujours les listes et les chaines',
            'Il n’utilise jamais d’indice',
          ],
          'B',
          "Un tableau unidimensionnel organise ses elements selon une seule dimension d'indices.",
        ),
      ];
    }

    if (topicSignature.includes('machine learning')) {
      return [
        this.createSingleChoiceQuestion(
          'ml-1',
          'Le Machine Learning permet :',
          [
            'D’écrire uniquement du code statique',
            'D’apprendre automatiquement à partir des données',
            'De remplacer les bases de données',
            'De créer uniquement des interfaces',
          ],
          'B',
          'Le machine learning permet à un système d’apprendre à partir des données.',
        ),
        this.createSingleChoiceQuestion(
          'ml-2',
          'Quel type d’apprentissage utilise des données étiquetées ?',
          ['Non supervisé', 'Renforcement', 'Supervisé', 'Automatique'],
          'C',
          'Les données étiquetées sont utilisées en apprentissage supervisé.',
        ),
        this.createSingleChoiceQuestion(
          'ml-3',
          'Le phénomène d’overfitting correspond à :',
          [
            'Un modèle trop simple',
            'Un modèle qui généralise bien',
            'Un modèle qui mémorise les données d’entraînement',
            'Une erreur de programmation',
          ],
          'C',
          'Un modèle en overfitting mémorise trop les données d’entraînement et généralise mal.',
        ),
        this.createSingleChoiceQuestion(
          'ml-4',
          'Quel algorithme est utilisé pour le clustering ?',
          ['Régression linéaire', 'K-Means', 'SVM', 'Decision Tree'],
          'B',
          'K-Means est un algorithme classique de clustering.',
        ),
        this.createSingleChoiceQuestion(
          'ml-5',
          'Quelle métrique est utilisée pour évaluer un modèle de classification ?',
          ['Accuracy', 'Moyenne', 'Variance', 'Médiane'],
          'A',
          'Accuracy est une métrique classique pour les tâches de classification.',
        ),
        this.createSingleChoiceQuestion(
          'ml-6',
          'Parmi les éléments suivants, lequel correspond à une variable cible dans un problème supervisé ?',
          ['Le label à prédire', 'Le taux de compression', 'Le mot de passe', 'Le port du serveur'],
          'A',
          'La variable cible, ou label, est la valeur que le modèle doit prédire.',
        ),
        this.createSingleChoiceQuestion(
          'ml-7',
          'Quel ensemble de données sert principalement à mesurer la performance finale d’un modèle ?',
          ['Le jeu de test', 'Le jeu d’entraînement uniquement', 'Le cache du navigateur', 'Le journal système'],
          'A',
          'Le jeu de test permet d’évaluer le modèle sur des données jamais vues.',
        ),
        this.createSingleChoiceQuestion(
          'ml-8',
          'Quel concept désigne les variables d’entrée utilisées par un modèle ?',
          ['Les features', 'Les clusters', 'Les requêtes SQL', 'Les index HTTP'],
          'A',
          'Les features sont les variables d’entrée utilisées pour l’apprentissage.',
        ),
      ];
    }

    const joinKeywords = keywords.map(keyword => keyword.toLowerCase());
    if (
      topicSignature.includes('join') ||
      joinKeywords.some(keyword => keyword.includes('join'))
    ) {
      return [
        this.createSingleChoiceQuestion(
          'sql-join-1',
          'INNER JOIN permet de :',
          [
            'Retourner uniquement les lignes correspondantes dans les deux tables',
            'Retourner toutes les lignes de la table de gauche uniquement',
            'Supprimer les doublons automatiquement',
            'Créer une nouvelle base de données',
          ],
          'A',
          'INNER JOIN conserve seulement les correspondances présentes dans les deux tables.',
        ),
        this.createSingleChoiceQuestion(
          'sql-join-2',
          'LEFT JOIN retourne :',
          [
            'Toutes les lignes de la table de gauche, même sans correspondance',
            'Seulement les lignes communes aux deux tables',
            'Toutes les lignes de la table de droite uniquement',
            'Uniquement les lignes nulles',
          ],
          'A',
          'LEFT JOIN garde toutes les lignes de la table de gauche.',
        ),
        this.createSingleChoiceQuestion(
          'sql-join-3',
          'RIGHT JOIN retourne :',
          [
            'Toutes les lignes de la table de gauche',
            'Toutes les lignes de la table de droite, même sans correspondance',
            'Uniquement les lignes sans doublons',
            'Les lignes triées par ordre alphabétique',
          ],
          'B',
          'RIGHT JOIN garde toutes les lignes de la table de droite.',
        ),
        this.createSingleChoiceQuestion(
          'sql-join-4',
          'FULL JOIN permet de :',
          [
            'Ne garder que les lignes communes',
            'Combiner toutes les lignes des deux tables, avec ou sans correspondance',
            'Fusionner uniquement les colonnes numériques',
            'Supprimer les valeurs nulles',
          ],
          'B',
          'FULL JOIN réunit toutes les lignes des deux tables.',
        ),
        this.createSingleChoiceQuestion(
          'sql-join-5',
          'La clause utilisée pour relier deux tables est généralement :',
          ['GROUP BY', 'ORDER BY', 'ON', 'HAVING'],
          'C',
          'La condition de jointure est exprimée avec la clause ON.',
        ),
        this.createSingleChoiceQuestion(
          'sql-join-6',
          'Quelle jointure choisir pour conserver tous les enregistrements clients, même sans commande ?',
          ['INNER JOIN', 'LEFT JOIN', 'CROSS JOIN', 'SELF JOIN'],
          'B',
          'LEFT JOIN conserve tous les clients de la table de gauche.',
        ),
      ];
    }

    return [];
  }

  private generateGenericKeywordQuestions(
    keywords: string[],
    targetCount: number,
    difficulty: QuizDifficulty,
    quizLabel: string,
  ): QuizQuestion[] {
    const templates: QuizQuestion[] = [];
    const normalizedKeywords = Array.from(
      new Set(
        keywords
          .map(keyword => keyword.trim())
          .filter(Boolean),
      ),
    );
    const conceptTemplates = normalizedKeywords
      .map((keyword, index) =>
        this.buildConceptAwareQuestion(keyword, index, normalizedKeywords, quizLabel),
      )
      .filter((question): question is QuizQuestion => !!question);

    templates.push(...conceptTemplates);

    if (difficulty === 'difficile' && normalizedKeywords.length >= 2) {
      const optionSet = normalizedKeywords.slice(0, Math.min(6, normalizedKeywords.length));
      templates.push({
        id: 'keywords-multiple',
        prompt: `Quelles notions font partie du chapitre traite dans "${quizLabel}" ?`,
        type: 'multiple',
        options: optionSet.map((keyword, index) => ({
          label: String.fromCharCode(65 + index),
          text: keyword,
        })),
        correctAnswers: optionSet
          .map((keyword, index) =>
            normalizedKeywords.some(item => item.toLowerCase() === keyword.toLowerCase())
              ? String.fromCharCode(65 + index)
              : null,
          )
          .filter((value): value is string => value !== null),
        explanation: 'Les bonnes reponses correspondent aux notions extraites du titre et des mots-cles du quiz.',
      });
    }

    const deduplicatedTemplates = this.deduplicateQuizQuestions(templates);

    if (deduplicatedTemplates.length < targetCount) {
      deduplicatedTemplates.push(
        ...this.generateFallbackQuizQuestions(
          normalizedKeywords,
          targetCount - deduplicatedTemplates.length,
          quizLabel,
        ),
      );
    }

    return this.deduplicateQuizQuestions(deduplicatedTemplates).slice(0, targetCount);
  }

  private generateFallbackQuizQuestions(
    keywords: string[],
    missingCount: number,
    quizLabel: string,
  ): QuizQuestion[] {
    const fallbackQuestions: QuizQuestion[] = [];
    const baseTerms = Array.from(
      new Set(
        [
          ...keywords,
          ...String(quizLabel || '')
            .split(/[\s,;:/()-]+/)
            .map(term => term.trim())
            .filter(term => term.length >= 3),
        ]
          .map(term => term.trim())
          .filter(Boolean),
      ),
    );

    const pickTerm = (index: number, fallback: string) =>
      baseTerms[index % Math.max(1, baseTerms.length)] || fallback;

    const factories = [
      (index: number) =>
        this.createSingleChoiceQuestion(
          `fallback-definition-${index + 1}`,
          `Dans "${quizLabel}", quel enonce decrit le mieux la notion "${pickTerm(index, quizLabel || 'ce chapitre')}" ?`,
          [
            `C'est une notion importante du chapitre utilisee pour comprendre ${pickTerm(index + 1, 'les notions principales')}`,
            `C'est uniquement le nom d'un fichier sans rapport avec le cours`,
            `C'est une erreur de syntaxe obligatoire`,
            `C'est un bouton d'interface sans lien avec le contenu`,
          ],
          'A',
          `La notion "${pickTerm(index, quizLabel || 'ce chapitre')}" doit etre comprise comme un element important du chapitre.`,
        ),
      (index: number) =>
        this.createSingleChoiceQuestion(
          `fallback-objective-${index + 1}`,
          `Quel est un objectif logique du chapitre "${quizLabel}" a propos de "${pickTerm(index, 'cette notion')}" ?`,
          [
            `Comprendre ${pickTerm(index, 'la notion principale')} et ${pickTerm(index + 1, 'les notions associees')}`,
            'Memoriser uniquement des noms sans explication',
            'Supprimer toutes les notions du cours precedent',
            'Remplacer completement les exercices pratiques',
          ],
          'A',
          `Le chapitre vise surtout a faire comprendre les notions principales comme ${pickTerm(index, 'la notion principale')}.`,
        ),
      (index: number) =>
        this.createSingleChoiceQuestion(
          `fallback-application-${index + 1}`,
          `Parmi les propositions suivantes, laquelle correspond a une application de "${pickTerm(index, 'la notion etudiee')}" ?`,
          [
            `Utiliser ${pickTerm(index, 'la notion etudiee')} pour analyser ou resoudre un exercice du chapitre`,
            `Fermer automatiquement l'ordinateur`,
            'Supprimer la connexion Internet',
            'Modifier la date systeme',
          ],
          'A',
          `Une notion de cours s'applique en general dans la resolution d'exercices ou de problemes.`,
        ),
      (index: number) =>
        this.createSingleChoiceQuestion(
          `fallback-link-${index + 1}`,
          `Quel lien est le plus logique entre "${pickTerm(index, 'la premiere notion')}" et "${pickTerm(index + 1, 'la seconde notion')}" dans ce chapitre ?`,
          [
            `${pickTerm(index, 'la premiere notion')} aide a mieux comprendre ${pickTerm(index + 1, 'la seconde notion')}`,
            `${pickTerm(index, 'la premiere notion')} supprime toujours ${pickTerm(index + 1, 'la seconde notion')}`,
            `${pickTerm(index, 'la premiere notion')} n'a aucun rapport avec ${pickTerm(index + 1, 'la seconde notion')}`,
            `${pickTerm(index, 'la premiere notion')} interdit toute explication de ${pickTerm(index + 1, 'la seconde notion')}`,
          ],
          'A',
          `Dans un quiz de comprehension, on cherche le lien logique entre les notions du chapitre.`,
        ),
      (index: number) =>
        this.createSingleChoiceQuestion(
          `fallback-example-${index + 1}`,
          `Quel exemple est le plus coherent avec le contenu "${quizLabel}" pour travailler "${pickTerm(index, 'la notion cible')}" ?`,
          [
            `Un exemple mettant en pratique ${pickTerm(index, 'la notion cible')} et ${pickTerm(index + 2, 'les exemples du cours')}`,
            'Un sujet totalement hors theme',
            'Une procedure de desinstallation du systeme',
            'Une action sans rapport avec le cours',
          ],
          'A',
          `Le bon exemple reste celui qui reutilise les notions du chapitre.`,
        ),
    ];

    for (let index = 0; index < missingCount; index++) {
      const factory = factories[index % factories.length];
      fallbackQuestions.push(factory(index));
    }

    return fallbackQuestions;
  }

  private buildConceptAwareQuestion(
    keyword: string,
    index: number,
    keywordPool: string[],
    quizLabel: string,
  ): QuizQuestion | null {
    const normalized = this.normalizeQuizConcept(keyword);

    const buildOptions = (correctText: string, distractors: string[]) => {
      const uniqueDistractors = Array.from(
        new Set(
          distractors
            .filter(value => value && value.toLowerCase() !== correctText.toLowerCase())
            .slice(0, 3),
        ),
      );

      while (uniqueDistractors.length < 3) {
        uniqueDistractors.push(`Proposition ${String.fromCharCode(66 + uniqueDistractors.length)}`);
      }

      const insertAt = index % 4;
      const optionTexts = [...uniqueDistractors];
      optionTexts.splice(insertAt, 0, correctText);

      return {
        options: optionTexts.slice(0, 4).map((text, optionIndex) => ({
          label: String.fromCharCode(65 + optionIndex),
          text,
        })),
        correctLabel: String.fromCharCode(65 + insertAt),
      };
    };

    const conceptQuestion = (
      id: string,
      prompt: string,
      correctText: string,
      distractors: string[],
      explanation: string,
    ): QuizQuestion => {
      const choice = buildOptions(correctText, distractors);
      return {
        id,
        prompt,
        type: 'single',
        options: choice.options,
        correctAnswers: [choice.correctLabel],
        explanation,
      };
    };

    switch (normalized) {
      case 'tableau':
      case 'array':
        return conceptQuestion(
          `concept-array-${index + 1}`,
          `Dans "${quizLabel}", quel enonce definit correctement un tableau ?`,
          'Une structure qui stocke plusieurs valeurs accessibles par position',
          [
            'Une instruction utilisee pour arreter une boucle',
            'Une condition qui retourne vrai ou faux',
            'Une fonction reservee a la saisie clavier',
          ],
          'Un tableau sert a stocker plusieurs valeurs organisees par position.',
        );
      case 'indice':
      case 'index':
      case 'position':
        return conceptQuestion(
          `concept-index-${index + 1}`,
          `Dans le contexte de "${quizLabel}", a quoi sert un indice ?`,
          "A reperer la position d'un element dans un tableau ou une sequence",
          [
            'A definir le type du programme',
            'A compter le nombre de fonctions',
            'A supprimer automatiquement une variable',
          ],
          "Un indice permet d'acceder a la position d'un element.",
        );
      case 'element':
        return conceptQuestion(
          `concept-element-${index + 1}`,
          `Dans "${quizLabel}", que represente un element d'un tableau ?`,
          'Une valeur stockee a une position precise',
          [
            'Le nom du compilateur',
            'La longueur du programme source',
            'Une erreur de syntaxe obligatoire',
          ],
          "Un element correspond a une valeur rangee dans le tableau.",
        );
      case 'taille':
      case 'longueur':
      case 'length':
        return conceptQuestion(
          `concept-length-${index + 1}`,
          `Que signifie la taille d'une structure etudiee dans "${quizLabel}" ?`,
          "Le nombre total d'elements qu'elle contient",
          [
            'Le nombre de boucles dans le chapitre',
            'La derniere valeur stockee',
            'Le type de chaque variable',
          ],
          "La taille ou longueur correspond au nombre total d'elements.",
        );
      case 'dimension':
      case 'unidimensionnel':
        return conceptQuestion(
          `concept-dimension-${index + 1}`,
          `Que signifie "unidimensionnel" dans "${quizLabel}" ?`,
          "Que les donnees sont organisees selon une seule serie d'indices",
          [
            'Que le tableau contient un seul element',
            'Que le programme n’utilise aucune variable',
            'Que les valeurs sont forcement triees',
          ],
          "Unidimensionnel signifie une seule dimension d'indexation.",
        );
      case 'boucle':
      case 'for':
      case 'while':
      case 'iteration':
        return conceptQuestion(
          `concept-loop-${index + 1}`,
          `Dans "${quizLabel}", quel est le role principal d'une boucle ?`,
          "Repeter un bloc d'instructions selon une condition ou une sequence",
          [
            'Declarer une classe en memoire',
            'Creer automatiquement une base de donnees',
            'Changer le type de toutes les variables',
          ],
          "Une boucle sert a repeter des instructions.",
        );
      case 'condition':
      case 'if':
      case 'else':
        return conceptQuestion(
          `concept-condition-${index + 1}`,
          `A quoi sert une condition dans le chapitre "${quizLabel}" ?`,
          "A choisir une action selon qu'une expression est vraie ou fausse",
          [
            'A creer plusieurs tableaux en meme temps',
            'A remplacer les fonctions du programme',
            'A incrementer automatiquement toutes les variables',
          ],
          "Une condition permet de choisir entre plusieurs chemins d'execution.",
        );
      case 'fonction':
      case 'function':
      case 'parametre':
      case 'return':
      case 'retour':
        return conceptQuestion(
          `concept-function-${index + 1}`,
          `Dans "${quizLabel}", quel enonce decrit le mieux une fonction ?`,
          'Un bloc reutilisable pouvant recevoir des parametres et retourner un resultat',
          [
            'Une liste ordonnee de valeurs uniquement',
            'Une erreur qui bloque la compilation',
            'Un commentaire obligatoirement present en fin de fichier',
          ],
          'Une fonction regroupe des instructions reutilisables.',
        );
      case 'requete':
      case 'select':
      case 'where':
      case 'from':
      case 'join':
      case 'table':
      case 'colonne':
      case 'ligne':
      case 'base':
      case 'donnees':
        return conceptQuestion(
          `concept-sql-${index + 1}`,
          `Dans "${quizLabel}", que fait generalement une requete sur une base de donnees ?`,
          'Elle permet de lire, filtrer ou combiner des donnees stockees',
          [
            'Elle sert uniquement a dessiner une interface graphique',
            'Elle remplace automatiquement le systeme d’exploitation',
            'Elle transforme chaque variable en boucle',
          ],
          'Une requete sert a manipuler ou consulter les donnees.',
        );
      default:
        return null;
    }
  }

  private normalizeQuizConcept(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[«»"'`]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private deduplicateQuizQuestions(questions: QuizQuestion[]): QuizQuestion[] {
    const seen = new Set<string>();

    return questions.filter(question => {
      const promptSignature = String(question?.prompt || '')
        .trim()
        .toLowerCase();
      const optionsSignature = Array.isArray(question?.options)
        ? question.options
            .map(option => String(option?.text || '').trim().toLowerCase())
            .join('|')
        : '';
      const answersSignature = Array.isArray(question?.correctAnswers)
        ? [...question.correctAnswers]
            .map(answer => String(answer).trim().toUpperCase())
            .sort()
            .join('|')
        : '';
      const signature = `${promptSignature}::${optionsSignature}::${answersSignature}`;

      if (!promptSignature || seen.has(signature)) {
        return false;
      }

      seen.add(signature);
      return true;
    });
  }

  private createSingleChoiceQuestion(
    id: string,
    prompt: string,
    options: string[],
    correctLabel: string,
    explanation: string,
  ): QuizQuestion {
    return {
      id,
      prompt,
      type: 'single',
      options: options.map((text, index) => ({
        label: String.fromCharCode(65 + index),
        text,
      })),
      correctAnswers: [correctLabel],
      explanation,
    };
  }

  private updateExistingPartName(
    courseId: string,
    chapterId: string,
    nextPartId: string,
  ) {
    const normalizedNextPartId = (nextPartId || '').trim();
    const previousPartId = (this.editingCourseItems[0]?.partId || '').trim();

    if (!normalizedNextPartId) {
      this.scheduleUiUpdate(() => {
        this.isSaving = false;
        this.formError = 'Le nom de la partie est obligatoire.';
      });
      return;
    }

    const requests = this.editingCourseItems
      .map(item => {
        const itemId = this.normalizeContentId(item._id);
        if (!itemId) {
          return null;
        }

        return this.http.patch(`/api/contents/${itemId}`, {
          courseId,
          chapterId,
          partId: normalizedNextPartId,
          title: this.renameContentTitleForPart(item.title, previousPartId, normalizedNextPartId),
          ...(item.type === 'Quiz' ? { quizDisplayMode: 'scoped' } : {}),
          ...this.buildTeacherMetadata(),
        });
      })
      .filter(Boolean);

    if (requests.length === 0) {
      this.scheduleUiUpdate(() => {
        this.isSaving = false;
        this.formError = 'Aucun contenu a mettre a jour pour cette partie.';
      });
      return;
    }

    forkJoin(requests).subscribe({
      next: () => {
        this.scheduleUiUpdate(() => {
          this.isSaving = false;
          this.closeModal(true);
          this.loadContents();
          this.showOperationSuccess('Le nom de la partie a ete modifie avec succes.');
        });
      },
      error: error => {
        this.scheduleUiUpdate(() => {
          this.isSaving = false;
          this.formError = this.resolveContentErrorMessage(
            error,
            'La modification de la partie a echoue.',
          );
        });
      },
    });
  }

  private renameContentTitleForPart(
    currentTitle: string,
    previousPartId: string,
    nextPartId: string,
  ) {
    const safeCurrentTitle = currentTitle || '';
    const safePreviousPartId = previousPartId || '';
    const safeNextPartId = nextPartId || '';

    if (!safePreviousPartId || !safeCurrentTitle.startsWith(safePreviousPartId)) {
      return safeCurrentTitle;
    }

    return `${safeNextPartId}${safeCurrentTitle.slice(safePreviousPartId.length)}`;
  }

  private updateExistingCourse(
    courseId: string,
    chapterId: string,
    partId: string,
    quizPayload: any,
  ) {
    const documentItem = this.editingCourseItems.find(item => item.type === 'Document');
    const videoItem = this.editingCourseItems.find(item => item.type.toLowerCase().includes('vid'));
    const quizItem = this.editingCourseItems.find(item => item.type === 'Quiz');
    const documentId = this.normalizeContentId(documentItem?._id);
    const videoId = this.normalizeContentId(videoItem?._id);
    const quizId = this.normalizeContentId(quizItem?._id);

    const requests = [
      documentId
        ? this.http.patch(`/api/contents/${documentId}`, {
            courseId,
            chapterId,
            partId,
            title: `${partId} - Document`,
            description: 'Document de cours ajouté',
            ...this.buildTeacherMetadata(),
          })
        : of(null),
      videoId
        ? this.http.patch(`/api/contents/${videoId}`, {
            courseId,
            chapterId,
            partId,
            title: `${partId} - Vidéo`,
            description: this.contentForm.videoLink || 'Vidéo ajoutée',
            source: this.contentForm.videoLink || undefined,
            fileUrl: this.contentForm.videoLink ? '' : undefined,
            fileName: this.contentForm.videoLink ? '' : undefined,
            ...this.buildTeacherMetadata(),
          })
        : of(null),
      quizId
        ? this.http.patch(`/api/contents/${quizId}`, quizPayload)
        : of(null),
    ];

    forkJoin(requests)
      .pipe(
        switchMap(() => {
          const uploads = [];

          if (documentId && this.contentForm.documentFile) {
            const documentFormData = new FormData();
            documentFormData.append('file', this.contentForm.documentFile);
            uploads.push(
              this.http.post(`/api/contents/${documentId}/file`, documentFormData),
            );
          }

          if (videoId && this.contentForm.videoFile) {
            const videoFormData = new FormData();
            videoFormData.append('file', this.contentForm.videoFile);
            uploads.push(
              this.http.post(`/api/contents/${videoId}/file`, videoFormData),
            );
          }

          if (quizId && this.contentForm.quizFile) {
            const quizFormData = new FormData();
            quizFormData.append('file', this.contentForm.quizFile);
            uploads.push(
              this.http.post<any>(`/api/contents/${quizId}/file`, quizFormData).pipe(
                map(response => {
                  const parsedQuiz = response?.content || quizItem;
                  return {
                    parsedQuiz,
                    parseFailed:
                      this.contentForm.quizMode === 'existing' &&
                      (!parsedQuiz?.quizQuestions || parsedQuiz.quizQuestions.length === 0),
                  };
                }),
              ),
            );
          }

          return uploads.length ? forkJoin(uploads) : of(null);
        }),
      )
      .subscribe({
        next: uploadResults => {
          this.scheduleUiUpdate(() => {
            const normalizedResults = Array.isArray(uploadResults)
              ? uploadResults
              : uploadResults
                ? [uploadResults]
                : [];
            const quizUpload = normalizedResults.find((result: any) => result?.parseFailed) as
              | { parseFailed?: boolean }
              | undefined;

            if (quizUpload?.parseFailed) {
              this.isSaving = false;
              this.formError =
                "Le fichier quiz a ete telecharge, mais aucune question n'a pu etre extraite. Verifiez le format 'Question / A. / B. / C. / D. / Bonne reponse: X'.";
              return;
            }

            this.isSaving = false;
            this.closeModal(true);
            this.loadContents();
            this.showOperationSuccess('Les modifications ont ete enregistrees avec succes.');
          });
        },
        error: error => {
          this.scheduleUiUpdate(() => {
            this.isSaving = false;
            this.formError = this.resolveContentErrorMessage(
              error,
              'La modification du cours a échoué.',
            );
          });
        },
      });
  }

  private updateExistingContent(
    item: ContentItem,
    courseId: string,
    chapterId: string,
    partId: string,
    trimmedVideoLink: string,
  ) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId) {
      this.scheduleUiUpdate(() => {
        this.isSaving = false;
        this.formError = 'Impossible de modifier ce contenu.';
      });
      return;
    }

    if (item.type === 'Quiz') {
      const quizPayload = this.buildQuizPayload(courseId, chapterId, partId);
      this.updateExistingQuiz(item, quizPayload);
      return;
    }

    const payload =
      item.type === 'Vidéo'
        ? {
            courseId,
            chapterId,
            partId,
            title: `${partId} - Vidéo`,
            description: trimmedVideoLink || item.description || 'Vidéo ajoutée',
            source: trimmedVideoLink || item.source || undefined,
            fileUrl: trimmedVideoLink ? '' : item.fileUrl || undefined,
            fileName: trimmedVideoLink ? '' : item.fileName || undefined,
            ...this.buildTeacherMetadata(),
          }
        : {
            courseId,
            chapterId,
            partId,
            title: `${partId} - Document`,
            description: item.description || 'Document de cours ajouté',
            ...this.buildTeacherMetadata(),
          };

    this.http
      .patch<any>(`/api/contents/${itemId}`, payload)
      .pipe(
        switchMap(updatedContent => {
          const selectedFile =
            item.type === 'Vidéo' ? this.contentForm.videoFile : this.contentForm.documentFile;

          if (!selectedFile) {
            return of(updatedContent);
          }

          const formData = new FormData();
          formData.append('file', selectedFile);

          return this.http
            .post<any>(`/api/contents/${itemId}/file`, formData)
            .pipe(map(response => response?.content || updatedContent));
        }),
      )
      .subscribe({
        next: updatedContent => {
          this.scheduleUiUpdate(() => {
            this.contents = this.deduplicateContents(
              this.contents.map(content =>
                this.normalizeContentId(content._id) === itemId
                  ? (this.mapApiItemToContentItem(updatedContent) || content)
                  : content,
              ),
            );
            this.syncStructureFromContents();
            this.isSaving = false;
            this.closeModal(true);
            this.showOperationSuccess('Les modifications ont ete enregistrees avec succes.');
          });
        },
        error: error => {
          this.scheduleUiUpdate(() => {
            this.isSaving = false;
            this.formError = this.resolveContentErrorMessage(
              error,
              'La modification du contenu a échoué.',
            );
          });
        },
      });
  }

  private updateExistingQuiz(item: ContentItem, quizPayload: any) {
    const itemId = this.normalizeContentId(item._id);
    if (!itemId) {
      this.scheduleUiUpdate(() => {
        this.isSaving = false;
        this.formError = "Impossible de modifier ce quiz.";
      });
      return;
    }

    this.http
      .patch<any>(`/api/contents/${itemId}`, quizPayload)
      .pipe(
        switchMap(updatedQuiz => {
          if (!this.contentForm.quizFile) {
            return of(updatedQuiz);
          }

          const formData = new FormData();
          formData.append('file', this.contentForm.quizFile);

          return this.http
            .post<any>(`/api/contents/${itemId}/file`, formData)
            .pipe(map(response => response?.content || updatedQuiz));
        }),
      )
      .subscribe({
        next: updatedQuiz => {
          const normalizedUpdatedQuiz = this.mapApiItemToContentItem({
            ...item,
            ...quizPayload,
            ...(updatedQuiz || {}),
            quizQuestions: Array.isArray(updatedQuiz?.quizQuestions)
              ? updatedQuiz.quizQuestions
              : quizPayload.quizQuestions,
            quizQuestionCount:
              updatedQuiz?.quizQuestionCount ??
              quizPayload.quizQuestionCount ??
              quizPayload.quizQuestions?.length,
          });
          this.scheduleUiUpdate(() => {
            this.contents = this.deduplicateContents(
              this.contents.map(content =>
                this.normalizeContentId(content._id) === itemId
                  ? (normalizedUpdatedQuiz || content)
                  : content,
              ),
            );
            this.syncStructureFromContents();
            this.isSaving = false;
            this.closeModal(true);
            this.showOperationSuccess('Le quiz a ete enregistre avec succes.');
          });
        },
        error: error => {
          this.scheduleUiUpdate(() => {
            this.isSaving = false;
            this.formError = this.resolveContentErrorMessage(
              error,
              'La modification du quiz a échoué.',
            );
          });
        },
      });
  }

  private resolveContentErrorMessage(error: any, fallbackMessage: string): string {
    if (error?.status === 413) {
      return 'Le fichier est trop volumineux pour etre telecharge.';
    }

    const serverMessage = Array.isArray(error?.error?.message)
      ? error.error.message.join(', ')
      : error?.error?.message;

    return serverMessage || error?.message || fallbackMessage;
  }

  private toEmbeddedVideoUrl(url: string): string | null {
    const youtubeMatch =
      url.match(/[?&]v=([^&]+)/i) || url.match(/youtu\.be\/([^?&]+)/i);
    if (youtubeMatch?.[1]) {
      return `https://www.youtube.com/embed/${youtubeMatch[1]}`;
    }

    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/i);
    if (vimeoMatch?.[1]) {
      return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    }

    return null;
  }

  private showOperationSuccess(message: string) {
    this.successMessage = message;
    this.showSuccessModal = true;
  }

}












