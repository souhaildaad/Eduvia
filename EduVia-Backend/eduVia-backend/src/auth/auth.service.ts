import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import KcAdminClient from '@keycloak/keycloak-admin-client';
// import { UsersService } from '../users/users.service';         // Décommente quand MongoDB est actif
// import { EmailService } from '../email/email.service';        // Décommente quand tu utilises ton service email

@Injectable()
export class AuthService {
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  private kcAdmin: KcAdminClient;

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    // private usersService: UsersService,     // Pour MongoDB
    // private emailService: EmailService,     // Pour envoi emails custom
  ) {
    this.keycloakUrl = this.configService.getOrThrow<string>('KEYCLOAK_URL');
    this.realm = this.configService.getOrThrow<string>('KEYCLOAK_REALM');
    this.clientId = this.configService.getOrThrow<string>('KEYCLOAK_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('KEYCLOAK_CLIENT_SECRET');
    this.adminUsername = this.configService.getOrThrow<string>('KEYCLOAK_ADMIN_USERNAME');
    this.adminPassword = this.configService.getOrThrow<string>('KEYCLOAK_ADMIN_PASSWORD');

    this.kcAdmin = new KcAdminClient({
      baseUrl: this.keycloakUrl,
      realmName: this.realm,
    });
  }

  // ────────────────────────────────────────────────
  // Méthode privée : authentification admin
  // ────────────────────────────────────────────────
  private async authenticateAdmin(): Promise<void> {
    try {
      await this.kcAdmin.auth({
        username: this.adminUsername,
        password: this.adminPassword,
        grantType: 'password',
        clientId: 'admin-cli',
      });
    } catch (error: any) {
      console.error('Échec authentification admin Keycloak:', error.message);
      throw new HttpException(
        'Erreur interne Keycloak (admin)',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ────────────────────────────────────────────────
  // LOGIN – User Story 1.2
  // ────────────────────────────────────────────────
  async login(email: string, password: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          username: email,
          password,
          scope: 'openid profile email',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const decoded = this.jwtService.decode(access_token) as any;

      // Mise à jour last login (quand MongoDB sera activé)
      // await this.usersService.updateLastLogin(decoded.sub);

      return {
        access_token,
        refresh_token,
        expires_in,
        user: {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name || `${decoded.given_name || ''} ${decoded.family_name || ''}`.trim(),
          preferred_username: decoded.preferred_username,
        },
      };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.data?.error === 'invalid_grant') {
        throw new UnauthorizedException('Identifiants invalides');
      }
      console.error('Erreur login:', error.message);
      throw new HttpException('Échec connexion', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ────────────────────────────────────────────────
  // REFRESH TOKEN
  // ────────────────────────────────────────────────
  async refreshToken(refreshToken: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token || refreshToken,
        expires_in: response.data.expires_in,
      };
    } catch (error: any) {
      console.error('Erreur refresh:', error.response?.data || error.message);
      throw new UnauthorizedException('Token de rafraîchissement invalide');
    }
  }

  // ────────────────────────────────────────────────
  // LOGOUT – User Story 1.6
  // ────────────────────────────────────────────────
  async logout(refreshToken: string): Promise<boolean> {
    try {
      await axios.post(
        `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/logout`,
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      return true;
    } catch (error: any) {
      console.warn('Logout échoué (peut-être déjà invalide):', error.message);
      return false;
    }
  }

  // ────────────────────────────────────────────────
  // CHANGE PASSWORD – User Story 1.3
  // ────────────────────────────────────────────────
  async changePassword(userId: string, newPassword: string): Promise<void> {
    try {
      await this.authenticateAdmin();

      await this.kcAdmin.users.resetPassword({
        id: userId,
        credential: {
          type: 'password',
          value: newPassword,
          temporary: false,
        },
      });

      // await this.usersService.markPasswordChanged(userId); // Quand MongoDB actif
    } catch (error: any) {
      console.error('Erreur changement mot de passe:', error);
      throw new HttpException(
        'Échec changement mot de passe',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ────────────────────────────────────────────────
  // FORGOT PASSWORD – User Story 1.4
  // ────────────────────────────────────────────────
  async forgotPassword(email: string): Promise<void> {
    try {
      await this.authenticateAdmin();

      const users = await this.kcAdmin.users.find({ email, exact: true });
      if (users.length === 0) {
        return; // Sécurité : on ne dit pas si l'email existe
      }

      const userId = users[0].id!;

      await this.kcAdmin.users.executeActionsEmail({
        id: userId,
        actions: ['UPDATE_PASSWORD'],
        lifespan: 3600, // 1 heure
        // redirectUri: 'http://localhost:4200/reset-password', // optionnel
      });
    } catch (error: any) {
      console.error('Erreur forgot password:', error);
      // Pas d'erreur renvoyée au client (sécurité)
    }
  }

  // ────────────────────────────────────────────────
  // UPDATE PROFILE – User Story 1.5
  // ────────────────────────────────────────────────
  async updateProfile(
    userId: string,
    updates: { firstName?: string; lastName?: string; email?: string },
  ): Promise<void> {
    try {
      await this.authenticateAdmin();

      await this.kcAdmin.users.update(
        { id: userId },
        {
          firstName: updates.firstName,
          lastName: updates.lastName,
          email: updates.email,
          emailVerified: updates.email ? true : undefined,
        },
      );

      // await this.usersService.updateProfile(userId, updates); // MongoDB
    } catch (error: any) {
      console.error('Erreur mise à jour profil:', error);
      throw new HttpException('Échec mise à jour profil', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ────────────────────────────────────────────────
  // GET PROFILE
  // ────────────────────────────────────────────────
  async getProfile(userId: string): Promise<any> {
    try {
      await this.authenticateAdmin();
      const user = await this.kcAdmin.users.findOne({ id: userId });

      if (!user) {
        throw new HttpException('Utilisateur introuvable', HttpStatus.NOT_FOUND);
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: user.enabled,
      };
    } catch (error: any) {
      console.error('Erreur récupération profil:', error);
      throw new HttpException('Échec récupération profil', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ────────────────────────────────────────────────
  // CRÉATION UTILISATEUR + ENVOI IDENTIFIANTS – User Story 1.1
  // ────────────────────────────────────────────────
  async createAndSendCredentials(
    email: string,
    username: string,
    firstName?: string,
    lastName?: string,
  ): Promise<{ keycloakId: string; message: string }> {
    try {
      await this.authenticateAdmin();

      // Vérification existence
      const existing = await this.kcAdmin.users.find({ username, email, exact: true });
      if (existing.length > 0) {
        throw new HttpException('Utilisateur existe déjà', HttpStatus.CONFLICT);
      }

      const tempPassword = this.generateTempPassword();

      const created = await this.kcAdmin.users.create({
        username,
        email,
        enabled: true,
        emailVerified: false,
        firstName: firstName || '',
        lastName: lastName || '',
        credentials: [{
          type: 'password',
          value: tempPassword,
          temporary: true,
        }],
      });

      const keycloakId = created.id!;

      // Envoi email (adapte selon ton EmailService)
      // await this.emailService.sendCredentialsEmail({
      //   to: email,
      //   username,
      //   tempPassword,
      //   appName: 'EduVia',
      //   loginUrl: this.configService.get('FRONTEND_URL') + '/login',
      // });

      // await this.usersService.create({ keycloakId, email, username, ... }); // MongoDB

      return {
        keycloakId,
        message: `Compte créé. Identifiants envoyés à ${email}`,
      };
    } catch (error: any) {
      console.error('Erreur création + credentials:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException('Échec création compte', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let pw = '';
    for (let i = 0; i < 12; i++) {
      pw += chars[Math.floor(Math.random() * chars.length)];
    }
    return pw;
  }
}