import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlannerEventDocument = PlannerEvent & Document;

@Schema({ timestamps: true, collection: 'planner_events' })
export class PlannerEvent {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  ownerEmail: string;

  @Prop({ type: String, trim: true, default: null })
  ownerUserId?: string | null;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, enum: ['exam', 'test'], default: 'exam' })
  type: 'exam' | 'test';

  @Prop({ required: true, trim: true, index: true })
  date: string;

  @Prop({ required: true, trim: true, default: '09:00' })
  time: string;

  @Prop({ type: String, trim: true, default: '' })
  notes: string;

  @Prop({ default: false, index: true })
  reminderEnabled: boolean;

  @Prop({ type: Date, default: null })
  reminderEnabledAt?: Date | null;

  @Prop({ default: false, index: true })
  reminded: boolean;

  @Prop({ type: Date, default: null })
  remindedAt?: Date | null;
}

export const PlannerEventSchema = SchemaFactory.createForClass(PlannerEvent);

PlannerEventSchema.index({ ownerEmail: 1, date: 1, time: 1 });
PlannerEventSchema.index({ reminderEnabled: 1, reminded: 1, date: 1 });
