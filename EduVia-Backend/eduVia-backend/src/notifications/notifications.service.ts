import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './notification.schema';
import { EmailService } from '../email/email.service';
import { User } from '../users/user.schema';

type NotificationPayload = {
  title: string;
  message: string;
  type?: 'warning' | 'info' | 'success';
  action?: {
    kind?: 'forum_request' | 'forum_chat' | 'exam_reminder' | 'meet_session';
    requestId?: string;
    reminderTitle?: string;
    reminderBody?: string;
    studentName?: string;
    selectedTopics?: string[];
    courseId?: string;
    courseName?: string;
    hostEmail?: string;
    hostName?: string;
  } | null;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private emailService: EmailService,
  ) {}

  async findForUser(email: string) {
    const recipientEmail = this.normalizeEmail(email);
    if (!recipientEmail) {
      return [];
    }

    const notifications = await this.notificationModel
      .find({ recipientEmail, dismissed: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const currentUser = await this.userModel
      .findOne({ email: recipientEmail })
      .select('firstName lastName profileData')
      .lean()
      .exec();
    const currentUserName = this.normalizeText(
      currentUser?.profileData?.fullName ||
        `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`,
    );

    return notifications
      .filter((notification: any) => {
        if (notification?.action?.kind !== 'meet_session') {
          return true;
        }

        const hostEmail = this.normalizeEmail(notification?.action?.hostEmail);
        const hostName = this.normalizeText(notification?.action?.hostName);
        const message = this.normalizeText(notification?.message);

        return (
          (!hostEmail || hostEmail !== recipientEmail) &&
          (!hostName || !currentUserName || hostName !== currentUserName) &&
          (!currentUserName || !message.startsWith(`${currentUserName} a ouvert une session`))
        );
      })
      .map((notification: any) => this.toClientNotification(notification));
  }

  async createForUser(
    email: string,
    userId: string | undefined,
    payload: NotificationPayload,
  ) {
    const recipientEmail = this.normalizeEmail(email);
    if (!recipientEmail) {
      throw new HttpException(
        'Email destinataire introuvable',
        HttpStatus.BAD_REQUEST,
      );
    }

    const notification = await this.upsertNotification(
      recipientEmail,
      userId,
      payload,
    );
    return this.toClientNotification(notification);
  }

  async createForEmails(emails: string[], payload: NotificationPayload) {
    const recipientEmails = [
      ...new Set(
        (emails || [])
          .map((email) => this.normalizeEmail(email))
          .filter(Boolean),
      ),
    ];

    if (recipientEmails.length === 0) {
      throw new HttpException(
        'Aucun destinataire valide',
        HttpStatus.BAD_REQUEST,
      );
    }

    const notifications = await Promise.all(
      recipientEmails.map((email) =>
        this.upsertNotification(email, undefined, payload),
      ),
    );
    const recipientNameByEmail = await this.buildRecipientNameMap(
      recipientEmails,
    );

    await Promise.allSettled(
      recipientEmails.map((email) =>
        this.emailService.sendExamReminderEmail({
          to: email,
          studentName:
            payload?.action?.studentName ||
            recipientNameByEmail.get(email) ||
            undefined,
          title: payload?.action?.reminderTitle || payload?.title || 'Rappel de votre enseignant',
          message: payload?.action?.reminderBody || payload?.message || '',
        }),
      ),
    );

    return notifications.map((notification) =>
      this.toClientNotification(notification),
    );
  }

  async deleteForUser(email: string, notificationId: string) {
    const recipientEmail = this.normalizeEmail(email);
    if (!recipientEmail || !notificationId) {
      return { deleted: false };
    }

    const result = await this.notificationModel.updateOne(
      {
        _id: notificationId,
        recipientEmail,
      },
      {
        $set: {
          dismissed: true,
        },
      },
    );

    return { deleted: result.modifiedCount > 0 };
  }

  async dismissForUser(email: string, notificationId: string) {
    return this.deleteForUser(email, notificationId);
  }

  async findReadStateForEmails(emails: string[], title?: string) {
    const recipientEmails = [
      ...new Set(
        (emails || [])
          .map((email) => this.normalizeEmail(email))
          .filter(Boolean),
      ),
    ];
    const normalizedTitle = String(title || '').trim();

    if (recipientEmails.length === 0 || !normalizedTitle) {
      return { total: 0, read: 0, allRead: false };
    }

    const notifications = await this.notificationModel
      .find({
        recipientEmail: { $in: recipientEmails },
        $or: [
          { title: normalizedTitle },
          { 'action.reminderTitle': normalizedTitle },
        ],
        dismissed: { $ne: true },
      })
      .lean()
      .exec();
    const matchedEmails = new Set(
      notifications.map((notification) =>
        this.normalizeEmail(notification.recipientEmail),
      ),
    );
    const readEmails = new Set(
      notifications
        .filter((notification) => notification.read === true)
        .map((notification) =>
          this.normalizeEmail(notification.recipientEmail),
        ),
    );

    return {
      total: matchedEmails.size,
      read: readEmails.size,
      allRead: matchedEmails.size > 0 && readEmails.size === matchedEmails.size,
    };
  }

  async markReadForUser(email: string, notificationId: string) {
    const recipientEmail = this.normalizeEmail(email);
    if (!recipientEmail || !notificationId) {
      return { updated: false };
    }

    const result = await this.notificationModel.updateOne(
      {
        _id: notificationId,
        recipientEmail,
        read: { $ne: true },
      },
      {
        $set: {
          read: true,
        },
      },
    );

    return { updated: result.modifiedCount > 0 };
  }

  async deleteStoredNotificationsForUser(
    email: string,
    userId?: string | null,
  ) {
    const recipientEmail = this.normalizeEmail(email);
    const normalizedUserId = String(userId || '').trim();
    const filters: Array<Record<string, string>> = [];

    if (recipientEmail) {
      filters.push({ recipientEmail });
    }

    if (normalizedUserId) {
      filters.push({ recipientUserId: normalizedUserId });
    }

    if (filters.length === 0) {
      return { deletedCount: 0 };
    }

    const result = await this.notificationModel.deleteMany({ $or: filters });
    return { deletedCount: result.deletedCount || 0 };
  }

  async clearForUser(email: string) {
    const recipientEmail = this.normalizeEmail(email);
    if (!recipientEmail) {
      return { deletedCount: 0 };
    }

    const result = await this.notificationModel.updateMany(
      { recipientEmail },
      {
        $set: {
          dismissed: true,
        },
      },
    );

    return { deletedCount: result.modifiedCount || 0 };
  }

  /*
   * User-triggered deletes only hide notifications from the UI. The records stay
   * in MongoDB for history and are hard-deleted only when the user account is deleted.
   */
  async hardDeleteForUser(email: string, userId?: string | null) {
    return this.deleteStoredNotificationsForUser(email, userId);
  }

  private async upsertNotification(
    recipientEmail: string,
    recipientUserId: string | undefined,
    payload: NotificationPayload,
  ) {
    const normalizedPayload = this.normalizePayload(payload);
    const query = {
      recipientEmail,
      title: normalizedPayload.title,
      message: normalizedPayload.message,
      'action.kind': normalizedPayload.action?.kind || null,
      'action.requestId': normalizedPayload.action?.requestId || null,
    };

    const existing = await this.notificationModel.findOne(query);
    if (existing) {
      if (existing.dismissed) {
        existing.dismissed = false;
        await existing.save();
      }
      return existing;
    }

    return this.notificationModel.create({
      recipientEmail,
      recipientUserId: recipientUserId || null,
      dismissed: false,
      ...normalizedPayload,
    });
  }

  private normalizePayload(payload: NotificationPayload) {
    const title = String(payload?.title || '').trim();
    const message = String(payload?.message || '').trim();

    if (!title || !message) {
      throw new HttpException(
        'Titre et message obligatoires',
        HttpStatus.BAD_REQUEST,
      );
    }

    const type = ['warning', 'info', 'success'].includes(String(payload?.type))
      ? payload.type
      : 'info';

    const action = payload?.action
      ? {
          kind: payload.action.kind,
          requestId: payload.action.requestId,
          reminderTitle: payload.action.reminderTitle,
          reminderBody: payload.action.reminderBody,
          studentName: payload.action.studentName,
          selectedTopics: Array.isArray(payload.action.selectedTopics)
            ? payload.action.selectedTopics
            : undefined,
          courseId: payload.action.courseId,
          courseName: payload.action.courseName,
          hostEmail: this.normalizeEmail(payload.action.hostEmail),
          hostName: String(payload.action.hostName || '').trim(),
        }
      : null;

    return { title, message, type, action };
  }

  private normalizeEmail(email?: string | null) {
    return String(email || '')
      .trim()
      .toLowerCase();
  }

  private normalizeText(value?: string | null) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private async buildRecipientNameMap(emails: string[]) {
    const users = await this.userModel
      .find(
        {
          email: { $in: emails },
        },
        { email: 1, firstName: 1, lastName: 1, profileData: 1 },
      )
      .lean()
      .exec();

    return new Map<string, string>(
      users
        .map((user: any) => {
          const email = this.normalizeEmail(user?.email);
          const fullName = String(
            user?.profileData?.fullName ||
              `${user?.firstName || ''} ${user?.lastName || ''}`,
          )
            .trim()
            .replace(/\s+/g, ' ');

          return [email, fullName] as [string, string];
        })
        .filter(([email, fullName]) => !!email && !!fullName),
    );
  }

  private toClientNotification(notification: any) {
    return {
      id: String(notification._id),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      createdAt:
        notification.createdAt instanceof Date
          ? notification.createdAt.toISOString()
          : new Date(notification.createdAt || Date.now()).toISOString(),
      action: notification.action || undefined,
      read: notification.read === true,
    };
  }
}
