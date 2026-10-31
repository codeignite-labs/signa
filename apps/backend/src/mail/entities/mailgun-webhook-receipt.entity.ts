import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('mailgun_webhook_receipts')
export class MailgunWebhookReceipt {
  @PrimaryColumn({
    name: 'token_hash',
    type: 'varchar',
    length: 64,
    primaryKeyConstraintName: 'PK_mailgun_webhook_receipts',
  })
  tokenHash!: string;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Index('IDX_mailgun_receipts_expiry')
  @Column({ name: 'expires_at', type: Date })
  expiresAt!: Date;
}
