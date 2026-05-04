import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlannerTaskDocument = PlannerTask & Document;

@Schema({ timestamps: true, collection: 'planner_tasks' })
export class PlannerTask {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  ownerEmail: string;

  @Prop({ type: String, trim: true, default: null })
  ownerUserId?: string | null;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, enum: ['day', 'week'], default: 'day' })
  scope: 'day' | 'week';

  @Prop({ required: true, trim: true, index: true })
  date: string;

  @Prop({ type: String, trim: true, default: '' })
  notes: string;

  @Prop({ default: false, index: true })
  completed: boolean;
}

export const PlannerTaskSchema = SchemaFactory.createForClass(PlannerTask);

PlannerTaskSchema.index({ ownerEmail: 1, scope: 1, date: 1 });
