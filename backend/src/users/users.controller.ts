import { Controller, Get, Put, Post, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../auth/auth.guard';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('search/by-email')
  async searchUsersByEmail(@Query('q') query: string, @Request() req) {
    return this.usersService.searchUsersByEmail(query, req.user.uid);
  }

  @Get(':id')
  async getUser(@Param('id') id: string, @Request() req) {
    return this.usersService.getUser(id, req.user.uid);
  }

  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Request() req) {
    return this.usersService.updateUser(id, updateUserDto, req.user.uid);
  }

  @Post(':id/profile-image')
  async uploadProfileImage(@Param('id') id: string, @Body() body: { imageUrl: string }, @Request() req) {
    return this.usersService.updateProfileImage(id, body.imageUrl, req.user.uid);
  }
}
