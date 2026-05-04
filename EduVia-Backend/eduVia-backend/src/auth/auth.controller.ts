import {
  Body,
  Controller,
  Delete,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Request,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import {
  FACE_ID_AMBIGUITY_MARGIN,
  FACE_ID_DUPLICATE_THRESHOLD,
  FACE_ID_HASH_LENGTH,
  FACE_ID_MATCH_THRESHOLD,
  normalizeFaceIdNumber,
} from './face-id.constants';

import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsIn,
  Matches,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ───────────────── DTOs ─────────────────

class LoginDto {
  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  confirmPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

class ValidateCurrentPasswordDto {
  @IsString()
  currentPassword: string;
}

class FaceIdDto {
  @IsString()
  @Matches(new RegExp(`^[01]{${FACE_ID_HASH_LENGTH}}$`), {
    message: 'Empreinte Face ID invalide',
  })
  faceHash: string;
}

class FaceLoginDto extends FaceIdDto {
  @IsOptional()
  @IsIn(['teacher', 'student'])
  role?: 'teacher' | 'student';
}

class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @IsOptional()
  @IsIn(['teacher', 'student'])
  role?: 'teacher' | 'student';
}

class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @Matches(/^\+216\d{8}$/, {
    message: 'Telephone invalide (format attendu: +216XXXXXXXX)',
  })
  phone: string;

  @IsString()
  birthdate: string;

  @IsString()
  @MinLength(2)
  specialization: string;

  @IsString()
  @MinLength(2)
  address: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  avatarDataUrl?: string;
}

class TeachingAssignmentDto {
  @IsString()
  subject: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  classes: string[];
}

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  username: string;

  @IsOptional()
  firstName?: string;

  @IsOptional()
  lastName?: string;

  @IsString()
  role: 'teacher' | 'student';

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  assignedClasses?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  teachingSubjects?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeachingAssignmentDto)
  teachingAssignments?: TeachingAssignmentDto[];
}

class UpdateUserDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  firstName?: string;

  @IsOptional()
  lastName?: string;

  @IsString()
  role: 'teacher' | 'student';

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  assignedClasses?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  teachingSubjects?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeachingAssignmentDto)
  teachingAssignments?: TeachingAssignmentDto[];
}

