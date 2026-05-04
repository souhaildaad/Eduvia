import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubsService } from './clubs.service';

@Controller('api/clubs')
@UseGuards(JwtAuthGuard)
export class ClubsController {
  constructor(private readonly clubsService: ClubsService) {}

  @Get()
  getClubs(@Query('limit') limit: string | undefined, @Request() req: any) {
    return this.clubsService.getClubs(
      req.user?.userId,
      req.user?.email,
      Number(limit),
    );
  }

  @Get('recommendations')
  getRecommendations(@Query('limit') limit: string | undefined, @Request() req: any) {
    return this.clubsService.getRecommendations(
      req.user?.userId,
      req.user?.email,
      Number(limit),
    );
  }
}
