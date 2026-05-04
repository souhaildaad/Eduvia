import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlannerController } from './planner.controller';
import { PlannerEvent, PlannerEventSchema } from './planner-event.schema';
import { PlannerService } from './planner.service';
import { PlannerTask, PlannerTaskSchema } from './planner-task.schema';

@Module({
  imports: [
    EmailModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: PlannerEvent.name, schema: PlannerEventSchema },
      { name: PlannerTask.name, schema: PlannerTaskSchema },
    ]),
  ],
  controllers: [PlannerController],
  providers: [PlannerService],
})
export class PlannerModule {}
