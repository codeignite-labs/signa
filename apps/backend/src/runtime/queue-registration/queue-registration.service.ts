import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { BullRegistrar } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QueueRegistrationService implements OnApplicationBootstrap {
  private registered = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registrar: BullRegistrar,
  ) {}

  onApplicationBootstrap(): void {
    if (this.registered || !this.config.get<boolean>('QUEUE_ENABLED', false))
      return;
    this.registrar.register();
    this.registered = true;
  }
}
