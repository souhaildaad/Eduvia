import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InternshipDocument = Internship & Document;

@Schema({ timestamps: true, collection: 'internships' })
export class Internship {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  company: string;

  @Prop({ required: true, trim: true })
  city: string;

  @Prop({ required: true, trim: true })
  domain: string;

  @Prop({ required: true, trim: true })
  duration: string;

  @Prop({ required: true, trim: true, default: 'L2' })
  level: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ type: String, trim: true, default: '' })
  website: string;

  @Prop({ required: true, trim: true })
  deadline: string;

  @Prop({ type: String, trim: true, default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  skills: string[];

  @Prop({ type: String, trim: true, default: '' })
  address: string;

  @Prop({ type: Number, default: null })
  latitude?: number | null;

  @Prop({ type: Number, default: null })
  longitude?: number | null;
}

export const InternshipSchema = SchemaFactory.createForClass(Internship);
