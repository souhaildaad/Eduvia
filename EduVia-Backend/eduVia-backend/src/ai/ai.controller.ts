import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@Body('message') message: string) {
    const response = await this.aiService.askChatbot(message);
    return { reply: response };
  }

  @Get('chat/history')
  @UseGuards(JwtAuthGuard)
  async findHistory(@Request() req) {
    const data = await this.aiService.findChatHistory(req.user);
    return { success: true, data };
  }

  @Post('chat/history')
  @UseGuards(JwtAuthGuard)
  async saveHistory(@Request() req, @Body() body: any) {
    const data = await this.aiService.saveChatHistory(req.user, body);
    return { success: true, data };
  }

  @Delete('chat/history/:id')
  @UseGuards(JwtAuthGuard)
  async deleteHistory(@Request() req, @Param('id') id: string) {
    const data = await this.aiService.deleteChatHistory(req.user, id);
    return { success: true, data };
  }
}
