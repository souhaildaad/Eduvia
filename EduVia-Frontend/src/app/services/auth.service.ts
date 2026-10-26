import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { SessionLockService } from './session-lock.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = this.resolveApiUrl();

  private tokenKey = 'auth_token';
  private refreshTokenKey = 'refresh_token';

  constructor(
    private http: HttpClient,
    private sessionLockService: SessionLockService,
  ) {}

  private resolveApiUrl(): string {
    return '/auth';
  }

  // ────────────────────────────────────────────────
  // Connexion
  // ────────────────────────────────────────────────
  login(email: string, password: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/login`, { email, password }).pipe(
      tap(response => {
        if (response?.success && response?.data?.access_token) {
          this.storeTokens(response.data.access_token, response.data.refresh_token);
        }
      }),
      catchError(this.handleError('login'))
    );
  }

  // ────────────────────────────────────────────────
  // Déconnexion
  // ────────────────────────────────────────────────
  logout(): Observable<any> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      this.clearTokens();
      return of({ success: true, message: 'Déconnexion réussie (aucun token trouvé)' });
    }

    return this.http.post<any>(`${this.apiUrl}/logout`, { refresh_token: refreshToken }).pipe(
      tap(() => this.clearTokens()),
      catchError(err => {
        this.clearTokens();
        return of({ success: true, message: 'Déconnexion locale effectuée' });
      })
    );
  }

  // ────────────────────────────────────────────────
  // Rafraîchissement du token
  // ────────────────────────────────────────────────
  refreshToken(): Observable<any> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return throwError(() => new Error('Aucun refresh token disponible'));
    }

    return this.http.post<any>(`${this.apiUrl}/refresh`, { refresh_token: refreshToken }).pipe(
      tap(response => {
        const data = response?.data || response || {};
        if (data?.access_token) {
          this.storeTokens(data.access_token, data.refresh_token || refreshToken);
        }
      }),
      catchError(this.handleError('refreshToken'))
    );
  }

  loginWithFaceId(faceHash: string, role?: 'teacher' | 'student' | 'admin' | null): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/face-id/login`, {
      faceHash,
      role: role === 'teacher' || role === 'student' ? role : undefined,
    }).pipe(
      tap(response => {
        if (response?.success && response?.data?.access_token) {
          this.storeTokens(response.data.access_token, response.data.refresh_token || '');
        }
      }),
      catchError(this.handleError('loginWithFaceId'))
    );
  }

  // ────────────────────────────────────────────────
  // Vérification token
  // ────────────────────────────────────────────────
  verifyToken(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/verify`).pipe(
      catchError(this.handleError('verifyToken'))
    );
  }

  // ────────────────────────────────────────────────
  // Statut du mot de passe
  // ────────────────────────────────────────────────
   // ====================== FRONTEND - auth.service.ts ======================
  getPasswordStatus(): Observable<{ needsPasswordChange: boolean; blocked: boolean }> {
    return this.http.get<any>(`${this.apiUrl}/password-status`).pipe(
      map(response => {
        const data = response?.data || response || {};
        return {
          needsPasswordChange: !!data.needsPasswordChange,
          blocked: !!data.blocked,
        };
      }),
      catchError((err: HttpErrorResponse) => {
        console.warn('getPasswordStatus failed', err);

        // Le popup ne doit apparaitre que si l'API le confirme explicitement.
        // En cas d'erreur, on n'affiche rien.
        return of({
          needsPasswordChange: false,
          blocked: false,
        });
      })
    );
  }

  // ────────────────────────────────────────────────
  // Changement de mot de passe (classique + forcé)
  // ────────────────────────────────────────────────
  changePassword(payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    captchaAnswer: string;
    isNotRobot: boolean;
    updateKeycloak?: boolean;
    updateDatabase?: boolean;
    disableTemporaryPasswordBlock?: boolean;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/change-password`, payload).pipe(
      catchError(this.handleError('changePassword'))
    );
  }

  validateCurrentPassword(payload: {
    currentPassword: string;
  }): Observable<{
    valid: boolean;
    canUseAsCurrentPassword: boolean;
    unlockNewPasswordFields: boolean;
    message?: string;
  }> {
    return this.http.post<any>(`${this.apiUrl}/validate-current-password`, payload).pipe(
      map((response) => {
        const data = response?.data || response || {};
        return {
          valid: !!data.valid,
          canUseAsCurrentPassword: !!data.canUseAsCurrentPassword,
          unlockNewPasswordFields: !!data.unlockNewPasswordFields,
          message: data.message,
        };
      }),
      catchError(this.handleError('validateCurrentPassword'))
    );
  }

  requestPasswordReset(payload: {
    email: string;
    role: 'teacher' | 'student';
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/forgot-password`, payload).pipe(
      catchError(this.handleError('requestPasswordReset'))
    );
  }

  validatePasswordResetToken(token: string): Observable<{
    valid: boolean;
    role: 'teacher' | 'student';
    email: string;
    name: string;
  }> {
    return this.http.get<any>(`${this.apiUrl}/reset-password/validate`, {
      params: { token }
    }).pipe(
      map((response) => {
        const data = response?.data || response || {};
        return {
          valid: !!data.valid,
          role: data.role,
          email: data.email,
          name: data.name,
        };
      }),
      catchError(this.handleError('validatePasswordResetToken'))
    );
  }

  resetForgottenPassword(payload: {
    token: string;
    newPassword: string;
    confirmPassword: string;
    captchaAnswer: string;
    isNotRobot: boolean;
    updateKeycloak?: boolean;
    updateDatabase?: boolean;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/reset-password`, payload).pipe(
      catchError(this.handleError('resetForgottenPassword'))
    );
  }

  // ────────────────────────────────────────────────
  // Profil utilisateur
  // ────────────────────────────────────────────────
  getProfile(): Observable<any> {
    if (!this.getToken()) {
      return of({ data: {} });
    }

    return this.http.get<any>(`${this.apiUrl}/profile`).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401) {
          return of({ data: {} });
        }

        return this.handleError('getProfile')(err);
      })
    );
  }

  updateProfile(profileData: any): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/profile`, profileData).pipe(
      catchError(this.handleError('updateProfile'))
    );
  }

  updateStudentLevel(level: 'debutant' | 'intermediaire' | 'avance', assessmentResult?: any): Observable<any> {
    return this.http.post<any>('/api/student/level', { level, assessmentResult }).pipe(
      catchError(this.handleError('updateStudentLevel'))
    );
  }

  // ────────────────────────────────────────────────
  // Gestion des utilisateurs (Admin)
  // ────────────────────────────────────────────────
  getUsers(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/users`).pipe(
      catchError(this.handleError('getUsers'))
    );
  }

  createUser(userData: {
    name?: string;
    email: string;
    role: 'teacher' | 'student';
    password?: string;
    username: string;
    firstName?: string;
    lastName?: string;
    className?: string;
    assignedClasses?: string[];
    teachingSubjects?: string[];
    teachingAssignments?: { subject: string; classes: string[] }[];
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/users`, userData).pipe(
      catchError(this.handleError('createUser'))
    );
  }

  resendVerificationEmail(userId: number | string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/users/${userId}/resend-verification`, {}).pipe(
      catchError(this.handleError('resendVerificationEmail'))
    );
  }

  enrollFaceId(faceHash: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/face-id/enroll`, { faceHash }).pipe(
      catchError(this.handleError('enrollFaceId'))
    );
  }

  updateUser(
    userId: number | string,
    userData: {
      name?: string;
      email: string;
      role: 'teacher' | 'student';
      username?: string;
      firstName?: string;
      lastName?: string;
      className?: string;
      assignedClasses?: string[];
      teachingSubjects?: string[];
      teachingAssignments?: { subject: string; classes: string[] }[];
    }
  ): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/users/${userId}`, userData).pipe(
      catchError(this.handleError('updateUser'))
    );
  }

  getStudentClasses(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/student-classes`).pipe(
      catchError(this.handleError('getStudentClasses'))
    );
  }

  deleteUser(userId: number | string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/users/${userId}`).pipe(
      catchError(this.handleError('deleteUser'))
    );
  }

  // ────────────────────────────────────────────────
  // Gestion des tokens
  // ────────────────────────────────────────────────
  isLoggedIn(): boolean {
    return this.sessionLockService.canUseAuthenticatedSession() && !this.isTokenExpired();
  }

  getToken(): string | null {
    if (!this.sessionLockService.canUseAuthenticatedSession()) {
      return null;
    }

    return sessionStorage.getItem(this.tokenKey);
  }

  getDecodedTokenPayload(): Record<string, any> | null {
    const token = this.getToken();
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

  getRoleFromStoredToken(): 'student' | 'teacher' | 'admin' | null {
    const payload = this.getDecodedTokenPayload();
    if (!payload) {
      return null;
    }

    const roleCandidates = [
      ...(Array.isArray(payload['realm_access']?.roles) ? payload['realm_access'].roles : []),
      ...(Array.isArray(payload['roles']) ? payload['roles'] : []),
      payload['role'],
    ]
      .filter(Boolean)
      .map((value: string) => value.toString().trim().toLowerCase());

    return roleCandidates.find((value) =>
      ['student', 'teacher', 'admin'].includes(value),
    ) as 'student' | 'teacher' | 'admin' | null;
  }

  isTokenExpired(): boolean {
    const payload = this.getDecodedTokenPayload();
    if (!payload?.['exp']) {
      return !this.getToken();
    }

    const expirationMs = Number(payload['exp']) * 1000;
    return Number.isNaN(expirationMs) || Date.now() >= expirationMs;
  }

  private getRefreshToken(): string | null {
    if (!this.sessionLockService.canUseAuthenticatedSession()) {
      return null;
    }

    return sessionStorage.getItem(this.refreshTokenKey);
  }

  hasRefreshToken(): boolean {
    return !!this.getRefreshToken();
  }

  private storeTokens(accessToken: string, refreshToken: string): void {
    sessionStorage.setItem(this.tokenKey, accessToken);
    sessionStorage.setItem(this.refreshTokenKey, refreshToken);
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.refreshTokenKey);
  }

  clearTokens(): void {
    sessionStorage.removeItem(this.tokenKey);
    sessionStorage.removeItem(this.refreshTokenKey);
    sessionStorage.removeItem('role');
    sessionStorage.removeItem('current_user_email');
    sessionStorage.removeItem('current_user_class');
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.refreshTokenKey);
  }

  // ────────────────────────────────────────────────
  // Gestion des erreurs
  // ────────────────────────────────────────────────
  private handleError(operation = 'operation') {
    return (error: HttpErrorResponse): Observable<never> => {
      const isExpectedLoginFailure = operation === 'login' && error.status === 401;
      const isExpectedFaceLoginFailure =
        operation === 'loginWithFaceId' && (error.status === 401 || error.status === 404);
      const isExpectedVerifyFailure = operation === 'verifyToken' && error.status === 401;

      if (!isExpectedLoginFailure && !isExpectedFaceLoginFailure && !isExpectedVerifyFailure) {
        console.error(`${operation} failed:`, error);
      }

      return throwError(() => error);
    };
  }
} 
