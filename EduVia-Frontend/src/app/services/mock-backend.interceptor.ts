import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpResponse,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';

type MockRole = 'admin' | 'teacher' | 'student';

interface MockUser {
  id: number;
  email: string;
  password: string;
  role: MockRole;
  name: string;
  forcePasswordChange: boolean;
  createdAt: string;
  firstLoginAt: string | null;
  passwordChangedAt: string | null;
}

interface MockProfile {
  email: string;
  fullName: string;
  phone: string;
  birthdate: string;
  specialization: string;
  address: string;
  bio: string;
  avatarDataUrl: string;
}

interface PasswordResetRequest {
  token: string;
  userEmail: string;
  role: 'teacher' | 'student';
  expiresAt: string;
  usedAt: string | null;
}

interface MockForumMessage {
  id: string;
  senderEmail: string;
  senderName: string;
  senderLevel: string;
  text: string;
  createdAt: string;
}

interface MockForumRequest {
  id: string;
  authorEmail: string;
  authorName: string;
  authorLevel: string;
  title: string;
  message: string;
  createdAt: string;
  messages: MockForumMessage[];
}

@Injectable()
export class MockBackendInterceptor implements HttpInterceptor {
  private readonly usersStorageKey = 'mock_auth_users';
  private readonly resetRequestsStorageKey = 'mock_password_reset_requests';
  private readonly profilesStorageKey = 'mock_user_profiles';
  private readonly forumRequestsStorageKey = 'mock_student_forum_requests';

  private shouldUseMockBackend(): boolean {
    return localStorage.getItem('use_mock_backend') === 'true';
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.shouldUseMockBackend()) {
      return next.handle(req);
    }

    if (req.url.includes('/auth/profile')) {
      return next.handle(req);
    }

    const mockUsers = this.readUsers();
    const resetRequests = this.readResetRequests();
    const profiles = this.readProfiles();

    if (req.method === 'POST' && req.url.includes('/auth/login')) {
      const { email, password } = req.body;
      const user = mockUsers.find((candidate) => candidate.email === email && candidate.password === password);

      if (user) {
        localStorage.setItem('current_user_email', user.email);
        return of(new HttpResponse<any>({
          status: 200,
          body: {
            success: true,
            data: {
              access_token: 'mock_token_' + Date.now(),
              refresh_token: 'mock_refresh_token_' + Date.now(),
              user: {
                id: user.id,
                email: user.email,
                role: user.role,
                name: user.name,
                className: localStorage.getItem('current_user_class') || '',
              }
            }
          }
        })).pipe(delay(400));
      }

      const userByEmail = mockUsers.find((candidate) => candidate.email === email);
      return this.errorResponse(userByEmail ? 'Mot de passe incorrect' : 'Email invalide', 401, req.url);
    }

