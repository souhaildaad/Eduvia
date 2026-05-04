import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findMine(@Request() req) {
    const data = await this.notificationsService.findForUser(req.user?.email);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'admin')
  @Get('read-state')
  async findReadState(
    @Query('emails') emails?: string,
    @Query('title') title?: string,
  ) {
    const data = await this.notificationsService.findReadStateForEmails(
      String(emails || '').split(','),
      title,
    );
    return { success: true, data };
  }

  @Post()
  async createMine(@Request() req, @Body() body: any) {
    const data = await this.notificationsService.createForUser(
      req.user?.email,
      req.user?.userId,
      body,
    );
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'admin')
  @Post('bulk')
  async createForEmails(@Body() body: any) {
    const data = await this.notificationsService.createForEmails(
      Array.isArray(body?.emails) ? body.emails : [],
      body?.notification || body,
    );
    return { success: true, data };
  }

  @Delete()
  async clearMine(@Request() req) {
    const data = await this.notificationsService.clearForUser(req.user?.email);
    return { success: true, data };
  }

  @Delete(':id')
  async deleteMine(@Request() req, @Param('id') id: string) {
    const data = await this.notificationsService.deleteForUser(req.user?.email, id);
    return { success: true, data };
  }

  @Patch(':id/read')
  async markRead(@Request() req, @Param('id') id: string) {
    const data = await this.notificationsService.markReadForUser(req.user?.email, id);
    return { success: true, data };
  }
}
