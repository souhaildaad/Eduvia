import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { existsSync } from 'fs';
import { resolve } from 'path';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logoCid = 'eduvia-logo';
  private readonly logoMarkupStyle =
    'width:76px;height:76px;object-fit:contain;background:#ffffff;border-radius:20px;padding:8px;display:block;';

  private resolveLogoAttachment() {
    const configuredLogoPath = this.configService.get('EMAIL_LOGO_PATH');
    const candidatePaths = [
      configuredLogoPath,
      resolve(process.cwd(), 'public', 'logo.png'),
      resolve(process.cwd(), '..', 'EduVia-Frontend', 'public', 'logo.png'),
      resolve(process.cwd(), '..', '..', 'EduVia-Frontend', 'public', 'logo.png'),
      resolve(
        process.cwd(),
        '..',
        '..',
        '..',
        'EduVia-Frontend',
        'public',
        'logo.png',
      ),
      resolve(__dirname, '..', '..', '..', 'EduVia-Frontend', 'public', 'logo.png'),
      resolve(__dirname, '..', '..', '..', '..', 'EduVia-Frontend', 'public', 'logo.png'),
    ].filter((value): value is string => Boolean(value));

    const logoPath = candidatePaths.find((candidatePath) =>
      existsSync(candidatePath),
    );

    if (!logoPath) {
      return null;
    }

    return {
      filename: 'logo.png',
      path: logoPath,
      cid: this.logoCid,
    };
  }

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow('SMTP_HOST'),
      port: this.configService.getOrThrow('SMTP_PORT'),
      secure: false,
      auth: {
        user: this.configService.getOrThrow('SMTP_USER'),
        pass: this.configService.getOrThrow('SMTP_PASSWORD'),
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    this.transporter.verify((error) => {
      if (error) {
        console.error('[EMAIL SERVICE] ❌ Erreur connexion SMTP:', error);
      } else {
        console.log('[EMAIL SERVICE] ✅ SMTP connecté et prêt');
      }
    });

    console.log('[EMAIL SERVICE] Configuré avec:');
    console.log(`  - Host: ${this.configService.getOrThrow('SMTP_HOST')}`);
    console.log(`  - Port: ${this.configService.getOrThrow('SMTP_PORT')}`);
    console.log(`  - User: ${this.configService.getOrThrow('SMTP_USER')}`);
    console.log(`  - From: ${this.configService.getOrThrow('SMTP_FROM_EMAIL')}`);
  }
  async sendPasswordResetEmail(params: {
    to: string;
    resetLink: string;
    appName: string;
    expirationMinutes?: number;
    firstName?: string;
    role?: 'teacher' | 'student';
  }): Promise<void> {
    const {
      to,
      resetLink,
      appName,
      expirationMinutes = 60,
      firstName,
      role,
    } = params;

    console.log(`[EMAIL] Preparation email de reinitialisation pour: ${to}`);
    console.log(`[EMAIL] Verification du champ TO: ${to}`);

    if (!to || typeof to !== 'string') {
      console.error(`[EMAIL ERROR] Le champ 'to' est invalide: ${to}`);
      throw new Error(`Destinataire invalide: ${to}`);
    }

    const fromEmail = this.configService.getOrThrow('SMTP_FROM_EMAIL');
    const fromName = this.configService.get('SMTP_FROM_NAME') || appName;
    const greetingName = firstName?.trim() || to;
    const roleLabel = role === 'teacher' ? 'enseignant' : 'etudiant';
    const logoAssets = this.getLogoEmailAssets(appName);

    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: to.toLowerCase().trim(),
      subject: `Reinitialisation de mot de passe - ${appName}`,
      attachments: logoAssets.attachment ? [logoAssets.attachment] : [],
      text: `
${appName}

Reinitialisation de votre mot de passe

Bonjour ${greetingName},

Vous avez demande une reinitialisation de mot de passe pour votre compte ${appName}.

Cliquez sur le lien ci-dessous pour definir un nouveau mot de passe :
${resetLink}

Ce lien expire dans ${expirationMinutes} minutes.

Si vous n'etes pas a l'origine de cette demande, ignorez cet email.

Apres reinitialisation, vous pourrez acceder a votre espace ${roleLabel} ${appName}.

Cordialement,
L'equipe ${appName}
      `.trim(),
      html: `
        <div style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#091224;">
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 45px rgba(9,18,36,0.08);border:1px solid #dde3ef;">
            <div style="padding:36px 40px;background:linear-gradient(135deg,#8b1e3f 0%,#c62828 52%,#ef5350 100%);color:#ffffff;">
              <div style="display:flex;align-items:flex-start;">
                ${logoAssets.markup}
                <div style="padding-top:6px;padding-left:28px;">
                  <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">${appName}</div>
                  <h1 style="margin:10px 0 0;font-size:32px;line-height:1.15;">Reinitialisation de votre mot de passe</h1>
                </div>
              </div>
              <p style="margin:28px 0 0;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.92);">
                Une demande de reinitialisation de mot de passe a ete effectuee pour votre compte ${appName}.
              </p>
            </div>

            <div style="padding:32px;">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.8;">Bonjour ${greetingName},</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#31405d;">
                Vous avez demande a reinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour definir un nouveau mot de passe et securiser votre compte.
              </p>

              <div style="text-align:center;margin:0 0 26px;">
                <a href="${resetLink}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#c62828;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 12px 24px rgba(198,40,40,0.22);">
                  Reinitialiser mon mot de passe
                </a>
              </div>

              <div style="margin-bottom:22px;padding:18px 20px;border-radius:18px;background:#fff4f4;border:1px solid #ffd6d6;">
                <div style="font-size:15px;font-weight:700;color:#991b1b;margin-bottom:10px;">Important</div>
                <ul style="margin:0;padding-left:20px;color:#7a3030;font-size:14px;line-height:1.8;">
                  <li>Ce lien est valable pendant ${expirationMinutes} minutes.</li>
                  <li>Si vous n'etes pas a l'origine de cette demande, ignorez cet email.</li>
                  <li>Ne partagez jamais vos identifiants.</li>
                </ul>
              </div>

              <div style="padding:22px;border-radius:18px;background:#ffffff;border:1px solid #dde3ef;">
                <div style="font-size:16px;font-weight:700;margin-bottom:10px;">Acces securise</div>
                <p style="margin:0;font-size:14px;line-height:1.8;color:#31405d;">
                  Apres reinitialisation, vous pourrez acceder a votre espace ${roleLabel} ${appName} avec votre nouveau mot de passe.
                </p>
              </div>

              <p style="margin:22px 0 0;font-size:14px;line-height:1.8;color:#31405d;">
                Merci d'utiliser <strong>${appName}</strong><br />
                Apprendre, collaborer et progresser dans un espace securise.
              </p>
            </div>
          </div>
        </div>
      `,
    };

    try {
      console.log(
        `[EMAIL] Envoi via SMTP (${this.configService.getOrThrow('SMTP_HOST')}:${this.configService.getOrThrow('SMTP_PORT')})...`,
      );
      console.log(`[EMAIL] From: ${mailOptions.from}`);
      console.log(`[EMAIL] To: ${mailOptions.to}`);
      console.log(`[EMAIL] Subject: ${mailOptions.subject}`);
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EMAIL] Reinitialisation envoyee AVEC SUCCES`);
      console.log(`[EMAIL] Destinataire confirme: ${to}`);
      console.log(`[EMAIL] MessageID: ${info.messageId}`);
      console.log(`[EMAIL] Response: ${info.response}`);
    } catch (error: any) {
      console.error(`[EMAIL ERROR] Erreur lors de l'envoi a ${to}:`);
      console.error(`[EMAIL ERROR] Message: ${error.message}`);
      console.error(`[EMAIL ERROR] Code: ${error.code}`);
      console.error(`[EMAIL ERROR] Details complets:`, error);
      throw error;
    }
  }

  private getLogoEmailAssets(appName: string): {
    attachment: { filename: string; path: string; cid: string } | null;
    markup: string;
  } {
    const attachment = this.resolveLogoAttachment();
    const markup = attachment
      ? `<img src="cid:${this.logoCid}" alt="${appName}" style="${this.logoMarkupStyle}" />`
      : `<div style="width:76px;height:76px;border-radius:20px;background:#ffffff;color:#c62828;font-size:28px;font-weight:800;display:flex;align-items:center;justify-content:center;">E</div>`;

    return { attachment, markup };
  }
  async sendIdentificationEmail(
    email: string,
    userId: string,
    temporaryPassword: string,
    role: 'teacher' | 'student',
    firstName?: string,
    verificationUrl?: string,
  ): Promise<void> {
    const appName = 'EduVia';
    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    const loginUrl = `${frontendUrl}/?role=${role}`;
    const primaryUrl = verificationUrl || loginUrl;
    const greetingName = firstName?.trim() || email;
    const roleLabel = role === 'teacher' ? 'enseignant' : 'etudiant';
    const logoAssets = this.getLogoEmailAssets(appName);

    console.log(`[EMAIL] Préparation email d'identification pour: ${email}`);
    console.log(`[EMAIL] Vérification du champ TO: ${email}`);

    if (!email || typeof email !== 'string') {
      console.error(`[EMAIL ERROR] Le champ 'email' est invalide: ${email}`);
      throw new Error(`Email destinataire invalide: ${email}`);
    }

    const fromEmail = this.configService.getOrThrow('SMTP_FROM_EMAIL');
    const fromName = this.configService.get('SMTP_FROM_NAME') || appName;

    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: email.toLowerCase().trim(),
      subject: `Bienvenue sur ${appName} - Vos identifiants`,
      attachments: logoAssets.attachment ? [logoAssets.attachment] : [],
      text: `
Bonjour ${greetingName},

Votre compte ${appName} a ete cree avec succes.

Profil : ${roleLabel}
Email : ${email}
Mot de passe temporaire : ${temporaryPassword}

Verifiez votre email puis ouvrez votre interface ici : ${primaryUrl}
Connectez-vous avec ces identifiants et changez votre mot de passe des votre premiere visite.

Cordialement,
L'equipe ${appName}
      `.trim(),
      html: `
        <div style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#091224;">
          <style>
            .eduvia-login-button {
              display: inline-block;
              padding: 14px 28px;
              border-radius: 999px;
              background: #c62828;
              color: #ffffff !important;
              text-decoration: none;
              font-weight: 700;
              font-size: 15px;
              transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
              box-shadow: 0 12px 24px rgba(198, 40, 40, 0.22);
            }

            .eduvia-login-button:hover {
              background: #b71c1c;
              transform: translateY(-2px);
              box-shadow: 0 16px 28px rgba(183, 28, 28, 0.28);
            }
          </style>
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 45px rgba(9,18,36,0.08);border:1px solid #dde3ef;">
            <div style="padding:36px 40px;background:linear-gradient(135deg,#8b1e3f 0%,#c62828 52%,#ef5350 100%);color:#ffffff;">
              <div style="display:flex;align-items:flex-start;">
                ${logoAssets.markup}
                <div style="padding-top:6px;padding-left:28px;">
                  <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">EduVia</div>
                  <h1 style="margin:10px 0 0;font-size:32px;line-height:1.15;">Bienvenue sur votre espace ${roleLabel}</h1>
                </div>
              </div>
              <p style="margin:28px 0 0;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.92);">
                Votre compte a ete cree. Retrouvez votre interface de connexion et vos identifiants temporaires dans un email au design proche de la plateforme.
              </p>
            </div>

            <div style="padding:32px;">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.8;">Bonjour ${greetingName},</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#31405d;">
                Votre acces ${appName} est pret. Cliquez sur le bouton ci-dessous pour verifier votre adresse email puis ouvrir directement l'interface de connexion ${roleLabel}.
              </p>

              <div style="text-align:center;margin:0 0 26px;">
                <a href="${primaryUrl}" class="eduvia-login-button" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#c62828;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 12px 24px rgba(198,40,40,0.22);">
                  Verifier puis acceder a la connexion
                </a>
              </div>

              <div style="margin-bottom:22px;padding:18px 20px;border-radius:18px;background:#eef4ff;border:1px solid #d4e1ff;">
                <div style="font-size:15px;font-weight:700;color:#12346b;margin-bottom:10px;">Important</div>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#31405d;">
                  Lors de votre premiere connexion, vous devrez changer votre mot de passe temporaire avant de pouvoir utiliser la plateforme.
                </p>
              </div>

              <div style="padding:22px;border-radius:18px;background:#ffffff;border:1px solid #dde3ef;box-shadow:inset 0 1px 0 rgba(255,255,255,0.8);">
                <div style="font-size:16px;font-weight:700;margin-bottom:16px;">Identifiants de connexion</div>
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:0 0 12px;font-size:14px;color:#5b6780;">Profil</td>
                    <td style="padding:0 0 12px;font-size:14px;font-weight:700;text-align:right;color:#091224;text-transform:capitalize;">${roleLabel}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 12px;font-size:14px;color:#5b6780;">Email</td>
                    <td style="padding:0 0 12px;font-size:14px;font-weight:700;text-align:right;color:#091224;">${email}</td>
                  </tr>
                  <tr>
                    <td style="padding:0;font-size:14px;color:#5b6780;">Mot de passe temporaire</td>
                    <td style="padding:0;font-size:14px;font-weight:700;text-align:right;color:#091224;"><span style="display:inline-block;padding:8px 12px;border-radius:12px;background:#f4f6fb;border:1px solid #dde3ef;">${temporaryPassword}</span></td>
                  </tr>
                </table>
              </div>

              <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e6ebf3;">
                <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Etapes rapides</div>
                <ol style="margin:0;padding-left:20px;color:#31405d;font-size:14px;line-height:1.9;">
                  <li>Ouvrez votre interface de connexion ${roleLabel}.</li>
                  <li>Connectez-vous avec votre email et votre mot de passe temporaire.</li>
                  <li>Changez votre mot de passe pour activer votre acces definitif.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      `,
    };

    try {
      console.log(
        `[EMAIL] Envoi via SMTP (${this.configService.getOrThrow('SMTP_HOST')}:${this.configService.getOrThrow('SMTP_PORT')})...`,
      );
      console.log(`[EMAIL] From: ${mailOptions.from}`);
      console.log(`[EMAIL] To: ${mailOptions.to}`);
      console.log(`[EMAIL] Subject: ${mailOptions.subject}`);
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EMAIL] ✅ Identifiants envoyés AVEC SUCCÈS`);
      console.log(`[EMAIL] Destinataire confirmé: ${email}`);
      console.log(`[EMAIL] MessageID: ${info.messageId}`);
      console.log(`[EMAIL] Response: ${info.response}`);
    } catch (error: any) {
      console.error(`[EMAIL ERROR] ❌ Erreur lors de l'envoi à ${email}:`);
      console.error(`[EMAIL ERROR] Message: ${error.message}`);
      console.error(`[EMAIL ERROR] Code: ${error.code}`);
      console.error(`[EMAIL ERROR] Détails complets:`, error);
      throw error;
    }
  }

  async sendCredentialsEmail(params: {
    to: string;
    username: string;
    tempPassword: string;
    appName: string;
    loginUrl: string;
  }): Promise<void> {
    const mailOptions = {
      from: `${params.appName} <${this.configService.getOrThrow('SMTP_FROM_EMAIL')}>`,
      to: params.to,
      subject: `Bienvenue sur ${params.appName} !`,
      html: `
      <h2>Bonjour ${params.username},</h2>
      <p>Votre compte <strong>${params.appName}</strong> a été créé.</p>
      <p>Veuillez d'abord vérifier votre adresse e-mail, puis vous connecter à l'aide des identifiants ci-dessous.</p>
      <p><strong>Identifiant :</strong> ${params.username}</p>
      <p><strong>Mot de passe temporaire :</strong> ${params.tempPassword}</p>
      <a href="${params.loginUrl}" style="background:#4CAF50;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;">
        Vérifier l'adresse e-mail
      </a>
      <p>Ce mot de passe est temporaire. Vous devrez le changer dès votre première connexion.</p>
    `,
    };
    await this.transporter.sendMail(mailOptions);
  }

  async sendExamReminderEmail(params: {
    to: string;
    studentName?: string;
    title: string;
    message: string;
  }): Promise<void> {
    const appName = 'EduVia';
    const to = String(params.to || '').trim().toLowerCase();
    if (!to) {
      throw new Error('Email destinataire invalide');
    }

    const fromEmail = this.configService.getOrThrow('SMTP_FROM_EMAIL');
    const fromName = this.configService.get('SMTP_FROM_NAME') || appName;
    const greetingName = params.studentName?.trim() || to;
    const logoAssets = this.getLogoEmailAssets(appName);
    const escapedMessage = String(params.message || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');

    await this.transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: params.title || 'Rappel de votre enseignant',
      attachments: logoAssets.attachment ? [logoAssets.attachment] : [],
      text: `Bonjour ${greetingName},\n\n${params.message}\n\nL'equipe ${appName}`,
      html: `
        <div style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#091224;">
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dde3ef;">
            <div style="padding:28px 32px;background:linear-gradient(135deg,#8b1e3f 0%,#c62828 55%,#ef5350 100%);color:#ffffff;">
              ${logoAssets.markup}
              <h1 style="margin:18px 0 0;font-size:28px;line-height:1.2;">${params.title}</h1>
            </div>
            <div style="padding:28px 32px;">
              <p style="margin:0 0 18px;font-size:16px;">Bonjour ${greetingName},</p>
              <div style="padding:18px 20px;border-radius:18px;background:#f8fafc;border:1px solid #dde3ef;line-height:1.7;">
                ${escapedMessage}
              </div>
              <p style="margin:22px 0 0;color:#31405d;">Bon courage dans vos revisions.<br />L'equipe ${appName}</p>
            </div>
          </div>
        </div>
      `,
    });
  }

  async sendMeetSessionEmail(params: {
    to: string;
    studentName?: string;
    title: string;
    message: string;
    joinUrl: string;
  }): Promise<void> {
    const appName = 'EduVia';
    const to = String(params.to || '').trim().toLowerCase();
    if (!to) {
      throw new Error('Email destinataire invalide');
    }

    const fromEmail = this.configService.getOrThrow('SMTP_FROM_EMAIL');
    const fromName = this.configService.get('SMTP_FROM_NAME') || appName;
    const greetingName = params.studentName?.trim() || to;
    const logoAssets = this.getLogoEmailAssets(appName);
    const escapedMessage = String(params.message || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');

    await this.transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: params.title || 'Nouvelle session Meet EduVia',
      attachments: logoAssets.attachment ? [logoAssets.attachment] : [],
      text: `Bonjour ${greetingName},

${params.message}

Ouvrir la session : ${params.joinUrl}

L'equipe ${appName}`,
      html: `
        <div style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#091224;">
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dde3ef;">
            <div style="padding:28px 32px;background:linear-gradient(135deg,#0f766e 0%,#2563eb 100%);color:#ffffff;">
              ${logoAssets.markup}
              <h1 style="margin:18px 0 0;font-size:28px;line-height:1.2;">${params.title}</h1>
            </div>
            <div style="padding:28px 32px;">
              <p style="margin:0 0 18px;font-size:16px;">Bonjour ${greetingName},</p>
              <div style="padding:18px 20px;border-radius:18px;background:#f8fafc;border:1px solid #dde3ef;line-height:1.7;">
                ${escapedMessage}
              </div>
              <div style="text-align:center;margin:26px 0 0;">
                <a href="${params.joinUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;">
                  Ouvrir la session
                </a>
              </div>
            </div>
          </div>
        </div>
      `,
    });
  }

  async sendPlannerReminderEmail(params: {
    to: string;
    studentName?: string;
    eventTitle: string;
    eventDateLabel: string;
    eventTime: string;
    message: string;
  }): Promise<void> {
    const appName = 'EduVia';
    const to = String(params.to || '').trim().toLowerCase();
    if (!to) {
      throw new Error('Email destinataire invalide');
    }

    const fromEmail = this.configService.getOrThrow('SMTP_FROM_EMAIL');
    const fromName = this.configService.get('SMTP_FROM_NAME') || appName;
    const greetingName = params.studentName?.trim() || to;
    const logoAssets = this.getLogoEmailAssets(appName);
    const title = `Rappel EduVia - ${params.eventTitle}`;
    const escapedMessage = String(params.message || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');

    await this.transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: title,
      attachments: logoAssets.attachment ? [logoAssets.attachment] : [],
      text: `Bonjour ${greetingName},

${params.message}

Evenement : ${params.eventTitle}
Date : ${params.eventDateLabel}
Heure : ${params.eventTime}

Ce rappel est programme parce que vous avez clique sur l'alerte dans votre calendrier.

L'equipe ${appName}`,
      html: `
        <div style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#091224;">
          <div style="max-width:680px;margin:0 auto;background:#101214;border-radius:24px;overflow:hidden;border:1px solid #2b3038;box-shadow:0 22px 46px rgba(9,18,36,0.16);">
            <div style="padding:34px 36px;background:linear-gradient(135deg,#9f1239 0%,#dc2626 56%,#f43f5e 100%);color:#ffffff;">
              ${logoAssets.markup}
              <h1 style="margin:22px 0 0;font-size:32px;line-height:1.15;color:#ffffff;">${title}</h1>
            </div>
            <div style="padding:34px 36px;background:#101214;color:#e5e7eb;">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#dbe4f0;">Bonjour <strong>${greetingName}</strong>,</p>
              <div style="padding:22px 24px;border-radius:18px;background:#1f2329;border:1px solid #343b46;line-height:1.8;color:#f8fafc;font-size:15px;">
                ${escapedMessage}
              </div>
              <div style="margin-top:22px;padding:18px 20px;border-radius:16px;background:#171a1f;border:1px solid #303640;color:#dbe4f0;">
                <p style="margin:0 0 8px;"><strong>Evenement :</strong> ${params.eventTitle}</p>
                <p style="margin:0 0 8px;"><strong>Date :</strong> ${params.eventDateLabel}</p>
                <p style="margin:0;"><strong>Heure :</strong> ${params.eventTime}</p>
              </div>
              <p style="margin:22px 0 0;color:#9ca3af;font-size:14px;line-height:1.7;">
                Ce rappel est programme uniquement parce que vous avez clique sur l'alerte dans votre calendrier. EduVia vous rappelle de vous preparer 24h avant cet evenement.
              </p>
            </div>
          </div>
        </div>
      `,
    });
  }
}
