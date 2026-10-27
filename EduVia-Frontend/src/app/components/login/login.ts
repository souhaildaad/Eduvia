import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { VoicePlaybackService } from '../../services/voice-playback.service';

type CaptchaMode = 'math' | 'puzzle';
type LoginMode = 'login' | 'forgot-password' | 'reset-password';

interface PuzzleCell {
  id: number;
  label: string;
  isTarget: boolean;
  selected: boolean;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class Login implements OnChanges, OnDestroy {
  @ViewChild('faceLoginVideo') faceLoginVideo?: ElementRef<HTMLVideoElement>;
  @Input() role: 'student' | 'teacher' | 'admin' | null = null;
  @Input() errorMessage: string | null = null;
  @Input() mode: LoginMode = 'login';
  @Input() resetToken: string | null = null;
  @Input() resetEmail: string | null = null;
  @Input() resetUserName: string | null = null;

  email = '';
  password = '';
  newPassword = '';
  confirmPassword = '';
  captchaAnswer = '';
  showPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;
  captchaError = '';
  successMessage = '';
  localErrorMessage = '';
  isLoading = false;
  faceLoginOpen = false;
  faceLoginLoading = false;
  faceLoginMessage = '';
  private faceLoginStream: MediaStream | null = null;
  captchaMode: CaptchaMode = 'math';
  mathFailures = 0;
  readonly passwordRequirements = [
    { key: 'lowercase', label: 'au moins 1 lettre minuscule' },
    { key: 'uppercase', label: 'au moins 1 lettre majuscule' },
    { key: 'special', label: 'au moins 1 caractere speciale' },
    { key: 'length', label: 'au minimum 8 caracteres' },
  ] as const;
  private captchaResult = 0;
  captchaPrompt = '';
  puzzleInstruction = '';
  puzzleCells: PuzzleCell[] = [];
  screenReaderMessage = '';
  private readonly puzzlePool = ['HUMAIN', 'BUS', 'VELO', 'ARBRE', 'LIVRE'];
  private readonly authService = inject(AuthService);
  private readonly voicePlaybackService = inject(VoicePlaybackService);

  login = output<{ role: 'student' | 'teacher' | 'admin' | null; email: string; password: string }>();
  faceLogin = output<{ role: 'student' | 'teacher' | 'admin' | null; faceHash: string }>();
  forgotPasswordRequested = output<void>();
  backRequested = output<void>();
  resetCompleted = output<void>();

  constructor() {
    this.generateCaptcha();
  }

  ngOnDestroy() {
    this.stopFaceLoginCamera();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['errorMessage'] && changes['errorMessage'].currentValue) {
      this.announceError(changes['errorMessage'].currentValue);
    }

    if (changes['mode'] && !changes['mode'].firstChange) {
      this.resetFormState();
    }

    if (changes['resetEmail'] && this.mode === 'forgot-password' && this.resetEmail) {
      this.email = this.resetEmail;
    }
  }

  get roleLabel(): string {
    if (this.role === 'student') {
      return 'etudiant';
    }
    if (this.role === 'teacher') {
      return 'enseignant';
    }
    if (this.role === 'admin') {
      return 'administrateur';
    }
    return 'utilisateur';
  }

  get isForgotPasswordAvailable(): boolean {
    return this.mode === 'login' && (this.role === 'student' || this.role === 'teacher');
  }

  get canSubmit(): boolean {
    const captchaReady = this.captchaMode === 'math'
      ? this.captchaAnswer.trim() !== ''
      : this.puzzleCells.some((cell) => cell.selected);

    if (!captchaReady || this.isLoading) {
      return false;
    }

    if (this.mode === 'login') {
      return !!this.email.trim() && !!this.password.trim();
    }

    if (this.mode === 'forgot-password') {
      return !!this.email.trim();
    }

    return this.allNewPasswordRequirementsMet && !!this.confirmPassword.trim() && this.newPassword === this.confirmPassword;
  }

  get newPasswordRequirementState(): Record<string, boolean> {
    return {
      lowercase: /[a-z]/.test(this.newPassword),
      uppercase: /[A-Z]/.test(this.newPassword),
      special: /[^A-Za-z0-9]/.test(this.newPassword),
      length: this.newPassword.length >= 8,
    };
  }

  get allNewPasswordRequirementsMet(): boolean {
    const requirementState = this.newPasswordRequirementState;
    return Object.values(requirementState).every(Boolean);
  }

