import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from './services/auth.service';
import { NotificationService } from './services/notification.service';
import { SessionLockService } from './services/session-lock.service';

import { RoleSelection } from './components/role-selection/role-selection';
import { StudentDashboard } from './components/student-dashboard/student-dashboard';
import { TeacherDashboard } from './components/teacher-dashboard/teacher-dashboard';
import { AdminDashboard } from './components/admin/admin-dashboard/admin-dashboard';
import { Login } from './components/login/login';
import { AiAssessment } from './components/student/ai-assessment/ai-assessment';

type UserRole = 'student' | 'teacher' | 'admin' | null;
type PublicAuthScreen = 'login' | 'forgot-password' | 'reset-password';
type StudentLevel = 'debutant' | 'intermediaire' | 'avance';
const pendingLoginRoleKey = 'eduvia_pending_login_role';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    RoleSelection,
    StudentDashboard,
    TeacherDashboard,
    AdminDashboard,
    Login,
    AiAssessment,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, OnDestroy {
  userRole = signal<UserRole>(null);
  selectedRole = signal<UserRole>(null);
  publicAuthScreen = signal<PublicAuthScreen>('login');
  loginErrorMessage = signal<string | null>(null);
  transientNotificationMessage = signal<string | null>(null);
  resetToken = signal<string | null>(null);
  resetEmail = signal<string | null>(null);
  resetUserName = signal<string | null>(null);
  isInitializing = signal(true);
  studentNeedsAssessment = signal(false);
  studentAssessmentLevel = signal<StudentLevel>('debutant');
  private transientNotificationTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private authService: AuthService,
    private notificationService: NotificationService,
    private sessionLockService: SessionLockService,
  ) {}

  ngOnInit() {
    this.resetState();
    this.applyRoleFromUrl();
    if (this.resetToken()) {
      // Reset links arrive without a role query parameter; the API supplies it after token validation.
      this.selectedRole.set('student');
      this.validateResetFlow(this.resetToken()!);
      return;
    }
    this.restoreSession();
  }

  ngOnDestroy() {
    this.clearTransientNotification();
  }

  private resetState() {
    this.userRole.set(null);
    this.selectedRole.set(null);
    this.publicAuthScreen.set('login');
    this.loginErrorMessage.set(null);
    this.transientNotificationMessage.set(null);
    this.resetToken.set(null);
    this.resetEmail.set(null);
    this.resetUserName.set(null);
  }

  onRoleSelected(role: UserRole) {
    this.selectedRole.set(role);
    this.publicAuthScreen.set('login');
    this.loginErrorMessage.set(null);
    this.syncUrl(role);
  }

  onLogin(event: { role: 'student' | 'teacher' | 'admin' | null; email: string; password: string }) {
    this.loginErrorMessage.set(null);

    if (this.sessionLockService.hasActiveForeignSession()) {
      this.userRole.set(null);
      this.selectedRole.set(event.role);
      this.publicAuthScreen.set('login');
      this.loginErrorMessage.set(
        'Une session EduVia est deja ouverte dans un autre onglet. Fermez cet autre onglet puis reessayez.'
      );
      this.isInitializing.set(false);
      this.syncUrl(event.role);
      return;
    }

    this.authService.login(event.email, event.password).subscribe({
      next: (res: any) => {
        const data = res?.data || res;
        const role = data?.user?.role || data?.role || event.role;
        const roleNormalized = role?.toString().trim().toLowerCase() as UserRole;
        const expectedRole = event.role;
        const currentUser = data?.user || {};

        if (!roleNormalized) {
          this.authService.clearTokens();
          this.loginErrorMessage.set('Role introuvable dans la reponse du serveur.');
          return;
        }

        if (expectedRole && roleNormalized !== expectedRole) {
          const roleLabel =
            roleNormalized === 'admin'
              ? 'administrateur'
              : roleNormalized === 'teacher'
                ? 'enseignant'
                : 'etudiant';

          this.authService.clearTokens();
          this.loginErrorMessage.set(
            `Ces identifiants appartiennent a un compte ${roleLabel}. Utilisez l'interface de connexion correspondante.`
          );
          return;
        }

        localStorage.setItem('role', roleNormalized);
        localStorage.setItem('current_user_email', event.email.trim().toLowerCase());
        this.sessionLockService.tryAcquire();
        this.notificationService.syncCurrentUserNotifications();
        if (roleNormalized === 'student') {
          localStorage.setItem('current_user_class', this.formatStudentClassName(currentUser?.className || ''));
        }
        localStorage.removeItem(pendingLoginRoleKey);
        this.userRole.set(roleNormalized);
        this.selectedRole.set(null);

        if (roleNormalized === 'student') {
          this.refreshStoredStudentClass();
          this.prepareStudentAssessmentGate(currentUser);
        }

        if (roleNormalized !== 'admin') {
          this.checkPasswordStatus();
        } else {
          this.announceLoginSuccess(roleNormalized, false);
        }
      },
      error: (err: any) => {
        this.authService.clearTokens();
        this.userRole.set(null);
        this.selectedRole.set(event.role);
        this.publicAuthScreen.set('login');
        this.syncUrl(event.role);
        const backendMessage =
          typeof err?.error === 'string'
            ? err.error
            : err?.error?.message || err?.error?.error || err?.message;
        this.loginErrorMessage.set(
          backendMessage || 'Echec de connexion. Verifiez votre email et votre mot de passe.'
        );
      }
    });
  }

  onFaceLogin(event: { role: 'student' | 'teacher' | 'admin' | null; faceHash: string }) {
    this.loginErrorMessage.set(null);

    if (this.sessionLockService.hasActiveForeignSession()) {
      this.userRole.set(null);
      this.selectedRole.set(event.role);
      this.publicAuthScreen.set('login');
      this.loginErrorMessage.set(
        'Une session EduVia est deja ouverte dans un autre onglet. Fermez cet autre onglet puis reessayez.'
      );
      this.isInitializing.set(false);
      this.syncUrl(event.role);
      return;
    }

    this.authService.loginWithFaceId(event.faceHash, event.role).subscribe({
      next: (res: any) => {
        const data = res?.data || res;
        const role = data?.user?.role || data?.role || event.role;
        const roleNormalized = role?.toString().trim().toLowerCase() as UserRole;
        const expectedRole = event.role;
        const currentUser = data?.user || {};

        if (!roleNormalized) {
          this.authService.clearTokens();
          this.loginErrorMessage.set('Role introuvable dans la reponse du serveur.');
          return;
        }

        if (expectedRole && roleNormalized !== expectedRole) {
          this.authService.clearTokens();
          this.loginErrorMessage.set(
            "Ce Face ID appartient a un autre type de compte. Utilisez l'interface correspondante."
          );
          return;
        }

        localStorage.setItem('role', roleNormalized);
        localStorage.setItem('current_user_email', String(currentUser?.email || '').trim().toLowerCase());
        this.sessionLockService.tryAcquire();
        this.notificationService.syncCurrentUserNotifications();
        if (roleNormalized === 'student') {
          localStorage.setItem('current_user_class', this.formatStudentClassName(currentUser?.className || ''));
        }
        localStorage.removeItem(pendingLoginRoleKey);
        this.userRole.set(roleNormalized);
        this.selectedRole.set(null);

        if (roleNormalized === 'student') {
          this.refreshStoredStudentClass();
          this.prepareStudentAssessmentGate(currentUser);
        }

        if (roleNormalized !== 'admin') {
          this.checkPasswordStatus();
        } else {
          this.announceLoginSuccess(roleNormalized, false);
        }
      },
      error: (err: any) => {
        this.authService.clearTokens();
        this.userRole.set(null);
        this.selectedRole.set(event.role);
        this.publicAuthScreen.set('login');
        this.syncUrl(event.role);
        const backendMessage =
          typeof err?.error === 'string'
            ? err.error
            : err?.error?.message || err?.error?.error || err?.message;
        this.loginErrorMessage.set(
          backendMessage || 'Face ID non reconnu. Utilisez la connexion classique.'
        );
      }
    });
  }

  dismissTransientNotification() {
    this.clearTransientNotification();
  }

  onAssessmentCompleted(result: {
    level: StudentLevel;
    levelLabel: string;
    score: number;
    correctCount: number;
    totalQuestions: number;
    strengths: string[];
    weaknesses: string[];
    recommendation: string;
    completedAt: string;
  }) {
    const email = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
    this.studentAssessmentLevel.set(result.level);
    localStorage.setItem(this.assessmentStorageKey(email), JSON.stringify(result));
    localStorage.setItem(this.studentLevelStorageKey(email), result.level);
    this.studentNeedsAssessment.set(false);
    this.authService.updateStudentLevel(result.level, result).subscribe({
      error: () => {
        // Le stockage local garde le dashboard coherent si le profil est momentanement indisponible.
      },
    });
  }

  onForgotPasswordRequested() {
    if (this.selectedRole() === 'teacher' || this.selectedRole() === 'student') {
      this.publicAuthScreen.set('forgot-password');
      this.loginErrorMessage.set(null);
      this.syncUrl(this.selectedRole());
    }
  }

  onBackToLogin() {
    this.publicAuthScreen.set('login');
    this.loginErrorMessage.set(null);
    this.resetToken.set(null);
    this.resetEmail.set(null);
    this.resetUserName.set(null);
    this.syncUrl(this.selectedRole());
  }

  onResetCompleted() {
    this.publicAuthScreen.set('login');
    this.loginErrorMessage.set('Mot de passe reinitialise avec succes. Connectez-vous avec votre nouveau mot de passe.');
    this.resetToken.set(null);
    this.resetEmail.set(null);
    this.resetUserName.set(null);
    this.syncUrl(this.selectedRole());
  }

  private checkPasswordStatus() {
    const role = this.userRole()?.toString().trim().toLowerCase();
    if (role === 'admin') {
      return;
    }

    this.authService.getPasswordStatus().subscribe({
      next: (status) => {
        this.announceLoginSuccess(this.userRole(), status.needsPasswordChange === true && !status.blocked);
        if (status.needsPasswordChange === true && !status.blocked) {
          this.showPasswordWarning();
        }
      },
      error: (err) => console.warn('getPasswordStatus error:', err)
    });
  }

  private showPasswordWarning() {
    const message = 'Votre acces sera bloque apres 24 heures si vous ne changerez pas votre mot de passe.';

    this.notificationService.addNotification({
      title: 'Changement de mot de passe requis',
      message,
      type: 'warning'
    });

    this.transientNotificationMessage.set(message);
    if (this.transientNotificationTimeout) {
      clearTimeout(this.transientNotificationTimeout);
    }
    this.transientNotificationTimeout = setTimeout(() => {
      this.transientNotificationMessage.set(null);
      this.transientNotificationTimeout = null;
    }, 5000);
  }

  private announceLoginSuccess(role: UserRole, shouldWarnAboutPassword: boolean) {
    const welcomeMessage = 'Bienvenue sur EduVia, vous avez accede a votre interface.';

    if (role === 'admin') {
      this.speakText(welcomeMessage);
      return;
    }

    if ((role === 'student' || role === 'teacher') && shouldWarnAboutPassword) {
      this.speakText(`${welcomeMessage} Votre acces sera bloque apres 24 heures si vous ne changerez pas votre mot de passe.`);
      return;
    }

    if (role === 'student' || role === 'teacher') {
      this.speakText(welcomeMessage);
    }
  }

  onLogout() {
    this.authService.logout().subscribe({
      next: () => this.finalizeLogout(),
      error: () => this.finalizeLogout()
    });
  }

  private finalizeLogout() {
    this.sessionLockService.release();
    this.authService.clearTokens();
    this.notificationService.clearNotifications();
    this.clearTransientNotification();
    localStorage.removeItem('role');
    localStorage.removeItem('current_user_email');
    localStorage.removeItem('current_user_class');
    this.studentNeedsAssessment.set(false);
    window.history.replaceState({}, '', window.location.pathname);
    this.resetState();
    this.isInitializing.set(false);
  }

  private applyRoleFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    const resetToken = params.get('resetToken') || params.get('token');
    const verified = params.get('verified');
    const message = params.get('message');
    const role = urlRole === 'student' || urlRole === 'teacher' || urlRole === 'admin' ? urlRole : null;

    if (role === 'student' || role === 'teacher' || role === 'admin') {
      this.selectedRole.set(role);
      localStorage.setItem(pendingLoginRoleKey, role);
    } else {
      localStorage.removeItem(pendingLoginRoleKey);
    }

    if (resetToken) {
      this.resetToken.set(resetToken);
    }

    if (verified === '1') {
      const successMessage =
        message || 'Email verifie avec succes. Vous pouvez maintenant vous connecter.';
      this.transientNotificationMessage.set(successMessage);
      this.loginErrorMessage.set(null);
    }

    if (verified === '0') {
      this.loginErrorMessage.set(message || 'Echec de verification de l email.');
      this.transientNotificationMessage.set(null);
    }
  }

  private restoreSession(refreshAttempted = false) {
    const storedRole =
      this.authService.getRoleFromStoredToken() ||
      (localStorage.getItem('role') as UserRole);

    if (storedRole && !this.sessionLockService.tryAcquire()) {
      this.userRole.set(null);
      this.selectedRole.set(storedRole);
      this.publicAuthScreen.set('login');
      this.loginErrorMessage.set(null);
      this.isInitializing.set(false);
      this.syncUrl(storedRole);
      return;
    }

    if (!this.authService.isLoggedIn() || !storedRole) {
      if (!refreshAttempted && this.authService.hasRefreshToken()) {
        this.authService.refreshToken().subscribe({
          next: () => this.restoreSession(true),
          error: () => {
            this.authService.clearTokens();
            if (this.selectedRole() && this.resetToken()) {
              this.validateResetFlow(this.resetToken()!);
              return;
            }
            this.isInitializing.set(false);
          },
        });
        return;
      }

      if (this.selectedRole() && this.resetToken()) {
        this.validateResetFlow(this.resetToken()!);
        return;
      }
      this.isInitializing.set(false);
      return;
    }

    this.userRole.set(storedRole);
    this.selectedRole.set(null);
    this.loginErrorMessage.set(null);
    localStorage.setItem('role', storedRole);
    this.isInitializing.set(false);

    if (storedRole !== 'admin') {
      if (storedRole === 'student') {
        this.refreshStoredStudentClass();
        this.prepareStudentAssessmentGate();
      }
      this.checkPasswordStatus();
    }
  }

  private prepareStudentAssessmentGate(currentUser?: any) {
    const email = (localStorage.getItem('current_user_email') || String(currentUser?.email || '')).trim().toLowerCase();
    const storedLevel = localStorage.getItem(this.studentLevelStorageKey(email));
    if (storedLevel === 'debutant' || storedLevel === 'intermediaire' || storedLevel === 'avance') {
      this.studentAssessmentLevel.set(storedLevel);
    }

    const localResult = localStorage.getItem(this.assessmentStorageKey(email));
    const completedFromUser =
      currentUser?.profileData?.initialAssessmentCompleted === true ||
      currentUser?.profileData?.initialAssessment;
    this.studentNeedsAssessment.set(!localResult && !completedFromUser);
  }

  private assessmentStorageKey(email: string) {
    return email ? `eduvia-initial-level-test-${email}` : 'eduvia-initial-level-test';
  }

  private studentLevelStorageKey(email: string) {
    return email ? `eduvia-student-level-${email}` : 'eduvia-student-level';
  }

  private refreshStoredStudentClass() {
    this.authService.getProfile().subscribe({
      next: (response: any) => {
        const profile = response?.data || response || {};
        const className = this.resolveStudentClassName(profile);
        localStorage.setItem('current_user_class', className);
        const email = (localStorage.getItem('current_user_email') || String(profile?.email || '')).trim().toLowerCase();
        const profileLevel = profile?.level;
        if (profileLevel === 'debutant' || profileLevel === 'intermediaire' || profileLevel === 'avance') {
          this.studentAssessmentLevel.set(profileLevel);
          localStorage.setItem(this.studentLevelStorageKey(email), profileLevel);
        }
        if (profile?.initialAssessmentCompleted === true || profile?.initialAssessment) {
          localStorage.setItem(
            this.assessmentStorageKey(email),
            JSON.stringify(profile.initialAssessment || { completedAt: new Date().toISOString(), level: this.studentAssessmentLevel() }),
          );
          this.studentNeedsAssessment.set(false);
        }
      },
      error: () => {
        // Keep the last known value in local storage when the profile endpoint is temporarily unavailable.
      }
    });
  }

  private resolveStudentClassName(profile: any): string {
    const candidates = [
      profile?.className,
      profile?.studentClass,
      profile?.class,
      profile?.classe,
      profile?.user?.className,
      Array.isArray(profile?.classes) ? profile.classes[0] : undefined,
      Array.isArray(profile?.assignedClasses) ? profile.assignedClasses[0] : undefined,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return this.formatStudentClassName(value);
      }
    }

    return '';
  }

  private formatStudentClassName(value: string): string {
    return value.trim().replace(/[a-z]/, (letter) => letter.toUpperCase());
  }

  private clearTransientNotification() {
    if (this.transientNotificationTimeout) {
      clearTimeout(this.transientNotificationTimeout);
      this.transientNotificationTimeout = null;
    }
    this.transientNotificationMessage.set(null);
  }

  private speakText(text: string) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = 1;
      utterance.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  }

  private validateResetFlow(token: string) {
    this.authService.validatePasswordResetToken(token).subscribe({
      next: (data) => {
        if (!data.valid || (data.role !== 'student' && data.role !== 'teacher')) {
          this.selectedRole.set('student');
          this.publicAuthScreen.set('login');
          this.resetToken.set(null);
          this.loginErrorMessage.set('Le lien de reinitialisation est invalide ou expire.');
          this.isInitializing.set(false);
          this.syncUrl('student');
          return;
        }
        this.selectedRole.set(data.role);
        this.resetEmail.set(data.email);
        this.resetUserName.set(data.name);
        this.publicAuthScreen.set('reset-password');
        this.isInitializing.set(false);
        this.syncUrl(data.role, token);
      },
      error: () => {
        this.publicAuthScreen.set('login');
        this.resetToken.set(null);
        this.resetEmail.set(null);
        this.resetUserName.set(null);
        this.loginErrorMessage.set('Le lien de reinitialisation est invalide ou expire.');
        this.isInitializing.set(false);
        this.syncUrl(this.selectedRole());
      }
    });
  }

  private syncUrl(role: UserRole, resetToken?: string | null) {
    const params = new URLSearchParams();
    if (role) {
      params.set('role', role);
    }
    if (resetToken) {
      params.set('resetToken', resetToken);
    }
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
  }
}
