import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt'; // même si tu ne signes pas, utile pour decode/verify

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard'; // ← Import du guard rôles
import { KeycloakService } from './keycloak.service'; // suppose que tu as ce service
import { EmailModule } from 'src/email/email.module';
import { UsersModule } from 'src/users/users.module';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/user.schema';

// import { UsersModule } from '../users/users.module'; // Décommente quand MongoDB prêt

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    EmailModule,
    UsersModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    KeycloakService, // Pour appels admin Keycloak
    JwtStrategy, // Stratégie de validation JWT + rôles
    RolesGuard, // Guard pour vérifier les rôles (@Roles('admin'))
  ],

  // Exporte les services pour les utiliser dans d'autres modules (ex: UsersModule)
  exports: [AuthService, KeycloakService],
})
export class AuthModule {}
