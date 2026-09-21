import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness() {
    // TODO(Milestone 1): check database connectivity once persistence is wired up.
    return { status: 'ok' };
  }
}
