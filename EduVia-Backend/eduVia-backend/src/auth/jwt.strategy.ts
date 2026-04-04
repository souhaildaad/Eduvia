// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwksRsa from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${configService.getOrThrow('KEYCLOAK_URL')}/realms/${configService.getOrThrow('KEYCLOAK_REALM')}/protocol/openid-connect/certs`,
      }),
      // audience: configService.getOrThrow('KEYCLOAK_CLIENT_ID'),   ← SUPPRIME ou COMENTE cette ligne
      issuer: `${configService.getOrThrow('KEYCLOAK_URL')}/realms/${configService.getOrThrow('KEYCLOAK_REALM')}`,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: any) {
    // Gestion service account (pas de sub)
    const userId =
      payload.sub ||
      payload.azp ||
      payload.clientId ||
      'service-account-' + (payload.azp || 'unknown');
    const roles = payload.realm_access?.roles || [];

    this.logger.log(
      `[JWT] Token validé - ID: ${userId}, Roles: ${roles.join(', ')}, Service Account: ${!payload.sub}`,
    );

    return {
      userId,
      email: payload.email || null,
      username: payload.preferred_username || null,
      roles,
      isServiceAccount: !payload.sub,
      scope: payload.scope,
    };
  }
}