  get title(): string {
    if (this.mode === 'forgot-password') {
      return 'Mot de passe oublie ?';
    }

    if (this.mode === 'reset-password') {
      return 'Nouveau mot de passe';
    }

    return 'Bienvenue sur EduVia';
  }

  get eyebrow(): string {
    if (this.mode === 'forgot-password') {
      return 'Recuperation';
    }

    if (this.mode === 'reset-password') {
      return 'Reinitialisation';
    }

    return 'Connexion';
  }

  get copy(): string {
    if (this.mode === 'forgot-password') {
      return "Saisissez et validez l'adresse e-mail de votre compte. Vous recevrez ensuite par e-mail un lien vers une page vous permettant de creer facilement votre nouveau mot de passe.";
    }

    if (this.mode === 'reset-password') {
      const userName = this.resetUserName?.trim();
      return userName
        ? `Bonjour ${userName}, saisissez votre nouveau mot de passe pour votre espace ${this.roleLabel}.`
        : `Saisissez votre nouveau mot de passe pour votre espace ${this.roleLabel}.`;
    }

    return `Entrez vos identifiants pour acceder a votre espace ${this.roleLabel}.`;
  }

  get submitLabel(): string {
    if (this.mode === 'forgot-password') {
      return 'Valider';
    }

    if (this.mode === 'reset-password') {
      return 'Sauvegarder';
    }

    return 'Se connecter';
  }

  onSubmit() {
    this.localErrorMessage = '';
    this.successMessage = '';

    if (!this.canSubmit) {
      return;
    }

    if (!this.validateCaptcha()) {
      return;
    }

    if (this.mode === 'login') {
      this.login.emit({
        role: this.role,
        email: this.email.trim(),
        password: this.password,
      });
      return;
    }

    if (this.mode === 'forgot-password') {
      this.submitForgotPassword();
      return;
    }

    this.submitResetPassword();
  }

  onForgotPasswordClick() {
    this.forgotPasswordRequested.emit();
  }

  async openFaceLogin() {
    this.localErrorMessage = '';
    this.faceLoginMessage = '';
    this.faceLoginOpen = true;
    this.announceFaceLoginHelp();

    try {
      this.faceLoginStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setTimeout(() => {
        const video = this.faceLoginVideo?.nativeElement;
        if (video && this.faceLoginStream) {
          video.srcObject = this.faceLoginStream;
          video.play();
        }
      });
    } catch {
      this.faceLoginMessage = "Impossible d'ouvrir la camera. Autorisez l'acces camera puis reessayez.";
    }
  }

  closeFaceLogin() {
    this.faceLoginOpen = false;
    this.faceLoginLoading = false;
    this.faceLoginMessage = '';
    this.stopFaceLoginCamera();
  }

  announceFaceLoginHelp() {
    const message = 'Connexion avec Face ID. La camera va s ouvrir. Placez votre visage complet, clair et face a la camera, puis cliquez sur verifier mon visage.';
    this.voicePlaybackService.toggle('login:face-id', message);
    this.screenReaderMessage = message;
  }

  async submitFaceLogin() {
    const video = this.faceLoginVideo?.nativeElement;
    if (!video || video.readyState < 2) {
      this.faceLoginMessage = 'Camera non prete. Patientez quelques secondes.';
      return;
    }

    this.faceLoginLoading = true;
    const result = this.createFaceHashFromVideo(video);
    this.faceLoginLoading = false;

    if (!result.ok) {
      this.faceLoginMessage = result.message;
      return;
    }

    this.closeFaceLogin();
    this.faceLogin.emit({ role: this.role, faceHash: result.hash });
  }

  onBackClick() {
    this.backRequested.emit();
  }

  togglePasswordVisibility(field: 'password' | 'newPassword' | 'confirmPassword') {
    if (field === 'password') {
      this.showPassword = !this.showPassword;
      return;
    }

    if (field === 'newPassword') {
      this.showNewPassword = !this.showNewPassword;
      return;
    }

    this.showConfirmPassword = !this.showConfirmPassword;
  }

  onNewPasswordInput() {
    if (!this.allNewPasswordRequirementsMet) {
      this.confirmPassword = '';
    }
  }