    if (req.method === 'GET' && req.url.includes('/auth/verify')) {
      const storedRole = localStorage.getItem('role');

      if (storedRole !== 'admin' && storedRole !== 'teacher' && storedRole !== 'student') {
        return this.errorResponse('Session invalide', 401, req.url, 300);
      }

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          data: {
            user: {
              role: storedRole
            }
          }
        }
      })).pipe(delay(300));
    }

    if (req.method === 'GET' && req.url.includes('/auth/password-status')) {
      const currentEmail = localStorage.getItem('current_user_email');
      const currentUser = mockUsers.find((candidate) => candidate.email === currentEmail);

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          data: {
            needsPasswordChange: !!currentUser?.forcePasswordChange,
            blocked: false,
          }
        }
      })).pipe(delay(250));
    }

    if (req.method === 'POST' && req.url.includes('/auth/logout')) {
      return of(new HttpResponse<any>({
        status: 200,
        body: { success: true, message: 'Deconnexion reussie' }
      })).pipe(delay(250));
    }

    if (req.method === 'GET' && req.url.includes('/auth/profile')) {
      const currentEmail = localStorage.getItem('current_user_email');
      const currentUser = mockUsers.find((candidate) => candidate.email === currentEmail);

      if (!currentUser || !currentEmail) {
        return this.errorResponse('Profil introuvable', 404, req.url);
      }

      const profile = profiles.find((candidate) => candidate.email === currentEmail);
      const fallbackNameParts = currentUser.name.split(' ');

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          data: {
            fullName: profile?.fullName || currentUser.name,
            email: currentUser.email,
            phone: profile?.phone || '+216',
            birthdate: profile?.birthdate || '',
            specialization: profile?.specialization || '',
            address: profile?.address || '',
            bio: profile?.bio || '',
            avatarDataUrl: profile?.avatarDataUrl || '',
            passwordChangedAt: currentUser.passwordChangedAt,
            hasSavedPassword: !!currentUser.passwordChangedAt,
            firstName: fallbackNameParts[0] || '',
            lastName: fallbackNameParts.slice(1).join(' '),
          }
        }
      })).pipe(delay(250));
    }

    if (req.method === 'PATCH' && req.url.includes('/auth/profile')) {
      const currentEmail = localStorage.getItem('current_user_email');
      const currentUser = mockUsers.find((candidate) => candidate.email === currentEmail);

      if (!currentUser || !currentEmail) {
        return this.errorResponse('Profil introuvable', 404, req.url);
      }

      const body = req.body || {};
      const existingProfile = profiles.find((candidate) => candidate.email === currentEmail);
      const nextProfile: MockProfile = {
        email: currentEmail,
        fullName: body.fullName ?? existingProfile?.fullName ?? currentUser.name,
        phone: body.phone ?? existingProfile?.phone ?? '+216',
        birthdate: body.birthdate ?? existingProfile?.birthdate ?? '',
        specialization: body.specialization ?? existingProfile?.specialization ?? '',
        address: body.address ?? existingProfile?.address ?? '',
        bio: body.bio ?? existingProfile?.bio ?? '',
        avatarDataUrl: body.avatarDataUrl ?? existingProfile?.avatarDataUrl ?? '',
      };

      const nextProfiles = [
        ...profiles.filter((candidate) => candidate.email !== currentEmail),
        nextProfile,
      ];
      this.commitProfiles(nextProfiles);

      const nextUsers = mockUsers.map((candidate) => candidate.email === currentEmail
        ? {
            ...candidate,
            name: nextProfile.fullName || candidate.name,
          }
        : candidate);
      this.commitUsers(nextUsers);

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          data: {
            ...nextProfile,
            email: currentEmail,
            passwordChangedAt: currentUser.passwordChangedAt,
            hasSavedPassword: !!currentUser.passwordChangedAt,
          }
        }
      })).pipe(delay(300));
    }

    if (req.method === 'GET' && req.url.includes('/auth/users')) {
      const usersForAdmin = mockUsers.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        isActive: user.role === 'admin' ? true : !!user.passwordChangedAt,
        firstLoginAt: user.firstLoginAt,
        passwordChangedAt: user.passwordChangedAt,
        lastActivity: user.passwordChangedAt
          ? 'Il y a 2 heures'
          : user.firstLoginAt
            ? 'Il y a 3 heures'
            : 'Aucune activite recente'
      }));

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          data: usersForAdmin
        }
      })).pipe(delay(450));
    }

    if (req.method === 'POST' && req.url.includes('/auth/forgot-password')) {
      const { email, role } = req.body as { email: string; role: 'teacher' | 'student' };
      const user = mockUsers.find((candidate) => candidate.email === email && candidate.role === role);

      if (!user) {
        return this.errorResponse('Aucun compte correspondant a cet email pour ce profil.', 404, req.url);
      }

      const token = this.generateToken();
      const nextResetRequests = [
        ...resetRequests.filter((item) => item.userEmail !== user.email || item.usedAt),
        {
          token,
          userEmail: user.email,
          role,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          usedAt: null,
        }
      ];
      this.commitResetRequests(nextResetRequests);

      const resetLink = this.buildResetLink(role, token);
      const previewHtml = this.buildResetEmailPreview(user, resetLink, this.buildEmbeddedLogo());

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          message: 'Email de reinitialisation envoye.',
          data: {
            emailSent: true,
            resetLink,
            previewHtml,
          }
        }
      })).pipe(delay(400));
    }

    if (req.method === 'GET' && req.url.includes('/auth/reset-password/validate')) {
      const token = req.params.get('token');
      const resetRequest = resetRequests.find((item) => item.token === token);

      if (!token || !resetRequest) {
        return this.errorResponse('Le lien de reinitialisation est invalide.', 400, req.url);
      }

      if (resetRequest.usedAt) {
        return this.errorResponse('Ce lien de reinitialisation a deja ete utilise.', 400, req.url);
      }

      if (new Date(resetRequest.expiresAt).getTime() < Date.now()) {
        return this.errorResponse('Le lien de reinitialisation a expire.', 400, req.url);
      }

      const user = mockUsers.find((candidate) => candidate.email === resetRequest.userEmail);
      if (!user) {
        return this.errorResponse('Utilisateur introuvable.', 404, req.url);
      }

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          data: {
            valid: true,
            role: user.role,
            email: user.email,
            name: user.name,
          }
        }
      })).pipe(delay(250));
    }

    if (req.method === 'POST' && req.url.includes('/auth/reset-password')) {
      const {
        token,
        newPassword,
        confirmPassword,
        isNotRobot,
      } = req.body as {
        token: string;
        newPassword: string;
        confirmPassword: string;
        isNotRobot: boolean;
      };

      const resetRequest = resetRequests.find((item) => item.token === token);
      if (!token || !resetRequest) {
        return this.errorResponse('Le lien de reinitialisation est invalide.', 400, req.url);
      }

      if (resetRequest.usedAt) {
        return this.errorResponse('Ce lien de reinitialisation a deja ete utilise.', 400, req.url);
      }

      if (new Date(resetRequest.expiresAt).getTime() < Date.now()) {
        return this.errorResponse('Le lien de reinitialisation a expire.', 400, req.url);
      }

      if (!newPassword || newPassword.length < 8) {
        return this.errorResponse('Le nouveau mot de passe doit contenir au moins 8 caracteres.', 400, req.url);
      }

      if (newPassword !== confirmPassword) {
        return this.errorResponse('La confirmation du mot de passe ne correspond pas.', 400, req.url);
      }

      if (isNotRobot !== true) {
        return this.errorResponse('La verification anti-robot est obligatoire.', 400, req.url);
      }

      const user = mockUsers.find((candidate) => candidate.email === resetRequest.userEmail);
      if (!user) {
        return this.errorResponse('Utilisateur introuvable.', 404, req.url);
      }

      const nextUsers = mockUsers.map((candidate) => candidate.email === user.email ? {
        ...candidate,
        password: newPassword,
        forcePasswordChange: false,
        firstLoginAt: null,
        passwordChangedAt: new Date().toISOString(),
      } : candidate);
      this.commitUsers(nextUsers);

      const nextRequests = resetRequests.map((item) => item.token === token ? {
        ...item,
        usedAt: new Date().toISOString(),
      } : item);
      this.commitResetRequests(nextRequests);

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          message: 'Mot de passe reinitialise',
          data: {
            syncedWithKeycloak: true,
            syncedWithDatabase: true,
          }
        }
      })).pipe(delay(400));
    }

    if (req.method === 'POST' && req.url.includes('/auth/change-password')) {
      const currentEmail = localStorage.getItem('current_user_email');
      const currentUser = mockUsers.find((candidate) => candidate.email === currentEmail);
      const { currentPassword, newPassword, confirmPassword, isNotRobot, disableTemporaryPasswordBlock } = req.body;

      if (!currentUser) {
        return this.errorResponse('Utilisateur introuvable', 401, req.url);
      }

      if (!currentPassword || currentPassword !== currentUser.password) {
        return this.errorResponse('Ancien mot de passe incorrect', 401, req.url);
      }

      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        return this.errorResponse('Le nouveau mot de passe doit contenir au moins 8 caracteres', 400, req.url);
      }

      if (confirmPassword !== newPassword) {
        return this.errorResponse('La confirmation du mot de passe ne correspond pas', 400, req.url);
      }

      if (isNotRobot !== true) {
        return this.errorResponse('La verification anti-robot est obligatoire', 400, req.url);
      }

      const nextUsers = mockUsers.map((candidate) => candidate.email === currentUser.email ? {
        ...candidate,
        password: newPassword,
        forcePasswordChange: false,
        passwordChangedAt: new Date().toISOString(),
        firstLoginAt: disableTemporaryPasswordBlock ? null : candidate.firstLoginAt,
      } : candidate);
      this.commitUsers(nextUsers);

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          message: 'Mot de passe change',
          data: {
            syncedWithKeycloak: true,
            syncedWithDatabase: true,
            temporaryBlockDisabled: disableTemporaryPasswordBlock !== false
          }
        }
      })).pipe(delay(400));
    }

    if (
      req.method === 'GET' &&
      req.url.includes('/api/student/forum/requests') &&
      !req.url.match(/\/api\/student\/forum\/requests\/[^/]+\/chat$/)
    ) {
      const currentEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
      const search = (req.params.get('search') || '').trim().toLowerCase();
      const requests = this.readForumRequests();
      const filtered = requests.filter((request) => {
        if (!search) {
          return true;
        }

        return (
          request.authorName.toLowerCase().includes(search) ||
          request.authorLevel.toLowerCase().includes(search) ||
          request.title.toLowerCase().includes(search) ||
          request.message.toLowerCase().includes(search)
        );
      });

      const mapped = filtered
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((request) => {
          const replies = request.messages.filter((msg) => msg.senderEmail !== request.authorEmail).length;
          const latestResponder = [...request.messages]
            .reverse()
            .find((msg) => msg.senderEmail !== request.authorEmail);
          return {
            id: request.id,
            author: request.authorName,
            authorAvatarDataUrl:
              profiles.find((candidate) => candidate.email === request.authorEmail)?.avatarDataUrl || '',
            level: request.authorLevel,
            title: request.title,
            message: request.message,
            time: this.relativeTime(request.createdAt),
            replies,
            status: replies > 0 ? 'En discussion' : 'En attente',
            canDelete: true,
            isMine: request.authorEmail === currentEmail,
            lastResponderName: latestResponder?.senderName || '',
          };
        });

      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
      const repliesToday = requests.reduce((total, request) => {
        return total + request.messages.filter((msg) => {
          if (msg.senderEmail === request.authorEmail) {
            return false;
          }
          const created = new Date(msg.createdAt).getTime();
          return Number.isFinite(created) && created >= dayStartMs && created < dayEndMs;
        }).length;
      }, 0);

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          stats: {
            openQuestions: mapped.length,
            repliesToday,
            resolutionRate: 0,
          },
          requests: mapped,
        },
      })).pipe(delay(150));
    }

    if (
      req.method === 'POST' &&
      req.url.includes('/api/student/forum/requests') &&
      !req.url.match(/\/api\/student\/forum\/requests\/[^/]+\/chat\/messages$/)
    ) {
      const currentEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
      const currentUser = mockUsers.find((candidate) => candidate.email.toLowerCase() === currentEmail);
      if (!currentUser || !currentEmail) {
        return this.errorResponse('Session etudiant invalide', 401, req.url);
      }

      const subject = String(req.body?.subject || '').trim();
      const message = String(req.body?.message || '').trim();
      if (!subject || !message) {
        return this.errorResponse('Sujet et message obligatoires', 400, req.url);
      }

      const className = localStorage.getItem('current_user_class') || '';
      const nextRequest: MockForumRequest = {
        id: this.generateToken(),
        authorEmail: currentEmail,
        authorName: currentUser.name || currentEmail.split('@')[0],
        authorLevel: `${(className || 'Etudiant').toUpperCase()} Informatique`,
        title: subject,
        message,
        createdAt: new Date().toISOString(),
        messages: [],
      };

      const requests = this.readForumRequests();
      this.commitForumRequests([nextRequest, ...requests]);

      return of(new HttpResponse<any>({
        status: 201,
        body: {
          request: {
            id: nextRequest.id,
            author: nextRequest.authorName,
            authorAvatarDataUrl:
              profiles.find((candidate) => candidate.email === nextRequest.authorEmail)?.avatarDataUrl || '',
            level: nextRequest.authorLevel,
            title: nextRequest.title,
            message: nextRequest.message,
            time: "A l'instant",
            replies: 0,
            status: 'En attente',
            canDelete: true,
            isMine: true,
            lastResponderName: '',
          },
        },
      })).pipe(delay(180));
    }

    if (req.method === 'DELETE' && req.url.match(/\/api\/student\/forum\/requests\/[^/]+$/)) {
      const currentEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
      const requestId = req.url.split('/').pop() || '';
      const requests = this.readForumRequests();
      const target = requests.find((item) => item.id === requestId);
      if (!target) {
        return this.errorResponse('Demande introuvable', 404, req.url);
      }

      this.commitForumRequests(requests.filter((item) => item.id !== requestId));
      return of(new HttpResponse<any>({
        status: 200,
        body: { success: true },
      })).pipe(delay(120));
    }

    if (req.method === 'GET' && req.url.match(/\/api\/student\/forum\/requests\/[^/]+\/chat$/)) {
      const requestId = req.url.split('/').slice(-2)[0] || '';
      const currentEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
      const requests = this.readForumRequests();
      const target = requests.find((item) => item.id === requestId);
      if (!target) {
        return this.errorResponse('Demande introuvable', 404, req.url);
      }

      const visibleMessages = target.authorEmail === currentEmail
        ? target.messages
        : target.messages.filter(
            (msg) => msg.senderEmail === currentEmail || msg.senderEmail === target.authorEmail,
          );
      const replies = visibleMessages.filter((msg) => msg.senderEmail !== target.authorEmail).length;
      const messages = [
        {
          id: `initial-${target.id}`,
          senderType: 'request',
          senderName: target.authorName,
          senderAvatarDataUrl:
            profiles.find((candidate) => candidate.email === target.authorEmail)?.avatarDataUrl || '',
          senderLevel: target.authorLevel,
          text: target.message,
          time: this.relativeTime(target.createdAt),
        },
        ...visibleMessages.map((message) => ({
          id: message.id,
          senderType: message.senderEmail === target.authorEmail ? 'author' : 'helper',
          senderName: message.senderName,
          senderAvatarDataUrl:
            profiles.find((candidate) => candidate.email === message.senderEmail)?.avatarDataUrl || '',
          senderLevel: message.senderLevel,
          text: message.text,
          time: this.relativeTime(message.createdAt),
        })),
      ];

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          request: {
            id: target.id,
            author: target.authorName,
            authorAvatarDataUrl:
              profiles.find((candidate) => candidate.email === target.authorEmail)?.avatarDataUrl || '',
            level: target.authorLevel,
            title: target.title,
            message: target.message,
            time: this.relativeTime(target.createdAt),
            replies,
            status: replies > 0 ? 'En discussion' : 'En attente',
            canDelete: true,
            isMine: target.authorEmail === currentEmail,
            lastResponderName:
              [...target.messages]
                .reverse()
                .find((msg) => msg.senderEmail !== target.authorEmail)?.senderName || '',
          },
          messages,
        },
      })).pipe(delay(120));
    }

    if (req.method === 'POST' && req.url.match(/\/api\/student\/forum\/requests\/[^/]+\/chat\/messages$/)) {
      const requestId = req.url.split('/').slice(-3)[0] || '';
      const currentEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
      const currentUser = mockUsers.find((candidate) => candidate.email.toLowerCase() === currentEmail);
      if (!currentUser || !currentEmail) {
        return this.errorResponse('Session etudiant invalide', 401, req.url);
      }

      const text = String(req.body?.message || '').trim();
      if (!text) {
        return this.errorResponse('Message obligatoire', 400, req.url);
      }

      const requests = this.readForumRequests();
      const target = requests.find((item) => item.id === requestId);
      if (!target) {
        return this.errorResponse('Demande introuvable', 404, req.url);
      }

      const className = localStorage.getItem('current_user_class') || '';
      const nextMessage: MockForumMessage = {
        id: this.generateToken(),
        senderEmail: currentEmail,
        senderName: currentUser.name || currentEmail.split('@')[0],
        senderLevel: `${(className || 'Etudiant').toUpperCase()} Informatique`,
        text,
        createdAt: new Date().toISOString(),
      };

      const updatedRequests = requests.map((item) =>
        item.id === requestId
          ? { ...item, messages: [...item.messages, nextMessage] }
          : item,
      );
      this.commitForumRequests(updatedRequests);

      const updated = updatedRequests.find((item) => item.id === requestId)!;
      const visibleMessages = updated.authorEmail === currentEmail
        ? updated.messages
        : updated.messages.filter(
            (msg) => msg.senderEmail === currentEmail || msg.senderEmail === updated.authorEmail,
          );
      const replies = visibleMessages.filter((msg) => msg.senderEmail !== updated.authorEmail).length;
      const messages = [
        {
          id: `initial-${updated.id}`,
          senderType: 'request',
          senderName: updated.authorName,
          senderAvatarDataUrl:
            profiles.find((candidate) => candidate.email === updated.authorEmail)?.avatarDataUrl || '',
          senderLevel: updated.authorLevel,
          text: updated.message,
          time: this.relativeTime(updated.createdAt),
        },
        ...visibleMessages.map((message) => ({
          id: message.id,
          senderType: message.senderEmail === updated.authorEmail ? 'author' : 'helper',
          senderName: message.senderName,
          senderAvatarDataUrl:
            profiles.find((candidate) => candidate.email === message.senderEmail)?.avatarDataUrl || '',
          senderLevel: message.senderLevel,
          text: message.text,
          time: this.relativeTime(message.createdAt),
        })),
      ];

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          request: {
            id: updated.id,
            author: updated.authorName,
            authorAvatarDataUrl:
              profiles.find((candidate) => candidate.email === updated.authorEmail)?.avatarDataUrl || '',
            level: updated.authorLevel,
            title: updated.title,
            message: updated.message,
            time: this.relativeTime(updated.createdAt),
            replies,
            status: replies > 0 ? 'En discussion' : 'En attente',
            canDelete: true,
            isMine: updated.authorEmail === currentEmail,
            lastResponderName:
              [...updated.messages]
                .reverse()
                .find((msg) => msg.senderEmail !== updated.authorEmail)?.senderName || '',
          },
          messages,
        },
      })).pipe(delay(120));
    }

    if (req.method === 'POST' && req.url.includes('/auth/validate-current-password')) {
      const currentEmail = localStorage.getItem('current_user_email');
      const currentUser = mockUsers.find((candidate) => candidate.email === currentEmail);
      const { currentPassword } = req.body as { currentPassword: string };

      if (!currentUser) {
        return this.errorResponse('Utilisateur introuvable', 401, req.url);
      }

      if (!currentPassword || currentPassword !== currentUser.password) {
        return this.errorResponse('Ancien mot de passe incorrect', 401, req.url);
      }

      if (!currentUser.passwordChangedAt) {
        return this.errorResponse(
          'Le mot de passe temporaire envoye par le systeme ne peut pas etre utilise ici. Vous devez d abord le remplacer apres votre premiere connexion.',
          400,
          req.url
        );
      }

      return of(new HttpResponse<any>({
        status: 200,
        body: {
          success: true,
          data: {
            valid: true,
            canUseAsCurrentPassword: true,
            unlockNewPasswordFields: true,
            message: 'Ancien mot de passe verifie',
          }
        }
      })).pipe(delay(300));
    }

    return next.handle(req);
  }

  private readUsers(): MockUser[] {
    const raw = localStorage.getItem(this.usersStorageKey);
    if (!raw) {
      const seededUsers: MockUser[] = [
        { id: 1, email: 'admin@test.com', password: 'admin123', role: 'admin', name: 'Admin User', forcePasswordChange: false, createdAt: new Date().toISOString(), firstLoginAt: new Date().toISOString(), passwordChangedAt: null },
        { id: 2, email: 'teacher@test.com', password: 'teacher123', role: 'teacher', name: 'Teacher User', forcePasswordChange: true, createdAt: new Date().toISOString(), firstLoginAt: new Date().toISOString(), passwordChangedAt: null },
        { id: 3, email: 'student@test.com', password: 'student123', role: 'student', name: 'Student User', forcePasswordChange: true, createdAt: new Date().toISOString(), firstLoginAt: new Date().toISOString(), passwordChangedAt: null },
      ];
      this.commitUsers(seededUsers);
      return seededUsers;
    }

    try {
      return JSON.parse(raw) as MockUser[];
    } catch {
      localStorage.removeItem(this.usersStorageKey);
      return this.readUsers();
    }
  }

  private commitUsers(users: MockUser[]) {
    localStorage.setItem(this.usersStorageKey, JSON.stringify(users));
  }

  private readProfiles(): MockProfile[] {
    const raw = localStorage.getItem(this.profilesStorageKey);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as MockProfile[];
    } catch {
      localStorage.removeItem(this.profilesStorageKey);
      return [];
    }
  }

  private commitProfiles(profiles: MockProfile[]) {
    localStorage.setItem(this.profilesStorageKey, JSON.stringify(profiles));
  }

  private readResetRequests(): PasswordResetRequest[] {
    const raw = localStorage.getItem(this.resetRequestsStorageKey);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as PasswordResetRequest[];
    } catch {
      localStorage.removeItem(this.resetRequestsStorageKey);
      return [];
    }
  }

  private commitResetRequests(requests: PasswordResetRequest[]) {
    localStorage.setItem(this.resetRequestsStorageKey, JSON.stringify(requests));
  }

  private readForumRequests(): MockForumRequest[] {
    const raw = localStorage.getItem(this.forumRequestsStorageKey);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as MockForumRequest[];
    } catch {
      localStorage.removeItem(this.forumRequestsStorageKey);
      return [];
    }
  }

  private commitForumRequests(requests: MockForumRequest[]) {
    localStorage.setItem(this.forumRequestsStorageKey, JSON.stringify(requests));
  }

  private relativeTime(value?: string) {
    const dateMs = value ? new Date(value).getTime() : Date.now();
    if (!Number.isFinite(dateMs)) {
      return "A l'instant";
    }

    const diffInMinutes = Math.floor((Date.now() - dateMs) / 60000);
    if (diffInMinutes <= 0) {
      return "A l'instant";
    }
    if (diffInMinutes < 60) {
      return `Il y a ${diffInMinutes} min`;
    }

    const hours = Math.floor(diffInMinutes / 60);
    if (hours < 24) {
      return `Il y a ${hours} h`;
    }

    const days = Math.floor(hours / 24);
    return `Il y a ${days} j`;
  }

  private buildResetLink(role: 'teacher' | 'student', token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const path = typeof window !== 'undefined' ? window.location.pathname : '/';
    return `${origin}${path}?role=${role}&resetToken=${token}`;
  }

  private buildResetEmailPreview(user: MockUser, resetLink: string, logoUrl: string): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email EduVia</title>
