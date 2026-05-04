import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Internship, InternshipSchema } from './internship.schema';
import { InternshipsController } from './internships.controller';
import { InternshipsService } from './internships.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Internship.name, schema: InternshipSchema }]),
  ],
  controllers: [InternshipsController],
  providers: [InternshipsService],
})
export class InternshipsModule {}
