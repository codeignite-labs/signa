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
import { Account } from '../../accounts/entities/account.entity';
import { User } from '../../users/entities/user.entity';

@Entity('account_memberships')
@Index(['accountId', 'userId'], { unique: true })
@Index(['userId', 'archivedAt'])
export class AccountMembership {
  @PrimaryGeneratedColumn() id!: string;
  @Column({ name: 'account_id', type: 'bigint' }) accountId!: string;
  @Column({ name: 'user_id', type: 'bigint' }) userId!: string;
  @Column({ type: 'varchar', length: 64, default: 'member' }) role!: string;
  @Column({ name: 'accepted_at', type: Date, nullable: true })
  acceptedAt!: Date | null;
  @Column({ name: 'expires_at', type: Date, nullable: true })
  expiresAt!: Date | null;
  @Column({ name: 'archived_at', type: Date, nullable: true })
  archivedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