</head>
<body style="margin:0;padding:24px;background:#f7f4f6;font-family:Arial,sans-serif;color:#2a1014;">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(126,21,38,0.12);border:1px solid rgba(194,51,73,0.12);">
    <div style="padding:28px 32px;background:linear-gradient(145deg,#930100 0%,#9e2336 46%,#d48693 100%);color:#fff;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="width:72px;height:72px;border-radius:20px;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 10px 24px rgba(58,12,22,0.18);flex-shrink:0;">
          <img src="${logoUrl}" alt="EduVia" style="width:58px;height:58px;object-fit:contain;display:block;" />
        </div>
        <div>
          <div style="font-size:14px;letter-spacing:0.24em;font-weight:800;text-transform:uppercase;">EDUVIA</div>
          <h1 style="margin:8px 0 0;font-size:30px;line-height:1.15;">Reinitialisation de votre mot de passe</h1>
        </div>
      </div>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 20px;font-size:18px;font-weight:700;">Bonjour ${user.name},</p>
      <p style="margin:0 0 16px;line-height:1.7;">Une demande de reinitialisation de mot de passe a ete effectuee pour votre compte EduVia.</p>
      <p style="margin:0 0 20px;line-height:1.7;">Cliquez sur le bouton ci-dessous pour definir un nouveau mot de passe et securiser votre compte.</p>
      <div style="margin:28px 0 30px;">
        <a href="${resetLink}" style="display:inline-block;padding:16px 28px;border-radius:999px;background:linear-gradient(135deg,#8f1f2f 0%,#c62f45 100%);color:#ffffff;text-decoration:none;font-weight:800;">Reinitialiser mon mot de passe</a>
      </div>
      <div style="padding:18px 20px;border-radius:18px;background:#fff7f8;border:1px solid #f0d3d9;">
        <p style="margin:0 0 10px;font-weight:800;">Important</p>
        <ul style="margin:0;padding-left:18px;line-height:1.7;">
          <li>Ce lien est valable pour une duree limitee de 1 heure</li>
          <li>Si vous n etes pas a l origine de cette demande, veuillez ignorer cet email</li>
          <li>Pour votre securite, ne partagez jamais vos identifiants</li>
        </ul>
      </div>
      <p style="margin:24px 0 0;line-height:1.7;">Apres reinitialisation, vous pourrez acceder a votre espace ${user.role === 'teacher' ? 'enseignant' : 'etudiant'} EduVia avec votre nouveau mot de passe.</p>
      <p style="margin:24px 0 0;line-height:1.7;">Merci d utiliser <strong>EduVia</strong><br /><strong>Apprendre, collaborer et progresser dans un espace securise.</strong></p>
    </div>
  </div>
