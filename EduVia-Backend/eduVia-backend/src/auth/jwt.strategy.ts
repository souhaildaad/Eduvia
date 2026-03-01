// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwksRsa from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {  // 'jwt' est le nom de la strategy (par défaut)
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Bearer <token>
      ignoreExpiration: false,                                  // Vérifie l'expiration
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,                           // Cache les clés (très important)
        rateLimit: true,                       // Limite les requêtes au JWKS
        jwksRequestsPerMinute: 5,              // Max 5 req/min
        jwksUri: `${configService.getOrThrow('KEYCLOAK_URL')}/realms/${configService.getOrThrow('KEYCLOAK_REALM')}/protocol/openid-connect/certs`,
      }),
      audience: configService.getOrThrow('KEYCLOAK_CLIENT_ID'),   // Doit matcher client_id
      issuer: `${configService.getOrThrow('KEYCLOAK_URL')}/realms/${configService.getOrThrow('KEYCLOAK_REALM')}`,
      algorithms: ['RS256'],                   // Algorithme attendu
    });
  }

  // Cette méthode est appelée quand le token est valide
  async validate(payload: any) {
    return {
      userId: payload.sub,                     // Keycloak ID
      email: payload.email,
      username: payload.preferred_username,
      roles: payload.realm_access?.roles || [], // Roles du realm
      // Ajoute d'autres claims si besoin (scope, etc.)
    };
  }
}