import { BrandingModule } from '../branding/branding.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { SubmissionEvent } from '../submissions/entities/submission-event.entity';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { StartFormController } from './start-form.controller';
import { StartFormService } from './start-form.service';

@Module({
  imports: [
    BrandingModule,
    MailModule,
    TypeOrmModule.forFeature([
      Submission,
      SubmissionEvent,
      Submitter,
      Template,
    ]),
  ],
  controllers: [StartFormController],
  providers: [StartFormService],
})
export class StartFormModule {}