</body>
</html>`;
  }

  private buildEmbeddedLogo(): string {
    return `data:image/svg+xml;utf8,
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="28" fill="%23fff7f8"/>
  <path d="M35 78c-9 0-16-7-16-16 0-6 4-12 10-15-1-8 6-15 14-15 5 0 9 2 12 6 3-3 7-4 11-4 10 0 18 8 18 18 0 2 0 4-1 6 5 3 8 8 8 14 0 9-7 16-16 16H35Z" fill="none" stroke="%2318151b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M60 32v50" stroke="%2318151b" stroke-width="4" stroke-linecap="round"/>
  <path d="M70 70l-10 12-10-12h20Z" fill="%2318151b"/>
  <path d="M82 26c10 4 18 14 20 25" stroke="%2318151b" stroke-width="4" stroke-linecap="round"/>
  <path d="M88 48h10" stroke="%2318151b" stroke-width="4" stroke-linecap="round"/>
  <path d="M80 20l6-8" stroke="%2318151b" stroke-width="4" stroke-linecap="round"/>
  <text x="60" y="104" text-anchor="middle" font-family="Georgia, serif" font-size="24" font-weight="700">
    <tspan fill="%23c62f45">Edu</tspan><tspan fill="%2318151b">Via</tspan>
  </text>
</svg>`.replace(/\n/g, '').replace(/\s{2,}/g, ' ');
  }

  private generateToken(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  private errorResponse(message: string, status: number, url: string, delayMs = 400): Observable<never> {
    const errorResponse = new HttpErrorResponse({
      error: { message },
      status,
      statusText: status >= 500 ? 'Server Error' : 'Bad Request',
      url
    });
    return throwError(() => errorResponse).pipe(delay(delayMs));
  }
}
