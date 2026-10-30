import { AbilityFactory } from './ability.factory';
import { AuthorizationAction as Action } from './authorization-actions';
import { User } from '../users/entities/user.entity';
it.each(['admin', 'editor', 'agent', 'member', 'viewer', 'unknown'])(
  'grants only role-appropriate capabilities to %s',
  (role) => {
    const ability = new AbilityFactory().createForUser({ role } as User);
    expect(ability.can(Action.Manage, 'all')).toBe(role === 'admin');
    expect(ability.can(Action.Read, 'Template')).toBe(true);
    expect(ability.can(Action.Read, 'Submission')).toBe(true);
    expect(ability.can(Action.Read, 'Team')).toBe(true);
    expect(ability.can(Action.Create, 'Template')).toBe(
      ['admin', 'editor', 'member'].includes(role),
    );
    expect(ability.can(Action.Manage, 'Template')).toBe(
      ['admin', 'editor'].includes(role),
    );
    expect(ability.can(Action.Send, 'Submission')).toBe(
      ['admin', 'editor', 'agent'].includes(role),
    );
    expect(ability.can(Action.Delete, 'User')).toBe(role === 'admin');
    expect(ability.can(Action.Manage, 'Team')).toBe(role === 'admin');
  },
);