  announceField(field: 'email' | 'password' | 'newPassword' | 'confirmPassword' | 'captcha') {
    let message = '';

    if (field === 'email') {
      message = this.mode === 'forgot-password' ? "Saisir l adresse email du compte pour recevoir le lien de reinitialisation." : 'Saisir votre email.';
    } else if (field === 'password') {
      message = 'Saisir votre mot de passe.';
    } else if (field === 'newPassword') {
      message = 'Saisir le nouveau mot de passe.';
    } else if (field === 'confirmPassword') {
      message = 'Confirmer le nouveau mot de passe.';
    } else {
      message = 'Tu dois verifier que vous n etes pas un robot : ';
      if (this.captchaMode === 'math') {
        message += `Resoudre l operation pour continuer. Voici l operation : ${this.captchaPrompt}`;
      } else {
        message += `Selectionnez les bonnes cases pour continuer. ${this.puzzleInstruction}`;
      }
    }

    this.voicePlaybackService.toggle(`login:${field}`, message);
    this.screenReaderMessage = message;
  }

  isVoiceFieldActive(field: 'email' | 'password' | 'newPassword' | 'confirmPassword' | 'captcha'): boolean {
    return this.voicePlaybackService.isActive(`login:${field}`);
  }

  announceError(errorMessage: string) {
    let message = '';

    if (errorMessage.includes('Email invalide')) {
      message = 'Email invalide vous devriez saisir votre email de nouveau.';
    } else if (errorMessage.includes('Mot de passe incorrect')) {
      message = 'Votre mot de passe est invalide vous devriez saisir votre mot de passe de nouveau.';
    } else if (errorMessage.includes('Captcha incorrect')) {
      message = errorMessage + ' Voici l operation de nouveau : ' + this.captchaPrompt;
    } else {
      message = errorMessage;
    }

    this.speakText(message);
    this.screenReaderMessage = message;
  }

  refreshCaptcha() {
    this.captchaError = '';

    if (this.captchaMode === 'math') {
      this.generateCaptcha();
      return;
    }

    this.generatePuzzleCaptcha();
  }

  togglePuzzleCell(cellId: number) {
    this.captchaError = '';
    this.puzzleCells = this.puzzleCells.map((cell) =>
      cell.id === cellId ? { ...cell, selected: !cell.selected } : cell
    );
  }

  private submitForgotPassword() {
    if (this.role !== 'student' && this.role !== 'teacher') {
      return;
    }

    this.isLoading = true;
    this.authService.requestPasswordReset({
      email: this.email.trim().toLowerCase(),
      role: this.role,
    }).subscribe({
      next: (response) => {
        setTimeout(() => {
          this.isLoading = false;
          this.successMessage = response?.data?.emailSent
            ? 'Si cette adresse correspond à un compte, le lien a été envoyé. Vérifiez aussi les courriers indésirables.'
            : 'Si cette adresse correspond à un compte, un lien sera envoyé. Vérifiez l’adresse saisie.';
          this.speakText(this.successMessage);
          const previewHtml = response?.data?.previewHtml || response?.previewHtml;
          if (previewHtml && typeof window !== 'undefined') {
            const previewWindow = window.open('', '_blank', 'width=760,height=860');
            if (previewWindow) {
              previewWindow.document.open();
              previewWindow.document.write(previewHtml);
              previewWindow.document.close();
            }
          }
        });
      },
      error: (err) => {
        setTimeout(() => {
          this.isLoading = false;
          this.localErrorMessage = err?.error?.message || 'Erreur lors de la demande de reinitialisation.';
          this.announceError(this.localErrorMessage);
        });
      }
    });
  }

