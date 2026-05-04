import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiChatHistory, AiChatHistorySchema } from './ai-chat-history.schema';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiChatHistory.name, schema: AiChatHistorySchema },
    ]),
  ],
  providers: [AiService],
  controllers: [AiController]
})
export class AiModule {}
