import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom, timeout } from 'rxjs';
import { NotificationService } from '../../../services/notification.service';

type TeacherContentItem = {
  _id?: string;
  id?: string;
  type?: string;
  title?: string;
  courseId?: string;
  chapterId?: string;
  partId?: string;
  dueDate?: string;
  dueDateTime?: string;
  visibleToAllClasses?: boolean;
  visibleToClasses?: string[];
  isActive?: boolean;
  quizQuestions?: unknown[];
};

type TeacherStudent = {
  id: string;
  fullName: string;
  email: string;
  className: string;
  avatarDataUrl?: string;
  learningProgress?: Array<{
    contentId?: string;
    contentType?: string;
    status?: string;
    score?: number | null;
    completedAt?: string | null;
    updatedAt?: string | null;
  }>;
};

type CourseReminderStudent = {
  id: string;
  name: string;
  email: string;
  progress: number;
  completedContents?: number;
  totalContents?: number;
  missingChapters: string[];
};

type ExamReminder = {
  id: string;
  course: string;
  courseIds?: string[];
  courseNames?: string[];
  date: string;
  time: string;
  location: string;
  chapters: string[];
  studentsCount: number;
  studentEmails: string[];
  remindersSent: number;
  studentsAtRisk: CourseReminderStudent[];
};

type ReminderHistoryItem = {
  title: string;
  meta: string;
  courseId?: string;
  status?: 'non_lu' | 'lu';
  message?: string;
  reminderTitle?: string;
  emails?: string[];
};

type TeacherCourseMembersResponse = {
  success?: boolean;
  data?: {
    students?: TeacherStudent[];
  };
};

type TeacherExamRemindersResponse = {
  success?: boolean;
  data?: {
    exams?: ExamReminder[];
    students?: TeacherStudent[];
  };
};

type ReminderStorageState = {
  sentByExamId: Record<string, number>;
  history: ReminderHistoryItem[];
};

type RequestedStudentReminder = {
  id: string;
  name: string;
  email: string;
  className: string;
  selectedTopics?: string[];
};

@Component({
  selector: 'app-exam-reminders',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, MatIconModule],
  templateUrl: './exam-reminders.html',
  styleUrls: ['./exam-reminders.css'],
})
export class ExamReminders implements OnInit {
  @Input()
  set requestedStudentReminder(value: RequestedStudentReminder | null) {
    this.pendingRequestedStudentReminder = value;
    this.tryOpenRequestedStudentReminder();
  }

  showReminderDialog = false;
  selectedExam: ExamReminder | null = null;
  selectedStudents: string[] = [];
  lockedReminderStudent: RequestedStudentReminder | null = null;
  lockedReminderTopics: string[] = [];
  showDeleteHistoryDialog = false;
  pendingDeleteHistoryIndex: number | null = null;
  reminderMessage = '';
  loading = false;
  errorMessage = '';

  upcomingExams: ExamReminder[] = [];
  reminderHistory: ReminderHistoryItem[] = [];
  private teacherContents: TeacherContentItem[] = [];

