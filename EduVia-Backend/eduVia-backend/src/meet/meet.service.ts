import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { Notification, NotificationDocument } from '../notifications/notification.schema';
import { User } from '../users/user.schema';
import { MeetSession, MeetSessionDocument } from './meet-session.schema';

type MeetInput = Partial<MeetSession>;

@Injectable()
export class MeetService {
  private readonly logger = new Logger(MeetService.name);

  constructor(
    @InjectModel(MeetSession.name)
    private readonly meetModel: Model<MeetSessionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly emailService: EmailService,
  ) {}

  async findAll() {
    await this.removeLegacySeedData();
    return this.meetModel
      .find({ status: { $ne: 'ended' } })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findReplays(audience?: 'student' | 'teacher') {
    await this.removeLegacySeedData();
    const query: Record<string, unknown> = {
      $or: [
        { replayUrl: { $regex: /^https?:\/\//i } },
        { status: 'ended', recordingEnabled: true },
      ],
    };
    if (audience === 'student' || audience === 'teacher') {
      query.audience = audience;
    }

    return this.meetModel
      .find(query)
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
  }

  async create(input: MeetInput, requester?: any) {
    const normalized = this.normalizeInput(input, requester);
    const roomName = this.roomName(normalized.title);
    const session = new this.meetModel({
      ...normalized,
      roomName,
      joinUrl: this.jitsiJoinUrl(roomName),
    });

    const savedSession = await session.save();
    await this.notifyStudentsForNewSession(savedSession, requester);

    return savedSession;
  }

  async end(id: string) {
    const session = await this.meetModel.findById(id).exec();

    if (!session) {
      throw new BadRequestException('Session introuvable.');
    }

    const endedAt = new Date().toISOString();
    session.status = 'ended';
    session.endedAt = endedAt;

    if (!session.replayUrl && session.recordingEnabled && process.env.MEET_REPLAY_BASE_URL) {
      session.replayUrl = this.replayUrl(session);
    }
    if (session.recordingEnabled) {
      session.replayTitle = session.replayTitle || session.title;
      session.replaySubject = session.replaySubject || session.topic;
      session.replayDuration = session.replayDuration || 'Video en cours de preparation';
    }

    return session.save();
  }

  async join(id: string) {
    const session = await this.meetModel.findById(id).exec();

    if (!session) {
      throw new BadRequestException('Session introuvable.');
    }

    if (session.status === 'ended') {
      throw new BadRequestException('Cette session est terminee.');
    }

    session.participants = Math.min(
      Math.max(1, Number(session.capacity || 1)),
      Math.max(0, Number(session.participants || 0)) + 1,
    );

    return session.save();
  }

  async addReplay(input: MeetInput) {
    const replayUrl = String(input.replayUrl || '').trim();
    if (!/^https?:\/\/.+/i.test(replayUrl)) {
      throw new BadRequestException('Lien replay invalide.');
    }

    return this.create({
      ...input,
      status: 'ended',
      replayUrl,
      replayTitle: String(input.replayTitle || input.title || '').trim(),
      endedAt: new Date().toISOString(),
    });
  }

  private normalizeInput(input: MeetInput, requester?: any) {
    const title = String(input.title || '').trim();
    if (title.length < 3) {
      throw new BadRequestException('Titre de salle obligatoire.');
    }

    const audience = input.audience === 'teacher' ? 'teacher' : 'student';
    const status = input.status === 'ended' ? input.status : 'live';

    return {
      title,
      audience,
      status,
      hostName: String(input.hostName || '').trim(),
      hostEmail: String(input.hostEmail || requester?.email || '').trim().toLowerCase(),
      topic: String(input.topic || '').trim(),
      participants: Math.max(0, Number(input.participants || 0)),
      capacity: Math.max(1, Number(input.capacity || 30)),
      scheduledAt: String(input.scheduledAt || '').trim(),
      recordingEnabled: input.recordingEnabled === true,
      replayUrl: String(input.replayUrl || '').trim(),
      replayTitle: String(input.replayTitle || '').trim(),
      replayDuration: String(input.replayDuration || '').trim(),
      replaySubject: String(input.replaySubject || input.topic || '').trim(),
      endedAt: String(input.endedAt || '').trim(),
    };
  }

  private roomName(title: string) {
    const slug = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);

    return `eduvia-${slug || 'meet'}-${Date.now()}`;
  }

  private jitsiJoinUrl(roomName: string) {
    const domain = process.env.JITSI_DOMAIN || 'meet.jit.si';
    const baseUrl = process.env.JITSI_BASE_URL || `https://${domain}`;
    return `${baseUrl.replace(/\/$/, '')}/${roomName}#config.prejoinPageEnabled=false`;
  }

  private replayUrl(session: MeetSessionDocument) {
    const replayBaseUrl = process.env.MEET_REPLAY_BASE_URL;
    if (replayBaseUrl) {
      return `${replayBaseUrl.replace(/\/$/, '')}/${session.roomName}`;
    }

    return '';
  }

  private async removeLegacySeedData() {
    await this.meetModel.deleteMany({
      $or: [
        { roomName: { $in: ['eduvia-revision-algorithmique', 'eduvia-prof-durand-questions'] } },
        { hostName: { $in: ['Sophie Martin', 'Prof. Jean Durand'] } },
        { title: { $in: ['Revision Algorithmique', 'Questions avec Prof. Durand'] } },
        { topic: { $in: ['Revision chapitre 3', 'Questions, revision et cours complementaires en direct.'] } },
        { roomName: /^eduvia-(revision-algorithmique|prof-durand-questions)(-|$)/i },
        { title: /^(revision algorithmique|questions avec prof\.?\s*durand)$/i },
        { topic: /^(revision chapitre 3|questions, revision et cours complementaires en direct\.?)$/i },
      ],
    });
  }

  private async notifyStudentsForNewSession(
    session: MeetSessionDocument,
    requester?: any,
  ) {
    const recipients = await this.resolveSessionRecipients(session, requester);
    if (recipients.length === 0) {
      this.logger.warn(
        `[MEET NOTIFY] Aucun destinataire pour session=${session._id} audience=${session.audience} host=${session.hostEmail}`,
      );
      return;
    }

    const title =
      session.audience === 'teacher'
        ? `Nouvelle session avec professeur: ${session.title}`
        : `Nouvelle session entre etudiants: ${session.title}`;
    const host = session.hostName || (session.audience === 'teacher' ? 'Votre enseignant' : 'Un etudiant');
    const message = `${host} a ouvert une session en direct: ${session.title}${session.topic ? ` - ${session.topic}` : ''}.`;

    const notificationResults = await Promise.allSettled(
      recipients.map((student: any) =>
        this.notificationModel.create({
          recipientEmail: student.email,
          recipientUserId: String(student.keycloakId || ''),
          title,
          message,
          type: 'info',
          dismissed: false,
          action: {
            kind: 'meet_session',
            requestId: String(session._id),
            reminderTitle: session.title,
            reminderBody: message,
            hostEmail: String(session.hostEmail || '').trim().toLowerCase(),
            hostName: session.hostName || '',
            audience: session.audience,
          },
        }),
      ),
    );

    const emailResults = await Promise.allSettled(
      recipients.map((student: any) =>
        this.emailService.sendMeetSessionEmail({
          to: student.email,
          studentName:
            student.profileData?.fullName ||
            `${student.firstName || ''} ${student.lastName || ''}`.trim(),
          title,
          message,
          joinUrl: session.joinUrl,
        }),
      ),
    );

    const notificationsSent = notificationResults.filter(
      (result) => result.status === 'fulfilled',
    ).length;
    const emailsSent = emailResults.filter(
      (result) => result.status === 'fulfilled',
    ).length;
    const emailFailures = emailResults.filter(
      (result) => result.status === 'rejected',
    );

    if (emailFailures.length > 0) {
      this.logger.warn(
        `[MEET EMAIL] ${emailFailures.length}/${recipients.length} email(s) echoue(s): ${emailFailures
          .slice(0, 3)
          .map((result: any) => result.reason?.message || result.reason)
          .join(' | ')}`,
      );
    }

    this.logger.log(
      `[MEET NOTIFY] session=${session._id} notifications=${notificationsSent}/${recipients.length} emails=${emailsSent}/${recipients.length}`,
    );
  }

  private async resolveSessionRecipients(session: MeetSessionDocument, requester?: any) {
    const creatorEmail = String(session.hostEmail || requester?.email || '')
      .trim()
      .toLowerCase();
    const creatorUserId = String(requester?.userId || '').trim();
    const creatorName = this.normalizeText(session.hostName);
    const baseQuery: any = {
      role: 'student',
      email: { $type: 'string', $ne: '' },
    };

    if (session.audience === 'teacher') {
      const teacher = await this.userModel
        .findOne({
          $or: [
            { keycloakId: String(requester?.userId || '') },
            { email: String(session.hostEmail || requester?.email || '').trim().toLowerCase() },
          ],
          role: 'teacher',
        })
        .lean()
        .exec();
      const assignedClasses = Array.isArray(teacher?.assignedClasses)
        ? teacher.assignedClasses.map((value: string) => value.trim()).filter(Boolean)
        : [];

      if (assignedClasses.length === 0) {
        return [];
      }

      baseQuery.$or = assignedClasses.map((className) => ({
        className: new RegExp(`^${this.escapeRegex(className)}$`, 'i'),
      }));
    }

    const recipients = await this.userModel
      .find(baseQuery)
      .select('email keycloakId firstName lastName profileData')
      .lean()
      .exec();

    return recipients.filter((recipient: any) => {
      const recipientEmail = String(recipient.email || '').trim().toLowerCase();
      const recipientUserId = String(recipient.keycloakId || '').trim();
      const recipientName = this.normalizeText(
        recipient.profileData?.fullName ||
          `${recipient.firstName || ''} ${recipient.lastName || ''}`,
      );
      return (
        (!creatorEmail || recipientEmail !== creatorEmail) &&
        (!creatorUserId || recipientUserId !== creatorUserId) &&
        (!creatorName || recipientName !== creatorName)
      );
    });
  }

  private escapeRegex(value: string) {
    return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeText(value: string) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}
