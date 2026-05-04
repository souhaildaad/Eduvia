import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MeetSessionDocument = MeetSession & Document;

@Schema({ timestamps: true, collection: 'meet_sessions' })
export class MeetSession {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, enum: ['student', 'teacher'] })
  audience: 'student' | 'teacher';

  @Prop({ required: true, enum: ['live', 'scheduled', 'ended'], default: 'live' })
  status: 'live' | 'scheduled' | 'ended';

  @Prop({ required: true, trim: true })
  roomName: string;

  @Prop({ required: true, trim: true })
  joinUrl: string;

  @Prop({ type: String, trim: true, default: '' })
  hostName: string;

  @Prop({ type: String, trim: true, default: '' })
  hostEmail: string;

  @Prop({ type: String, trim: true, default: '' })
  topic: string;

  @Prop({ type: Number, default: 0 })
  participants: number;

  @Prop({ type: Number, default: 30 })
  capacity: number;

  @Prop({ type: String, trim: true, default: '' })
  scheduledAt: string;

  @Prop({ type: Boolean, default: false })
  recordingEnabled: boolean;

  @Prop({ type: String, trim: true, default: '' })
  replayUrl: string;

  @Prop({ type: String, trim: true, default: '' })
  replayTitle: string;

  @Prop({ type: String, trim: true, default: '' })
  replayDuration: string;

  @Prop({ type: String, trim: true, default: '' })
  replaySubject: string;

  @Prop({ type: String, trim: true, default: '' })
  endedAt: string;
}

export const MeetSessionSchema = SchemaFactory.createForClass(MeetSession);
