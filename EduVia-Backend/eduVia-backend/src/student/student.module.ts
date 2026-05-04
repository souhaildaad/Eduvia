import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentModule } from '../content/content.module';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { User, UserSchema } from '../users/user.schema';
import { ForumRequest, ForumRequestSchema } from './forum-request.schema';
import {
  FlashcardSession,
  FlashcardSessionSchema,
} from './flashcard-session.schema';
import { PlannerTask, PlannerTaskSchema } from '../planner/planner-task.schema';

@Module({
  imports: [
    ContentModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ForumRequest.name, schema: ForumRequestSchema },
      { name: FlashcardSession.name, schema: FlashcardSessionSchema },
      { name: PlannerTask.name, schema: PlannerTaskSchema },
    ]),
  ],
  controllers: [StudentController],
  providers: [StudentService],
  exports: [StudentService],
})
export class StudentModule {}
