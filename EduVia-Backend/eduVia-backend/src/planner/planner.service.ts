import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlannerEvent, PlannerEventDocument } from './planner-event.schema';
import { PlannerTask, PlannerTaskDocument } from './planner-task.schema';

type PlannerUser = {
  email?: string;
  userId?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

@Injectable()
export class PlannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlannerService.name);
  private readonly reminderCheckIntervalMs = 15 * 60 * 1000;
  private readonly reminderLeadMs = 24 * 60 * 60 * 1000;
  private reminderInterval?: NodeJS.Timeout;

  constructor(
    @InjectModel(PlannerEvent.name)
    private readonly eventModel: Model<PlannerEventDocument>,
    @InjectModel(PlannerTask.name)
    private readonly taskModel: Model<PlannerTaskDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    this.processDueReminders().catch((error) => {
      this.logger.error('Erreur traitement rappels planner', error);
    });
    this.reminderInterval = setInterval(
      () =>
        this.processDueReminders().catch((error) => {
          this.logger.error('Erreur traitement rappels planner', error);
        }),
      this.reminderCheckIntervalMs,
    );
  }

  onModuleDestroy() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
    }
  }

  async findMine(user: PlannerUser) {
    const ownerEmail = this.requireEmail(user);
    await this.resetPrematureReminders({ ownerEmail });

    const [events, tasks] = await Promise.all([
      this.eventModel.find({ ownerEmail }).sort({ date: 1, time: 1 }).lean(),
      this.taskModel.find({ ownerEmail }).sort({ date: 1, createdAt: 1 }).lean(),
    ]);

    return {
      events: events.map((event) => this.toClientEvent(event)),
      tasks: tasks.map((task) => this.toClientTask(task)),
    };
  }

  async createEvent(user: PlannerUser, body: any) {
    const ownerEmail = this.requireEmail(user);
    const payload = this.normalizeEventPayload(body);
    const event = await this.eventModel.create({
      ownerEmail,
      ownerUserId: user?.userId || null,
      reminderEnabled: body?.reminderEnabled === true,
      reminderEnabledAt: body?.reminderEnabled === true ? new Date() : null,
      reminded: false,
      remindedAt: null,
      ...payload,
    });

    return this.toClientEvent(event);
  }

  async updateEvent(user: PlannerUser, id: string, body: any) {
    const ownerEmail = this.requireEmail(user);
    const current = await this.eventModel.findOne({ _id: id, ownerEmail });

    if (!current) {
      throw new HttpException('Evenement introuvable', HttpStatus.NOT_FOUND);
    }

    const payload = this.normalizeEventPayload(body);
    const scheduleChanged =
      current.date !== payload.date || current.time !== payload.time;

    current.title = payload.title;
    current.type = payload.type;
    current.date = payload.date;
    current.time = payload.time;
    current.notes = payload.notes;
    if (typeof body?.reminderEnabled === 'boolean') {
      current.reminderEnabled = body.reminderEnabled;
      current.reminderEnabledAt = body.reminderEnabled ? new Date() : null;
    }
    if (scheduleChanged) {
      current.reminded = false;
      current.remindedAt = null;
    }

    await current.save();
    return this.toClientEvent(current);
  }

  async deleteEvent(user: PlannerUser, id: string) {
    const ownerEmail = this.requireEmail(user);
    const result = await this.eventModel.deleteOne({ _id: id, ownerEmail });
    return { deleted: result.deletedCount > 0 };
  }

  async remindEvent(user: PlannerUser, id: string) {
    const ownerEmail = this.requireEmail(user);
    const event = await this.eventModel.findOne({ _id: id, ownerEmail });

    if (!event) {
      throw new HttpException('Evenement introuvable', HttpStatus.NOT_FOUND);
    }

    event.reminderEnabled = true;
    event.reminderEnabledAt = new Date();
    event.reminded = false;
    event.remindedAt = null;
    await event.save();

    return this.toClientEvent(event);
  }

  async disableReminder(user: PlannerUser, id: string) {
    const ownerEmail = this.requireEmail(user);
    const event = await this.eventModel.findOne({ _id: id, ownerEmail });

    if (!event) {
      throw new HttpException('Evenement introuvable', HttpStatus.NOT_FOUND);
    }

    event.reminderEnabled = false;
    event.reminderEnabledAt = null;
    await event.save();

    return this.toClientEvent(event);
  }

  async createTask(user: PlannerUser, body: any) {
    const ownerEmail = this.requireEmail(user);
    const task = await this.taskModel.create({
      ownerEmail,
      ownerUserId: user?.userId || null,
      ...this.normalizeTaskPayload(body),
      completed: body?.completed === true,
    });

    return this.toClientTask(task);
  }

  async updateTask(user: PlannerUser, id: string, body: any) {
    const ownerEmail = this.requireEmail(user);
    const current = await this.taskModel.findOne({ _id: id, ownerEmail });

    if (!current) {
      throw new HttpException('Tache introuvable', HttpStatus.NOT_FOUND);
    }

    const payload = this.normalizeTaskPayload(body);
    current.title = payload.title;
    current.scope = payload.scope;
    current.date = payload.date;
    current.notes = payload.notes;
    if (typeof body?.completed === 'boolean') {
      current.completed = body.completed;
    }

    await current.save();
    return this.toClientTask(current);
  }

  async toggleTask(user: PlannerUser, id: string, completed: boolean) {
    const ownerEmail = this.requireEmail(user);
    const task = await this.taskModel.findOneAndUpdate(
      { _id: id, ownerEmail },
      { $set: { completed: completed === true } },
      { new: true },
    );

    if (!task) {
      throw new HttpException('Tache introuvable', HttpStatus.NOT_FOUND);
    }

    return this.toClientTask(task);
  }

  async deleteTask(user: PlannerUser, id: string) {
    const ownerEmail = this.requireEmail(user);
    const result = await this.taskModel.deleteOne({ _id: id, ownerEmail });
    return { deleted: result.deletedCount > 0 };
  }

  private normalizeEventPayload(body: any) {
    const title = String(body?.title || '').trim();
    const date = String(body?.date || '').trim();
    const time = String(body?.time || '09:00').trim();
    const type = body?.type === 'test' ? 'test' : 'exam';

    if (!title || !this.isDateKey(date) || !this.isTimeValue(time)) {
      throw new HttpException('Evenement invalide', HttpStatus.BAD_REQUEST);
    }

    return {
      title,
      type: type as 'exam' | 'test',
      date,
      time,
      notes: String(body?.notes || '').trim(),
    };
  }

  private normalizeTaskPayload(body: any) {
    const title = String(body?.title || '').trim();
    const date = String(body?.date || '').trim();
    const scope: 'day' | 'week' = body?.scope === 'week' ? 'week' : 'day';

    if (!title || !this.isDateKey(date)) {
      throw new HttpException('Tache invalide', HttpStatus.BAD_REQUEST);
    }

    return {
      title,
      scope,
      date,
      notes: String(body?.notes || '').trim(),
    };
  }

  private buildReminderMessage(event: PlannerEventDocument) {
    const dateLabel = this.formatDate(event.date);
    return `Rappel programme pour "${event.title}". Evenement prevu le ${dateLabel} a ${event.time}. EduVia vous rappelle de vous preparer 24h avant cette date.`;
  }

  private async processDueReminders() {
    const now = new Date();
    await this.resetPrematureReminders({}, now);

    const candidates = await this.eventModel
      .find({
        reminderEnabled: true,
        reminded: { $ne: true },
      })
      .limit(200)
      .exec();

    for (const event of candidates) {
      if (!this.isReminderDue(event, now)) {
        continue;
      }

      const claimed = await this.eventModel.findOneAndUpdate(
        {
          _id: event._id,
          reminderEnabled: true,
          reminded: { $ne: true },
        },
        {
          $set: {
            reminded: true,
            remindedAt: now,
          },
        },
        { new: true },
      );

      if (!claimed) {
        continue;
      }

      await this.sendReminder(claimed);
    }
  }

  private isReminderDue(event: PlannerEventDocument, now: Date) {
    const eventDate = this.eventDateTime(event.date, event.time);
    if (!eventDate) {
      return false;
    }

    const diffMs = eventDate.getTime() - now.getTime();
    return (
      diffMs > this.reminderLeadMs - this.reminderCheckIntervalMs &&
      diffMs <= this.reminderLeadMs
    );
  }

  private isReminderPremature(event: PlannerEventDocument, now: Date) {
    const eventDate = this.eventDateTime(event.date, event.time);
    if (!eventDate) {
      return false;
    }

    return eventDate.getTime() - now.getTime() > this.reminderLeadMs;
  }

  private async resetPrematureReminders(filter: Record<string, any>, now = new Date()) {
    const events = await this.eventModel
      .find({
        ...filter,
        reminderEnabled: true,
        reminded: true,
      })
      .limit(200)
      .exec();

    const prematureIds = events
      .filter((event) => this.isReminderPremature(event, now))
      .map((event) => event._id);

    if (!prematureIds.length) {
      return;
    }

    await this.eventModel.updateMany(
      { _id: { $in: prematureIds } },
      {
        $set: {
          reminded: false,
          remindedAt: null,
        },
      },
    );
  }

  private eventDateTime(dateKey: string, timeValue: string) {
    if (!this.isDateKey(dateKey) || !this.isTimeValue(timeValue)) {
      return null;
    }

    const [year, month, day] = dateKey.split('-').map(Number);
    const [hours, minutes] = timeValue.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  }

  private async sendReminder(event: PlannerEventDocument) {
    const reminderMessage = this.buildReminderMessage(event);
    const reminderTitle = `Rappel EduVia - ${event.title}`;
    const dateLabel = this.formatDate(event.date);
    const studentName = event.ownerEmail || 'Etudiant';

    const results = await Promise.allSettled([
      this.notificationsService.createForUser(event.ownerEmail, event.ownerUserId || undefined, {
        title: reminderTitle,
        message: reminderMessage,
        type: 'info',
        action: {
          kind: 'exam_reminder',
          reminderTitle,
          reminderBody: reminderMessage,
          studentName,
        },
      }),
      this.emailService.sendPlannerReminderEmail({
        to: event.ownerEmail,
        studentName,
        eventTitle: event.title,
        eventDateLabel: dateLabel,
        eventTime: event.time,
        message: reminderMessage,
      }),
    ]);

    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      await this.eventModel.updateOne(
        { _id: event._id },
        {
          $set: {
            reminded: false,
            remindedAt: null,
          },
        },
      );
      this.logger.error(`Echec envoi rappel planner ${event._id}`);
    }
  }

  private formatDate(dateKey: string) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1).toLocaleDateString(
      'fr-FR',
      { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' },
    );
  }

  private displayName(user: PlannerUser) {
    return String(
      `${user?.firstName || ''} ${user?.lastName || ''}`.trim() ||
        user?.username ||
        user?.email ||
        'Etudiant',
    ).trim();
  }

  private requireEmail(user: PlannerUser) {
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) {
      throw new HttpException('Utilisateur non connecte', HttpStatus.UNAUTHORIZED);
    }
    return email;
  }

  private isDateKey(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private isTimeValue(value: string) {
    return /^\d{2}:\d{2}$/.test(value);
  }

  private toClientEvent(event: any) {
    return {
      id: String(event._id),
      title: event.title,
      type: event.type || 'exam',
      date: event.date,
      time: event.time || '09:00',
      notes: event.notes || '',
      reminderEnabled: event.reminderEnabled === true,
      reminderEnabledAt: event.reminderEnabledAt || null,
      reminded: event.reminded === true,
      remindedAt: event.remindedAt || null,
    };
  }

  private toClientTask(task: any) {
    return {
      id: String(task._id),
      title: task.title,
      scope: task.scope || 'day',
      date: task.date,
      notes: task.notes || '',
      completed: task.completed === true,
    };
  }
}
