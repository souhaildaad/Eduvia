import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { NotificationBell } from '../notification-bell/notification-bell';
import { StudentTracking } from '../teacher/student-tracking/student-tracking';
import { TeacherProfileSettingsComponent } from '../teacher/teacher-profile-settings/teacher-profile-settings';
import { ContentManagement } from '../teacher/content-management/content-management';
import { ExamReminders } from '../teacher/exam-reminders/exam-reminders';
import { ReclamationsPanelComponent } from '../shared/reclamations-panel/reclamations-panel';
import { VoicePlaybackService } from '../../services/voice-playback.service';
import { environment } from '../../../environments/environment';

type DashboardCourse = {
  title: string;
  subtitle: string;
  students: number;
  key: string;
  items?: any[];
};

type CourseDetailPart = {
  name: string;
  items: any[];
};

type CourseDetailChapter = {
  name: string;
  parts: CourseDetailPart[];
  itemCount: number;
};

type ReminderTargetStudent = {
  id: string;
  name: string;
  email: string;
  className: string;
  selectedTopics?: string[];
};

type MeetSession = {
  _id?: string;
  title: string;
  audience: 'student' | 'teacher';
  status: 'live' | 'scheduled' | 'ended';
  roomName?: string;
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
  selector: 'app-teacher-dashboard',
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    HttpClientModule,
    NotificationBell,
    StudentTracking,
    TeacherProfileSettingsComponent,
    ContentManagement,
    ExamReminders,
    ReclamationsPanelComponent,
  ],
  templateUrl: './teacher-dashboard.html',
  styleUrls: ['./teacher-dashboard.css'],
})
export class TeacherDashboard implements OnInit {
  isMenuOpen = false;
  tabIndex = 0;
  requestedCourseView: string | null = null;
  requestedReminderStudent: ReminderTargetStudent | null = null;
  showAtRiskStudentsOnly = false;
  chapterExpanded: Record<string, boolean> = {};
  partExpanded: Record<string, boolean> = {};

  @Output() logout = new EventEmitter<void>();

  readonly fallbackCourses: DashboardCourse[] = [
    {
      title: 'Mathématiques avancées',
      subtitle: 'Algèbre et calcul',
      students: 42,
      key: 'Mathématiques avancées',
    },
    {
      title: 'Physique I',
      subtitle: 'Mécanique classique',
      students: 38,
      key: 'Physique I',
    },
    {
      title: 'Programmation Web',
      subtitle: 'Angular & TypeScript',
      students: 56,
      key: 'Programmation Web',
    },
  ];

  courses: DashboardCourse[] = [];
  courseCount = 0;
  totalStudents = 0;
  studentsAtRiskCount = 0;
  averageProgress = 0;
  headerProfile = {
    name: 'Enseignant',
    avatarDataUrl: '',
  };
  displayedHeaderName = 'Enseignant';
  displayedHeaderAvatarDataUrl = '';
  currentTeacherEmail = '';
  teacherAssignedClasses: string[] = [];
  selectedClassFilter = 'all';
  meetSessions: MeetSession[] = [];
  meetReplays: MeetSession[] = [];
  meetLoading = false;
  meetCreating = false;
  meetError = '';
  meetCreateDialogOpen = false;
  meetFrameOpen = false;
  meetFrameTitle = '';
  meetFrameUrl: SafeResourceUrl | null = null;
  meetFrameReplay: MeetSession | null = null;
  teacherReplayListOpen = false;
  pendingMeetInterfaceDelete: MeetSession | null = null;
  private hiddenMeetInterfaceIds = new Set<string>();
  readonly meetApiBaseUrl = `${environment.backendUrl}/api/meet`;
  meetForm = {
    title: '',
    topic: '',
    capacity: 30,
    recordingEnabled: true,
  };
  replayForm = {
    title: '',
    url: '',
    subject: '',
    duration: '',
  };

  selectedCourse: {
    title: string;
    subtitle: string;
    students: number;
    key: string;
    items: any[];
  } | null = null;

