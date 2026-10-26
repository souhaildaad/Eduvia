import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface NotificationItem {
  id: number | string;
  title: string;
  message: string;
  type: 'warning' | 'info' | 'success';
  createdAt: string;
  read?: boolean;
  action?: {
    kind: 'forum_request' | 'forum_chat' | 'exam_reminder' | 'meet_session' | 'planner_reminder';
    requestId?: string;
    eventId?: string;
    reminderTitle?: string;
    reminderBody?: string;
    studentName?: string;
    selectedTopics?: string[];
    courseId?: string;
    courseName?: string;
    hostEmail?: string;
    hostName?: string;
    audience?: 'student' | 'teacher';
  };
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly storageKey = 'app_notifications';
  private readonly apiUrl = '/notifications';
  private nextId = 1;
  private notificationsSubject = new BehaviorSubject<NotificationItem[]>([]);
  notifications$ = this.notificationsSubject.asObservable();

  constructor(private http: HttpClient) {
    if (this.canUseApi()) {
      this.syncCurrentUserNotifications();
    }
  }

  syncCurrentUserNotifications() {
    const email = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
    const localNotifications = this.readNotifications();

    if (!this.canUseApi()) {
      this.notificationsSubject.next(this.filterSelfMeetNotifications(localNotifications));
      return;
    }

    this.notificationsSubject.next(this.filterSelfMeetNotifications(localNotifications));
    this.persistLocalNotifications(localNotifications, email);
    this.http.get<any>(this.apiUrl).subscribe({
      next: (response) => {
        const notifications = this.filterSelfMeetNotifications(
          this.normalizeServerNotifications(response?.data || response || []),
        );
        this.commitNotificationsForEmail(notifications, email);
      },
      error: () => {
        if (email === (localStorage.getItem('current_user_email') || '').trim().toLowerCase()) {
          this.notificationsSubject.next(this.filterSelfMeetNotifications(this.readNotifications()));
        }
      },
    });
  }

  addNotification(notification: Omit<NotificationItem, 'id' | 'createdAt'>) {
    const existing = this.notificationsSubject.value;
    const nextNotifications = this.upsertNotification(existing, notification, this.getStorageKey());
    this.commitNotifications(nextNotifications);

    if (!this.canUseApi() || nextNotifications === existing) {
      return;
    }

    const savedNotification = nextNotifications[0];
    this.http.post<any>(this.apiUrl, {
      ...notification,
      clientId: `local-${savedNotification.id}`,
    }).subscribe({
      next: () => this.syncCurrentUserNotifications(),
      error: () => undefined,
    });
  }

  addNotificationForUserEmails(
    emails: string[],
    notification: Omit<NotificationItem, 'id' | 'createdAt'>,
  ) {
    const uniqueEmails = [...new Set(
      emails
        .map(email => String(email || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    if (!this.canUseApi()) {
      uniqueEmails.forEach(email => {
        const storageKey = this.buildStorageKeyForEmail(email);
        const notifications = this.readNotificationsForStorageKey(storageKey);
        const nextNotifications = this.upsertNotification(notifications, notification, storageKey);
        localStorage.setItem(storageKey, JSON.stringify(nextNotifications));
        if (storageKey === this.getStorageKey()) this.notificationsSubject.next(nextNotifications);
      });
      return;
    }

    this.http.post<any>(`${this.apiUrl}/bulk`, {
      emails: uniqueEmails,
      notification,
    }).subscribe({
      next: () => {
        const currentEmail = (localStorage.getItem('current_user_email') || '').trim().toLowerCase();
        if (uniqueEmails.includes(currentEmail)) this.syncCurrentUserNotifications();
      },
      error: () => undefined,
    });
  }

  removeNotification(notificationId: number | string) {
    this.commitNotifications(
      this.notificationsSubject.value.filter((item) => item.id !== notificationId)
    );

    if (!this.canUseApi() || typeof notificationId !== 'string') {
      return;
    }

    this.http.delete<any>(`${this.apiUrl}/${encodeURIComponent(notificationId)}`).subscribe({
      error: () => undefined,
    });
  }

  markNotificationAsRead(notificationId: number | string) {
    const nextNotifications = this.notificationsSubject.value.map((item) =>
      item.id === notificationId ? { ...item, read: true } : item,
    );
    this.commitNotifications(nextNotifications);

    if (!this.canUseApi() || typeof notificationId !== 'string') {
      return;
    }

    this.http.patch<any>(`${this.apiUrl}/${encodeURIComponent(notificationId)}/read`, {}).subscribe({
      error: () => undefined,
    });
  }

  clearNotifications() {
    this.commitNotifications([]);
  }

  private commitNotifications(notifications: NotificationItem[], saveLocal = true) {
    const visibleNotifications = this.filterSelfMeetNotifications(notifications);
    this.notificationsSubject.next(visibleNotifications);
    localStorage.setItem(this.getStorageKey(), JSON.stringify(visibleNotifications));
  }

  private commitNotificationsForEmail(notifications: NotificationItem[], email: string) {
    const visible = this.filterSelfMeetNotifications(notifications);
    localStorage.setItem(this.buildStorageKeyForEmail(email), JSON.stringify(visible));
    if (email === (localStorage.getItem('current_user_email') || '').trim().toLowerCase()) {
      this.notificationsSubject.next(visible);
    }
  }

  private readNotifications(): NotificationItem[] {
    return this.readNotificationsForStorageKey(this.getStorageKey());
  }

  private readNotificationsForStorageKey(storageKey: string): NotificationItem[] {
    try {
      const raw = localStorage.getItem(storageKey);
      const notifications = raw ? JSON.parse(raw) as NotificationItem[] : [];
      const maxId = notifications.reduce(
        (currentMax, item) =>
          typeof item.id === 'number' ? Math.max(currentMax, item.id) : currentMax,
        0,
      );
      this.nextId = maxId + 1;
      return notifications;
    } catch {
      this.nextId = 1;
      return [];
    }
  }

  private upsertNotification(
    existingNotifications: NotificationItem[],
    notification: Omit<NotificationItem, 'id' | 'createdAt'>,
    storageKey: string,
  ): NotificationItem[] {
    const existing = existingNotifications.find(
      (item) =>
        item.title === notification.title &&
        item.message === notification.message &&
        (item.action?.kind || '') === (notification.action?.kind || '') &&
        (item.action?.requestId || '') === (notification.action?.requestId || '')
    );

    if (existing) {
      return existingNotifications;
    }

    const newNotification: NotificationItem = {
      id: this.nextIdForStorageKey(storageKey, existingNotifications),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      createdAt: new Date().toISOString(),
      action: notification.action,
    };

    return [newNotification, ...existingNotifications];
  }

  private nextIdForStorageKey(storageKey: string, notifications: NotificationItem[]) {
    const maxId = notifications.reduce(
      (currentMax, item) =>
        typeof item.id === 'number' ? Math.max(currentMax, item.id) : currentMax,
      0,
    );
    const nextId = maxId + 1;
    if (storageKey === this.getStorageKey()) {
      this.nextId = nextId + 1;
    }
    return nextId;
  }

  private getStorageKey() {
    const email = (localStorage.getItem('current_user_email') || '')
      .trim()
      .toLowerCase();
    return this.buildStorageKeyForEmail(email);
  }

  private buildStorageKeyForEmail(email: string) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return normalizedEmail ? `${this.storageKey}_${normalizedEmail}` : this.storageKey;
  }

  private normalizeServerNotifications(notifications: any[]): NotificationItem[] {
    return (Array.isArray(notifications) ? notifications : [])
      .map((notification) => ({
        id: notification.id,
        title: String(notification.title || ''),
        message: String(notification.message || ''),
        type: notification.type || 'info',
        createdAt: notification.createdAt || new Date().toISOString(),
        read: notification.read === true,
        action: notification.action || undefined,
      }))
      .filter((notification) => notification.id && notification.title && notification.message);
  }

  private persistLocalNotifications(notifications: NotificationItem[], email: string) {
    const localOnlyNotifications = this.filterSelfMeetNotifications(notifications).filter(
      notification => typeof notification.id === 'number',
    );

    localOnlyNotifications.forEach(notification => {
      const { id, ...payload } = notification;
      this.http.post<any>(this.apiUrl, { ...payload, clientId: `local-${id}` }).subscribe({
        next: () => {
          if (email === (localStorage.getItem('current_user_email') || '').trim().toLowerCase()) {
            this.syncCurrentUserNotifications();
          }
        },
        error: () => undefined,
      });
    });
  }

  private canUseApi() {
    return !!(sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token'));
  }

  private filterSelfMeetNotifications(notifications: NotificationItem[]) {
    const identity = this.currentIdentity();
    return notifications.filter((notification) => {
      if (notification.action?.kind !== 'meet_session') {
        return true;
      }

      const hostEmail = this.normalizeEmail(notification.action.hostEmail);
      const hostName = this.normalizeText(notification.action.hostName);
      const message = this.normalizeText(notification.message);

      return (
        (!identity.email || !hostEmail || identity.email !== hostEmail) &&
        (!identity.name || !hostName || identity.name !== hostName) &&
        (!identity.name || !message.startsWith(`${identity.name} a ouvert une session`))
      );
    });
  }

  private currentIdentity() {
    const email = this.normalizeEmail(localStorage.getItem('current_user_email') || '');
    const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
    let name = '';

    try {
      const payload = JSON.parse(atob((token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')));
      name = this.normalizeText(
        payload.name ||
          [payload.given_name, payload.family_name].filter(Boolean).join(' ') ||
          payload.preferred_username ||
          '',
      );
    } catch {
      name = '';
    }

    return { email, name };
  }

  private normalizeEmail(email?: string | null) {
    return String(email || '').trim().toLowerCase();
  }

  private normalizeText(value?: string | null) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}
