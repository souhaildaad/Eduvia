import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { delay } from 'rxjs';

type StudentCourse = {
  name: string;
  progress: number;
  lastQuizScore: number;
  weakTopics: string[];
  summary?: string;
};

type StudentStatus = 'excellent' | 'good' | 'at-risk' | 'critical';

type TrackedStudent = {
  id: string;
  name: string;
  email: string;
  level: string;
  overallProgress: number;
  levelProgress: number;
  levelProgressSummary: string;
  status: StudentStatus;
  courses: StudentCourse[];
  learningStyle: string;
  lastActivity: string;
  avatarDataUrl?: string;
};

type ReminderTopicSelection = {
  id: string;
  name: string;
  email: string;
  className: string;
  selectedTopics: string[];
};

type TeacherCourseMembersResponse = {
  success?: boolean;
  data?: {
    classes?: string[];
    selectedClass?: string;
    totalStudents?: number;
    students?: Array<{
      id: string;
      fullName: string;
      email: string;
      className: string;
      avatarDataUrl?: string;
      lastActivityAt?: string | null;
      globalProgress?: number;
      levelProgress?: number;
      quizProgressDetails?: {
        attemptedQuizzes?: number;
        totalQuizzes?: number;
        averageAttemptScore?: number;
      };
      pendingContentScopes?: string[];
      progressDetails?: {
        completedMaterials?: number;
        totalMaterials?: number;
        completedCourses?: number;
        totalCourses?: number;
        completedUnits?: number;
        totalUnits?: number;
      };
    }>;
  };
};

@Component({
  selector: 'app-student-tracking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  templateUrl: './student-tracking.html',
  styleUrls: ['./student-tracking.css'],
})
export class StudentTracking implements OnInit {
  @Input() showAtRiskOnly = false;

  @Output() reminderRequested = new EventEmitter<ReminderTopicSelection>();

  searchQuery = '';
  selectedClass = 'all';
  selectedStudent: TrackedStudent | null = null;
  reminderTopicStudent: TrackedStudent | null = null;
  selectedReminderTopics: string[] = [];
  showDetailDialog = false;
  showReminderTopicDialog = false;
  loading = true;
  errorMessage = '';

