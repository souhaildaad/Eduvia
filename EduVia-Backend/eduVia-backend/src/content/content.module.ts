import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { Content, ContentSchema } from './content.schema';
import { User, UserSchema } from '../users/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Content.name, schema: ContentSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
