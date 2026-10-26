import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-update-profile',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatSnackBarModule,
  ],
  templateUrl: './update-profile.html',
  styleUrls: ['./update-profile.css'],
  standalone: true,
})
export class UpdateProfileComponent {
  profileForm: FormGroup;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private auth: AuthService,
  ) {
    this.profileForm = this.fb.group({
      fullName: ['Jean Dupont', Validators.required],
      email: ['jean.dupont@example.com', [Validators.required, Validators.email]],
      phone: ['+33 6 12 34 56 78', Validators.required],
      birthdate: ['1980-01-15', Validators.required],
      specialization: ['Informatique', Validators.required],
      address: ['Paris, France', Validators.required],
      bio: ['Professeur passionné par l\'informatique', Validators.maxLength(500)],
    });

    // try to load profile from backend if available
    this.auth.getProfile().subscribe({
      next: (profile: any) => {
        if (profile) {
          this.profileForm.patchValue({
            fullName: profile.fullName ?? profile.name ?? this.profileForm.get('fullName')?.value,
            email: profile.email ?? this.profileForm.get('email')?.value,
            phone: profile.phone ?? this.profileForm.get('phone')?.value,
            birthdate: profile.birthdate ?? this.profileForm.get('birthdate')?.value,
            specialization: profile.specialization ?? this.profileForm.get('specialization')?.value,
            address: profile.address ?? this.profileForm.get('address')?.value,
            bio: profile.bio ?? this.profileForm.get('bio')?.value,
          });
        }
      },
      error: (err: any) => {
        // ignore; keep defaults
      },
    });
  }

  onSubmit() {
    if (this.profileForm.valid) {
      this.isLoading = true;
      const payload = this.profileForm.value;
      this.auth.updateProfile(payload).subscribe({
        next: () => {
          this.isLoading = false;
          this.snackBar.open('Profil mis à jour avec succès!', 'Fermer', {
            duration: 3000,
            horizontalPosition: 'end',
            verticalPosition: 'top',
            panelClass: ['success-snackbar'],
          });
        },
        error: (err: any) => {
          this.isLoading = false;
          const msg = err?.error?.message || 'Erreur lors de la mise à jour du profil';
          this.snackBar.open(msg, 'Fermer', { duration: 4000, horizontalPosition: 'end', verticalPosition: 'top' });
        },
      });
    }
  }

  onCancel() {
    this.profileForm.reset();
    this.profileForm.patchValue({
      fullName: 'Jean Dupont',
      email: 'jean.dupont@example.com',
      phone: '+33 6 12 34 56 78',
      birthdate: '1980-01-15',
      specialization: 'Informatique',
      address: 'Paris, France',
      bio: 'Professeur passionné par l\'informatique',
    });
  }

}