  classOptions: { value: string; label: string }[] = [{ value: 'all', label: 'Toutes les classes' }];
  students: TrackedStudent[] = [];

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    setTimeout(() => this.loadTrackedStudents(), 0);
  }

  get filteredStudents(): TrackedStudent[] {
    const query = this.normalizeSearchText(this.searchQuery);

    return this.students.filter(student => {
      const matchesQuery =
        !query ||
        this.normalizeSearchText(student.name).includes(query);

      const matchesClass =
        this.selectedClass === 'all' ||
        student.level.toLowerCase() === this.selectedClass.toLowerCase();
      const matchesRisk =
        !this.showAtRiskOnly ||
        student.status === 'at-risk' ||
        student.status === 'critical';

      return matchesQuery && matchesClass && matchesRisk;
    });
  }

  onSearchChange(value: string): void {
    this.searchQuery = value || '';
  }

  get atRiskStudentsCount(): number {
    return this.filteredStudents.filter(
      student => student.status === 'at-risk' || student.status === 'critical',
    ).length;
  }

  openStudentDetails(student: TrackedStudent): void {
    this.selectedStudent = student;
    this.showDetailDialog = true;
  }

  closeStudentDetails(): void {
    this.showDetailDialog = false;
    this.selectedStudent = null;
  }

  requestReminderForSelectedStudent(): void {
    if (!this.selectedStudent) {
      return;
    }

    const topics = this.allWeakTopics(this.selectedStudent);
    this.reminderTopicStudent = this.selectedStudent;
    this.selectedReminderTopics = [...topics];
    this.showReminderTopicDialog = true;
  }

  closeReminderTopicDialog(): void {
    this.showReminderTopicDialog = false;
    this.reminderTopicStudent = null;
    this.selectedReminderTopics = [];
  }

  confirmReminderTopicSelection(): void {
    if (!this.reminderTopicStudent || this.selectedReminderTopics.length === 0) {
      return;
    }

    this.reminderRequested.emit({
      id: this.reminderTopicStudent.id,
      name: this.reminderTopicStudent.name,
      email: this.reminderTopicStudent.email,
      className: this.reminderTopicStudent.level,
      selectedTopics: this.selectedReminderTopics,
    });
    this.closeReminderTopicDialog();
    this.closeStudentDetails();
  }

  allWeakTopics(student: TrackedStudent): string[] {
    return [...new Set(student.courses.flatMap(course => course.weakTopics))];
  }

  toggleReminderTopic(topic: string): void {
    if (this.selectedReminderTopics.includes(topic)) {
      this.selectedReminderTopics = this.selectedReminderTopics.filter(item => item !== topic);
      return;
    }

    this.selectedReminderTopics = [...this.selectedReminderTopics, topic];
  }

  isReminderTopicSelected(topic: string): boolean {
    return this.selectedReminderTopics.includes(topic);
  }

  toggleAllReminderTopics(): void {
    const topics = this.reminderTopicStudent ? this.allWeakTopics(this.reminderTopicStudent) : [];
    this.selectedReminderTopics =
      this.selectedReminderTopics.length === topics.length ? [] : [...topics];
  }

  trackCourse(_: number, course: StudentCourse): string {
    return course.name;
  }

  statusLabel(status: StudentStatus): string {
    switch (status) {
      case 'excellent':
        return 'Excellent';
      case 'good':
        return 'Bon niveau';
      case 'at-risk':
        return 'A surveiller';
      case 'critical':
        return 'Critique';
      default:
        return status;
    }
  }

  statusIcon(status: StudentStatus): string {
    switch (status) {
      case 'excellent':
        return 'trending_up';
      case 'good':
        return 'check_circle';
      case 'at-risk':
        return 'warning';
      case 'critical':
        return 'cancel';
      default:
        return 'info';
    }
  }

  statusClass(status: StudentStatus): string {
    return `status-badge--${status}`;
  }

  hasWeakTopics(student: TrackedStudent): boolean {
    return student.courses.some(course => course.weakTopics.length > 0);
  }

  limitedWeakTopics(student: TrackedStudent): string[] {
    return student.courses.flatMap(course => course.weakTopics).slice(0, 3);
  }

  progressWidth(progress: number): string {
    return `${progress}%`;
  }

  progressClass(progress: number): string {
    if (progress >= 75) {
      return 'progress-fill--good';
    }
    if (progress >= 50) {
      return 'progress-fill--medium';
    }

    return 'progress-fill--low';
  }

  studentInitials(student: TrackedStudent): string {
    const parts = String(student.name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length === 0) {
      return 'E';
    }

    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }

    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }

  onClassChange(value: string): void {
    this.selectedClass = String(value || 'all').trim() || 'all';
    this.loadTrackedStudents();
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  loadTrackedStudents(): void {
    this.loading = true;
    this.errorMessage = '';

    const query = this.selectedClass !== 'all' ? `?className=${encodeURIComponent(this.selectedClass)}` : '';

    this.http
      .get<TeacherCourseMembersResponse>(`/auth/teacher-course-members${query}`)
      .pipe(delay(0))
      .subscribe({
        next: response => {
          const data = response?.data || {};
          const classes = Array.isArray(data.classes) ? data.classes : [];
          const students = Array.isArray(data.students) ? data.students : [];

          this.classOptions = [
            { value: 'all', label: 'Toutes les classes' },
            ...classes.map(className => ({
              value: String(className || '').trim(),
              label: String(className || '').trim(),
            })),
          ];

          this.students = students.map(student => this.toTrackedStudent(student));
          this.loading = false;
        },
        error: () => {
          this.students = [];
          this.loading = false;
          this.errorMessage = "Impossible de charger les etudiants de cet enseignant.";
        },
      });
  }

  private toTrackedStudent(student: {
    id: string;
    fullName: string;
    email: string;
    className: string;
    avatarDataUrl?: string;
    lastActivityAt?: string | null;
    globalProgress?: number;
    levelProgress?: number;
    quizProgressDetails?: {
      attemptedQuizzes?: number;
      totalQuizzes?: number;
      averageAttemptScore?: number;
    };
    pendingContentScopes?: string[];
    progressDetails?: {
      completedMaterials?: number;
      totalMaterials?: number;
      completedCourses?: number;
      totalCourses?: number;
      completedUnits?: number;
      totalUnits?: number;
    };
  }): TrackedStudent {
    const level = String(student.className || 'Classe non definie').trim() || 'Classe non definie';
    const details = student.progressDetails || {};
    const overallProgress = Math.max(
      0,
      Math.min(100, Number(student.globalProgress || 0)),
    );
    const levelProgress = Math.max(
      0,
      Math.min(100, Number(student.levelProgress || 0)),
    );
    const quizProgressDetails = student.quizProgressDetails || {};
    const attemptedQuizzes = Math.max(0, Number(quizProgressDetails.attemptedQuizzes || 0));
    const totalQuizzes = Math.max(0, Number(quizProgressDetails.totalQuizzes || 0));
    const levelProgressSummary = totalQuizzes > 0
      ? `${attemptedQuizzes} quiz realise(s) sur ${totalQuizzes}`
      : 'Aucun quiz disponible';
    const completedMaterials = Math.max(0, Number(details.completedMaterials || 0));
    const totalMaterials = Math.max(0, Number(details.totalMaterials || 0));
    const completedCourses = Math.max(0, Number(details.completedCourses || 0));
    const totalCourses = Math.max(0, Number(details.totalCourses || 0));
    const completedUnits = Math.max(0, Number(details.completedUnits || 0));
    const totalUnits = Math.max(0, Number(details.totalUnits || 0));
    const weakTopics: string[] = [];
    const pendingContentScopes = Array.isArray(student.pendingContentScopes)
      ? student.pendingContentScopes
          .map((value: string) => String(value || '').trim())
          .filter(Boolean)
      : [];

    weakTopics.push(...pendingContentScopes);

    return {
      id: String(student.id || ''),
      name: String(student.fullName || student.email || 'Etudiant'),
      email: String(student.email || '').trim().toLowerCase(),
      level,
      overallProgress,
      levelProgress,
      levelProgressSummary,
      status: this.progressStatus(overallProgress),
      courses: [
        {
          name: `Classe ${level}`,
          progress: overallProgress,
          lastQuizScore: overallProgress,
          weakTopics,
          summary:
            totalUnits > 0
              ? `${completedUnits} element(s) termines sur ${totalUnits}`
              : 'Aucun contenu disponible',
        },
      ],
      learningStyle:
        overallProgress >= 75
          ? 'Rythme d apprentissage stable'
          : overallProgress >= 50
            ? 'Progression a renforcer'
            : 'Accompagnement recommande',
      lastActivity: this.formatRelativeTime(student.lastActivityAt),
      avatarDataUrl: String(student.avatarDataUrl || '').trim(),
    };
  }

  private progressStatus(progress: number): StudentStatus {
    if (progress >= 90) {
      return 'excellent';
    }
    if (progress >= 75) {
      return 'good';
    }
    if (progress >= 50) {
      return 'at-risk';
    }

    return 'critical';
  }

  private formatRelativeTime(value?: string | null): string {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
      return "Activite recente indisponible";
    }

    const target = new Date(rawValue).getTime();
    if (Number.isNaN(target)) {
      return "Activite recente indisponible";
    }

    const diffInMinutes = Math.floor((Date.now() - target) / 60000);
    if (diffInMinutes <= 0) {
      return "A l'instant";
    }
    if (diffInMinutes < 60) {
      return `Il y a ${diffInMinutes} min`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `Il y a ${diffInHours} heure${diffInHours > 1 ? 's' : ''}`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    return `Il y a ${diffInDays} jour${diffInDays > 1 ? 's' : ''}`;
  }
}
