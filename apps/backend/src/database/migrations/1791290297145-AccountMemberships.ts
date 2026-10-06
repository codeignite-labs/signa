import { MigrationInterface, QueryRunner } from "typeorm";

export class AccountMemberships1791290297145 implements MigrationInterface {
    name = 'AccountMemberships1791290297145'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "account_memberships" ("id" SERIAL NOT NULL, "account_id" integer NOT NULL, "user_id" integer NOT NULL, "role" character varying(64) NOT NULL DEFAULT 'member', "accepted_at" TIMESTAMP, "expires_at" TIMESTAMP, "archived_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_93c907762ba47544a83dfb95d3c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_33a819ea5fc0507efef77e9ab7" ON "account_memberships"  ("user_id", "archived_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d6b65a8f8f7863f1489955eb69" ON "account_memberships"  ("account_id", "user_id") `);
        await queryRunner.query(`ALTER TABLE "access_tokens" ADD "account_id" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_d69d5e926afbdb5cca4ccea86a" ON "access_tokens"  ("account_id") `);
        await queryRunner.query(`ALTER TABLE "account_memberships" ADD CONSTRAINT "FK_5194d47fc75c9d927ce48896e95" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_memberships" ADD CONSTRAINT "FK_33ea7541aff88894b6ad75a357b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "access_tokens" ADD CONSTRAINT "FK_d69d5e926afbdb5cca4ccea86a5" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "access_tokens" DROP CONSTRAINT "FK_d69d5e926afbdb5cca4ccea86a5"`);
        await queryRunner.query(`ALTER TABLE "account_memberships" DROP CONSTRAINT "FK_33ea7541aff88894b6ad75a357b"`);
        await queryRunner.query(`ALTER TABLE "account_memberships" DROP CONSTRAINT "FK_5194d47fc75c9d927ce48896e95"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d69d5e926afbdb5cca4ccea86a"`);
        await queryRunner.query(`ALTER TABLE "access_tokens" DROP COLUMN "account_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d6b65a8f8f7863f1489955eb69"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_33a819ea5fc0507efef77e9ab7"`);
        await queryRunner.query(`DROP TABLE "account_memberships"`);
    }

}
