import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  recipientEmail: string;

  @Prop({ type: String, trim: true, default: null })
  recipientUserId?: string | null;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  message: string;

  @Prop({
    required: true,
    enum: ['warning', 'info', 'success'],
    default: 'info',
  })
  type: 'warning' | 'info' | 'success';

  @Prop({ type: Object, default: null })
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
    audience?: 'student' | 'teacher';
  } | null;

  @Prop({ default: false })
  read: boolean;

  @Prop({ default: false, index: true })
  dismissed: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index(
  {
    recipientEmail: 1,
    title: 1,
    message: 1,
    'action.kind': 1,
    'action.requestId': 1,
  },
  { unique: false },
);
