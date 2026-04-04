import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import KcAdminClient from '@keycloak/keycloak-admin-client';
import { URL } from 'url';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.schema';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  private kcAdmin: KcAdminClient;
  private readonly logger = new Logger(AuthService.name);

  private resolveAppRole(roles: string[]): 'admin' | 'teacher' | 'student' | null {
    if (roles.includes('admin')) return 'admin';
    if (roles.includes('teacher')) return 'teacher';
    if (roles.includes('student')) return 'student';
    return null;
  }

  private async authenticateAdmin(): Promise<void> {
    const adminRealm = this.configService.get('KEYCLOAK_ADMIN_REALM') || 'master';
    const targetRealm = this.configService.get('KEYCLOAK_REALM') || 'master';

    this.kcAdmin.setConfig({ realmName: adminRealm });

    await this.kcAdmin.auth({
      username:
        this.configService.get('KEYCLOAK_ADMIN_USERNAME') ||
        this.configService.get('KEYCLOAK_ADMIN_USER'),
      password: this.configService.get('KEYCLOAK_ADMIN_PASSWORD'),
      grantType: 'password',
      clientId: 'admin-cli',
    });

    this.kcAdmin.setConfig({ realmName: targetRealm });
  }

  private async syncUserToMongo(params: {
    userId: string;
    email: string;
    role: 'teacher' | 'student' | 'admin';
    username: string;
    firstName?: string;
    lastName?: string;
  }) {
    const { userId, email, role, username, firstName, lastName } = params;
    const updateData = {
      keycloakId: userId,
      email,
      role,
      firstName: firstName?.trim() || username,
      lastName: lastName?.trim() || role,
      passwordChanged: false,
      isBlocked: false,
    };

    const existingByKeycloakId = await this.userModel.findOne({ keycloakId: userId });
    if (existingByKeycloakId) {
      Object.assign(existingByKeycloakId, updateData);
      return existingByKeycloakId.save();
    }

    const existingByEmail = await this.userModel.findOne({ email });
    if (existingByEmail) {
      Object.assign(existingByEmail, updateData);
      return existingByEmail.save();
    }

    return this.userModel.create(updateData);
  }

  private async findManagedUserOrThrow(identifier: string) {
    const query = Types.ObjectId.isValid(identifier)
      ? { $or: [{ _id: identifier }, { keycloakId: identifier }] }
      : { keycloakId: identifier };

    const user = await this.userModel.findOne(query);

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return user;
  }

  private async ensureRealmRoleAssigned(
    userId: string,
    role: 'teacher' | 'student',
  ): Promise<void> {
    const roleRep = await this.kcAdmin.roles.findOneByName({ name: role });
    if (!roleRep || !roleRep.id || !roleRep.name) {
      throw new HttpException(
        `Role '${role}' not found or invalid in Keycloak`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const currentRoles = await this.kcAdmin.users.listRealmRoleMappings({ id: userId });
    const removableRoles = currentRoles.filter((mappedRole: any) =>
      ['teacher', 'student'].includes(mappedRole.name),
    );

    if (removableRoles.length > 0) {
      await this.kcAdmin.users.delRealmRoleMappings({
        id: userId,
        roles: removableRoles.map((mappedRole: any) => ({
          id: mappedRole.id,
          name: mappedRole.name,
        })),
      });
    }

    await this.kcAdmin.users.addRealmRoleMappings({
      id: userId,
      roles: [
        {
          ...roleRep,
          id: roleRep.id,
          name: roleRep.name,
        },
      ],
    });
  }

  private getEmailVerificationSecret(): string {
    return (
      this.configService.get('EMAIL_VERIFICATION_SECRET') ||
      this.configService.get('JWT_SECRET') ||
      this.configService.get('KEYCLOAK_CLIENT_SECRET') ||
      'eduvia-email-verification-secret'
    );
  }

  private buildEmailVerificationLink(params: {
    userId: string;
    email: string;
    role: 'teacher' | 'student';
  }): string {
    const backendUrl =
      this.configService.get('BACKEND_URL') || 'http://localhost:3000';
    const token = this.jwtService.sign(
      {
        sub: params.userId,
        email: params.email,
        role: params.role,
        type: 'email-verification',
      },
      {
        secret: this.getEmailVerificationSecret(),
        expiresIn: '7d',
      },
    );

    return `${backendUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
  }

  private async inspectKeycloakLoginBlockers(email: string): Promise<{
    exists: boolean;
    enabled?: boolean;
    emailVerified?: boolean;
    requiredActions?: string[];
  }> {
    await this.authenticateAdmin();

    const users = await this.kcAdmin.users.find({ email, exact: true });
    const user = users.find(
      (candidate: any) => candidate.email?.toLowerCase() === email.toLowerCase(),
    );

    if (!user) {
      return { exists: false };
    }

    return {
      exists: true,
      enabled: user.enabled,
      emailVerified: user.emailVerified,
      requiredActions: Array.isArray(user.requiredActions) ? user.requiredActions : [],
    };
  }

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    private usersService: UsersService,
    private emailService: EmailService,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {
    this.kcAdmin = new KcAdminClient({
      baseUrl: this.configService.get('KEYCLOAK_URL'),
      realmName: this.configService.get('KEYCLOAK_REALM'),
    });
  }

  // ───────── LOGIN ─────────
  async login(email: string, password: string) {
    try {
      const response = await axios.post(
        `${this.configService.get('KEYCLOAK_URL')}/realms/${this.configService.get('KEYCLOAK_REALM')}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: this.configService.get('KEYCLOAK_CLIENT_ID') || '',
          client_secret: this.configService.get('KEYCLOAK_CLIENT_SECRET') || '',
          username: email,
          password,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const { access_token, refresh_token } = response.data;
      const decoded: any = this.jwtService.decode(access_token);

      const userId = decoded.sub;
      const roles = decoded.realm_access?.roles || [];
      const appRole = this.resolveAppRole(roles);

      let user = await this.userModel.findOne({ keycloakId: userId });

      if (!user) {
        user = new this.userModel({
          keycloakId: userId,
          email: decoded.email || 'user@test.com',
          role: appRole || 'student',
          firstName: decoded.given_name || 'User',
          lastName: decoded.family_name || 'Keycloak',
          passwordChanged: false,
        });
        await user.save();
      } else if ((!user.role || !['admin', 'teacher', 'student'].includes(user.role)) && appRole) {
        user.role = appRole;
        await user.save();
      }

      await this.usersService.handleFirstLogin(userId);

      const blocked = await this.usersService.checkAndBlockIfNeeded(userId, roles);
      if (blocked) {
        throw new HttpException('Compte bloqué', HttpStatus.FORBIDDEN);
      }

      // Pour les admins → on marque directement le mot de passe comme changé
      if (roles.includes('admin')) {
        await this.usersService.markPasswordChanged(userId);
      }

      const mainRole = appRole;

      const passwordChanged = await this.usersService.isPasswordChanged(userId);

      // L'obligation de changer le mot de passe ne concerne QUE teacher et student
      const requiresPasswordChange = roles.some((role) =>
        ['teacher', 'student'].includes(role)
      );

      return {
        access_token,
        refresh_token,
        user: {
          id: userId,
          email: decoded.email,
          roles,
          role: mainRole,
        },
        needsPasswordChange: requiresPasswordChange && !passwordChanged,
      };
    } catch (error: any) {
      this.logger.error(
        `[LOGIN] Keycloak token request failed: status=${error.response?.status ?? 'unknown'} payload=${JSON.stringify(error.response?.data ?? error.message)}`,
      );

      if (
        error.response?.status === 400 &&
        error.response?.data?.error === 'invalid_grant' &&
        error.response?.data?.error_description === 'Account is not fully set up'
      ) {
        const blockers = await this.inspectKeycloakLoginBlockers(email);

        if (blockers.exists && blockers.enabled === false) {
          throw new HttpException('Compte desactive ou bloque dans Keycloak', HttpStatus.FORBIDDEN);
        }

        if (blockers.exists && blockers.emailVerified === false) {
          throw new HttpException(
            'Email non verifie. Cliquez d abord sur le lien recu par email.',
            HttpStatus.BAD_REQUEST,
          );
        }

        if (blockers.exists && (blockers.requiredActions || []).length > 0) {
          throw new HttpException(
            `Compte Keycloak incomplet. Actions requises restantes: ${(blockers.requiredActions || []).join(', ')}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      if (error.response?.status === 401) {
        throw new UnauthorizedException(
          error.response?.data?.error_description ||
            error.response?.data?.error ||
            'Identifiants invalides',
        );
      }
      throw new HttpException(
        error.response?.data?.error_description || 'Echec connexion',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ───────── LOGOUT ─────────
  async logout(refreshToken: string) {
    await axios.post(
      `${this.configService.get('KEYCLOAK_URL')}/realms/${this.configService.get('KEYCLOAK_REALM')}/protocol/openid-connect/logout`,
      new URLSearchParams({
        client_id: this.configService.get('KEYCLOAK_CLIENT_ID') || '',
        client_secret: this.configService.get('KEYCLOAK_CLIENT_SECRET') || '',
        refresh_token: refreshToken,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
  }

  // ───────── REFRESH ─────────
  async refreshToken(refreshToken: string) {
    const response = await axios.post(
      `${this.configService.get('KEYCLOAK_URL')}/realms/${this.configService.get('KEYCLOAK_REALM')}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.configService.get('KEYCLOAK_CLIENT_ID') || '',
        client_secret: this.configService.get('KEYCLOAK_CLIENT_SECRET') || '',
        refresh_token: refreshToken,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return response.data;
  }

  // ───────── CHANGE PASSWORD ─────────
  async changePassword(userId: string, newPassword: string) {
    await this.authenticateAdmin();

    await this.kcAdmin.users.resetPassword({
      id: userId,
      credential: {
        type: 'password',
        value: newPassword,
        temporary: false,
      },
    });

    await this.usersService.markPasswordChanged(userId);
  }

  async verifyEmailAndBuildRedirect(token: string): Promise<string> {
    if (!token) {
      throw new HttpException('Lien de verification manquant', HttpStatus.BAD_REQUEST);
    }

    let payload: any;

    try {
      payload = this.jwtService.verify(token, {
        secret: this.getEmailVerificationSecret(),
      });
    } catch {
      throw new HttpException('Lien de verification invalide ou expire', HttpStatus.BAD_REQUEST);
    }

    if (payload?.type !== 'email-verification' || !payload?.sub || !payload?.role) {
      throw new HttpException('Jeton de verification invalide', HttpStatus.BAD_REQUEST);
    }

    await this.authenticateAdmin();

    await this.kcAdmin.users.update(
      { id: payload.sub },
      {
        emailVerified: true,
      } as any,
    );

    await this.userModel.updateOne(
      { keycloakId: payload.sub },
      {
        $set: {
          emailVerified: true,
        },
      },
    );

    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    const redirectUrl = new URL(frontendUrl);
    redirectUrl.searchParams.set('role', payload.role);
    redirectUrl.searchParams.set('verified', '1');

    return redirectUrl.toString();
  }

  // ───────── CREATE USER ─────────
  async createAndSendCredentials(
    email: string,
    username: string,
    role: 'teacher' | 'student',
    firstName?: string,
    lastName?: string,
  ) {
    await this.authenticateAdmin();

    const tempPassword = Math.random().toString(36).slice(-8);
    let userId: string | undefined;
    let reusedExistingUser = false;
    let shouldSendCredentials = true;

    try {
      const created = await this.kcAdmin.users.create({
        username,
        email,
        enabled: true,
        emailVerified: false,
        firstName,
        lastName,
        credentials: [
          {
            type: 'password',
            value: tempPassword,
            temporary: false,
          },
        ],
        requiredActions: [],
      });

      userId = created.id;
    } catch (error: any) {
      if (error.response?.status !== 409) {
        throw error;
      }

      const existingUsers = await this.kcAdmin.users.find({ email, exact: true });
      const existingUser = existingUsers.find(
        (user: any) => user.email?.toLowerCase() === email.toLowerCase(),
      );

      if (!existingUser?.id) {
        throw new HttpException('User exists in Keycloak but could not be loaded', HttpStatus.CONFLICT);
      }

      userId = existingUser.id;
      reusedExistingUser = true;
    }

    const roleRep = await this.kcAdmin.roles.findOneByName({ name: role });
    if (!roleRep || !roleRep.id || !roleRep.name) {
      throw new HttpException(
        `Role '${role}' not found or invalid in Keycloak`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const rolePayload = {
      ...roleRep,
      id: roleRep.id,
      name: roleRep.name,
    };

    const currentRoles = await this.kcAdmin.users.listRealmRoleMappings({ id: userId });
    const hasRoleAlready = currentRoles.some((mappedRole: any) => mappedRole.name === role);

    if (!hasRoleAlready) {
      await this.kcAdmin.users.addRealmRoleMappings({
        id: userId,
        roles: [rolePayload],
      });
    }

    if (reusedExistingUser) {
      await this.kcAdmin.users.update(
        { id: userId },
        {
          username,
          email,
          enabled: true,
          emailVerified: false,
          firstName,
          lastName,
          requiredActions: [],
        } as any,
      );

      await this.kcAdmin.users.resetPassword({
        id: userId,
        credential: {
          type: 'password',
          value: tempPassword,
          temporary: false,
        },
      });
    }

    const savedUser = await this.syncUserToMongo({
      userId,
      email,
      role,
      username,
      firstName,
      lastName,
    });

    if (!hasRoleAlready) {
      const verificationLink = this.buildEmailVerificationLink({
        userId,
        email,
        role,
      });

      await this.emailService.sendIdentificationEmail(
        email,
        userId,
        tempPassword,
        role,
        firstName,
        verificationLink,
      );
    } else if (reusedExistingUser && shouldSendCredentials) {
      const verificationLink = this.buildEmailVerificationLink({
        userId,
        email,
        role,
      });

      await this.emailService.sendIdentificationEmail(
        email,
        userId,
        tempPassword,
        role,
        firstName,
        verificationLink,
      );
    }

    return {
      message: reusedExistingUser
        ? 'Existing user updated in Keycloak, password reset, and credentials sent'
        : 'User created and credentials sent',
      userId,
      data: {
        id: savedUser?._id,
        keycloakId: userId,
        email,
        username,
        firstName: savedUser?.firstName,
        lastName: savedUser?.lastName,
        role,
      },
    };
  }

  async updateManagedUser(
    identifier: string,
    params: {
      email: string;
      username: string;
      role: 'teacher' | 'student';
      firstName?: string;
      lastName?: string;
    },
  ) {
    const user = await this.findManagedUserOrThrow(identifier);
    await this.authenticateAdmin();

    await this.kcAdmin.users.update(
      { id: user.keycloakId },
      {
        email: params.email,
        username: params.username,
        firstName: params.firstName,
        lastName: params.lastName,
        enabled: !user.isBlocked,
      } as any,
    );

    await this.ensureRealmRoleAssigned(user.keycloakId, params.role);

    const savedUser = await this.syncUserToMongo({
      userId: user.keycloakId,
      email: params.email,
      role: params.role,
      username: params.username,
      firstName: params.firstName,
      lastName: params.lastName,
    });

    return {
      success: true,
      message: 'User updated successfully',
      data: {
        id: savedUser?._id,
        keycloakId: user.keycloakId,
        email: savedUser?.email,
        firstName: savedUser?.firstName,
        lastName: savedUser?.lastName,
        role: savedUser?.role,
      },
    };
  }

  async deleteManagedUser(identifier: string) {
    const user = await this.findManagedUserOrThrow(identifier);
    await this.authenticateAdmin();

    try {
      await this.kcAdmin.users.del({ id: user.keycloakId });
    } catch (error: any) {
      if (error.response?.status !== 404) {
        throw error;
      }

      this.logger.warn(
        `[DELETE USER] Keycloak user already missing: keycloakId=${user.keycloakId} email=${user.email}`,
      );
    }

    await this.userModel.deleteOne({ _id: user._id });

    return {
      success: true,
      message: 'User deleted successfully',
      data: {
        id: user._id,
        keycloakId: user.keycloakId,
        email: user.email,
      },
    };
  }
}
