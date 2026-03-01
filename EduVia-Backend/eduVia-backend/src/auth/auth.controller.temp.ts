import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Temporary version without MongoDB dependencies for testing
 * Only includes Keycloak-based endpoints
 */
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
  ) {}

  /**
   * Login endpoint
   * POST /auth/login
   * Body: { email, password }
   */
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    try {
      const result = await this.authService.login(body.email, body.password);
      return {
        success: true,
        data: result,
        message: 'Login successful',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Login failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Logout endpoint
   * POST /auth/logout
   * Body: { refresh_token }
   */
  @Post('logout')
  async logout(@Body() body: { refresh_token: string }) {
    try {
      await this.authService.logout(body.refresh_token);
      return {
        success: true,
        message: 'Logout successful',
      };
    } catch (error) {
      throw new HttpException('Logout failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Refresh token endpoint
   * POST /auth/refresh
   * Body: { refresh_token }
   */
  @Post('refresh')
  async refresh(@Body() body: { refresh_token: string }) {
    try {
      const result = await this.authService.refreshToken(body.refresh_token);
      return {
        success: true,
        data: result,
        message: 'Token refreshed successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Token refresh failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Verify token endpoint
   * GET /auth/verify
   * Headers: Authorization: Bearer <token>
   */
  @UseGuards(JwtAuthGuard)
  @Get('verify')
  async verifyToken(@Request() req) {
    return {
      success: true,
      data: req.user,
      message: 'Token is valid',
    };
  }

  // ========================================
  // TEMPORARILY DISABLED (Require MongoDB)
  // ========================================
  // See auth.controller.ts for the complete version with profile management
  // that can be enabled once MongoDB is connected:
  //
  // - POST /auth/register (Create new user & send email)
  // - GET /auth/profile (Get profile)
  // - POST /auth/profile (Update profile)
  // - POST /auth/change-password (Change password)
  // - POST /auth/forgot-password (Request password reset)
}