  private submitResetPassword() {
    if (!this.resetToken) {
      this.localErrorMessage = 'Lien de reinitialisation invalide.';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.localErrorMessage = 'La confirmation du mot de passe ne correspond pas.';
      this.announceError(this.localErrorMessage);
      return;
    }

    this.isLoading = true;
    this.authService.resetForgottenPassword({
      token: this.resetToken,
      newPassword: this.newPassword,
      confirmPassword: this.confirmPassword,
      captchaAnswer: this.captchaAnswer,
      isNotRobot: true,
      updateKeycloak: true,
      updateDatabase: true,
    }).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = 'Votre mot de passe a ete reinitialise avec succes. Vous pouvez maintenant vous connecter.';
        this.speakText(this.successMessage);
        this.resetCompleted.emit();
      },
      error: (err) => {
        this.isLoading = false;
        this.localErrorMessage = err?.error?.message || 'Erreur lors de la reinitialisation du mot de passe.';
        this.announceError(this.localErrorMessage);
      }
    });
  }

  private speakText(text: string) {
    this.voicePlaybackService.speak(text);
  }

  private resetFormState() {
    this.password = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.captchaAnswer = '';
    this.captchaError = '';
    this.successMessage = '';
    this.localErrorMessage = '';
    this.showPassword = false;
    this.showNewPassword = false;
    this.showConfirmPassword = false;
    this.captchaMode = 'math';
    this.mathFailures = 0;
    this.puzzleCells = [];
    this.generateCaptcha();
  }

  private generateCaptcha() {
    const left = Math.floor(Math.random() * 8) + 2;
    const right = Math.floor(Math.random() * 8) + 1;
    this.captchaResult = left + right;
    this.captchaPrompt = `${left} + ${right} =`;
    this.captchaAnswer = '';
  }

  private validateCaptcha(): boolean {
    this.captchaError = '';

    if (this.captchaMode === 'math') {
      const answer = Number(this.captchaAnswer.trim());
      const isValid = this.captchaAnswer.trim() !== '' && answer === this.captchaResult;

      if (isValid) {
        return true;
      }

      this.mathFailures += 1;

      if (this.mathFailures >= 3) {
        this.captchaMode = 'puzzle';
        this.generatePuzzleCaptcha();
        this.captchaError = 'Trois erreurs detectees. Veuillez resoudre le captcha puzzle.';
        return false;
      }

      this.generateCaptcha();
      this.captchaError = `Captcha incorrect. Il vous reste ${3 - this.mathFailures} tentative(s) avant le mode puzzle.`;
      const captchaMessage = this.captchaError + ' Voici l operation de nouveau : ' + this.captchaPrompt;
      this.speakText(captchaMessage);
      this.screenReaderMessage = captchaMessage;
      return false;
    }

    const hasWrongSelection = this.puzzleCells.some((cell) => cell.selected !== cell.isTarget);

    if (hasWrongSelection) {
      this.generatePuzzleCaptcha();
      this.captchaError = 'Selection incorrecte. Essayez a nouveau avec le puzzle.';
      return false;
    }

    const targetCount = this.puzzleCells.filter((cell) => cell.isTarget).length;
    const selectedCount = this.puzzleCells.filter((cell) => cell.selected).length;

    if (selectedCount !== targetCount) {
      this.captchaError = 'Selection incomplete. Choisissez toutes les bonnes cases.';
      return false;
    }

    return true;
  }

  private generatePuzzleCaptcha() {
    const targets = this.puzzlePool.slice(0, 3 + Math.floor(Math.random() * 2));
    const targetLabel = targets[Math.floor(Math.random() * targets.length)];
    const otherLabels = this.puzzlePool.filter((label) => label !== targetLabel);
    const targetIndexes = this.pickUniqueIndexes(3);

    this.puzzleInstruction = `Selectionnez toutes les cases avec ${targetLabel}`;
    this.puzzleCells = Array.from({ length: 9 }, (_, index) => {
      const isTarget = targetIndexes.includes(index);
      const label = isTarget
        ? targetLabel
        : otherLabels[Math.floor(Math.random() * otherLabels.length)];

      return {
        id: index,
        label,
        isTarget,
        selected: false,
      };
    });
  }

  private pickUniqueIndexes(count: number): number[] {
    const indexes = new Set<number>();

    while (indexes.size < count) {
      indexes.add(Math.floor(Math.random() * 9));
    }

    return Array.from(indexes);
  }

  private stopFaceLoginCamera() {
    this.faceLoginStream?.getTracks().forEach(track => track.stop());
    this.faceLoginStream = null;
  }

  private createFaceHashFromVideo(video: HTMLVideoElement): { ok: true; hash: string } | { ok: false; message: string } {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return { ok: false, message: 'Capture impossible.' };
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const grayscale: number[] = [];
    for (let index = 0; index < image.length; index += 4) {
      grayscale.push((image[index] + image[index + 1] + image[index + 2]) / 3);
    }

    const average = grayscale.reduce((sum, value) => sum + value, 0) / grayscale.length;
    const variance = grayscale.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / grayscale.length;
    if (average < 18 || average > 245 || variance < 45) {
      return { ok: false, message: 'Visage pas assez clair. Placez votre visage complet face a la camera avec une bonne lumiere.' };
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
    const hashPixels = hashContext.getImageData(0, 0, 16, 16).data;
    const hashGray: number[] = [];
    for (let index = 0; index < hashPixels.length; index += 4) {
      hashGray.push((hashPixels[index] + hashPixels[index + 1] + hashPixels[index + 2]) / 3);
    }
    const hashAverage = hashGray.reduce((sum, value) => sum + value, 0) / hashGray.length;
    return { ok: true, hash: hashGray.map(value => (value >= hashAverage ? '1' : '0')).join('') };
  }
}
