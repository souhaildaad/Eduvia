import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

// Import des validateurs (installe npm install class-validator class-transformer)
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

// ────────────────────────────────────────────────
// DTOs (Data Transfer Objects) pour validation
// ────────────────────────────────────────────────

class LoginDto {
  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  password: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(8, { message: 'Le nouveau mot de passe doit contenir au moins 8 caractères' })
  newPassword: string;
}

class UpdateProfileDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

class CreateUserDto {
  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @IsString()
  @MinLength(3, { message: 'Le username doit contenir au moins 3 caractères' })
  username: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;
}

@Controller('auth')
@UsePipes(
  new ValidationPipe({
    whitelist: true,           // supprime les champs non définis dans le DTO
    forbidNonWhitelisted: true, // rejette la requête si champs inconnus
    transform: true,           // transforme automatiquement les types
  }),
)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ────────────────────────────────────────────────
  // Connexion (User Story 1.2) – Public
  // ────────────────────────────────────────────────
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    try {
      const result = await this.authService.login(loginDto.email, loginDto.password);
      return {
        success: true,
        data: result,
        message: 'Connexion réussie',
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException('Échec de la connexion', HttpStatus.UNAUTHORIZED);
    }
  }

  // ────────────────────────────────────────────────
  // Déconnexion (User Story 1.6) – Public
  // ────────────────────────────────────────────────
  @Post('logout')
  async logout(@Body() body: { refresh_token: string }) {
    try {
      await this.authService.logout(body.refresh_token);
      return {
        success: true,
        message: 'Déconnexion réussie',
      };
    } catch (error) {
      throw new HttpException('Échec de la déconnexion', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ────────────────────────────────────────────────
  // Rafraîchissement token – Public
  // ────────────────────────────────────────────────
  @Post('refresh')
  async refresh(@Body() body: { refresh_token: string }) {
    try {
      const result = await this.authService.refreshToken(body.refresh_token);
      return {
        success: true,
        data: result,
        message: 'Token rafraîchi avec succès',
      };
    } catch (error) {
      throw new HttpException('Échec du rafraîchissement', HttpStatus.UNAUTHORIZED);
    }
  }

  // ────────────────────────────────────────────────
  // Vérification token – Protégé
  // ────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('verify')
  async verifyToken(@Request() req) {
    return {
      success: true,
      data: req.user,
      message: 'Token valide',
    };
  }

  // ────────────────────────────────────────────────
  // Changement mot de passe (User Story 1.3) – Protégé
  // ────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    const userId = req.user.sub; // sub = ID Keycloak du token
    await this.authService.changePassword(userId, dto.newPassword);
    return {
      success: true,
      message: 'Mot de passe modifié avec succès',
    };
  }

  // ────────────────────────────────────────────────
  // Récupération mot de passe (User Story 1.4) – Public
  // ────────────────────────────────────────────────
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    await this.authService.forgotPassword(body.email);
    return {
      success: true,
      message: 'Email de réinitialisation envoyé (si l\'email existe)',
    };
  }

  // ────────────────────────────────────────────────
  // Mise à jour profil (User Story 1.5) – Protégé
  // ────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    const userId = req.user.sub;
    const updated = await this.authService.updateProfile(userId, dto);
    return {
      success: true,
      data: updated,
      message: 'Profil mis à jour',
    };
  }

  // ────────────────────────────────────────────────
  // Création utilisateur + envoi identifiants (User Story 1.1) – Admin only
  // ────────────────────────────────────────────────
  @Post('admin/create-user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')  // ← Seul les utilisateurs avec rôle "admin" passent
  async createUserAdmin(@Body() dto: CreateUserDto) {
    return this.authService.createAndSendCredentials(
      dto.email,
      dto.username,
      dto.firstName,
      dto.lastName,
    );
  }
}