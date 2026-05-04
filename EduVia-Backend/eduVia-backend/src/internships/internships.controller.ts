import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InternshipsService } from './internships.service';

@Controller('api/internships')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InternshipsController {
  constructor(private readonly internshipsService: InternshipsService) {}

  @Get()
  @Roles('admin', 'student')
  findAll() {
    return this.internshipsService.findAll();
  }

  @Post()
  @Roles('admin')
  create(@Body() body: any) {
    return this.internshipsService.create(body);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: any) {
    return this.internshipsService.update(id, body);
  }

  @Put(':id')
  @Roles('admin')
  replace(@Param('id') id: string, @Body() body: any) {
    return this.internshipsService.update(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) {
    return this.internshipsService.delete(id);
  }
}
