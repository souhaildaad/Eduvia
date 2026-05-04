import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlannerService } from './planner.service';

@Controller('api/student/planner')
@UseGuards(JwtAuthGuard)
export class PlannerController {
  constructor(private readonly plannerService: PlannerService) {}

  @Get()
  async findMine(@Request() req) {
    const data = await this.plannerService.findMine(req.user);
    return { success: true, data };
  }

  @Post('events')
  async createEvent(@Request() req, @Body() body: any) {
    const data = await this.plannerService.createEvent(req.user, body);
    return { success: true, data };
  }

  @Patch('events/:id')
  async updateEvent(@Request() req, @Param('id') id: string, @Body() body: any) {
    const data = await this.plannerService.updateEvent(req.user, id, body);
    return { success: true, data };
  }

  @Delete('events/:id')
  async deleteEvent(@Request() req, @Param('id') id: string) {
    const data = await this.plannerService.deleteEvent(req.user, id);
    return { success: true, data };
  }

  @Post('events/:id/reminder')
  async remindEvent(@Request() req, @Param('id') id: string) {
    const data = await this.plannerService.remindEvent(req.user, id);
    return { success: true, data };
  }

  @Delete('events/:id/reminder')
  async disableReminder(@Request() req, @Param('id') id: string) {
    const data = await this.plannerService.disableReminder(req.user, id);
    return { success: true, data };
  }

  @Post('tasks')
  async createTask(@Request() req, @Body() body: any) {
    const data = await this.plannerService.createTask(req.user, body);
    return { success: true, data };
  }

  @Patch('tasks/:id')
  async updateTask(@Request() req, @Param('id') id: string, @Body() body: any) {
    const data = await this.plannerService.updateTask(req.user, id, body);
    return { success: true, data };
  }

  @Patch('tasks/:id/toggle')
  async toggleTask(@Request() req, @Param('id') id: string, @Body('completed') completed: boolean) {
    const data = await this.plannerService.toggleTask(req.user, id, completed);
    return { success: true, data };
  }

  @Delete('tasks/:id')
  async deleteTask(@Request() req, @Param('id') id: string) {
    const data = await this.plannerService.deleteTask(req.user, id);
    return { success: true, data };
  }
}
