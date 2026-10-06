import { JwtService } from '@nestjs/jwt';
import { JwtGuard } from './jwt.guard';

describe('JwtGuard', () => {
  it('should be defined', () => {
    expect(
      new JwtGuard({
        verifyAsync: jest.fn(),
      } as unknown as JwtService, { resolveUser: jest.fn() } as never),
    ).toBeDefined();
  });
});
