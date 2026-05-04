// src/auth/jwt.strategy.ts
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwksRsa from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  private static buildSecretProvider(configService: ConfigService) {
    const keycloakProvider = jwksRsa.passportJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `${configService.getOrThrow('KEYCLOAK_URL')}/realms/${configService.getOrThrow('KEYCLOAK_REALM')}/protocol/openid-connect/certs`,
    });

    return (
      request: any,
      rawJwtToken: string,
      done: (error: any, secret?: string | Buffer) => void,
    ) => {
      try {
        const header = JSON.parse(
          Buffer.from(rawJwtToken.split('.')[0], 'base64').toString('utf8'),
        );
        if (header?.alg === 'HS256') {
          return done(
            null,
            configService.get('JWT_SECRET') || 'eduvia-face-id-secret',
          );
        }
      } catch {
        // Keycloak tokens continue through JWKS.
      }

      return keycloakProvider(request, rawJwtToken, done);
    };
  }

  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: JwtStrategy.buildSecretProvider(configService),
      issuer: `${configService.getOrThrow('KEYCLOAK_URL')}/realms/${configService.getOrThrow('KEYCLOAK_REALM')}`,
      algorithms: ['RS256', 'HS256'],
    });
  }

  async validate(payload: any) {
    const userId =
      payload.sub ||
      payload.azp ||
      payload.clientId ||
      'service-account-' + (payload.azp || 'unknown');
    const roles = payload.realm_access?.roles || payload.roles || [];

    this.logger.log(
      `[JWT] Token valide - ID: ${userId}, Roles: ${roles.join(', ')}, Service Account: ${!payload.sub}`,
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
