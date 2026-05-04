import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class LearningProgressItem {
  contentId: string;
  contentType: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'passed';
  score?: number | null;
  submittedAt?: Date | null;
  questionAttempts?: any[];
  attemptHistory?: any[];
  completedAt?: Date | null;
  updatedAt?: Date | null;
}

export class TeachingAssignment {
  subject: string;
  classes: string[];
}

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true })
  keycloakId: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true, enum: ['teacher', 'student', 'admin'] })
  role: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ type: String, default: null, trim: true })
  className: string | null;

  @Prop({ type: [String], default: [] })
  assignedClasses: string[];

  @Prop({ type: [String], default: [] })
  teachingSubjects: string[];

  @Prop({ type: [Object], default: [] })
  teachingAssignments: TeachingAssignment[];

  @Prop({ default: false })
  passwordChanged: boolean;

  @Prop({ type: Date, default: null })
  firstLoginAt: Date; // ← AJOUTÉ

  @Prop({ default: false })
  isBlocked: boolean; // ← AJOUTÉ

  @Prop({ type: Date, default: null })
  lastPasswordChange: Date;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ type: Date, default: null })
  lastLogin: Date;

  @Prop({ type: String, default: null })
  resetPasswordTokenHash: string | null;

  @Prop({ type: Date, default: null })
  resetPasswordExpiresAt: Date | null;

  @Prop({ type: Object, default: {} })
  profileData: any; // For additional profile fields like phone, address, etc.

  @Prop({ type: [Object], default: [] })
  learningProgress: LearningProgressItem[];
}

export const UserSchema = SchemaFactory.createForClass(User);
