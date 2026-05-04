import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ContentDocument = Content & Document;

export class QuizQuestionOption {
  label: string;
  text: string;
}

export class QuizQuestion {
  id: string;
  prompt: string;
  type: string;
  options: QuizQuestionOption[];
  correctAnswers: string[];
  explanation?: string;
}

@Schema({ timestamps: true })
export class Content {
  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  courseId?: string;

  @Prop()
  chapterId?: string;

  @Prop()
  partId?: string;

  @Prop()
  fileUrl?: string;

  @Prop()
  fileName?: string;

  @Prop()
  source?: string;

  @Prop()
  teacherName?: string;

  @Prop()
  teacherEmail?: string;

  @Prop()
  teacherAvatarDataUrl?: string;

  @Prop({ default: false })
  visibleToAllClasses?: boolean;

  @Prop({ type: [String], default: [] })
  visibleToClasses?: string[];

  @Prop()
  dueDate?: Date;

  @Prop()
  dueDateTime?: Date;

  @Prop()
  quizDurationMinutes?: number;

  @Prop()
  quizMode?: string;

  @Prop()
  quizDifficulty?: string;

  @Prop()
  quizDisplayMode?: string;

  @Prop()
  quizSourceChapter?: string;

  @Prop()
  quizAttempts?: number;

  @Prop()
  quizPassingScore?: number;

  @Prop()
  quizQuestionCount?: number;

  @Prop({ type: [Object], default: [] })
  quizQuestions?: QuizQuestion[];

  @Prop({ default: true })
  isActive?: boolean;
}

export const ContentSchema = SchemaFactory.createForClass(Content);
