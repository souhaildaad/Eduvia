import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false, timestamps: false })
export class ForumAttachment {
  @Prop({ required: true, enum: ['document', 'video'], default: 'document' })
  kind: 'document' | 'video';

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '', trim: true })
  mimeType: string;

  @Prop({ type: String, default: '' })
  dataUrl: string;
}

export const ForumAttachmentSchema = SchemaFactory.createForClass(ForumAttachment);

@Schema({ _id: false, timestamps: false })
export class ForumMessage {
  @Prop({ required: true, trim: true })
  senderUserId: string;

  @Prop({ required: true, trim: true })
  senderName: string;

  @Prop({ type: String, default: '', trim: true })
  senderClassName: string;

  @Prop({ required: true, trim: true })
  text: string;

  @Prop({ type: [ForumAttachmentSchema], default: [] })
  attachments: ForumAttachment[];

  @Prop({ type: String, default: '', trim: true })
  transcript: string;

  @Prop({ required: true, default: Date.now })
  createdAt: Date;
}

export const ForumMessageSchema = SchemaFactory.createForClass(ForumMessage);

@Schema({ timestamps: true })
export class ForumRequest extends Document {
  @Prop({ required: true, trim: true })
  authorUserId: string;

  @Prop({ required: true, trim: true, lowercase: true })
  authorEmail: string;

  @Prop({ required: true, trim: true })
  authorName: string;

  @Prop({ type: String, default: '', trim: true })
  authorClassName: string;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({ required: true, trim: true })
  message: string;

  @Prop({ required: true, enum: ['En attente', 'En discussion'], default: 'En attente' })
  status: 'En attente' | 'En discussion';

  @Prop({ type: [ForumMessageSchema], default: [] })
  messages: ForumMessage[];
}

export const ForumRequestSchema = SchemaFactory.createForClass(ForumRequest);
