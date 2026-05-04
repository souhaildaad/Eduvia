import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Content, ContentSchema } from '../content/content.schema';
import { User, UserSchema } from '../users/user.schema';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Content.name, schema: ContentSchema },
    ]),
  ],
  controllers: [ClubsController],
  providers: [ClubsService],
})
export class ClubsModule {}
