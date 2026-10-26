import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-change-password',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  templateUrl: './change-password.html',
  styleUrls: ['./change-password.css'],
  standalone: true,
})
export class ChangePasswordComponent {
  passwordForm: FormGroup;
  isLoading = false;
  showPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  constructor(
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private auth: AuthService,
    private cdr: ChangeDetectorRef,
  ) {
    this.passwordForm = this.fb.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    }, { validators: this.passwordMatchValidator });
  }

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const group = control as FormGroup;
    const newPassword = group.get('newPassword')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;
    
    return newPassword === confirmPassword ? null : { passwordMismatch: true };
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleNewPasswordVisibility() {
    this.showNewPassword = !this.showNewPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  onSubmit() {
    if (this.passwordForm.valid) {
      this.isLoading = true;
      const payload = {
        currentPassword: this.passwordForm.get('currentPassword')?.value,
        newPassword: this.passwordForm.get('newPassword')?.value,
        confirmPassword: this.passwordForm.get('confirmPassword')?.value,
        captchaAnswer: 'verified',
        isNotRobot: true,
        updateKeycloak: true,
        updateDatabase: true,
        disableTemporaryPasswordBlock: true,
      };

      this.auth.changePassword(payload).subscribe({
        next: () => {
          this.isLoading = false;
          this.cdr.detectChanges();
          this.snackBar.open('Mot de passe changé avec succès!', 'Fermer', {
            duration: 3000,
            horizontalPosition: 'end',
            verticalPosition: 'top',
            panelClass: ['success-snackbar'],
          });
          this.onCancel();
        },
        error: (err: any) => {
          this.isLoading = false;
          this.cdr.detectChanges();
          const msg =
            err?.status === 401
              ? 'Votre session a expire. Reconnectez-vous puis reessayez.'
              : err?.error?.message || 'Erreur lors du changement de mot de passe';
          this.snackBar.open(msg, 'Fermer', { duration: 4000, horizontalPosition: 'end', verticalPosition: 'top' });
        },
      });
    }
  }

  onCancel() {
    this.passwordForm.reset();
  }
}
