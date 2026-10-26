import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { ChangePasswordComponent } from '../../components/teacher/change-password/change-password';

@Component({
  selector: 'app-password-warning',
  standalone: true,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
  ],
  template: `
    <mat-card class="warning-card">
      <mat-card-header>
        <mat-icon color="warn">warning</mat-icon>
        <mat-card-title>Action requise</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <p>Vous devez changer votre mot de passe dans les 24h, sinon votre compte sera bloqué.</p>
      </mat-card-content>
      <mat-card-actions>
        <button mat-raised-button color="warn" (click)="openChangePassword()">Changer maintenant</button>
      </mat-card-actions>
    </mat-card>
  `,
  styles: [`
    .warning-card {
      max-width: 400px;
      margin: 16px;
    }
    .mat-mdc-card-header {
      padding-bottom: 8px;
    }
    .mat-mdc-card-content {
      padding-top: 8px;
      padding-bottom: 8px;
    }
  `]
})
export class PasswordWarningComponent {
  constructor(private dialog: MatDialog) {}

openChangePassword() {
  // Option de sécurité : fermer si jamais un admin arrive ici
  if (localStorage.getItem('role') === 'admin') {
    return;
  }
  this.dialog.open(ChangePasswordComponent, {
    width: '500px',
    disableClose: true
  });
}
}