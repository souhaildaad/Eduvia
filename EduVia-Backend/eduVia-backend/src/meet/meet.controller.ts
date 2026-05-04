import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MeetService } from './meet.service';

@Controller('api/meet')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeetController {
  constructor(private readonly meetService: MeetService) {}

  @Get('sessions')
  @Roles('student', 'teacher', 'admin')
  findAll() {
    return this.meetService.findAll();
  }

  @Get('replays')
  @Roles('student', 'teacher', 'admin')
  findReplays(@Query('audience') audience?: 'student' | 'teacher') {
    return this.meetService.findReplays(audience);
  }

  @Post('sessions')
  @Roles('student', 'teacher', 'admin')
  create(@Body() body: any, @Request() req: any) {
    return this.meetService.create(body, req.user);
  }

  @Patch('sessions/:id/end')
  @Roles('student', 'teacher', 'admin')
  end(@Param('id') id: string) {
    return this.meetService.end(id);
  }

  @Patch('sessions/:id/join')
  @Roles('student', 'teacher', 'admin')
  join(@Param('id') id: string) {
    return this.meetService.join(id);
  }

  @Post('replays')
  @Roles('teacher', 'admin')
  addReplay(@Body() body: any) {
    return this.meetService.addReplay(body);
  }
}
