import { Injectable, Logger, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  // Override to log auth errors/info for easier debugging
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      this.logger.warn(
        `Auth failed: err=${err?.message || err} info=${info ? JSON.stringify(info) : 'none'}`,
      );
    } else {
      this.logger.log(`Auth success - user: ${JSON.stringify(user)}`);
    }

    return super.handleRequest(err, user, info, context);
  }
}