// ───────────────── CONTROLLER ─────────────────

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  // ───────────────── LOGIN ─────────────────
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    try {
      const result = await this.authService.login(
        loginDto.email,
        loginDto.password,
      );

      const role = result?.user?.roles?.[0] || null;

      return {
        success: true,
        data: { ...result, role },
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error?.response?.data?.error_description ||
          error?.response?.data?.error ||
          error?.message ||
          'Echec de la connexion',
        error?.response?.status ||
          error?.status ||
          HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ───────────────── LOGOUT ─────────────────
  @Post('logout')
  async logout(@Body() body: { refresh_token: string }) {
    await this.authService.logout(body.refresh_token);
    return { success: true };
  }

  // ───────────────── VERIFY ─────────────────
  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verify(@Request() req) {
    return { success: true, user: req.user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    const data = await this.usersService.getProfileByKeycloakId(
      req.user.userId,
      req.user?.email,
      req.user?.username,
    );
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  @Get('teacher-course-members')
  async getTeacherCourseMembers(
    @Request() req,
    @Query('className') className?: string,
  ) {
    const data = await this.usersService.getTeacherCourseMembers(
      req.user.userId,
      className,
    );
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  @Get('teacher-exam-reminders')
  async getTeacherExamReminders(
    @Request() req,
    @Query('className') className?: string,
  ) {
    const data = await this.usersService.getTeacherExamReminders(
      req.user.userId,
      className,
    );
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    const data = await this.usersService.updateProfileByKeycloakId(
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Post('face-id/enroll')
  async enrollFaceId(@Request() req, @Body() dto: FaceIdDto) {
    const data = await this.usersService.saveFaceIdByKeycloakId(
      req.user.userId,
      dto.faceHash,
    );
    return { success: true, data };
  }

  @Get('face-id/config')
  faceIdConfig() {
    return {
      success: true,
      data: {
        apiBaseUrl:
          this.configService.get<string>('FACE_ID_API_BASE_URL') ||
          `${this.configService.get<string>('APP_BASE_URL') || 'http://localhost:3000'}/auth/face-id`,
        enrollUrl:
          this.configService.get<string>('FACE_ID_ENROLL_URL') ||
          `${this.configService.get<string>('APP_BASE_URL') || 'http://localhost:3000'}/auth/face-id/enroll`,
        loginUrl:
          this.configService.get<string>('FACE_ID_LOGIN_URL') ||
          `${this.configService.get<string>('APP_BASE_URL') || 'http://localhost:3000'}/auth/face-id/login`,
        hashLength: normalizeFaceIdNumber(
          this.configService.get('FACE_ID_HASH_LENGTH'),
          FACE_ID_HASH_LENGTH,
        ),
        matchThreshold: normalizeFaceIdNumber(
          this.configService.get('FACE_ID_MATCH_THRESHOLD'),
          FACE_ID_MATCH_THRESHOLD,
        ),
        duplicateThreshold: normalizeFaceIdNumber(
          this.configService.get('FACE_ID_DUPLICATE_THRESHOLD'),
          FACE_ID_DUPLICATE_THRESHOLD,
        ),
        ambiguityMargin: normalizeFaceIdNumber(
          this.configService.get('FACE_ID_AMBIGUITY_MARGIN'),
          FACE_ID_AMBIGUITY_MARGIN,
        ),
      },
    };
  }

  @Post('face-id/login')
  async loginWithFaceId(@Body() dto: FaceLoginDto) {
    const data = await this.authService.loginWithFaceId(dto.faceHash, dto.role);
    return { success: true, data };
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Res() res: any) {
    try {
      const redirectUrl =
        await this.authService.verifyEmailAndBuildRedirect(token);
      return res.redirect(redirectUrl);
    } catch (error: any) {
      const redirectUrl = this.authService.buildEmailVerificationRedirect({
        verified: false,
        message: error?.message || 'Echec de verification de l email',
      });

      return res.redirect(redirectUrl);
    }
  }

  // ───────────────── PASSWORD STATUS ─────────────────
  @UseGuards(JwtAuthGuard)
  @Get('password-status')
  async passwordStatus(@Request() req) {
    const roles = req.user?.roles || [];

    // ADMIN → jamais de changement de mot de passe
    if (roles.includes('admin')) {
      return {
        needsPasswordChange: false,
        blocked: false,
      };
    }

    const requiresPasswordChange = roles.some((role) =>
      ['teacher', 'student'].includes(role),
    );

    if (!requiresPasswordChange) {
      return {
        needsPasswordChange: false,
        blocked: false,
      };
    }

    const passwordChanged = await this.usersService.isPasswordChanged(
      req.user.userId,
    );

    return {
      needsPasswordChange: !passwordChanged,
      blocked: false,
    };
  }

  // ───────────────── CHANGE PASSWORD ─────────────────
  @UseGuards(JwtAuthGuard)
  @Post('validate-current-password')
  async validateCurrentPassword(
    @Request() req,
    @Body() dto: ValidateCurrentPasswordDto,
  ) {
    const result = await this.authService.validateCurrentPasswordForSecurity(
      req.user.userId,
      dto.currentPassword,
    );

    return { success: true, data: result };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    if (dto.confirmPassword !== dto.newPassword) {
      throw new HttpException(
        'La confirmation du mot de passe ne correspond pas',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.authService.validateCurrentPasswordForSecurity(
      req.user.userId,
      dto.currentPassword,
    );

    await this.authService.changePassword(req.user.userId, dto.newPassword);

    await this.usersService.markPasswordChanged(req.user.userId);

    return { success: true };
  }

  @Post('refresh')
  async refresh(@Body() body: { refresh_token: string }) {
    const data = await this.authService.refreshToken(body.refresh_token);
    return { success: true, data };
  }

  // ───────────────── LIST USERS (ADMIN) ─────────────────
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const result = await this.authService.requestPasswordReset(
      dto.email,
      dto.role,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Get('reset-password/validate')
  async validateResetPasswordToken(@Query('token') token: string) {
    const result = await this.authService.validateResetPasswordToken(token);
    return {
      success: true,
      data: result,
    };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const result = await this.authService.resetPasswordWithToken(
      dto.token,
      dto.newPassword,
    );

    return {
      success: true,
      data: result,
    };
  }
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getUsers() {
    const users = await this.usersService.getAllUsers();
    return { success: true, data: users };
  }

  @Get('student-classes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getStudentClasses() {
    const classes = await this.usersService.getDistinctStudentClasses();
    return { success: true, data: classes };
  }

  // ───────────────── CREATE USER (ADMIN) ─────────────────
  @Post('admin/create-user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createUser(@Body() dto: CreateUserDto) {
    return this.authService.createAndSendCredentials(
      dto.email,
      dto.username,
      dto.role,
      dto.firstName,
      dto.lastName,
      dto.className,
      dto.assignedClasses,
      dto.teachingSubjects,
      dto.teachingAssignments,
    );
  }

  // ───────────────── CREATE USER V1 (compatibilité) ─────────────────
  @Post('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createUserV1(@Body() dto: CreateUserDto) {
    return this.createUser(dto);
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.authService.updateManagedUser(id, {
      email: dto.email,
      username: dto.username || dto.email,
      role: dto.role,
      firstName: dto.firstName,
      lastName: dto.lastName,
      className: dto.className,
      assignedClasses: dto.assignedClasses,
      teachingSubjects: dto.teachingSubjects,
      teachingAssignments: dto.teachingAssignments,
    });
  }

  @Delete('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteUser(@Param('id') id: string) {
    return this.authService.deleteManagedUser(id);
  }
}
