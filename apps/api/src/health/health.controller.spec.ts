import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('reports liveness as ok', () => {
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });

  it('reports readiness as ok', () => {
    expect(controller.readiness()).toEqual({ status: 'ok' });
  });
});
