import { readFile, unlink } from "node:fs/promises";
import dataSource from "../apps/backend/src/database/data-source";
import { Account } from "../apps/backend/src/accounts/entities/account.entity";
import { User } from "../apps/backend/src/users/entities/user.entity";

async function main() {
  const fixture = JSON.parse(
    await readFile("/tmp/signa-docs-fixture.json", "utf8"),
  ) as { accountId: string; userId: string };
  await dataSource.initialize();
  try {
    const account = await dataSource.manager.findOneByOrFail(Account, {
      id: fixture.accountId,
    });
    const user = await dataSource.manager.findOneByOrFail(User, {
      id: fixture.userId,
      accountId: fixture.accountId,
    });
    if (
      account.name !== "Acme Corp · Documentation Example" ||
      !/^docs-[a-f\d-]+@example\.invalid$/.test(user.email)
    ) {
      throw new Error(
        "Refusing cleanup: this is not the isolated documentation fixture",
      );
    }
    await dataSource.transaction(async (manager) => {
      await manager.update(
        User,
        { id: user.id, accountId: account.id },
        { archivedAt: new Date() },
      );
      await manager.update(
        Account,
        { id: account.id },
        { archivedAt: new Date() },
      );
    });
    for (const path of [
      "/tmp/signa-docs-session.json",
      "/tmp/signa-docs-login.json",
    ]) {
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    console.log(
      "Archived isolated documentation account and revoked its login. Real accounts were untouched.",
    );
  } finally {
    await dataSource.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
