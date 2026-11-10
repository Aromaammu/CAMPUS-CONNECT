import { Module } from '@nestjs/common';
import { PdfService } from '../../common/pdf.service';
import { FeedbackController } from './feedback.controller';
import { MaterialsController } from './materials.controller';
import { ProjectsController } from './projects.controller';
import { ReportsController } from './reports.controller';

@Module({ controllers: [MaterialsController, FeedbackController, ProjectsController, ReportsController], providers: [PdfService], exports: [PdfService] })
export class LearningModule {}
