import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FlashcardSessionDocument = FlashcardSession & Document;

export class FlashcardSessionCard {
  id: string;
  question: string;
  answer: string;
  subject: string;
  difficulty: 'facile' | 'intermediaire' | 'difficile';
  userAnswer?: string;
  isCorrect?: boolean;
  revealed?: boolean;
}

@Schema({ timestamps: true, collection: 'flashcard_sessions' })
export class FlashcardSession {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  ownerEmail: string;

  @Prop({ type: String, trim: true, default: null, index: true })
  ownerUserId?: string | null;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({
    required: true,
    enum: ['facile', 'intermediaire', 'difficile'],
    default: 'facile',
  })
  difficulty: 'facile' | 'intermediaire' | 'difficile';

  @Prop({ required: true, default: 10 })
  questionCount: number;

  @Prop({ required: true })
  durationSeconds: number;

  @Prop({ type: [Object], default: [] })
  cards: FlashcardSessionCard[];

  @Prop({ required: true, enum: ['in_progress', 'completed', 'expired'], default: 'in_progress' })
  status: 'in_progress' | 'completed' | 'expired';

  @Prop({ default: 0 })
  correctCount: number;

  @Prop({ default: 0 })
  reviewedCount: number;

  @Prop({ default: 0 })
  score: number;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Number, default: null })
  remainingSeconds?: number | null;

  @Prop({ default: 'local' })
  source?: string;

  @Prop({ default: '' })
  model?: string;
}

export const FlashcardSessionSchema = SchemaFactory.createForClass(FlashcardSession);

FlashcardSessionSchema.index({ ownerEmail: 1, createdAt: -1 });
