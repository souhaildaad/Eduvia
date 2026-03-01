import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt'; // même si tu ne signes pas, utile pour decode/verify

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';          // ← Import du guard rôles
import { KeycloakService } from './keycloak.service'; // suppose que tu as ce service

// import { UsersModule } from '../users/users.module'; // Décommente quand MongoDB prêt

@Module({
  imports: [
    // Charge .env globalement (déjà dans AppModule ? Si oui, tu peux retirer ici)
    ConfigModule,

    // Passport avec stratégie JWT par défaut
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // JwtModule : utile pour JwtService.decode() et JwtService.verify()
    // Pas besoin de secret/signOptions car on ne signe PAS ici (Keycloak signe)
    JwtModule.register({}),

    // Décommente quand MongoDB et UsersModule sont prêts
    // UsersModule,
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    KeycloakService,     // Pour appels admin Keycloak
    JwtStrategy,         // Stratégie de validation JWT + rôles
    RolesGuard,          // Guard pour vérifier les rôles (@Roles('admin'))
  ],

  // Exporte les services pour les utiliser dans d'autres modules (ex: UsersModule)
  exports: [
    AuthService,
    KeycloakService,
  ],
})
export class AuthModule {}