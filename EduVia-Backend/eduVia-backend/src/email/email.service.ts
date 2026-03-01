import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<number>('SMTP_PORT') === 465,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  async sendIdentificationEmail(email: string, userId: string, password: string): Promise<boolean> {
    try {
      const htmlContent = `
        <h2>Bienvenue sur EduVia</h2>
        <p>Votre compte a été créé avec succès.</p>
        <p><strong>Vos identifiants de connexion :</strong></p>
        <ul>
          <li><strong>Identifiant (ID Keycloak) :</strong> ${userId}</li>
          <li><strong>Email :</strong> ${email}</li>
          <li><strong>Mot de passe temporaire :</strong> ${password}</li>
        </ul>
        <p>Veuillez vous connecter avec ces identifiants et changer votre mot de passe au premier accès.</p>
        <p><a href="${this.configService.get<string>('FRONTEND_URL')}/login">Se connecter</a></p>
      `;

      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM_EMAIL'),
        to: email,
        subject: 'Vos identifiants EduVia',
        html: htmlContent,
      });

      return true;
    } catch (error) {
      console.error('Error sending identification email:', error);
      return false;
    }
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    try {
      const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${resetToken}`;

      const htmlContent = `
        <h2>Récupération de mot de passe</h2>
        <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
        <p><a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Réinitialiser mon mot de passe</a></p>
        <p>Ce lien expire dans 1 heure.</p>
        <p>Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
      `;

      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM_EMAIL'),
        to: email,
        subject: 'Réinitialisation de votre mot de passe EduVia',
        html: htmlContent,
      });

      return true;
    } catch (error) {
      console.error('Error sending password reset email:', error);
      return false;
    }
  }

  async sendAccountNotification(email: string, message: string, subject: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM_EMAIL'),
        to: email,
        subject: subject,
        html: message,
      });

      return true;
    } catch (error) {
      console.error('Error sending notification email:', error);
      return false;
    }
  }
}