  private teacherEmail = '';
  private reminderStorage: ReminderStorageState = {
    sentByExamId: {},
    history: [],
  };
  private pendingRequestedStudentReminder: RequestedStudentReminder | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly notificationService: NotificationService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.teacherEmail = this.resolveTeacherEmail();
    this.restoreReminderStorage();
    this.loadReminderData();
  }

  openReminderDialog(exam: ExamReminder): void {
    this.selectedExam = exam;
    this.selectedStudents = [];
    this.lockedReminderStudent = null;
    this.lockedReminderTopics = [];
    this.reminderMessage = this.buildReminderMessage(exam);
    this.showReminderDialog = true;
  }

  closeReminderDialog(): void {
    this.showReminderDialog = false;
    this.selectedExam = null;
    this.selectedStudents = [];
    this.lockedReminderStudent = null;
    this.lockedReminderTopics = [];
    this.reminderMessage = '';
  }

  toggleStudent(studentId: string): void {
    if (this.selectedStudents.includes(studentId)) {
      this.selectedStudents = this.selectedStudents.filter(id => id !== studentId);
      return;
    }

    this.selectedStudents = [...this.selectedStudents, studentId];
  }

  toggleAllStudents(): void {
    const students = this.selectedExam?.studentsAtRisk || [];
    if (this.selectedStudents.length === students.length) {
      this.selectedStudents = [];
      return;
    }

    this.selectedStudents = students.map(student => student.id);
  }

  sendToAllChanged(checked: boolean): void {
    if (checked) {
      this.selectedStudents = [];
    }
  }

  confirmReminder(): void {
    const targetExam = this.selectedExam;
    if (!targetExam || !this.reminderMessage.trim()) {
      return;
    }

    const targetEmails = this.lockedReminderStudent
      ? [this.lockedReminderStudent.email]
      : this.selectedStudents.length > 0
      ? targetExam.studentsAtRisk
          .filter(student => this.selectedStudents.includes(student.id))
          .map(student => student.email)
      : this.resolveReminderTargetEmails(targetExam);
    const reminderTitle = this.buildReminderTitle(targetExam);

    if (targetEmails.length > 0) {
      this.notificationService.addNotificationForUserEmails(targetEmails, {
        title: reminderTitle,
        message: `Rappel: ${targetExam.course}. Consultez le rappel envoye par votre enseignant.`,
        type: 'info',
        action: {
          kind: 'exam_reminder',
          reminderTitle,
          reminderBody: this.reminderMessage.trim(),
          studentName: this.lockedReminderStudent?.name,
          selectedTopics: this.lockedReminderTopics,
          courseId: targetExam.courseIds?.join(',') || targetExam.id,
          courseName: targetExam.courseNames?.join(', ') || targetExam.course,
        },
      });
    }

    const remindedCourseIds = targetExam.courseIds?.length
      ? targetExam.courseIds
      : [targetExam.id];
    remindedCourseIds.forEach(courseId => {
      this.reminderStorage.sentByExamId[courseId] =
        Number(this.reminderStorage.sentByExamId[courseId] || 0) + 1;
    });

    const targetCount = targetEmails.length;

    this.reminderHistory = [
      {
        title: `Rappel envoye - ${targetExam.courseNames?.join(', ') || targetExam.course}`,
        meta: `${new Date().toLocaleDateString('fr-FR')} - ${targetCount} etudiant(s)`,
        courseId: remindedCourseIds.join(','),
        status: 'non_lu' as const,
        message: this.reminderMessage.trim(),
        reminderTitle,
        emails: targetEmails,
      },
      ...this.reminderHistory,
    ].slice(0, 8);

    this.reminderStorage.history = this.reminderHistory;
    this.persistReminderStorage();
    this.upcomingExams = this.upcomingExams.map(exam =>
      remindedCourseIds.includes(exam.id)
        ? {
            ...exam,
            remindersSent: exam.remindersSent + 1,
          }
        : exam,
    );

    this.closeReminderDialog();
  }

  isExamAtRisk(exam: ExamReminder): boolean {
    return exam.studentsAtRisk.length > 0;
  }

  studentsToRemindCount(exam: ExamReminder | null): number {
    return exam?.studentsAtRisk.length || 0;
  }

  reminderProgressLabel(student: CourseReminderStudent): string {
    const completed = Math.max(0, Number(student.completedContents || 0));
    const total = Math.max(0, Number(student.totalContents || 0));
    const completedLabel = completed > 1 ? 'contenus termines' : 'contenu termine';
    return `${completed} ${completedLabel} sur ${total}`;
  }

  deleteHistoryItem(index: number): void {
    if (index < 0 || index >= this.reminderHistory.length) {
      return;
    }

    this.pendingDeleteHistoryIndex = index;
    this.showDeleteHistoryDialog = true;
  }

  closeDeleteHistoryDialog(): void {
    this.showDeleteHistoryDialog = false;
    this.pendingDeleteHistoryIndex = null;
  }

  confirmDeleteHistoryItem(): void {
    const index = this.pendingDeleteHistoryIndex;
    if (index === null || index < 0 || index >= this.reminderHistory.length) {
      this.closeDeleteHistoryDialog();
      return;
    }

    const deletedItem = this.reminderHistory[index];
    const deletedCourseIds = String(deletedItem?.courseId || '')
      .split(',')
      .map(courseId => courseId.trim())
      .filter(Boolean);
    this.reminderHistory = this.reminderHistory.filter((_, itemIndex) => itemIndex !== index);
    if (deletedCourseIds.length > 0) {
      deletedCourseIds.forEach(courseId => {
        this.reminderStorage.sentByExamId[courseId] = Math.max(
          0,
          Number(this.reminderStorage.sentByExamId[courseId] || 0) - 1,
        );
      });
      this.upcomingExams = this.upcomingExams.map(exam =>
        deletedCourseIds.includes(exam.id)
          ? {
              ...exam,
              remindersSent: Math.max(0, exam.remindersSent - 1),
            }
          : exam,
      );
    }
    this.reminderStorage.history = this.reminderHistory;
    this.persistReminderStorage();
    this.closeDeleteHistoryDialog();
  }

  pendingDeleteHistoryItem(): ReminderHistoryItem | null {
    if (this.pendingDeleteHistoryIndex === null) {
      return null;
    }

    return this.reminderHistory[this.pendingDeleteHistoryIndex] || null;
  }

  historyStatusLabel(item: ReminderHistoryItem): string {
    return item.status === 'lu' ? 'Lu' : 'Non lu';
  }

  historyStatusIcon(item: ReminderHistoryItem): string {
    return item.status === 'lu' ? 'check_circle' : 'mark_email_unread';
  }

  toggleHistoryStatus(item: ReminderHistoryItem): void {
    item.status = item.status === 'lu' ? 'non_lu' : 'lu';
    this.reminderStorage.history = this.reminderHistory;
    this.persistReminderStorage();
  }

  resendHistoryItem(item: ReminderHistoryItem): void {
    const targetExam = this.upcomingExams.find(exam => exam.id === item.courseId);
    const targetEmails = Array.isArray(item.emails) && item.emails.length > 0
      ? item.emails
      : targetExam?.studentsAtRisk.map(student => student.email) || [];
    const message = String(item.message || '').trim();

    if (targetEmails.length === 0 || !message) {
      return;
    }

    this.notificationService.addNotificationForUserEmails(targetEmails, {
      title: item.reminderTitle || this.buildReminderTitle(targetExam),
      message: targetExam
        ? `Rappel: ${targetExam.course}. Consultez le rappel envoye par votre enseignant.`
        : 'Consultez le rappel envoye par votre enseignant.',
      type: 'info',
      action: {
        kind: 'exam_reminder',
        reminderTitle: item.reminderTitle || this.buildReminderTitle(targetExam),
        reminderBody: message,
        courseId: item.courseId,
        courseName: targetExam?.course,
      },
    });
  }

  isStudentSelected(studentId: string): boolean {
    return this.selectedStudents.includes(studentId);
  }

  allStudentsSelected(): boolean {
    const students = this.selectedExam?.studentsAtRisk || [];
    return students.length > 0 && this.selectedStudents.length === students.length;
  }

  private loadReminderData(): void {
    this.loading = true;
    this.errorMessage = '';

    const query = this.teacherEmail
      ? `?${new URLSearchParams({ teacherEmail: this.teacherEmail }).toString()}`
      : '';
    Promise.all([
      firstValueFrom(this.http.get<TeacherExamRemindersResponse>('/auth/teacher-exam-reminders').pipe(timeout(15000))).catch(() => null),
      firstValueFrom(this.http.get<TeacherCourseMembersResponse>('/auth/teacher-course-members').pipe(timeout(15000))).catch(() => null),
      firstValueFrom(this.http.get<TeacherContentItem[]>(`/api/contents${query}`).pipe(timeout(15000))).catch(() => []),
    ])
      .then(([remindersResponse, studentResponse, contents]) => {
        const backendExams = Array.isArray(remindersResponse?.data?.exams)
          ? remindersResponse!.data!.exams!
          : [];
        const students = Array.isArray(studentResponse?.data?.students)
          ? studentResponse!.data!.students!
          : Array.isArray(remindersResponse?.data?.students)
            ? remindersResponse!.data!.students!
            : [];
        this.teacherContents = Array.isArray(contents) ? contents : [];
        const baseExams =
          backendExams.length > 0
            ? backendExams
            : this.buildUpcomingExams(this.teacherContents, students);
        this.upcomingExams = baseExams.map(exam => ({
          ...exam,
          remindersSent: this.resolveReminderCount(exam),
        }));
        this.refreshHistoryReadStates();
        this.tryOpenRequestedStudentReminder();
        this.loading = false;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.upcomingExams = [];
        this.loading = false;
        this.errorMessage = "Impossible de charger les rappels de cet enseignant.";
        this.cdr.detectChanges();
      });
  }

  private tryOpenRequestedStudentReminder(): void {
    const requestedStudent = this.pendingRequestedStudentReminder;
    if (!requestedStudent || this.upcomingExams.length === 0) {
      return;
    }

    const requestedTopics = Array.isArray(requestedStudent.selectedTopics)
      ? requestedStudent.selectedTopics
      : [];
    const targetExam = this.buildRequestedReminderExam(requestedStudent, requestedTopics);

    if (!targetExam) {
      return;
    }

    this.openReminderDialog(targetExam);
    const matchingStudent = targetExam.studentsAtRisk.find(student =>
      student.id === requestedStudent.id ||
      student.email.toLowerCase() === requestedStudent.email.toLowerCase(),
    );

    this.selectedStudents = matchingStudent ? [matchingStudent.id] : [];
    this.lockedReminderStudent = requestedStudent;
    this.lockedReminderTopics = this.filterTopicsForExam(targetExam, requestedTopics);
    this.reminderMessage = this.buildReminderMessage(targetExam, this.lockedReminderTopics);
    this.pendingRequestedStudentReminder = null;
  }

  private buildRequestedReminderExam(
    requestedStudent: RequestedStudentReminder,
    requestedTopics: string[],
  ): ExamReminder | undefined {
    const examsForStudent = this.upcomingExams.filter(exam =>
      exam.studentsAtRisk.some(student =>
        student.id === requestedStudent.id ||
        student.email.toLowerCase() === requestedStudent.email.toLowerCase(),
      ),
    );
    const matches = examsForStudent
      .map(exam => ({
        exam,
        topics: this.filterTopicsForExam(exam, requestedTopics),
      }))
      .filter(match => match.topics.length > 0);

    if (matches.length <= 1) {
      return matches[0]?.exam || examsForStudent[0];
    }

    const studentRows = matches
      .flatMap(match => match.exam.studentsAtRisk)
      .filter((student, index, rows) =>
        rows.findIndex(candidate => candidate.email.toLowerCase() === student.email.toLowerCase()) === index,
      );
    const emails = [
      ...new Set(matches.flatMap(match => match.exam.studentEmails)),
    ];

    return {
      id: matches.map(match => match.exam.id).join('__'),
      course: 'Plusieurs matieres',
      courseIds: matches.map(match => match.exam.id),
      courseNames: matches.map(match => match.exam.course),
      date: matches[0].exam.date,
      time: matches[0].exam.time,
      location: matches[0].exam.location,
      chapters: matches.flatMap(match => match.topics),
      studentsCount: Math.max(...matches.map(match => match.exam.studentsCount)),
      studentEmails: emails,
      remindersSent: 0,
      studentsAtRisk: studentRows,
    };
  }

  private filterTopicsForExam(exam: ExamReminder, topics: string[]): string[] {
    const examChapterKeys = new Set(exam.chapters.map(chapter => this.normalizeReference(chapter)));
    return topics.filter(topic => {
      const topicKey = this.normalizeReference(topic);
      return Array.from(examChapterKeys).some(chapterKey =>
        topicKey === chapterKey || topicKey.startsWith(`${chapterKey} /`),
      );
    });
  }

  private buildUpcomingExams(contents: TeacherContentItem[], students: TeacherStudent[]): ExamReminder[] {
    const courseMap = new Map<
      string,
      {
        course: string;
        chapters: Map<string, string>;
        dueDates: string[];
        visibleToAllClasses: boolean;
        visibleToClasses: Set<string>;
      }
    >();

    contents.forEach(item => {
      const courseName = String(item.courseId || '').trim();
      if (!courseName) {
        return;
      }

      if (!courseMap.has(courseName)) {
        courseMap.set(courseName, {
          course: courseName,
          chapters: new Map<string, string>(),
          dueDates: [],
          visibleToAllClasses: false,
          visibleToClasses: new Set<string>(),
        });
      }

      const current = courseMap.get(courseName)!;
      const chapterKey = String(item.chapterId || '').trim();
      if (this.normalizeType(item.type) === 'chapter') {
        const resolvedKey = String(item._id || item.id || chapterKey).trim();
        const resolvedLabel = String(item.title || chapterKey || resolvedKey).trim();
        if (resolvedKey || resolvedLabel) {
          current.chapters.set(resolvedKey || resolvedLabel, resolvedLabel || resolvedKey);
        }
      } else if (chapterKey && !current.chapters.has(chapterKey)) {
        current.chapters.set(chapterKey, chapterKey);
      }

      const dueDateCandidate = String(item.dueDateTime || item.dueDate || '').trim();
      if (dueDateCandidate) {
        current.dueDates.push(dueDateCandidate);
      }

      if (item.visibleToAllClasses === true) {
        current.visibleToAllClasses = true;
      }

      (Array.isArray(item.visibleToClasses) ? item.visibleToClasses : []).forEach(className => {
        const normalized = String(className || '').trim();
        if (normalized) {
          current.visibleToClasses.add(normalized);
        }
      });
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from(courseMap.values())
      .map(course => {
        const chapters = Array.from(course.chapters.values()).sort((left, right) =>
          left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
        );
        const targetStudents = students.filter(student => {
          const studentClass = String(student.className || '').trim();
          if (course.visibleToAllClasses || course.visibleToClasses.size === 0) {
            return true;
          }

          return course.visibleToClasses.has(studentClass);
        });

        const studentsAtRisk = targetStudents
          .map(student => this.buildStudentRisk(student, course.course, chapters))
          .filter(student => student.missingChapters.length > 0);

        const futureDueDates = course.dueDates.filter(value => {
          const dueDate = new Date(value);
          return !Number.isNaN(dueDate.getTime()) && dueDate >= today;
        });
        const nextDueDate = this.resolveNearestDueDate(
          futureDueDates.length > 0 ? futureDueDates : course.dueDates,
        );

        return {
          id: course.course,
          course: course.course,
          date: this.formatExamDate(nextDueDate),
          time: this.formatExamTime(nextDueDate),
          location: 'A definir',
          chapters,
          studentsCount: targetStudents.length,
          studentEmails: targetStudents.map(student => student.email),
          remindersSent: Number(this.reminderStorage.sentByExamId[course.course] || 0),
          studentsAtRisk,
        } satisfies ExamReminder;
      })
      .sort((left, right) => left.course.localeCompare(right.course, undefined, { sensitivity: 'base' }));
  }

  private buildStudentRisk(
    student: TeacherStudent,
    courseName: string,
    chapters: string[],
  ): CourseReminderStudent {
    const courseContents = this.resolveCourseContentsForStudent(student, courseName);
    const materialItems = courseContents.filter(item => this.isTrackableMaterialForReminder(item));
    const completedContentIds = this.resolveCompletedContentIds(student);
    const totalContents = materialItems.length;
    const completedContents = materialItems.filter(item =>
      completedContentIds.has(this.contentIdentity(item)),
    ).length;
    const chapterStatuses = this.resolveChapterStatuses(courseContents, chapters, student);
    const totalChapters = chapterStatuses.length;
    const completedChapters = chapterStatuses.filter(chapter => chapter.isCompleted).length;
    const missingChapters = chapterStatuses
      .filter(chapter => !chapter.isCompleted)
      .map(chapter => chapter.label);

    if (totalChapters === 0) {
      return {
        id: student.id,
        name: student.fullName,
        email: student.email,
        progress: 100,
        completedContents,
        totalContents,
        missingChapters: [],
      };
    }

    const progress =
      totalContents > 0
        ? Math.round((completedContents / totalContents) * 100)
        : Math.round((completedChapters / totalChapters) * 100);

    return {
      id: student.id,
      name: student.fullName,
      email: student.email,
      progress,
      completedContents,
      totalContents,
      missingChapters,
    };
  }

  private resolveCourseContentsForStudent(
    student: TeacherStudent,
    courseName: string,
  ): TeacherContentItem[] {
    return this.teacherContents.filter(item => {
      if (item.isActive === false) {
        return false;
      }

      const itemCourseName = this.normalizeReference(item.courseId);
      if (!itemCourseName || itemCourseName !== this.normalizeReference(courseName)) {
        return false;
      }

      return this.isContentVisibleToStudent(item, student);
    });
  }

  private resolveChapterStatuses(
    courseContents: TeacherContentItem[],
    fallbackChapterLabels: string[],
    student: TeacherStudent,
  ): Array<{ key: string; label: string; isCompleted: boolean }> {
    const materialItems = courseContents.filter(item => this.isTrackableMaterialForReminder(item));
    const completedContentIds = this.resolveCompletedContentIds(student);
    const chapterTitleById = new Map<string, string>();

    courseContents
      .filter(item => this.normalizeType(item.type) === 'chapter')
      .forEach(chapter => {
        const id = this.contentIdentity(chapter);
        const rawChapterId = String(chapter.chapterId || '').trim();
        const title = String(chapter.title || rawChapterId || id).trim();
        if (id && title) {
          chapterTitleById.set(this.normalizeReference(id), title);
        }
        if (rawChapterId && title) {
          chapterTitleById.set(this.normalizeReference(rawChapterId), title);
        }
      });

    const chapterMap = new Map<string, TeacherContentItem[]>();

    materialItems.forEach(item => {
      const rawChapter = String(item.chapterId || '').trim();
      const chapterLabel =
        chapterTitleById.get(this.normalizeReference(rawChapter)) || rawChapter;
      if (!chapterLabel) {
        return;
      }

      if (!chapterMap.has(chapterLabel)) {
        chapterMap.set(chapterLabel, []);
      }

      chapterMap.get(chapterLabel)!.push(item);
    });

    const chapterLabels =
      chapterMap.size > 0
        ? Array.from(chapterMap.keys())
        : fallbackChapterLabels.filter(Boolean);

    return chapterLabels.map(chapterLabel => {
      const chapterMaterials = chapterMap.get(chapterLabel) || [];
      const isCompleted =
        chapterMaterials.length === 0 ||
        chapterMaterials.every(item => completedContentIds.has(this.contentIdentity(item)));

      return {
        key: chapterLabel,
        label: chapterLabel,
        isCompleted,
      };
    });
  }

  private resolveCompletedContentIds(student: TeacherStudent): Set<string> {
    return new Set(
      (Array.isArray(student.learningProgress) ? student.learningProgress : [])
        .filter(entry => {
          const status = String(entry?.status || '').trim().toLowerCase();
          return status === 'completed' || status === 'passed';
        })
        .map(entry => String(entry?.contentId || '').trim())
        .filter(Boolean),
    );
  }

  private isContentVisibleToStudent(item: TeacherContentItem, student: TeacherStudent): boolean {
    if (item.visibleToAllClasses === true) {
      return true;
    }

    const visibleClasses = (Array.isArray(item.visibleToClasses) ? item.visibleToClasses : [])
      .map(className => String(className || '').trim())
      .filter(Boolean);

    if (visibleClasses.length === 0) {
      return true;
    }

    const studentClass = String(student.className || '').trim();
    return visibleClasses.includes(studentClass);
  }

  private isTrackableMaterial(type?: string): boolean {
    const normalizedType = this.normalizeType(type);
    return normalizedType === 'document' || normalizedType === 'video' || normalizedType === 'quiz';
  }

  private isTrackableMaterialForReminder(item: TeacherContentItem): boolean {
    if (!this.isTrackableMaterial(item.type)) {
      return false;
    }

    if (this.normalizeType(item.type) !== 'quiz') {
      return true;
    }

    return !Array.isArray(item.quizQuestions) || item.quizQuestions.length > 0;
  }

  private normalizeType(value?: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeReference(value?: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private referencesMatch(
    sourceValue?: string,
    ...candidateValues: Array<string | undefined>
  ): boolean {
    const normalizedSource = this.normalizeReference(sourceValue);
    if (!normalizedSource) {
      return false;
    }

    return candidateValues.some(candidate => this.normalizeReference(candidate) === normalizedSource);
  }

  private contentIdentity(item: TeacherContentItem): string {
    return String(item._id || item.id || '').trim();
  }

  private buildReminderMessage(exam: ExamReminder, selectedTopics: string[] = []): string {
    const topics = selectedTopics.length > 0 ? selectedTopics : exam.chapters;
    return (
      `Rappel : Examen de ${exam.course} le ${exam.date}\n\n` +
      `Merci de terminer les chapitres / parties suivants :\n${topics.join('\n')}\n\n` +
      `Certains d'entre vous n'ont pas encore complete tous les chapitres. Merci de les terminer pour ameliorer vos chances de reussite.\n\n` +
      `Bon courage dans vos revisions !`
    );
  }

  private buildReminderTitle(exam?: ExamReminder | null): string {
    if ((exam?.courseIds || []).length > 1) {
      return 'Rappel d examen';
    }

    return exam?.course ? `Rappel d examen - ${exam.course}` : 'Rappel d examen';
  }

  private resolveReminderTargetEmails(exam: ExamReminder): string[] {
    const atRiskEmails = exam.studentsAtRisk.map(student => student.email);
    const enrolledEmails = Array.isArray(exam.studentEmails) ? exam.studentEmails : [];

    return [...new Set([...atRiskEmails, ...enrolledEmails].map(email => String(email || '').trim()).filter(Boolean))];
  }

  private refreshHistoryReadStates(): void {
    if (this.reminderHistory.length === 0) {
      return;
    }

    this.reminderHistory.forEach(item => {
      const emails = Array.isArray(item.emails) ? item.emails : [];
      const title = String(item.reminderTitle || '').trim();
      if (emails.length === 0 || !title) {
        return;
      }

      const params = new URLSearchParams({
        emails: emails.join(','),
        title,
      });

      this.http.get<any>(`/notifications/read-state?${params.toString()}`).subscribe({
        next: response => {
          if (response?.data?.allRead === true) {
            item.status = 'lu';
            this.reminderStorage.history = this.reminderHistory;
            this.persistReminderStorage();
          }
        },
        error: () => undefined,
      });
    });
  }

  private resolveReminderCount(exam: ExamReminder): number {
    const courseIds = exam.courseIds?.length ? exam.courseIds : [exam.id];
    return Math.max(0, Number(exam.remindersSent || 0)) + courseIds.reduce(
      (total, courseId) => total + Number(this.reminderStorage.sentByExamId[courseId] || 0),
      0,
    );
  }

  private resolveTeacherEmail(): string {
    const tokenEmail = localStorage.getItem('current_user_email') || '';
    return String(tokenEmail).trim().toLowerCase();
  }

  private reminderStorageKey(): string {
    return this.teacherEmail
      ? `teacher-exam-reminders-${this.teacherEmail}`
      : 'teacher-exam-reminders';
  }

  private restoreReminderStorage(): void {
    try {
      const raw = localStorage.getItem(this.reminderStorageKey());
      if (!raw) {
        this.reminderHistory = [];
        return;
      }

      const parsed = JSON.parse(raw) as ReminderStorageState;
      this.reminderStorage = {
        sentByExamId: parsed?.sentByExamId || {},
        history: Array.isArray(parsed?.history)
          ? parsed.history.map(item => ({
              ...item,
              status: item.status === 'lu' ? 'lu' : 'non_lu',
              emails: Array.isArray(item.emails) ? item.emails : [],
            }))
          : [],
      };
      this.reminderHistory = this.reminderStorage.history;
    } catch {
      this.reminderStorage = { sentByExamId: {}, history: [] };
      this.reminderHistory = [];
    }
  }

  private persistReminderStorage(): void {
    localStorage.setItem(this.reminderStorageKey(), JSON.stringify(this.reminderStorage));
  }

  private resolveNearestDueDate(values: string[]): string {
    const parsedDates = values
      .map(value => new Date(value))
      .filter(date => !Number.isNaN(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());

    return parsedDates[0]?.toISOString() || '';
  }

  private formatExamDate(value: string): string {
    if (!value) {
      return 'Date non definie';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Date non definie';
    }

    return parsed.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  private formatExamTime(value: string): string {
    if (!value) {
      return 'Heure non definie';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Heure non definie';
    }

    const hours = parsed.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${hours}`;
  }

}
