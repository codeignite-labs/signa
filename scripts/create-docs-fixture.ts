import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import dataSource from '../apps/backend/src/database/data-source';
import { Account } from '../apps/backend/src/accounts/entities/account.entity';
import { User } from '../apps/backend/src/users/entities/user.entity';

const backendRequire = createRequire(process.cwd() + '/package.json');
const { JwtService } = backendRequire('@nestjs/jwt');
const { PDFDocument, StandardFonts, rgb } = backendRequire('pdf-lib');

async function main() {
  await dataSource.initialize();
  const account = await dataSource.manager.save(Account, dataSource.manager.create(Account, { name: 'Acme Corp · Documentation Example' }));
  const user = await dataSource.manager.save(User, dataSource.manager.create(User, {
    accountId: account.id, account, email: `docs-${randomUUID()}@example.invalid`, firstName: 'Alex', lastName: 'Morgan', role: 'admin',
    // No usable login password; the short-lived local fixture session is stored privately.
    encryptedPassword: randomBytes(32).toString('hex'),
  }));
  const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: user.id, userId: user.id, accountId: account.id, role: user.role }, { expiresIn: '1h' });
  const session = { access_token: token, user: { id: String(user.id), first_name: user.firstName, last_name: user.lastName, email: user.email, role: user.role }, account: { id: String(account.id), name: account.name, timezone: account.timezone, locale: account.locale } };
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch('http://127.0.0.1:3001/api' + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Service agreement', { x: 48, y: 730, size: 24, font });
  page.drawText('Documentation sample - no legal effect', { x: 48, y: 699, size: 11, font, color: rgb(.4,.4,.4) });
  const lines = ['1. Scope of services', 'Describe the agreed work and expected completion date.', '2. Contact details', 'Full name:', '3. Acknowledgement', 'Signature:', 'Date:'];
  lines.forEach((text, i) => page.drawText(text, { x:48, y:640-i*55, size:12, font }));
  const form = new FormData();
  form.set('name', 'Service agreement (example)');
  form.append('documents', new Blob([await pdf.save()], { type:'application/pdf' }), 'Service agreement.pdf');
  const template = await api('/templates/pdf', { method:'POST', body:form });
  await writeFile('/tmp/signa-docs-session.json', JSON.stringify(session), { mode:0o600 });
  await writeFile('/tmp/signa-docs-fixture.json', JSON.stringify({ accountId:account.id, userId:user.id, template }), { mode:0o600 });
  console.log(JSON.stringify({ accountId:account.id, userId:user.id, templateId:template.id, purpose:'isolated documentation examples' }));
  await dataSource.destroy();
}
main().catch(async error => { console.error(error.message); if(dataSource.isInitialized) await dataSource.destroy(); process.exitCode=1; });
