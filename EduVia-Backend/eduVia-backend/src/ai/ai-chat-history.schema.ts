import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiChatHistoryDocument = AiChatHistory & Document;

@Schema({ _id: false })
export class AiChatMessage {
  @Prop({ required: true, enum: ['assistant', 'student'] })
  sender: 'assistant' | 'student';

  @Prop({ required: true, trim: true })
  text: string;

  @Prop({ required: true, trim: true })
  time: string;
}

const AiChatMessageSchema = SchemaFactory.createForClass(AiChatMessage);

@Schema({ timestamps: true, collection: 'ai_chat_histories' })
export class AiChatHistory {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  ownerEmail: string;

  @Prop({ type: String, trim: true, default: null })
  ownerUserId?: string | null;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ type: [AiChatMessageSchema], default: [] })
  messages: AiChatMessage[];
}

export const AiChatHistorySchema = SchemaFactory.createForClass(AiChatHistory);

AiChatHistorySchema.index({ ownerEmail: 1, updatedAt: -1 });
