import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import dataSource from '../apps/backend/src/database/data-source';
import { User } from '../apps/backend/src/users/entities/user.entity';
import { hashPassword } from '../apps/backend/src/auth/passwords';

async function main() {
  const fixture = JSON.parse(await readFile('/tmp/signa-docs-fixture.json','utf8'));
  const session = JSON.parse(await readFile('/tmp/signa-docs-session.json','utf8'));
  await dataSource.initialize();
  const password = randomBytes(24).toString('base64url');
  await dataSource.manager.update(User, {id:fixture.userId,accountId:fixture.accountId}, {encryptedPassword: await hashPassword(password)});
  await writeFile('/tmp/signa-docs-login.json', JSON.stringify({email:session.user.email,password}), {mode:0o600});
  const api = async (path: string, body: unknown, method='POST') => {
    const response = await fetch('http://127.0.0.1:3001/api'+path,{method,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  };
  const role = fixture.template.submitters[0].uuid;
  const attachment = fixture.template.documents[0].uuid;
  const field = (name:string,type:string,y:number,width:number) => ({uuid:randomUUID(),name,type,required:true,submitter_uuid:role,areas:[{attachment_uuid:attachment,page:0,x:.24,y,w:width,h:.045}]});
  fixture.template = await api('/templates/'+fixture.template.id, {submitters:[{name:'Client',uuid:role}],fields:[field('Full name','text',.38,.6),field('Signature','signature',.52,.6),field('Date','date',.60,.25)]}, 'PUT');
  await api('/account/branding', {primary_color:'#27639d',white_label:false,show_business_name:true}, 'PATCH');
  fixture.team = await api('/teams',{name:'Customer Success',description:'Example signing team for documentation'});
  fixture.submission = await api('/submissions',{template_id:String(fixture.template.id),send_email:false,send_sms:false,submitters:[{role:'Client',name:'Jamie Taylor',email:'jamie@example.invalid',send_email:false,send_sms:false}]});
  await writeFile('/tmp/signa-docs-fixture.json',JSON.stringify(fixture),{mode:0o600});
  console.log(JSON.stringify({templateId:fixture.template.id,teamId:fixture.team.id,submitterCount:fixture.submission.length,purpose:'synthetic documentation only; no delivery'}));
  await dataSource.destroy();
}
main().catch(async error=>{console.error(error.message);if(dataSource.isInitialized)await dataSource.destroy();process.exitCode=1;});