  showCourseModal = false;
  courseContentMap: Record<string, any[]> = {};

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private voicePlaybackService: VoicePlaybackService,
  ) {}

  ngOnInit() {
    this.loadHiddenMeetInterfaceIds();
    this.loadHeaderProfile();
  }

  get teacherInitials() {
    const fullName = this.displayedHeaderName.trim();
    return fullName ? fullName.charAt(0).toUpperCase() : 'E';
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  onTabChanged(index: number) {
    this.tabIndex = index;

    if (index === 0) {
      this.showAtRiskStudentsOnly = false;
      this.loadCourses();
    }
    if (index === 4) {
      this.loadMeetData();
    }
  }

  onLogout() {
    this.logout.emit();
  }

  viewDetails(course: DashboardCourse) {
    const items = (this.courseContentMap[course.key] || []).map(item =>
      this.normalizeDetailItem(item),
    );
    this.selectedCourse = { ...course, items };
    this.chapterExpanded = {};
    this.partExpanded = {};
    this.courseDetailChapters(items).forEach(chapter => {
      this.chapterExpanded[this.chapterKey(chapter.name)] = true;
      chapter.parts.forEach(part => {
        this.partExpanded[this.partKey(chapter.name, part.name)] = true;
      });
    });
    this.showCourseModal = true;
  }

  openCourseInContentTab(course: DashboardCourse, event?: Event) {
    event?.stopPropagation();
    this.requestedCourseView = course.key;
    this.tabIndex = 2;
  }

  openReminderTabForStudent(student: ReminderTargetStudent) {
    this.requestedReminderStudent = { ...student };
    this.tabIndex = 3;
  }

  openAtRiskStudents() {
    this.showAtRiskStudentsOnly = true;
    this.tabIndex = 1;
  }

  openStudentTracking() {
    this.showAtRiskStudentsOnly = false;
    this.tabIndex = 1;
  }

  private loadMeetData() {
    this.loadHiddenMeetInterfaceIds();
    this.meetLoading = true;
    this.meetError = '';
    this.http.get<MeetSession[]>(`${this.meetApiBaseUrl}/sessions`).subscribe({
      next: sessions => {
        this.meetSessions = sessions || [];
        this.meetLoading = false;
      },
      error: () => {
        this.meetSessions = [];
        this.meetError = '';
        this.meetLoading = false;
      },
    });

    this.http.get<MeetSession[]>(`${this.meetApiBaseUrl}/replays?audience=teacher`).subscribe({
      next: replays => {
        this.meetReplays = replays || [];
      },
      error: () => {
        this.meetReplays = [];
      },
    });
  }

  get teacherMeetSessions() {
    return this.meetSessions.filter(session => session.audience === 'teacher' && !this.isMeetHiddenFromInterface(session));
  }

  get connectedTeacherMeetReplays() {
    const currentEmail = this.currentTeacherEmail.trim().toLowerCase();
    return this.meetReplays.filter(replay => {
      const replayHostEmail = String(replay.hostEmail || '').trim().toLowerCase();
      return replay.audience === 'teacher' && !this.isMeetHiddenFromInterface(replay) && (!currentEmail || !replayHostEmail || replayHostEmail === currentEmail);
    });
  }

  get isMeetFormValid() {
    return (
      this.meetForm.title.trim().length >= 3 &&
      this.meetForm.topic.trim().length >= 3
    );
  }

  openTeacherMeetDialog() {
    this.meetError = '';
    this.meetCreateDialogOpen = true;
  }

  closeTeacherMeetDialog() {
    if (this.meetCreating) {
      return;
    }
    this.meetCreateDialogOpen = false;
  }

  createTeacherMeetRoom() {
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
      audience: 'teacher',
      status: 'live',
      hostName: this.displayedHeaderName,
      hostEmail: this.currentTeacherEmail,
      capacity: this.meetForm.capacity,
      recordingEnabled: this.meetForm.recordingEnabled,
      scheduledAt: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    }).subscribe({
      next: session => {
        this.meetSessions = [session, ...this.meetSessions];
        this.meetForm = { title: '', topic: '', capacity: 30, recordingEnabled: true };
        this.meetCreating = false;
        this.meetCreateDialogOpen = false;
        setTimeout(() => this.joinMeet(session), 0);
      },
      error: () => {
        this.meetCreating = false;
        this.meetError = 'Impossible de creer la salle meet.';
      },
    });
  }

  announceMeetField(field: 'title' | 'topic') {
    const messages: Record<'title' | 'topic', string> = {
      title: 'Titre de la salle. Saisir le nom du meet que vous voulez creer.',
      topic: 'Sujet ou description. Saisir le sujet de la reunion meet.',
    };
    this.voicePlaybackService.toggle(`teacher-meet:${field}`, messages[field]);
  }

  isMeetFieldVoiceActive(field: 'title' | 'topic') {
    return this.voicePlaybackService.isActive(`teacher-meet:${field}`);
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

  endMeet(session: MeetSession) {
    if (!session._id) {
      return;
    }

    this.http.patch<MeetSession>(`${this.meetApiBaseUrl}/sessions/${session._id}/end`, {}).subscribe({
      next: updated => {
        this.meetSessions = this.meetSessions.filter(item => item._id !== updated._id);
        if (this.shouldShowMeetReplay(updated)) {
          this.meetReplays = [updated, ...this.meetReplays.filter(item => item._id !== updated._id)];
          this.teacherReplayListOpen = true;
        }
      },
      error: () => {
        this.meetError = 'Impossible de terminer la session.';
      },
    });
  }

  private shouldShowMeetReplay(session: MeetSession) {
    return session.status === 'ended' && (session.recordingEnabled === true || !!session.replayUrl);
  }

  addReplay() {
    const title = this.replayForm.title.trim();
    if (title.length < 3 || !/^https?:\/\/.+/i.test(this.replayForm.url)) {
      this.meetError = 'Ajoutez un titre et un lien replay valide.';
      return;
    }

    this.http.post<MeetSession>(`${this.meetApiBaseUrl}/replays`, {
      title,
      audience: 'teacher',
      status: 'ended',
      hostName: this.displayedHeaderName,
      hostEmail: this.currentTeacherEmail,
      replayUrl: this.replayForm.url,
      replayTitle: title,
      replaySubject: this.replayForm.subject,
      replayDuration: this.replayForm.duration,
      topic: this.replayForm.subject,
    }).subscribe({
      next: replay => {
        this.meetReplays = [replay, ...this.meetReplays];
        this.replayForm = { title: '', url: '', subject: '', duration: '' };
      },
      error: () => {
        this.meetError = 'Impossible d enregistrer le replay.';
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

  private isMeetHiddenFromInterface(session: MeetSession) {
    return this.hiddenMeetInterfaceIds.has(this.meetInterfaceId(session));
  }

  private meetInterfaceId(session: MeetSession) {
    return String(session._id || session.joinUrl || session.replayUrl || `${session.audience}:${session.title}:${session.hostEmail || session.hostName}`).trim();
  }

  private hiddenMeetInterfaceKey() {
    return `eduvia-hidden-meet-interface:teacher:${this.currentTeacherEmail || 'anonymous'}`;
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

  closeMeetFrame() {
    this.meetFrameOpen = false;
    this.meetFrameTitle = '';
    this.meetFrameUrl = null;
    this.meetFrameReplay = null;
  }

  courseBadge(course: DashboardCourse): string {
    const compact = (course.title || '').replace(/\s+/g, '');
    return compact.slice(0, 2).toUpperCase() || 'CR';
  }

  courseDetailChapters(items: any[] | undefined): CourseDetailChapter[] {
    const chapterMap = new Map<string, Map<string, any[]>>();

    (items || [])
      .filter(item => item && (item.title || item.type || item.description))
      .forEach(item => {
        const chapterName = this.repairEncoding(item?.chapterId || item?.chapter || 'Chapitre 1') || 'Chapitre 1';
        const partName = this.repairEncoding(item?.partId || item?.part || 'Partie 1') || 'Partie 1';

        if (!chapterMap.has(chapterName)) {
          chapterMap.set(chapterName, new Map<string, any[]>());
        }

        const partMap = chapterMap.get(chapterName)!;
        if (!partMap.has(partName)) {
          partMap.set(partName, []);
        }

        partMap.get(partName)!.push(item);
      });

    return Array.from(chapterMap.entries()).map(([name, partMap]) => {
      const parts = Array.from(partMap.entries()).map(([partName, partItems]) => ({
        name: partName,
        items: partItems,
      }));

      return {
        name,
        parts,
        itemCount: parts.reduce((total, part) => total + part.items.length, 0),
      };
    });
  }

  closeCourseModal() {
    this.showCourseModal = false;
    this.selectedCourse = null;
    this.chapterExpanded = {};
    this.partExpanded = {};
  }

  toggleChapterDetails(chapterName: string) {
    const key = this.chapterKey(chapterName);
    this.chapterExpanded[key] = !this.chapterExpanded[key];
  }

  isChapterExpanded(chapterName: string): boolean {
    return this.chapterExpanded[this.chapterKey(chapterName)] ?? true;
  }

  togglePartDetails(chapterName: string, partName: string) {
    const key = this.partKey(chapterName, partName);
    this.partExpanded[key] = !this.partExpanded[key];
  }

  isPartExpanded(chapterName: string, partName: string): boolean {
    return this.partExpanded[this.partKey(chapterName, partName)] ?? true;
  }

  chapterSummaryForPopup(chapter: CourseDetailChapter): string {
    const partCount = chapter.parts.length;
    return `${partCount} partie${partCount > 1 ? 's' : ''} • ${chapter.itemCount} contenu${chapter.itemCount > 1 ? 's' : ''}`;
  }

  courseChapterCountForPopup(items: any[] | undefined): number {
    return this.courseDetailChapters(items).length;
  }

  courseElementCountForPopup(items: any[] | undefined): number {
    return (items || []).filter(item => item && (item.title || item.type || item.description)).length;
  }

  partSummaryForPopup(part: CourseDetailPart): string {
    const labels = Array.from(
      new Set(part.items.map(item => this.detailItemType(item).toLowerCase())),
    );
    return labels.length ? labels.join(' • ') : 'Aucun contenu';
  }

  detailMetaLabel(item: any): string {
    const dueDateLabel = this.formatDueDateLabel(item);
    return dueDateLabel ? `Date d'echeance : ${dueDateLabel}` : this.detailItemType(item);
  }

  quizLevelChipClass(item: any): string {
    switch ((item?.quizDifficulty || '').toLowerCase()) {
      case 'facile':
        return 'verification-chip verification-chip--verified';
      case 'moyen':
        return 'verification-chip verification-chip--pending';
      case 'difficile':
        return 'verification-chip verification-chip--blocked';
      default:
        return 'verification-chip';
    }
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
      this.applyHeaderProfileView(tokenName, this.headerProfile.avatarDataUrl);
    }

    const tokenEmail = payload?.['email'] || localStorage.getItem('current_user_email') || '';
    if (tokenEmail) {
      this.currentTeacherEmail = String(tokenEmail).trim().toLowerCase();
    }

    this.http.get<any>('/auth/profile').subscribe({
      next: (response) => {
        const profile = response?.data || response || {};
        this.headerProfile.name = profile.fullName || this.headerProfile.name;
        this.headerProfile.avatarDataUrl = profile.avatarDataUrl || '';
        this.applyHeaderProfileView(
          this.headerProfile.name,
          this.headerProfile.avatarDataUrl,
        );
        this.currentTeacherEmail =
          String(profile.email || this.currentTeacherEmail || '').trim().toLowerCase();
        this.teacherAssignedClasses = this.normalizeClassList([
          ...(Array.isArray(profile?.assignedClasses) ? profile.assignedClasses : []),
          profile?.className,
        ]);
        this.loadDashboardStats();
        this.loadCourses();
      },
      error: () => {
        this.applyHeaderProfileView(
          this.headerProfile.name,
          this.headerProfile.avatarDataUrl,
        );
        this.courses = [];
        this.courseCount = 0;
        this.totalStudents = 0;
        this.courseContentMap = {};
      },
    });
  }

  private applyHeaderProfileView(name: string, avatarDataUrl: string) {
    setTimeout(() => {
      this.displayedHeaderName = name || 'Enseignant';
      this.displayedHeaderAvatarDataUrl = avatarDataUrl || '';
      this.cdr.detectChanges();
    }, 0);
  }

  loadCourses() {
    const teacherEmail = String(this.currentTeacherEmail || '').trim().toLowerCase();
    if (!teacherEmail) {
      this.courses = [];
      this.courseCount = 0;
      this.totalStudents = 0;
      this.courseContentMap = {};
      this.cdr.detectChanges();
      return;
    }

    const params = new URLSearchParams({ teacherEmail });
    if (this.selectedClassFilter !== 'all') {
      params.set('className', this.selectedClassFilter);
    }
    const requestUrl = `/api/contents?${params.toString()}`;

    this.http.get<any[]>(requestUrl).subscribe(
      data => {
        let filteredData = (data || []).filter(item => {
          const itemTeacherEmail = String(item?.teacherEmail || '').trim().toLowerCase();
          return itemTeacherEmail === teacherEmail;
        });

        if (filteredData.length === 0 && (data || []).length > 0) {
          filteredData = (data || []).filter(item => {
            if (item.visibleToAllClasses) return true;
            const itemClasses = Array.isArray(item.visibleToClasses)
              ? item.visibleToClasses
              : [item.visibleToClasses, item.className].filter(Boolean);
            return itemClasses.some((c: string) =>
              this.teacherAssignedClasses.map(ac => ac.toLowerCase()).includes(String(c).toLowerCase())
            );
          });
          if (filteredData.length === 0) {
            filteredData = data;
          }
        }

        const grouped = filteredData.reduce((acc, item) => {
          const courseKey = this.repairEncoding(item.courseId || item.course || 'Cours inconnu');
          const isEmptyAssignedCourse = String(item?.type || '').toLowerCase() === 'course';
          const chapterName = isEmptyAssignedCourse
            ? 'Cours attribue'
            : this.repairEncoding(item.chapterId || item.chapter || 'Chapitre 1');
          const normalizedItem = this.normalizeDetailItem(item);

          if (!acc[courseKey]) {
            acc[courseKey] = {
              title: courseKey,
              subtitle: chapterName,
              students: 0,
              items: [] as any[],
            };
          }

          if (!isEmptyAssignedCourse) {
            acc[courseKey].students += 1;
            acc[courseKey].items.push(normalizedItem);
          }
          return acc;
        }, {} as Record<string, { title: string; subtitle: string; students: number; items: any[] }>);

        const apiCourses = Object.keys(grouped).map(key => ({ ...grouped[key], key }));

        if (apiCourses.length > 0) {
          this.courses = apiCourses;
          this.courseCount = apiCourses.length;
          this.courseContentMap = Object.keys(grouped).reduce((map, key) => {
            map[key] = grouped[key].items;
            return map;
          }, {} as Record<string, any[]>);
          this.cdr.detectChanges();
          return;
        }

        this.courses = [];
        this.courseCount = 0;
        this.courseContentMap = {};
        this.cdr.detectChanges();
      },
      () => {
        this.courses = [];
        this.courseCount = 0;
        this.courseContentMap = {};
        this.cdr.detectChanges();
      },
    );
  }

  private loadDashboardStats() {
    const teacherEmail = String(this.currentTeacherEmail || '').trim().toLowerCase();
    if (!teacherEmail) {
      this.totalStudents = 0;
      this.studentsAtRiskCount = 0;
      this.averageProgress = 0;
      this.cdr.detectChanges();
      return;
    }

    const params = new URLSearchParams({ teacherEmail });
    if (this.selectedClassFilter !== 'all') {
      params.set('className', this.selectedClassFilter);
    }
    const requestUrl = `/api/contents/dashboard-stats?${params.toString()}`;
    this.http.get<any>(requestUrl).subscribe({
      next: (response) => {
        this.totalStudents = Number(response?.totalStudents || 0);
        this.teacherAssignedClasses = this.normalizeClassList([
          ...this.teacherAssignedClasses,
          ...(Array.isArray(response?.assignedClasses) ? response.assignedClasses : []),
        ]);
        this.cdr.detectChanges();
      },
      error: () => {
        this.totalStudents = 0;
        this.cdr.detectChanges();
      },
    });
    this.loadStudentProgressStats();
  }

  private loadStudentProgressStats() {
    const params = new URLSearchParams();
    if (this.selectedClassFilter !== 'all') {
      params.set('className', this.selectedClassFilter);
    }
    const requestUrl = params.toString()
      ? `/auth/teacher-course-members?${params.toString()}`
      : '/auth/teacher-course-members';

    this.http.get<any>(requestUrl).subscribe({
      next: response => {
        const students = Array.isArray(response?.data?.students)
          ? response.data.students
          : [];
        const progressValues: number[] = students.map((student: any) =>
          Math.max(0, Math.min(100, Number(student?.globalProgress || 0))),
        );

        this.studentsAtRiskCount = progressValues.filter((progress: number) => progress < 75).length;
        this.averageProgress =
          progressValues.length > 0
            ? Math.round(
                progressValues.reduce((total: number, progress: number) => total + progress, 0) /
                  progressValues.length,
              )
            : 0;
        this.cdr.detectChanges();
      },
      error: () => {
        this.studentsAtRiskCount = 0;
        this.averageProgress = 0;
        this.cdr.detectChanges();
      },
    });
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

  onClassFilterChange(className: string) {
    this.selectedClassFilter = className || 'all';
    this.loadDashboardStats();
    this.loadCourses();
  }

  detailItemTitle(item: any): string {
    return this.normalizeCorruptedTitle(item);
  }

  detailItemType(item: any): string {
    const type = String(item?.type || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (type.includes('video') || type.includes('vid')) {
      return 'vidéo';
    }
    if (type.includes('document')) {
      return 'document';
    }
    if (type.includes('quiz')) {
      return 'quiz';
    }
    return this.repairEncoding(item?.type || 'Type inconnu');
  }

  detailItemDescription(item: any): string {
    const repaired = this.repairEncoding(item?.description || '');
    const type = this.detailItemType(item);

    if (this.looksCorrupted(repaired) && type === 'vidéo') {
      return 'Vidéo ajoutée';
    }
    if (this.looksCorrupted(repaired) && type === 'document') {
      return 'Document de cours ajouté';
    }

    return repaired || 'Pas de description';
  }

  private formatDueDateLabel(item: any): string {
    const candidate = this.normalizeApiDateValue(item?.dueDateTime || item?.dueDate);
    if (!candidate) {
      return '';
    }

    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const day = `${parsed.getDate()}`.padStart(2, '0');
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
  }

  quizLevelLabel(item: any): string {
    switch ((item?.quizDifficulty || '').toLowerCase()) {
      case 'facile':
        return 'Debutant';
      case 'moyen':
        return 'Intermediaire';
      case 'difficile':
        return 'Avance';
      default:
        return '';
    }
  }

  private normalizeDetailItem(item: any) {
    return {
      ...item,
      _id: this.normalizeContentId(item?._id ?? item?.id),
      title: this.normalizeCorruptedTitle(item),
      description: this.detailItemDescription(item),
      type: this.detailItemType(item),
      chapterId: this.repairEncoding(item?.chapterId || item?.chapter || ''),
      courseId: this.repairEncoding(item?.courseId || item?.course || ''),
      partId: this.repairEncoding(item?.partId || item?.part || ''),
      dueDate: this.normalizeApiDateValue(item?.dueDate),
      dueDateTime: this.normalizeApiDateValue(item?.dueDateTime),
    };
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

  private normalizeCorruptedTitle(item: any): string {
    const repairedTitle = this.repairEncoding(item?.title || item?.type || 'Element');
    const type = this.detailItemType(item);
    const partId = this.repairEncoding(item?.partId || item?.part || '');

    if (this.looksCorrupted(repairedTitle) && type === 'vidéo' && partId) {
      return `${partId} - Vidéo`;
    }

    if (this.looksCorrupted(repairedTitle) && type === 'document' && partId) {
      return `${partId} - Document`;
    }

    return repairedTitle;
  }

  private normalizeClassList(values: unknown[]): string[] {
    return [
      ...new Set(
        values
          .flatMap(value => `${value || ''}`.split(/[;,]/))
          .map(value => value.trim().toUpperCase())
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right, 'fr'));
  }

  private repairEncoding(value: string): string {
    if (!value || !/[ÃÂâ]/.test(value)) {
      return value;
    }

    try {
      const bytes = Uint8Array.from(Array.from(value).map(character => character.charCodeAt(0)));
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      return value;
    }
  }

  private looksCorrupted(value: string): boolean {
    return /[ÃÂâ]/.test(value) || value.includes('VidÃ') || value.includes('ajoutÃ');
  }

  private chapterKey(chapterName: string): string {
    return chapterName;
  }

  private partKey(chapterName: string, partName: string): string {
    return `${chapterName}|${partName}`;
  }
}



