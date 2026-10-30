import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly config: ConfigService) {}

  getHello(): string {
    return 'Hello World!';
  }

  getVersion(): string {
    return this.config.get<string>('APP_VERSION') || '0.1.0'; // x-release-please-version
  }

  getCommitSha(): string | null {
    return this.config.get<string>('APP_COMMIT_SHA') ?? null;
  }
}
