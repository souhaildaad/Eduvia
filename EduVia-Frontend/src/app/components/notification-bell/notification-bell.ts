import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotificationItem, NotificationService } from '../../services/notification.service';
import { VoicePlaybackService } from '../../services/voice-playback.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatCheckboxModule,
  ],
  templateUrl: './notification-bell.html',
  styleUrls: ['./notification-bell.css'],
})
export class NotificationBell implements OnInit, OnDestroy {
  notifications: NotificationItem[] = [];
  showDropdown = false;
  showDialog = false;
  selectedNotification: NotificationItem | null = null;
  captchaPrompt = '';
  captchaResult = 0;
  isLoading = false;
  formSubmitted = false;
  screenReaderMessage = '';
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;
  readonly passwordRequirements = [
    { key: 'lowercase', label: 'au moins 1 lettre minuscule' },
    { key: 'uppercase', label: 'au moins 1 lettre majuscule' },
    { key: 'special', label: 'au moins 1 caractere speciale' },
    { key: 'length', label: 'au minimum 8 caracteres' },
  ] as const;
  passwordForm: FormGroup;

  private destroy$ = new Subject<void>();
  private syncIntervalId: number | null = null;
  private readonly handleStorageSync = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith('app_notifications')) {
      this.notificationService.syncCurrentUserNotifications();
    }
  };

  constructor(
    private notificationService: NotificationService,
    private authService: AuthService,
    private fb: FormBuilder,
    private voicePlaybackService: VoicePlaybackService
  ) {
    this.passwordForm = this.fb.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, this.strongPasswordValidator.bind(this)]],
      confirmPassword: [{ value: '', disabled: true }, Validators.required],
      captchaAnswer: ['', Validators.required],
      isNotRobot: [false, Validators.requiredTrue],
    }, { validators: [this.passwordMatchValidator.bind(this), this.captchaValidator.bind(this)] });
  }

  ngOnInit() {
    this.notificationService.syncCurrentUserNotifications();
    this.notificationService.notifications$
      .pipe(takeUntil(this.destroy$))
      .subscribe((notifications) => {
        this.notifications = notifications;
      });

    this.syncIntervalId = window.setInterval(() => this.notificationService.syncCurrentUserNotifications(), 30000);

    window.addEventListener('storage', this.handleStorageSync);
    this.generateCaptcha();
  }

  ngOnDestroy() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    window.removeEventListener('storage', this.handleStorageSync);
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleDropdown() {
    this.notificationService.syncCurrentUserNotifications();
    this.showDropdown = !this.showDropdown;
  }

  closeDropdown() {
    this.showDropdown = false;
  }

  deleteNotification(notificationId: number | string) {
    this.notificationService.removeNotification(notificationId);
  }

  markNotificationAsRead(notification: NotificationItem) {
    if (notification.read) {
      return;
    }

    this.notificationService.markNotificationAsRead(notification.id);
    this.selectedNotification = {
      ...notification,
      read: true,
    };
    this.closeDialog();
  }

  consultNotification(notification: NotificationItem) {
    if (notification.action?.kind === 'forum_request' || notification.action?.kind === 'forum_chat') {
      localStorage.setItem(
        'eduvia_forum_consult_action',
        JSON.stringify({
          requestId: notification.action.requestId,
          openChat: notification.action.kind === 'forum_chat',
          ts: Date.now(),
        }),
      );
      window.dispatchEvent(
        new CustomEvent('eduvia-forum-open', {
          detail: {
            requestId: notification.action.requestId,
            openChat: notification.action.kind === 'forum_chat',
          },
        }),
      );
      this.showDropdown = false;
      return;
    }

    if (this.isExamReminderNotification(notification)) {
      this.selectedNotification = notification;
      this.showDialog = true;
      this.showDropdown = false;
      return;
    }

    if (notification.action?.kind === 'planner_reminder') {
      this.notificationService.markNotificationAsRead(notification.id);
      window.dispatchEvent(new CustomEvent('eduvia-planner-open', {
        detail: { eventId: notification.action.eventId },
      }));
      this.showDropdown = false;
      return;
    }

    if (notification.action?.kind === 'meet_session') {
      const normalizedTitle = String(notification.title || '').toLowerCase();
      const audience =
        notification.action.audience ||
        (normalizedTitle.includes('professeur') ? 'teacher' : 'student');
      this.notificationService.markNotificationAsRead(notification.id);
      window.dispatchEvent(
        new CustomEvent('eduvia-meet-open', {
          detail: {
            requestId: notification.action.requestId,
            audience,
          },
        }),
      );
      this.showDropdown = false;
      return;
    }

    this.selectedNotification = notification;
    this.showDialog = true;
    this.showDropdown = false;
    this.resetDialog();
  }

  closeDialog() {
    this.showDialog = false;
    this.selectedNotification = null;
    this.resetDialog();
  }

  isExamReminderNotification(notification: NotificationItem | null): boolean {
    if (!notification) {
      return false;
    }

    if (notification.action?.kind === 'exam_reminder') {
      return true;
    }

    const normalizedTitle = String(notification.title || '').trim().toLowerCase();
    return normalizedTitle === 'rappel d examen';
  }

  isMeetNotification(notification: NotificationItem | null): boolean {
    return notification?.action?.kind === 'meet_session';
  }

  isDetailNotification(notification: NotificationItem | null): boolean {
    return this.isExamReminderNotification(notification) || this.isMeetNotification(notification) ||
      notification?.action?.kind === 'planner_reminder' || !this.isPasswordChangeNotification(notification);
  }

  isPasswordChangeNotification(notification: NotificationItem | null): boolean {
    return String(notification?.title || '').trim().toLowerCase() === 'changement de mot de passe requis';
  }

  generateCaptcha() {
    const left = Math.floor(Math.random() * 8) + 2;
    const right = Math.floor(Math.random() * 8) + 1;
    this.captchaResult = left + right;
    this.captchaPrompt = `${left} + ${right} =`;
  }

  togglePasswordVisibility(field: 'current' | 'new' | 'confirm') {
    if (field === 'current') {
      this.showCurrentPassword = !this.showCurrentPassword;
      return;
    }

    if (field === 'new') {
      this.showNewPassword = !this.showNewPassword;
      return;
    }

    this.showConfirmPassword = !this.showConfirmPassword;
  }

  announceField(field: 'currentPassword' | 'newPassword' | 'confirmPassword' | 'captcha') {
    let message = '';

    if (field === 'currentPassword') {
      message = 'Saisir votre ancien mot de passe.';
    } else if (field === 'newPassword') {
      message = 'Saisir votre nouveau mot de passe. Minimum 8 caracteres.';
    } else if (field === 'confirmPassword') {
      message = 'Confirmer votre nouveau mot de passe.';
    } else {
      message = `Verification anti robot. Cochez la case je ne suis pas un robot puis resoudre l operation suivante : ${this.captchaPrompt}`;
    }

    this.voicePlaybackService.toggle(`notification-bell:${field}`, message);
    this.screenReaderMessage = message;
  }

  isVoiceFieldActive(field: 'currentPassword' | 'newPassword' | 'confirmPassword' | 'captcha'): boolean {
    return this.voicePlaybackService.isActive(`notification-bell:${field}`);
  }

  get isSaveEnabled(): boolean {
    const requiredControls = ['currentPassword', 'newPassword', 'confirmPassword', 'captchaAnswer', 'isNotRobot'];
    const allControlsTouched = requiredControls.every((controlName) => this.passwordForm.get(controlName)?.touched);
    return this.passwordForm.valid && allControlsTouched && !this.isLoading;
  }

  get unreadCount(): number {
    return this.notifications.filter(notification => !notification.read).length;
  }

  get newPasswordRequirementState(): Record<string, boolean> {
    const password = String(this.passwordForm.get('newPassword')?.value || '');
    return {
      lowercase: /[a-z]/.test(password),
      uppercase: /[A-Z]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
      length: password.length >= 8,
    };
  }

  get allNewPasswordRequirementsMet(): boolean {
    const requirementState = this.newPasswordRequirementState;
    return Object.values(requirementState).every(Boolean);
  }

  get showPasswordMismatchError(): boolean {
    return !!this.passwordForm.hasError('passwordMismatch') && !!this.passwordForm.get('confirmPassword')?.touched;
  }

  get showCaptchaError(): boolean {
    return !!this.passwordForm.hasError('captchaMismatch') && !!this.passwordForm.get('captchaAnswer')?.touched;
  }

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const form = control as FormGroup;
    const newPassword = form.get('newPassword')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;

    if (!newPassword || !confirmPassword || newPassword === confirmPassword) {
      return null;
    }

    return { passwordMismatch: true };
  }

  strongPasswordValidator(control: AbstractControl): ValidationErrors | null {
    const password = String(control.value || '');

    if (!password) {
      return null;
    }

    const errors: ValidationErrors = {};

    if (!/[a-z]/.test(password)) {
      errors['missingLowercase'] = true;
    }
    if (!/[A-Z]/.test(password)) {
      errors['missingUppercase'] = true;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      errors['missingSpecial'] = true;
    }
    if (password.length < 8) {
      errors['minlength'] = true;
    }

    return Object.keys(errors).length ? errors : null;
  }

  captchaValidator(control: AbstractControl): ValidationErrors | null {
    const form = control as FormGroup;
    const rawAnswer = form.get('captchaAnswer')?.value?.toString().trim();

    if (!rawAnswer) {
      return null;
    }

    const answer = Number(rawAnswer);
    return !Number.isNaN(answer) && answer === this.captchaResult ? null : { captchaMismatch: true };
  }

  savePassword() {
    this.formSubmitted = true;
    this.passwordForm.markAllAsTouched();
    this.passwordForm.updateValueAndValidity();

    if (!this.isSaveEnabled) {
      return;
    }

    this.isLoading = true;
    this.passwordForm.setErrors(null);

    this.authService.changePassword({
      currentPassword: this.passwordForm.get('currentPassword')?.value,
      newPassword: this.passwordForm.get('newPassword')?.value,
      confirmPassword: this.passwordForm.get('confirmPassword')?.value,
      captchaAnswer: this.passwordForm.get('captchaAnswer')?.value,
      isNotRobot: this.passwordForm.get('isNotRobot')?.value,
      updateKeycloak: true,
      updateDatabase: true,
      disableTemporaryPasswordBlock: true,
    }).subscribe({
      next: () => {
        this.isLoading = false;
        if (this.selectedNotification) {
          this.notificationService.removeNotification(this.selectedNotification.id);
        }
        this.closeDialog();
      },
      error: (err: any) => {
        this.isLoading = false;
        this.passwordForm.setErrors({
          ...(this.passwordForm.errors || {}),
          serverError:
            err?.status === 401
              ? 'Votre session a expire. Reconnectez-vous puis reessayez.'
              : err?.error?.message || 'Erreur lors du changement de mot de passe',
        });
      },
    });
  }

  private speakText(text: string) {
    this.voicePlaybackService.speak(text);
  }

  private resetDialog() {
    this.formSubmitted = false;
    this.screenReaderMessage = '';
    this.showCurrentPassword = false;
    this.showNewPassword = false;
    this.showConfirmPassword = false;
    this.passwordForm.reset({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      captchaAnswer: '',
      isNotRobot: false,
    });
    this.passwordForm.get('confirmPassword')?.disable({ emitEvent: false });
    this.generateCaptcha();
    this.passwordForm.updateValueAndValidity();
  }

  onNewPasswordInput() {
    const confirmControl = this.passwordForm.get('confirmPassword');

    if (!confirmControl) {
      return;
    }

    if (this.allNewPasswordRequirementsMet) {
      confirmControl.enable({ emitEvent: false });
    } else {
      confirmControl.reset('', { emitEvent: false });
      confirmControl.disable({ emitEvent: false });
    }

    this.passwordForm.updateValueAndValidity({ emitEvent: false });
  }
}
