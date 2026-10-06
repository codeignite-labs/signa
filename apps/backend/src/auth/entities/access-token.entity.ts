import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Account } from '../../accounts/entities/account.entity';

@Entity('access_tokens')
export class AccessToken {
  @Index()
  @Column({ name: 'account_id', type: 'bigint', nullable: true })
  accountId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'account_id' })
  account!: Account | null;
  @PrimaryGeneratedColumn()
  id!: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

  @Index()
  @Column({ name: 'team_id', type: 'bigint', nullable: true })
  teamId!: string | null;

  @Index({ unique: true })
  @Column({ type: 'text' })
  sha256!: string;

  @Column({ type: 'text' })
  token!: string;

  @Column({ type: 'simple-json', default: '[]' })
  permissions!: string[];

  @Column({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: Date, nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
