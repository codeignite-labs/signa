import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMailgunWebhookReceipts1793399754916 implements MigrationInterface {
    name = 'AddMailgunWebhookReceipts1793399754916'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "mailgun_webhook_receipts" ("token_hash" character varying(64) NOT NULL, "payload_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP NOT NULL, CONSTRAINT "PK_mailgun_webhook_receipts" PRIMARY KEY ("token_hash"))`);
        await queryRunner.query(`CREATE INDEX "IDX_mailgun_receipts_expiry" ON "mailgun_webhook_receipts"  ("expires_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_mailgun_receipts_expiry"`);
        await queryRunner.query(`DROP TABLE "mailgun_webhook_receipts"`);
    }

}
