import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../email/email.module';
import { Notification, NotificationSchema } from '../notifications/notification.schema';
import { User, UserSchema } from '../users/user.schema';
import { MeetController } from './meet.controller';
import { MeetSession, MeetSessionSchema } from './meet-session.schema';
import { MeetService } from './meet.service';

@Module({
  imports: [
    EmailModule,
    MongooseModule.forFeature([
      { name: MeetSession.name, schema: MeetSessionSchema },
      { name: User.name, schema: UserSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [MeetController],
  providers: [MeetService],
})
export class MeetModule {}
