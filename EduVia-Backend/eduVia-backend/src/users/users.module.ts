import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User, UserSchema } from './user.schema';
import { KeycloakService } from '../auth/keycloak.service';
import { EmailModule } from '../email/email.module';
import { Content, ContentSchema } from '../content/content.schema';
import { StudentModule } from '../student/student.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Content.name, schema: ContentSchema },
    ]),
    EmailModule,
    StudentModule,
  ],
  providers: [UsersService, KeycloakService],
  exports: [UsersService],
})
export class UsersModule {}
