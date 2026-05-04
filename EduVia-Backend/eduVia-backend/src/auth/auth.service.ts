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
import { createHash, randomBytes } from 'crypto';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.schema';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FACE_ID_MATCH_THRESHOLD,
  normalizeFaceIdNumber,
} from './face-id.constants';

type TeachingAssignmentInput = {
  subject?: string;
  classes?: string[];
};

type TeachingAssignment = {
  subject: string;
  classes: string[];
};

@Injectable()
export class AuthService {
  private kcAdmin: KcAdminClient;
  private readonly logger = new Logger(AuthService.name);

  private normalizeClassList(
    values: Array<string | null | undefined>,
  ): string[] {
    return [
      ...new Set(values.map((value) => value?.trim() || '').filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  private buildRoleFieldsForResponse(user: {
    role?: string;
    className?: string | null;
    assignedClasses?: string[];
    teachingSubjects?: string[];
    teachingAssignments?: TeachingAssignmentInput[];
  }) {
    const assignedClasses = this.normalizeClassList(user.assignedClasses || []);
    const teachingAssignments = this.resolveTeachingAssignments(
      assignedClasses,
      user.teachingSubjects || [],
      user.teachingAssignments || [],
    );
    const teachingSubjects = this.normalizeClassList(
      teachingAssignments.map((assignment) => assignment.subject),
    );
    const className =
      user.role === 'teacher'
        ? assignedClasses.join(', ')
        : user.className?.trim() || '';

    return {
      className,
      assignedClasses,
      teachingSubjects,
      teachingAssignments,
    };
  }

  private resolveAppRole(
    roles: string[],
  ): 'admin' | 'teacher' | 'student' | null {
    if (roles.includes('admin')) return 'admin';
    if (roles.includes('teacher')) return 'teacher';
    if (roles.includes('student')) return 'student';
    return null;
  }

  private async authenticateAdmin(): Promise<void> {
    const adminRealm =
      this.configService.get('KEYCLOAK_ADMIN_REALM') || 'master';
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
    className?: string | null;
    assignedClasses?: string[];
    teachingSubjects?: string[];
    teachingAssignments?: TeachingAssignmentInput[];
    resetPasswordState?: boolean;
  }) {
    const {
      userId,
      email,
      role,
      username,
      firstName,
      lastName,
      className,
      assignedClasses,
      teachingSubjects,
      teachingAssignments,
      resetPasswordState,
    } = params;
    const normalizedAssignedClasses =
      role === 'teacher' ? this.normalizeClassList(assignedClasses || []) : [];
    const normalizedTeachingAssignments =
      role === 'teacher'
        ? this.resolveTeachingAssignments(
            normalizedAssignedClasses,
            teachingSubjects || [],
            teachingAssignments || [],
          )
        : [];
    const normalizedTeachingSubjects = this.normalizeClassList(
      normalizedTeachingAssignments.map((assignment) => assignment.subject),
    );
    const updateData: any = {
      keycloakId: userId,
      email,
      role,
      firstName: firstName?.trim() || username,
      lastName: lastName?.trim() || role,
      className: role === 'student' ? className?.trim() || null : null,
      assignedClasses: normalizedAssignedClasses,
      teachingSubjects: role === 'teacher' ? normalizedTeachingSubjects : [],
      teachingAssignments:
        role === 'teacher' ? normalizedTeachingAssignments : [],
      isBlocked: false,
    };

    if (resetPasswordState) {
      updateData.passwordChanged = false;
      updateData.firstLoginAt = null;
    }

    const existingByKeycloakId = await this.userModel.findOne({
      keycloakId: userId,
    });
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

    const currentRoles = await this.kcAdmin.users.listRealmRoleMappings({
      id: userId,
    });
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

  private normalizeRoleSpecificFields(params: {
    role: 'teacher' | 'student';
    className?: string;
    assignedClasses?: string[];
    teachingSubjects?: string[];
    teachingAssignments?: TeachingAssignmentInput[];
  }): {
    className: string | null;
    assignedClasses: string[];
    teachingSubjects: string[];
    teachingAssignments: TeachingAssignment[];
  } {
    const className = params.className?.trim();
    const assignedClasses = [
      ...new Set(
        (params.assignedClasses || [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    const teachingAssignments = this.resolveTeachingAssignments(
      assignedClasses,
      params.teachingSubjects || [],
      params.teachingAssignments || [],
    );
    const teachingSubjects = this.normalizeClassList(
      teachingAssignments.map((assignment) => assignment.subject),
    );

    if (params.role === 'student') {
      if (!className) {
        throw new HttpException(
          'La classe est obligatoire pour un etudiant',
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        className,
        assignedClasses: [] as string[],
        teachingSubjects: [] as string[],
        teachingAssignments: [] as TeachingAssignment[],
      };
    }

    if (assignedClasses.length === 0) {
      throw new HttpException(
        'Au moins une classe doit etre affectee a un enseignant',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (teachingSubjects.length === 0) {
      throw new HttpException(
        'Au moins une matiere doit etre affectee a un enseignant',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      className: null,
      assignedClasses,
      teachingSubjects,
      teachingAssignments,
    };
  }

  private resolveTeachingAssignments(
    assignedClasses: string[],
    teachingSubjects: string[] = [],
    teachingAssignments: TeachingAssignmentInput[] = [],
  ): TeachingAssignment[] {
    const normalizedAssignedClasses = this.normalizeClassList(
      assignedClasses || [],
    );
    const classLookup = new Map(
      normalizedAssignedClasses.map((className) => [
        className.toLowerCase(),
        className,
      ]),
    );
    const assignmentMap = new Map<string, TeachingAssignment>();

    const addAssignment = (subjectValue?: string, classValues?: string[]) => {
      const subject = (subjectValue || '').trim();
      if (!subject) {
        return;
      }

      const requestedClasses = this.normalizeClassList(classValues || []);
      const classes =
        requestedClasses.length > 0
          ? requestedClasses
              .map((className) => classLookup.get(className.toLowerCase()))
              .filter((className): className is string => !!className)
          : normalizedAssignedClasses;

      if (classes.length === 0) {
        return;
      }

      const subjectKey = subject.toLowerCase();
      const existing = assignmentMap.get(subjectKey);
      if (existing) {
        existing.classes = this.normalizeClassList([
          ...existing.classes,
          ...classes,
        ]);
        return;
      }

      assignmentMap.set(subjectKey, {
        subject,
        classes: this.normalizeClassList(classes),
      });
    };

    const hasDetailedAssignments = teachingAssignments.some(
      (assignment) => !!assignment?.subject?.trim(),
    );

    if (hasDetailedAssignments) {
      teachingAssignments.forEach((assignment) =>
        addAssignment(assignment?.subject, assignment?.classes),
      );
    } else {
      teachingSubjects.forEach((subject) =>
        addAssignment(subject, normalizedAssignedClasses),
      );
    }

    return Array.from(assignmentMap.values()).sort((left, right) =>
      left.subject.localeCompare(right.subject, 'fr'),
    );
  }

  private async ensureTeacherClassSubjectsAvailable(
    teachingAssignments: TeachingAssignment[],
    excludedKeycloakId?: string,
  ): Promise<void> {
    if (teachingAssignments.length === 0) {
      return;
    }

    const assignedClasses = this.normalizeClassList(
      teachingAssignments.flatMap((assignment) => assignment.classes),
    );
    const conflictingTeachers = await this.userModel
      .find({
        role: 'teacher',
        assignedClasses: { $in: assignedClasses },
        ...(excludedKeycloakId
          ? { keycloakId: { $ne: excludedKeycloakId } }
          : {}),
      })
      .select(
        'firstName lastName assignedClasses teachingSubjects teachingAssignments keycloakId',
      );

    const requestedPairs = new Set(
      teachingAssignments.flatMap((assignment) =>
        assignment.classes.map(
          (className) =>
            `${className.toLowerCase()}::${assignment.subject.toLowerCase()}`,
        ),
      ),
    );
    const conflicts = conflictingTeachers.flatMap((teacher) =>
      this.resolveTeachingAssignments(
        teacher.assignedClasses || [],
        teacher.teachingSubjects || [],
        (teacher as any).teachingAssignments || [],
      ).flatMap((assignment) =>
        assignment.classes
          .filter((className) =>
            requestedPairs.has(
              `${className.toLowerCase()}::${assignment.subject.toLowerCase()}`,
            ),
          )
          .map((className) => ({
            className,
            subject: assignment.subject,
            teacherName:
              `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
          })),
      ),
    );

    if (conflicts.length === 0) {
      return;
    }

    const conflictMessage = conflicts
      .map((conflict) =>
        conflict.teacherName
          ? `${conflict.subject} en ${conflict.className} deja affectee a ${conflict.teacherName}`
          : `${conflict.subject} en ${conflict.className} deja affectee`,
      )
      .join(', ');

    throw new HttpException(conflictMessage, HttpStatus.CONFLICT);
  }

  private getEmailVerificationSecret(): string {
    return (
      this.configService.get('EMAIL_VERIFICATION_SECRET') ||
      this.configService.get('JWT_SECRET') ||
      this.configService.get('KEYCLOAK_CLIENT_SECRET') ||
      'eduvia-email-verification-secret'
    );
  }

  private getPasswordResetSecret(): string {
    return (
      this.configService.get('PASSWORD_RESET_SECRET') ||
      this.configService.get('JWT_SECRET') ||
      this.configService.get('KEYCLOAK_CLIENT_SECRET') ||
      'eduvia-password-reset-secret'
    );
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private hammingDistance(left: string, right: string) {
    if (left.length !== right.length) {
      return Number.POSITIVE_INFINITY;
    }

    return Array.from(left).reduce(
      (distance, bit, index) => distance + (bit === right[index] ? 0 : 1),
      0,
    );
  }

  private buildAppAccessToken(user: User) {
    const roles = [user.role].filter(Boolean);
    return this.jwtService.sign(
      {
        sub: user.keycloakId,
        email: user.email,
        preferred_username: user.email,
        realm_access: { roles },
        roles,
        typ: 'face-id',
      },
      {
        secret: this.configService.get('JWT_SECRET') || 'eduvia-face-id-secret',
        algorithm: 'HS256',
        issuer: `${this.configService.getOrThrow('KEYCLOAK_URL')}/realms/${this.configService.getOrThrow('KEYCLOAK_REALM')}`,
        expiresIn: '8h',
      },
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

  private buildRoleLoginRedirectUrl(role?: string): URL {
    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    const studentLoginUrl = this.configService.get('STUDENT_LOGIN_URL');
    const teacherLoginUrl = this.configService.get('TEACHER_LOGIN_URL');
    const explicitLoginUrl =
      role === 'student'
        ? studentLoginUrl
        : role === 'teacher'
          ? teacherLoginUrl
          : undefined;

    const redirectUrl = explicitLoginUrl
      ? new URL(explicitLoginUrl, frontendUrl)
      : new URL(frontendUrl);

    if (role === 'student' || role === 'teacher') {
      redirectUrl.searchParams.set('role', role);
    }

    return redirectUrl;
  }

  buildEmailVerificationRedirect(params: {
    role?: string;
    verified: boolean;
    message?: string;
  }): string {
    const redirectUrl = this.buildRoleLoginRedirectUrl(params.role);

    redirectUrl.searchParams.set('verified', params.verified ? '1' : '0');

    if (params.message) {
      redirectUrl.searchParams.set('message', params.message);
    }

    return redirectUrl.toString();
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
      (candidate: any) =>
        candidate.email?.toLowerCase() === email.toLowerCase(),
    );

    if (!user) {
      return { exists: false };
    }

    return {
      exists: true,
      enabled: user.enabled,
      emailVerified: user.emailVerified,
      requiredActions: Array.isArray(user.requiredActions)
        ? user.requiredActions
        : [],
    };
  }

  private async verifyPasswordAgainstKeycloak(
    email: string,
    password: string,
  ): Promise<void> {
    try {
      await axios.post(
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
    } catch (error: any) {
      if (
        error.response?.status === 400 &&
        error.response?.data?.error === 'invalid_grant'
      ) {
        throw new UnauthorizedException('Ancien mot de passe incorrect');
      }

      throw new HttpException(
        error.response?.data?.error_description ||
          'Echec de verification du mot de passe',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    private usersService: UsersService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
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
      } else if (
        (!user.role || !['admin', 'teacher', 'student'].includes(user.role)) &&
        appRole
      ) {
        user.role = appRole;
        await user.save();
      }

      await this.usersService.handleFirstLogin(userId);

      const blocked = await this.usersService.checkAndBlockIfNeeded(
        userId,
        roles,
      );
      if (blocked) {
        throw new HttpException('Compte bloqué', HttpStatus.FORBIDDEN);
      }
      // Met a jour la derniere activite reelle apres une connexion reussie.
      await this.userModel.updateOne(
        { keycloakId: userId },
        {
          $set: {
            lastLogin: new Date(),
          },
        },
      );
      // Pour les admins → on marque directement le mot de passe comme changé
      if (roles.includes('admin')) {
        await this.usersService.markPasswordChanged(userId);
      }

      const mainRole = appRole;

      const passwordChanged = await this.usersService.isPasswordChanged(userId);

      // L'obligation de changer le mot de passe ne concerne QUE teacher et student
      const requiresPasswordChange = roles.some((role) =>
        ['teacher', 'student'].includes(role),
      );
      const roleFields = this.buildRoleFieldsForResponse(user);

      return {
        access_token,
        refresh_token,
        user: {
          id: userId,
          email: decoded.email,
          roles,
          role: mainRole,
          className: roleFields.className,
          assignedClasses: roleFields.assignedClasses,
        },
        needsPasswordChange: requiresPasswordChange && !passwordChanged,
      };
    } catch (error: any) {
      const statusCode = error?.status || error?.response?.status;
      const errorPayload =
        error?.response?.data ?? error?.response ?? error?.message;

      if (error instanceof HttpException) {
        if (
          statusCode === HttpStatus.FORBIDDEN &&
          error?.message === 'Compte bloqué'
        ) {
          this.logger.warn(`[LOGIN] blocked account email=${email}`);
        } else {
          this.logger.warn(
            `[LOGIN] handled exception status=${statusCode ?? 'unknown'} payload=${JSON.stringify(errorPayload)}`,
          );
        }

        throw error;
      } else {
        this.logger.error(
          `[LOGIN] Keycloak token request failed: status=${statusCode ?? 'unknown'} payload=${JSON.stringify(errorPayload)}`,
        );
      }

      if (
        error.response?.status === 400 &&
        error.response?.data?.error === 'invalid_grant'
      ) {
        const errorDescription = error.response?.data?.error_description || '';

        if (errorDescription === 'Account disabled') {
          throw new HttpException(
            'Compte desactive ou bloque dans Keycloak',
            HttpStatus.FORBIDDEN,
          );
        }

        if (errorDescription !== 'Account is not fully set up') {
          throw new UnauthorizedException('Identifiants invalides');
        }

        const blockers = await this.inspectKeycloakLoginBlockers(email);

        if (blockers.exists && blockers.enabled === false) {
          throw new HttpException(
            'Compte desactive ou bloque dans Keycloak',
            HttpStatus.FORBIDDEN,
          );
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

  async loginWithFaceId(faceHash: string, role?: 'teacher' | 'student') {
    const candidates = await this.userModel
      .find({
        role: role || { $in: ['teacher', 'student'] },
        'profileData.faceIdHash': { $type: 'string' },
        isBlocked: { $ne: true },
      })
      .exec();

    const ranked = candidates
      .map((user) => ({
        user,
        distance: this.hammingDistance(
          faceHash,
          String(user.profileData?.faceIdHash || ''),
        ),
      }))
      .sort((left, right) => left.distance - right.distance);

    const matchThreshold = this.faceIdMatchThreshold();
    const best = ranked[0];
    if (!best || best.distance > matchThreshold) {
      throw new UnauthorizedException(
        "Face ID non reconnu. Utilisez la connexion classique.",
      );
    }

    const user = best.user;
    await this.usersService.handleFirstLogin(user.keycloakId);
    await this.userModel.updateOne(
      { keycloakId: user.keycloakId },
      { $set: { lastLogin: new Date() } },
    );

    return {
      access_token: this.buildAppAccessToken(user),
      refresh_token: '',
      role: user.role,
      user: {
        id: user._id,
        keycloakId: user.keycloakId,
        email: user.email,
        role: user.role,
        roles: [user.role],
        firstName: user.firstName,
        lastName: user.lastName,
        className: user.className,
      },
      faceMatchDistance: best.distance,
    };
  }

  private faceIdMatchThreshold() {
    return normalizeFaceIdNumber(
      this.configService.get('FACE_ID_MATCH_THRESHOLD'),
      FACE_ID_MATCH_THRESHOLD,
    );
  }

  // ───────── CHANGE PASSWORD ─────────
  async validateCurrentPasswordForSecurity(
    userId: string,
    currentPassword: string,
  ) {
    const user = await this.userModel.findOne({ keycloakId: userId });

    if (!user) {
      throw new HttpException('Utilisateur introuvable', HttpStatus.NOT_FOUND);
    }

    if (!currentPassword?.trim()) {
      throw new HttpException(
        'Ancien mot de passe obligatoire',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.verifyPasswordAgainstKeycloak(user.email, currentPassword);

    const passwordWasPreviouslyChangedByUser = !!user.passwordChanged;

    return {
      valid: true,
      canUseAsCurrentPassword: true,
      unlockNewPasswordFields: true,
      passwordWasPreviouslyChangedByUser,
      message: passwordWasPreviouslyChangedByUser
        ? 'Ancien mot de passe verifie'
        : 'Mot de passe temporaire verifie. Vous pouvez maintenant definir votre nouveau mot de passe.',
    };
  }

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
      throw new HttpException(
        'Lien de verification manquant',
        HttpStatus.BAD_REQUEST,
      );
    }

    let payload: any;

    try {
      payload = this.jwtService.verify(token, {
        secret: this.getEmailVerificationSecret(),
      });
    } catch {
      throw new HttpException(
        'Lien de verification invalide ou expire',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      payload?.type !== 'email-verification' ||
      !payload?.sub ||
      !payload?.email ||
      !['teacher', 'student'].includes(payload?.role)
    ) {
      throw new HttpException(
        'Jeton de verification invalide',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      await this.authenticateAdmin();

      await this.kcAdmin.users.update({ id: payload.sub }, {
        emailVerified: true,
      } as any);

      await this.userModel.updateOne(
        {
          $or: [
            { keycloakId: payload.sub },
            { email: String(payload.email).toLowerCase().trim() },
          ],
        },
        {
          $set: {
            emailVerified: true,
          },
        },
      );
    } catch (error: any) {
      this.logger.error(
        `[VERIFY EMAIL] userId=${payload.sub} role=${payload.role} status=${error?.response?.status ?? error?.status ?? 'unknown'} payload=${JSON.stringify(error?.response?.data ?? error?.message)}`,
      );

      if (error?.response?.status === 404) {
        throw new HttpException(
          'Utilisateur introuvable dans Keycloak',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'Echec de verification de l email',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return this.buildEmailVerificationRedirect({
      role: payload.role,
      verified: true,
      message:
        'Email verifie avec succes. Vous pouvez maintenant vous connecter.',
    });
  }

  // ───────── CREATE USER ─────────
  async requestPasswordReset(
    email: string,
    role?: 'teacher' | 'student',
  ): Promise<{ success: true; message: string }> {
    const normalizedEmail = email?.toLowerCase().trim();

    const query: any = {
      email: normalizedEmail,
      role: role || { $in: ['teacher', 'student'] },
    };

    const user = await this.userModel.findOne(query);

    // Avoid account enumeration.
    if (!user || !user.keycloakId) {
      return {
        success: true,
        message: 'If the account exists, a reset email has been sent',
      };
    }

    const tokenId = randomBytes(32).toString('hex');
    const resetToken = this.jwtService.sign(
      {
        sub: user.keycloakId,
        email: user.email,
        role: user.role,
        type: 'password-reset',
        jti: tokenId,
      },
      {
        secret: this.getPasswordResetSecret(),
        expiresIn: '1h',
      },
    );

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordTokenHash: this.hashToken(tokenId),
          resetPasswordExpiresAt: expiresAt,
        },
      },
    );

    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    const resetLink = `${frontendUrl}/?role=${user.role}&resetToken=${encodeURIComponent(
      resetToken,
    )}`;

    await this.emailService.sendPasswordResetEmail({
      to: user.email,
      resetLink,
      appName: 'EduVia',
      expirationMinutes: 60,
      firstName: user.firstName,
      role: user.role as 'teacher' | 'student',
    });

    return {
      success: true,
      message: 'If the account exists, a reset email has been sent',
    };
  }

  private async validateAndLoadPasswordResetToken(token: string): Promise<{
    user: User | null;
    payload: any;
  }> {
    if (!token) {
      throw new HttpException(
        'Reset token is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    let payload: any;

    try {
      payload = this.jwtService.verify(token, {
        secret: this.getPasswordResetSecret(),
      });
    } catch {
      throw new HttpException(
        'Reset token is invalid or expired',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      payload?.type !== 'password-reset' ||
      !payload?.sub ||
      !payload?.jti ||
      !payload?.role
    ) {
      throw new HttpException('Invalid reset token', HttpStatus.BAD_REQUEST);
    }

    const user = await this.userModel.findOne({
      keycloakId: payload.sub,
      role: payload.role,
    });

    if (!user || !user.resetPasswordTokenHash || !user.resetPasswordExpiresAt) {
      throw new HttpException('Reset token is invalid', HttpStatus.BAD_REQUEST);
    }

    if (user.resetPasswordExpiresAt.getTime() < Date.now()) {
      throw new HttpException(
        'Reset token has expired',
        HttpStatus.BAD_REQUEST,
      );
    }

    const providedHash = this.hashToken(payload.jti);
    if (providedHash !== user.resetPasswordTokenHash) {
      throw new HttpException(
        'Reset token is no longer valid',
        HttpStatus.BAD_REQUEST,
      );
    }

    return { user, payload };
  }

  async validateResetPasswordToken(token: string) {
    const { user } = await this.validateAndLoadPasswordResetToken(token);

    return {
      valid: true,
      role: user?.role,
      email: user?.email,
      expiresAt: user?.resetPasswordExpiresAt,
    };
  }

  async resetPasswordWithToken(token: string, newPassword: string) {
    const { user, payload } =
      await this.validateAndLoadPasswordResetToken(token);

    await this.authenticateAdmin();

    await this.kcAdmin.users.resetPassword({
      id: payload.sub,
      credential: {
        type: 'password',
        value: newPassword,
        temporary: false,
      },
    });

    await this.userModel.updateOne(
      { _id: user?._id },
      {
        $set: {
          passwordChanged: true,
          lastPasswordChange: new Date(),
          isBlocked: false,
          resetPasswordTokenHash: null,
          resetPasswordExpiresAt: null,
        },
      },
    );

    return {
      success: true,
      message: 'Password has been reset successfully',
    };
  }

  async createAndSendCredentials(
    email: string,
    username: string,
    role: 'teacher' | 'student',
    firstName?: string,
    lastName?: string,
    className?: string,
    assignedClasses?: string[],
    teachingSubjects?: string[],
    teachingAssignments?: TeachingAssignmentInput[],
  ) {
    await this.authenticateAdmin();
    const normalizedRoleFields = this.normalizeRoleSpecificFields({
      role,
      className,
      assignedClasses,
      teachingSubjects,
      teachingAssignments,
    });
    if (role === 'teacher') {
      await this.ensureTeacherClassSubjectsAvailable(
        normalizedRoleFields.teachingAssignments,
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const keycloakUsername = normalizedEmail;
    const tempPassword = Math.random().toString(36).slice(-8);
    let userId: string | undefined;
    let reusedExistingUser = false;
    let shouldSendCredentials = true;

    try {
      const created = await this.kcAdmin.users.create({
        username: keycloakUsername,
        email: normalizedEmail,
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

      const existingUsers = await this.kcAdmin.users.find({
        email: normalizedEmail,
        exact: true,
      });
      const existingUser = existingUsers.find(
        (user: any) => user.email?.toLowerCase() === normalizedEmail,
      );

      if (!existingUser?.id) {
        throw new HttpException(
          'User exists in Keycloak but could not be loaded',
          HttpStatus.CONFLICT,
        );
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

    const currentRoles = await this.kcAdmin.users.listRealmRoleMappings({
      id: userId,
    });
    const hasRoleAlready = currentRoles.some(
      (mappedRole: any) => mappedRole.name === role,
    );

    if (!hasRoleAlready) {
      await this.kcAdmin.users.addRealmRoleMappings({
        id: userId,
        roles: [rolePayload],
      });
    }

    if (reusedExistingUser) {
      await this.kcAdmin.users.update({ id: userId }, {
        username: keycloakUsername,
        email: normalizedEmail,
        enabled: true,
        emailVerified: false,
        firstName,
        lastName,
        requiredActions: [],
      } as any);

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
      email: normalizedEmail,
      role,
      username: keycloakUsername,
      firstName,
      lastName,
      className: normalizedRoleFields.className,
      assignedClasses: normalizedRoleFields.assignedClasses,
      teachingSubjects: normalizedRoleFields.teachingSubjects,
      teachingAssignments: normalizedRoleFields.teachingAssignments,
      resetPasswordState: true,
    });

    if (!hasRoleAlready) {
      const verificationLink = this.buildEmailVerificationLink({
        userId,
        email: normalizedEmail,
        role,
      });

      await this.emailService.sendIdentificationEmail(
        normalizedEmail,
        userId,
        tempPassword,
        role,
        firstName,
        verificationLink,
      );
    } else if (reusedExistingUser && shouldSendCredentials) {
      const verificationLink = this.buildEmailVerificationLink({
        userId,
        email: normalizedEmail,
        role,
      });

      await this.emailService.sendIdentificationEmail(
        normalizedEmail,
        userId,
        tempPassword,
        role,
        firstName,
        verificationLink,
      );
    }

    const roleFields = this.buildRoleFieldsForResponse(
      savedUser || {
        role,
        className: normalizedRoleFields.className,
        assignedClasses: normalizedRoleFields.assignedClasses,
        teachingSubjects: normalizedRoleFields.teachingSubjects,
        teachingAssignments: normalizedRoleFields.teachingAssignments,
      },
    );

    return {
      message: reusedExistingUser
        ? 'Existing user updated in Keycloak, password reset, and credentials sent'
        : 'User created and credentials sent',
      userId,
      data: {
        id: savedUser?._id,
        keycloakId: userId,
        email: normalizedEmail,
        username: keycloakUsername,
        firstName: savedUser?.firstName,
        lastName: savedUser?.lastName,
        role,
        className: roleFields.className,
        assignedClasses: roleFields.assignedClasses,
        teachingSubjects: roleFields.teachingSubjects,
        teachingAssignments: roleFields.teachingAssignments,
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
      className?: string;
      assignedClasses?: string[];
      teachingSubjects?: string[];
      teachingAssignments?: TeachingAssignmentInput[];
    },
  ) {
    const user = await this.findManagedUserOrThrow(identifier);
    await this.authenticateAdmin();
    const normalizedEmail = params.email.toLowerCase().trim();
    const normalizedRoleFields = this.normalizeRoleSpecificFields({
      role: params.role,
      className: params.className,
      assignedClasses: params.assignedClasses,
      teachingSubjects: params.teachingSubjects,
      teachingAssignments: params.teachingAssignments,
    });
    if (params.role === 'teacher') {
      await this.ensureTeacherClassSubjectsAvailable(
        normalizedRoleFields.teachingAssignments,
        user.keycloakId,
      );
    }

    await this.kcAdmin.users.update({ id: user.keycloakId }, {
      email: normalizedEmail,
      username: normalizedEmail,
      firstName: params.firstName,
      lastName: params.lastName,
      enabled: true,
    } as any);

    await this.ensureRealmRoleAssigned(user.keycloakId, params.role);

    const savedUser = await this.syncUserToMongo({
      userId: user.keycloakId,
      email: normalizedEmail,
      role: params.role,
      username: normalizedEmail,
      firstName: params.firstName,
      lastName: params.lastName,
      className: normalizedRoleFields.className,
      assignedClasses: normalizedRoleFields.assignedClasses,
      teachingSubjects: normalizedRoleFields.teachingSubjects,
      teachingAssignments: normalizedRoleFields.teachingAssignments,
    });

    const roleFields = this.buildRoleFieldsForResponse(
      savedUser || {
        role: params.role,
        className: normalizedRoleFields.className,
        assignedClasses: normalizedRoleFields.assignedClasses,
        teachingSubjects: normalizedRoleFields.teachingSubjects,
        teachingAssignments: normalizedRoleFields.teachingAssignments,
      },
    );

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
        className: roleFields.className,
        assignedClasses: roleFields.assignedClasses,
        teachingSubjects: roleFields.teachingSubjects,
        teachingAssignments: roleFields.teachingAssignments,
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
    await this.notificationsService.hardDeleteForUser(
      user.email,
      user.keycloakId,
    );

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
