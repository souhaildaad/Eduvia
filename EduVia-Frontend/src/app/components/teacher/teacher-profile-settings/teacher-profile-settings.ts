import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { delay, finalize, Subscription } from 'rxjs';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { AuthService } from '../../../services/auth.service';
import { VoiceDictationService } from '../../../services/voice-dictation.service';
import { VoicePlaybackService } from '../../../services/voice-playback.service';

interface ProfileData {
  fullName: string;
  email: string;
  phone: string;
  birthdate: string;
  specialization: string;
  address: string;
  bio: string;
  avatarDataUrl: string;
}

interface ProfileFormValue {
  fullName: string;
  email: string;
  phone: string;
  birthdate: string | Date | null;
  specialization: string;
  address: string;
  bio: string;
  avatarDataUrl: string;
}

@Component({
  selector: 'app-teacher-profile-settings',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTabsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatSnackBarModule,
  ],
  templateUrl: './teacher-profile-settings.html',
  styleUrls: ['./teacher-profile-settings.css'],
  standalone: true,
})
export class TeacherProfileSettingsComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('faceEnrollVideo') faceEnrollVideo?: ElementRef<HTMLVideoElement>;
  selectedTab = 0;
  birthdateInputMode: 'manual' | 'calendar' | null = null;
  readonly steps = ['Mise a jour du profil', 'Securite', 'Face ID', 'Apercu du profil'];
  profileForm: FormGroup;
  securityForm: FormGroup;
  screenReaderMessage = '';
  isLoading = false;
  savedProfile: ProfileData | null = null;
  photoPreviewUrl = '';
  securityLoading = false;
  validatingCurrentPassword = false;
  currentPasswordValidated = false;
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;
  currentPasswordStatusMessage = '';
  currentPasswordStatusType: 'success' | 'error' | '' = '';
  securityFormSubmitted = false;
  securityCaptchaPrompt = '';
  securityCaptchaResult = 0;
  faceIdEnabled = false;
  faceIdLoading = false;
  faceIdCameraActive = false;
  faceIdCameraReady = false;
  faceIdMessage = '';
  faceIdMessageType: 'info' | 'success' | 'error' = 'info';
  private faceIdStream: MediaStream | null = null;
  readonly passwordRequirements = [
    { key: 'lowercase', label: 'au moins 1 lettre minuscule' },
    { key: 'uppercase', label: 'au moins 1 lettre majuscule' },
    { key: 'special', label: 'au moins 1 caractere speciale' },
    { key: 'length', label: 'au minimum 8 caracteres' },
  ] as const;
  private formStateSub?: Subscription;
  private newPasswordSub?: Subscription;
  private pendingPasswordValidationTimer: ReturnType<typeof setTimeout> | null = null;
  private lastValidatedPassword = '';

  constructor(
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private auth: AuthService,
    private cdr: ChangeDetectorRef,
    private voiceDictationService: VoiceDictationService,
    private voicePlaybackService: VoicePlaybackService,
  ) {
    this.profileForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['+216', [Validators.required, this.tunisianPhoneValidator]],
      birthdate: [null, [Validators.required, this.birthdateValidator.bind(this)]],
      specialization: ['', [Validators.required, Validators.minLength(2)]],
      address: ['', [Validators.required, Validators.minLength(2)]],
      bio: ['', [Validators.maxLength(500)]],
      avatarDataUrl: [''],
    });

    this.securityForm = this.fb.group(
      {
        currentPassword: ['', Validators.required],
        newPassword: [{ value: '', disabled: true }, [Validators.required, this.strongPasswordValidator.bind(this)]],
        confirmPassword: [{ value: '', disabled: true }, Validators.required],
        captchaAnswer: ['', Validators.required],
        isNotRobot: [false, Validators.requiredTrue],
      },
      { validators: [this.passwordMatchValidator.bind(this), this.securityCaptchaValidator.bind(this)] },
    );
  }

  ngOnInit() {
    const identity = this.getIdentityFromToken();
    if (identity.fullName) {
      this.profileForm.get('fullName')?.setValue(identity.fullName);
    }
    if (identity.email) {
      this.profileForm.get('email')?.setValue(identity.email);
    }

    this.loadProfile(identity);

    this.formStateSub = this.profileForm.statusChanges.subscribe(() => {});
    this.newPasswordSub = this.securityForm.get('newPassword')?.valueChanges.subscribe(() => {
      this.syncConfirmPasswordState();
    });
    this.generateSecurityCaptcha();
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  get saveDisabled(): boolean {
    return this.isLoading || this.profileForm.invalid;
  }

  get initials(): string {
    const fullName = (this.profileForm.get('fullName')?.value || '').trim();
    return fullName ? fullName.charAt(0).toUpperCase() : 'U';
  }

  get profilePayload(): ProfileData {
    const value = this.profileForm.value;
    const identity = this.getIdentityFromToken();
    return {
      fullName: (value.fullName || identity.fullName || '').trim(),
      email: (value.email || identity.email || '').trim().toLowerCase(),
      phone: (value.phone || '').trim(),
      birthdate: this.normalizeBirthdate(value.birthdate),
      specialization: (value.specialization || '').trim(),
      address: (value.address || '').trim(),
      bio: (value.bio || '').trim(),
      avatarDataUrl: value.avatarDataUrl || '',
    };
  }

  onPhoneInput(event: Event) {
    const input = event.target as HTMLInputElement;
    let raw = input.value || '';
    raw = raw.replace(/[^\d+]/g, '');

    if (!raw.startsWith('+216')) {
      raw = '+216' + raw.replace(/\D/g, '');
    }

    const digitsAfterPrefix = raw.replace(/^\+216/, '').replace(/\D/g, '').slice(0, 8);
    const formatted = `+216${digitsAfterPrefix}`;

    this.profileForm.get('phone')?.setValue(formatted, { emitEvent: false });
  }

  onBirthdateBlur() {
    const control = this.profileForm.get('birthdate');
    const rawValue = String(control?.value || '').trim();

    if (!rawValue) {
      this.birthdateInputMode = null;
      control?.setErrors(null);
      return;
    }

    this.birthdateInputMode = 'manual';
    const parsedDate = this.parseBirthdate(control?.value);

    if (parsedDate) {
      control?.setValue(this.formatBirthdateInputValue(parsedDate), { emitEvent: false });
      control?.setErrors(null);
      return;
    }

    if (String(control?.value || '').trim()) {
      control?.setErrors({ ...(control?.errors || {}), invalidBirthdate: true });
    }
  }

  onBirthdateInput(event: Event) {
    if (this.birthdateInputMode === 'calendar') {
      return;
    }

    const input = event.target as HTMLInputElement;
    const formatted = this.formatBirthdateDigits(input.value || '');
    const control = this.profileForm.get('birthdate');

    this.birthdateInputMode = formatted ? 'manual' : null;
    input.value = formatted;
    control?.setValue(formatted, { emitEvent: false });

    if (!formatted) {
      control?.setErrors(null);
      return;
    }

    if (formatted.length === 10 && this.parseBirthdate(formatted)) {
      control?.setErrors(null);
    }
  }

  onBirthdateSelected(value: unknown) {
    const control = this.profileForm.get('birthdate');
    const currentValue = String(control?.value || '').trim();

    if (this.birthdateInputMode === 'manual' && currentValue) {
      return;
    }
    const parsedDate = this.parseBirthdate(value);

    if (parsedDate) {
      this.birthdateInputMode = 'calendar';
      control?.setValue(this.formatBirthdateInputValue(parsedDate), { emitEvent: false });
      control?.setErrors(null);
    }
  }

  clearBirthdate() {
    this.birthdateInputMode = null;
    this.profileForm.get('birthdate')?.setValue('', { emitEvent: false });
    this.profileForm.get('birthdate')?.setErrors(null);
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const isAllowedType = ['image/jpeg', 'image/png', 'image/gif'].includes(file.type);
    if (!isAllowedType) {
      this.snackBar.open('Format invalide. Utilisez JPG, PNG ou GIF.', 'Fermer', {
        duration: 3500,
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.snackBar.open('La photo depasse 2MB.', 'Fermer', { duration: 3500 });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      this.photoPreviewUrl = dataUrl;
      this.profileForm.get('avatarDataUrl')?.setValue(dataUrl);
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  removePhoto() {
    this.photoPreviewUrl = '';
    this.profileForm.get('avatarDataUrl')?.setValue('');
    this.savedProfile = this.savedProfile
      ? {
          ...this.savedProfile,
          avatarDataUrl: '',
        }
      : null;
    this.cdr.detectChanges();
  }

  onSubmit() {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const payload: Partial<ProfileData> = this.profilePayload;
    if ((payload.avatarDataUrl || '') === (this.savedProfile?.avatarDataUrl || '')) {
      delete payload.avatarDataUrl;
    }

    this.auth.updateProfile(payload).pipe(
      delay(0),
      finalize(() => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }),
    ).subscribe({
      next: (response) => {
        const saved = (response?.data || payload) as Partial<ProfileData>;
        this.savedProfile = this.toProfileData({
          ...saved,
          birthdate: this.parseBirthdate(saved.birthdate),
        });
        this.photoPreviewUrl = saved.avatarDataUrl || this.photoPreviewUrl;
        setTimeout(() => {
          this.selectedTab = 2;
          this.cdr.detectChanges();
        }, 0);
        this.snackBar.open('Profil mis a jour avec succes!', 'Fermer', {
          duration: 2500,
          horizontalPosition: 'end',
          verticalPosition: 'top',
          panelClass: ['success-snackbar'],
        });
        this.announceText('Profil mis a jour avec succes.');
      },
      error: (error) => {
        this.snackBar.open(
          error?.error?.message || 'Echec de sauvegarde du profil.',
          'Fermer',
          { duration: 3500 },
        );
      },
    });
  }

  ngOnDestroy() {
    this.clearPendingPasswordValidation();
    this.stopFaceIdCamera();
    this.formStateSub?.unsubscribe();
    this.newPasswordSub?.unsubscribe();
  }

  async startFaceIdCamera() {
    if (this.faceIdCameraActive) {
      return;
    }

    if (this.faceIdEnabled) {
      this.faceIdMessage = 'Face ID est deja enregistre pour ce compte.';
      this.faceIdMessageType = 'info';
      this.announceText(this.faceIdMessage);
      return;
    }

    this.faceIdMessage = '';
    this.faceIdMessageType = 'info';
    this.faceIdCameraReady = false;
    this.announceText('La camera va s ouvrir. Placez votre visage complet au centre du cadre, avec une bonne lumiere, puis cliquez sur enregistrer Face ID.');
    try {
      this.faceIdStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      this.faceIdCameraActive = true;
      setTimeout(() => {
        const video = this.faceEnrollVideo?.nativeElement;
        if (video && this.faceIdStream) {
          video.srcObject = this.faceIdStream;
          video.onloadedmetadata = () => {
            video.play();
          };
          video.oncanplay = () => {
            this.faceIdCameraReady = true;
            this.cdr.detectChanges();
          };
        }
      });
    } catch {
      this.faceIdCameraActive = false;
      this.faceIdCameraReady = false;
      this.faceIdMessage = "Impossible d'ouvrir la camera. Autorisez l'acces camera puis reessayez.";
      this.faceIdMessageType = 'error';
      this.announceText(this.faceIdMessage);
    }
  }

  stopFaceIdCamera() {
    this.faceIdStream?.getTracks().forEach(track => track.stop());
    this.faceIdStream = null;
    this.faceIdCameraActive = false;
    this.faceIdCameraReady = false;
    const video = this.faceEnrollVideo?.nativeElement;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.onloadedmetadata = null;
      video.oncanplay = null;
    }
  }

  captureFaceId() {
    if (this.faceIdEnabled) {
      this.faceIdMessage = 'Face ID est deja enregistre pour ce compte.';
      this.faceIdMessageType = 'info';
      this.announceText(this.faceIdMessage);
      return;
    }

    this.faceIdMessage = "Verification du Face ID en cours...";
    this.faceIdMessageType = 'info';
    this.screenReaderMessage = this.faceIdMessage;

    const video = this.faceEnrollVideo?.nativeElement;
    if (!this.faceIdCameraActive || !this.faceIdCameraReady || !video || video.readyState < 2) {
      this.faceIdMessage = 'Camera non prete. Patientez quelques secondes.';
      this.faceIdMessageType = 'error';
      this.announceText(this.faceIdMessage);
      return;
    }

    const result = this.createFaceHashFromVideo(video);
    if (!result.ok) {
      this.faceIdMessage = result.message;
      this.faceIdMessageType = 'error';
      this.announceText(this.faceIdMessage);
      return;
    }

    this.faceIdLoading = true;
    this.faceIdMessage = "Verification que ce Face ID n'est pas deja associe a un autre compte...";
    this.faceIdMessageType = 'info';
    this.auth.enrollFaceId(result.hash).pipe(delay(0)).subscribe({
      next: () => {
        this.faceIdLoading = false;
        this.faceIdEnabled = true;
        this.stopFaceIdCamera();
        this.faceIdMessage = 'Face ID enregistre avec succes.';
        this.faceIdMessageType = 'success';
        this.announceText(this.faceIdMessage);
        this.cdr.detectChanges();
      },
      error: error => {
        this.faceIdLoading = false;
        this.faceIdMessage = error?.error?.message || "Echec de l'enregistrement Face ID.";
        this.faceIdMessageType = 'error';
        this.announceText(this.faceIdMessage);
        this.cdr.detectChanges();
      },
    });
  }

  onCurrentPasswordInput() {
    this.clearPendingPasswordValidation();
    this.lastValidatedPassword = '';
    this.currentPasswordValidated = false;
    this.currentPasswordStatusMessage = '';
    this.currentPasswordStatusType = '';
    this.disableNewPasswordFields();
  }

  onCurrentPasswordBlur() {
    this.clearPendingPasswordValidation();
    this.pendingPasswordValidationTimer = setTimeout(() => {
      this.pendingPasswordValidationTimer = null;
      this.validateCurrentPassword();
    }, 0);
  }

  onValidateCurrentPasswordClick() {
    this.clearPendingPasswordValidation();
    this.validateCurrentPassword();
  }

  validateCurrentPassword() {
    const control = this.securityForm.get('currentPassword');
    const currentPassword = String(control?.value || '').trim();
    control?.markAsTouched();

    if (this.validatingCurrentPassword) {
      return;
    }

    if (this.currentPasswordValidated && currentPassword && currentPassword === this.lastValidatedPassword) {
      return;
    }

    if (!currentPassword) {
      this.lastValidatedPassword = '';
      this.currentPasswordValidated = false;
      this.currentPasswordStatusMessage = 'L ancien mot de passe est obligatoire.';
      this.currentPasswordStatusType = 'error';
      this.disableNewPasswordFields();
      this.announceText(this.currentPasswordStatusMessage);
      return;
    }

    this.validatingCurrentPassword = true;
    this.currentPasswordStatusMessage = '';
    this.currentPasswordStatusType = '';

    this.auth.validateCurrentPassword({ currentPassword }).pipe(delay(0)).subscribe({
      next: (response) => {
        this.validatingCurrentPassword = false;
        this.currentPasswordValidated = !!response?.valid && !!response?.canUseAsCurrentPassword;
        this.lastValidatedPassword = this.currentPasswordValidated ? currentPassword : '';
        this.currentPasswordStatusMessage = response?.message || 'Ancien mot de passe verifie.';
        this.currentPasswordStatusType = this.currentPasswordValidated ? 'success' : 'error';
        this.announceText(this.currentPasswordStatusMessage);

        if (response?.unlockNewPasswordFields) {
          this.enableNewPasswordFields();
        } else {
          this.disableNewPasswordFields();
        }
      },
      error: (error) => {
        this.validatingCurrentPassword = false;
        this.currentPasswordValidated = false;
        this.lastValidatedPassword = '';
        this.currentPasswordStatusMessage = error?.error?.message || 'Ancien mot de passe incorrect.';
        this.currentPasswordStatusType = 'error';
        this.disableNewPasswordFields();
        this.announceText(this.currentPasswordStatusMessage);
      },
    });
  }

  generateSecurityCaptcha() {
    const left = Math.floor(Math.random() * 8) + 2;
    const right = Math.floor(Math.random() * 8) + 1;
    this.securityCaptchaResult = left + right;
    this.securityCaptchaPrompt = `${left} + ${right} =`;
    this.securityForm.get('captchaAnswer')?.setValue('');
    this.securityForm.updateValueAndValidity();
  }

  get showSecurityPasswordMismatchError(): boolean {
    return !!this.securityForm.hasError('passwordMismatch') && !!this.securityForm.get('confirmPassword')?.touched;
  }

  get showSecurityCaptchaError(): boolean {
    return !!this.securityForm.hasError('captchaMismatch') && !!this.securityForm.get('captchaAnswer')?.touched;
  }

  get canSubmitSecurityForm(): boolean {
    const requiredControls = ['currentPassword', 'newPassword', 'confirmPassword', 'captchaAnswer', 'isNotRobot'];
    const allFilled = requiredControls.every((controlName) => {
      const control = this.securityForm.get(controlName);
      if (!control || control.disabled) {
        return false;
      }

      if (typeof control.value === 'boolean') {
        return control.value === true;
      }

      return String(control.value || '').trim() !== '';
    });

    return this.currentPasswordValidated && allFilled && this.securityForm.valid && !this.securityLoading;
  }

  get newPasswordRequirementState(): Record<string, boolean> {
    const password = String(this.securityForm.get('newPassword')?.value || '');
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

  submitSecurityForm() {
    this.securityFormSubmitted = true;
    this.securityForm.markAllAsTouched();
    this.securityForm.updateValueAndValidity();

    if (!this.canSubmitSecurityForm) {
      return;
    }

    this.securityLoading = true;
    this.securityForm.setErrors(null);

    this.auth.changePassword({
      currentPassword: this.securityForm.get('currentPassword')?.value,
      newPassword: this.securityForm.get('newPassword')?.value,
      confirmPassword: this.securityForm.get('confirmPassword')?.value,
      captchaAnswer: this.securityForm.get('captchaAnswer')?.value,
      isNotRobot: this.securityForm.get('isNotRobot')?.value,
      updateKeycloak: true,
      updateDatabase: true,
      disableTemporaryPasswordBlock: false,
    }).pipe(delay(0)).subscribe({
      next: () => {
        this.securityLoading = false;
        this.securityFormSubmitted = false;
        this.currentPasswordValidated = false;
        this.lastValidatedPassword = '';
        this.currentPasswordStatusMessage = '';
        this.currentPasswordStatusType = '';
        this.securityForm.reset({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
          captchaAnswer: '',
          isNotRobot: false,
        });
        this.disableNewPasswordFields();
        this.generateSecurityCaptcha();
        this.snackBar.open('Mot de passe modifie avec succes!', 'Fermer', {
          duration: 2500,
          horizontalPosition: 'end',
          verticalPosition: 'top',
          panelClass: ['success-snackbar'],
        });
        this.announceText('Mot de passe modifie avec succes.');
      },
      error: (error) => {
        this.securityLoading = false;
        this.securityForm.setErrors({
          ...(this.securityForm.errors || {}),
          serverError:
            error?.status === 401
              ? 'Votre session a expire. Reconnectez-vous puis reessayez.'
              : error?.error?.message || 'Erreur lors du changement de mot de passe',
        });
      },
    });
  }

  announceProfileHelp(topic: string) {
    const messages: Record<string, string> = {
      photoUpload: 'Bouton changer la photo. Il permet de televerser une image JPG, PNG ou GIF de taille maximale 2 megaoctets.',
      fullName: 'Champ nom complet. Saisissez votre nom et prenom complets.',
      email: 'Champ email. Cette adresse email est en lecture seule.',
      phone: 'Champ telephone. Saisissez un numero tunisien au format plus 216 suivi de 8 chiffres.',
      birthdate: 'Champ date de naissance. Vous pouvez saisir la date au format jour mois annee ou la choisir dans le calendrier.',
      specialization: 'Champ specialite. Saisissez votre domaine ou votre specialite.',
      address: 'Champ adresse. Saisissez votre adresse complete.',
      bio: 'Champ biographie. Vous pouvez decrire votre profil en 500 caracteres maximum.',
      saveProfile: 'Bouton sauvegarder. Il enregistre les informations personnelles de votre profil.',
      currentPassword: 'Champ ancien mot de passe. Saisissez votre mot de passe actuel puis utilisez le bouton verifier.',
      validateCurrentPassword: 'Bouton verifier. Il controle que votre ancien mot de passe est correct avant d activer le nouveau mot de passe.',
      newPassword: 'Champ nouveau mot de passe. Il devient actif apres verification de l ancien mot de passe et doit contenir au moins 8 caracteres.',
      confirmPassword: 'Champ confirmer le mot de passe. Saisissez de nouveau le nouveau mot de passe.',
      captcha: 'Verification anti robot. Cochez la case puis saisissez le resultat de l operation affichee.',
      refreshCaptcha: 'Bouton rafraichir captcha. Il genere une nouvelle operation anti robot.',
      confirmSecurity: 'Bouton confirmer. Il enregistre le nouveau mot de passe apres verification complete.',
    };

    const message = messages[topic] || topic;
    this.screenReaderMessage = message;
    this.voicePlaybackService.toggle(`teacher-profile:${topic}`, message);
  }

  isProfileVoiceActive(topic: string): boolean {
    return this.voicePlaybackService.isActive(`teacher-profile:${topic}`);
  }

  toggleProfileDictation(field: 'fullName' | 'phone' | 'birthdate' | 'specialization' | 'address' | 'bio') {
    this.voiceDictationService.toggle(`teacher-profile:${field}`, transcript => {
      const control = this.profileForm.get(field);
      const currentValue = String(control?.value || '');
      control?.setValue(this.mergeDictationText(currentValue, transcript));
      control?.markAsDirty();
      control?.markAsTouched();
    });
  }

  isProfileDictationActive(field: 'fullName' | 'phone' | 'birthdate' | 'specialization' | 'address' | 'bio'): boolean {
    return this.voiceDictationService.isActive(`teacher-profile:${field}`);
  }

  toggleSecurityPasswordVisibility(field: 'currentPassword' | 'newPassword' | 'confirmPassword') {
    if (field === 'currentPassword') {
      this.showCurrentPassword = !this.showCurrentPassword;
      return;
    }

    if (field === 'newPassword') {
      this.showNewPassword = !this.showNewPassword;
      return;
    }

    this.showConfirmPassword = !this.showConfirmPassword;
  }

  isStepCompleted(index: number): boolean {
    return this.selectedTab > index;
  }

  isStepActive(index: number): boolean {
    return this.selectedTab === index;
  }

  private tunisianPhoneValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value || '').trim();
    return /^\+216\d{8}$/.test(value)
      ? null
      : { tunisianPhone: true };
  }

  private birthdateValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;

    if (!value) {
      return null;
    }

    return this.parseBirthdate(value) ? null : { invalidBirthdate: true };
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const form = control as FormGroup;
    const newPassword = form.get('newPassword')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;

    if (!newPassword || !confirmPassword || newPassword === confirmPassword) {
      return null;
    }

    return { passwordMismatch: true };
  }

  private strongPasswordValidator(control: AbstractControl): ValidationErrors | null {
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

  private securityCaptchaValidator(control: AbstractControl): ValidationErrors | null {
    const form = control as FormGroup;
    const rawAnswer = form.get('captchaAnswer')?.value?.toString().trim();

    if (!rawAnswer) {
      return null;
    }

    const answer = Number(rawAnswer);
    return !Number.isNaN(answer) && answer === this.securityCaptchaResult ? null : { captchaMismatch: true };
  }

  private toProfileData(value: Partial<ProfileFormValue>): ProfileData {
    const identity = this.getIdentityFromToken();
    return {
      fullName: String(value.fullName || identity.fullName || '').trim(),
      email: String(value.email || identity.email || '').trim().toLowerCase(),
      phone: String(value.phone || '').trim(),
      birthdate: this.normalizeBirthdate(value.birthdate),
      specialization: String(value.specialization || '').trim(),
      address: String(value.address || '').trim(),
      bio: String(value.bio || '').trim(),
      avatarDataUrl: String(value.avatarDataUrl || ''),
    };
  }

  private parseBirthdate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const normalized = String(value).trim();
    if (!normalized) return null;

    const slashMatch = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (slashMatch) {
      const day = Number(slashMatch[1]);
      const month = Number(slashMatch[2]);
      const year = Number(slashMatch[3]);

      return this.buildValidDate(year, month, day);
    }

    const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      return this.buildValidDate(
        Number(isoMatch[1]),
        Number(isoMatch[2]),
        Number(isoMatch[3]),
      );
    }

    return null;
  }

  private normalizeBirthdate(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatBirthdateInputValue(value: Date): string {
    const day = String(value.getDate()).padStart(2, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const year = value.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private formatBirthdateForInput(value: unknown): string {
    const parsedDate = this.parseBirthdate(value);
    return parsedDate ? this.formatBirthdateInputValue(parsedDate) : '';
  }

  private formatBirthdateDigits(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 8);

    if (digits.length <= 2) {
      return digits;
    }

    if (digits.length <= 4) {
      return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }

    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  private buildValidDate(year: number, month: number, day: number): Date | null {
    if (!year || !month || !day) {
      return null;
    }

    const date = new Date(year, month - 1, day);

    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  private announceText(text: string) {
    this.screenReaderMessage = text;
    this.voicePlaybackService.speak(text);
  }

  private mergeDictationText(currentValue: string, transcript: string): string {
    return `${currentValue || ''}${currentValue ? ' ' : ''}${transcript}`.trim();
  }

  private getIdentityFromToken(): { fullName: string; email: string } {
    const token = this.auth.getToken();
    if (!token) return { fullName: '', email: '' };

    const payloadPart = token.split('.')[1];
    if (!payloadPart) return { fullName: '', email: '' };

    try {
      const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(atob(base64));
      const firstName = decoded?.given_name || '';
      const lastName = decoded?.family_name || '';
      const fullName =
        `${firstName} ${lastName}`.trim() ||
        decoded?.name ||
        decoded?.preferred_username ||
        '';
      const email = decoded?.email || '';
      return { fullName, email };
    } catch {
      return { fullName: '', email: '' };
    }
  }

  private enableNewPasswordFields() {
    this.securityForm.get('newPassword')?.enable({ emitEvent: false });
    this.syncConfirmPasswordState();
    this.securityForm.updateValueAndValidity();
  }

  private disableNewPasswordFields() {
    this.securityForm.get('newPassword')?.reset('', { emitEvent: false });
    this.securityForm.get('confirmPassword')?.reset('', { emitEvent: false });
    this.securityForm.get('newPassword')?.disable({ emitEvent: false });
    this.securityForm.get('confirmPassword')?.disable({ emitEvent: false });
    this.securityForm.updateValueAndValidity();
  }

  private syncConfirmPasswordState() {
    const confirmControl = this.securityForm.get('confirmPassword');

    if (!confirmControl) {
      return;
    }

    if (this.currentPasswordValidated && this.allNewPasswordRequirementsMet) {
      confirmControl.enable({ emitEvent: false });
    } else {
      confirmControl.reset('', { emitEvent: false });
      confirmControl.disable({ emitEvent: false });
    }

    this.securityForm.updateValueAndValidity({ emitEvent: false });
  }

  private clearPendingPasswordValidation() {
    if (this.pendingPasswordValidationTimer) {
      clearTimeout(this.pendingPasswordValidationTimer);
      this.pendingPasswordValidationTimer = null;
    }
  }

  private loadProfile(identity = this.getIdentityFromToken()) {
    if (!this.auth.isLoggedIn()) {
      return;
    }

    this.auth.getProfile().pipe(delay(0)).subscribe({
      next: (response) => {
        const profile = (response?.data || response || {}) as Partial<ProfileData>;
        const merged: ProfileFormValue = {
          fullName: profile.fullName || identity.fullName || '',
          email: profile.email || identity.email || '',
          phone: profile.phone || '+216',
          birthdate: this.formatBirthdateForInput(profile.birthdate),
          specialization: profile.specialization || '',
          address: profile.address || '',
          bio: profile.bio || '',
          avatarDataUrl: profile.avatarDataUrl || '',
        };

        this.profileForm.patchValue(merged);
        this.birthdateInputMode = merged.birthdate ? 'calendar' : null;
        this.photoPreviewUrl = merged.avatarDataUrl;
        this.savedProfile = this.toProfileData(merged);
        this.faceIdEnabled = !!(profile as any).faceIdEnabled;
        this.cdr.detectChanges();
      },
      error: () => {
        // Keep default empty form when profile is not yet available.
      },
    });
  }

  private createFaceHashFromVideo(video: HTMLVideoElement): { ok: true; hash: string } | { ok: false; message: string } {
    const qualityCanvas = document.createElement('canvas');
    qualityCanvas.width = 32;
    qualityCanvas.height = 32;
    const qualityContext = qualityCanvas.getContext('2d', { willReadFrequently: true });
    if (!qualityContext) {
      return { ok: false, message: 'Capture impossible.' };
    }

    qualityContext.drawImage(video, 0, 0, 32, 32);
    const image = qualityContext.getImageData(0, 0, 32, 32).data;
    const grayscale: number[] = [];
    for (let index = 0; index < image.length; index += 4) {
      grayscale.push((image[index] + image[index + 1] + image[index + 2]) / 3);
    }

    const average = grayscale.reduce((sum, value) => sum + value, 0) / grayscale.length;
    const variance = grayscale.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / grayscale.length;
    if (average < 45 || average > 225 || variance < 220) {
      return {
        ok: false,
        message: 'Visage pas assez clair. Reprenez avec une bonne lumiere et le visage complet face a la camera.',
      };
    }

    const hashCanvas = document.createElement('canvas');
    hashCanvas.width = 16;
    hashCanvas.height = 16;
    const hashContext = hashCanvas.getContext('2d', { willReadFrequently: true });
    if (!hashContext) {
      return { ok: false, message: 'Capture impossible.' };
    }

    const sourceWidth = video.videoWidth || video.clientWidth || 640;
    const sourceHeight = video.videoHeight || video.clientHeight || 480;
    const cropSize = Math.min(sourceWidth, sourceHeight) * 0.82;
    const cropX = (sourceWidth - cropSize) / 2;
    const cropY = (sourceHeight - cropSize) / 2;

    hashContext.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, 16, 16);
    const small = hashContext.getImageData(0, 0, 16, 16).data;
    const smallGray: number[] = [];
    for (let index = 0; index < small.length; index += 4) {
      smallGray.push((small[index] + small[index + 1] + small[index + 2]) / 3);
    }
    const smallAverage = smallGray.reduce((sum, value) => sum + value, 0) / smallGray.length;
    return { ok: true, hash: smallGray.map(value => (value >= smallAverage ? '1' : '0')).join('') };
  }
}
