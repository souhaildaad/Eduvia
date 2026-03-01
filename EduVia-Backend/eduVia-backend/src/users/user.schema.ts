import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true })
  keycloakId: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ default: false })
  passwordChanged: boolean;

  @Prop({ type: Date, default: null })
  lastPasswordChange: Date;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ type: Date, default: null })
  lastLogin: Date;

  @Prop({ type: Object, default: {} })
  profileData: {
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    avatar?: string;
  };

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
