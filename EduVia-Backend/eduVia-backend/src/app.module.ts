import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EmailModule } from './email/email.module';
import { ContentModule } from './content/content.module';
import { StudentModule } from './student/student.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';
import { PlannerModule } from './planner/planner.module';
import { InternshipsModule } from './internships/internships.module';
import { MeetModule } from './meet/meet.module';
import { ClubsModule } from './clubs/clubs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MongooseModule.forRoot(
      process.env.MONGO_URI ||
        process.env.MONGODB_URI ||
        'mongodb://127.0.0.1:27017/eduvia',
    ),
    AuthModule,
    UsersModule,
    EmailModule,
    ContentModule,
    StudentModule,
    NotificationsModule,
    AiModule,
    PlannerModule,
    InternshipsModule,
    MeetModule,
    ClubsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
