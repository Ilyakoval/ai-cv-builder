import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import '@fastify/multipart';
import {
  AnswerQuestionSchema,
  CvDetailDto,
  CvSummaryDto,
  SourceTextSchema,
  TargetRoleSchema,
  UpdateCvMetaSchema,
  UpdateDocumentSchema,
} from '@cvb/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/session.guard';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { User } from '../database/entities';
import { renderCvPdf } from '../pdf/cv-pdf';
import { CvsService } from './cvs.service';
import { extractPdfText } from './source-ingest';

@Controller('cvs')
@UseGuards(SessionGuard)
export class CvsController {
  constructor(private readonly cvs: CvsService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<CvSummaryDto[]> {
    return this.cvs.list(user);
  }

  /**
   * multipart/form-data: `targetRole` + either `file` (PDF) or `text`.
   * Returns 202 immediately; generation continues in the worker.
   */
  @Post()
  @HttpCode(202)
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  async create(@CurrentUser() user: User, @Req() req: FastifyRequest): Promise<CvDetailDto> {
    if (!req.isMultipart()) throw new BadRequestException('Expected multipart/form-data');

    const fields: Record<string, string> = {};
    let pdf: { buffer: Buffer; filename: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || pdf) throw new BadRequestException('Upload a single PDF in the "file" field');
        const buffer = await part.toBuffer(); // throws 413 past the multipart fileSize limit
        pdf = { buffer, filename: part.filename.slice(0, 255) };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }

    const targetRole = parseField(TargetRoleSchema, fields.targetRole, 'targetRole');
    if (pdf && fields.text?.trim()) throw new BadRequestException('Provide either a PDF or text, not both');

    if (pdf) {
      const sourceText = await extractPdfText(pdf.buffer);
      return this.cvs.create(user, { targetRole, sourceType: 'pdf', sourceText, sourceFileName: pdf.filename });
    }
    const sourceText = parseField(SourceTextSchema, fields.text, 'text');
    return this.cvs.create(user, { targetRole, sourceType: 'text', sourceText, sourceFileName: null });
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', UuidParam) id: string): Promise<CvDetailDto> {
    return this.cvs.get(user, id);
  }

  @Put(':id/document')
  updateDocument(
    @CurrentUser() user: User,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(UpdateDocumentSchema)) body: z.output<typeof UpdateDocumentSchema>,
  ): Promise<CvDetailDto> {
    return this.cvs.updateDocument(user, id, body.version, body.document);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: User,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(UpdateCvMetaSchema)) body: z.output<typeof UpdateCvMetaSchema>,
  ): Promise<CvDetailDto> {
    return this.cvs.rename(user, id, body.title);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id', UuidParam) id: string): Promise<void> {
    return this.cvs.remove(user, id);
  }

  @Post(':id/regenerate')
  @HttpCode(202)
  @RouteConfig({ rateLimit: { max: 10, timeWindow: '1 minute' } })
  regenerate(@CurrentUser() user: User, @Param('id', UuidParam) id: string): Promise<CvDetailDto> {
    return this.cvs.regenerate(user, id);
  }

  @Post(':id/questions/:questionId/answer')
  @HttpCode(202)
  @RouteConfig({ rateLimit: { max: 30, timeWindow: '1 minute' } })
  answer(
    @CurrentUser() user: User,
    @Param('id', UuidParam) id: string,
    @Param('questionId', UuidParam) questionId: string,
    @Body(new ZodPipe(AnswerQuestionSchema)) body: z.output<typeof AnswerQuestionSchema>,
  ): Promise<CvDetailDto> {
    return this.cvs.answerQuestion(user, id, questionId, body.answer);
  }

  @Post(':id/questions/:questionId/dismiss')
  @HttpCode(200)
  dismiss(
    @CurrentUser() user: User,
    @Param('id', UuidParam) id: string,
    @Param('questionId', UuidParam) questionId: string,
  ): Promise<CvDetailDto> {
    return this.cvs.dismissQuestion(user, id, questionId);
  }

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'no-store')
  async pdf(
    @CurrentUser() user: User,
    @Param('id', UuidParam) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const cv = await this.cvs.findOwned(user, id);
    if (!cv.document) throw new UnprocessableEntityException('The CV is not ready yet');
    const buffer = await renderCvPdf(cv.document, cv.title);
    const base = (cv.document.contact.fullName || cv.title).replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'cv';
    const filename = `${base} CV.pdf`;
    reply.header(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    return new StreamableFile(buffer);
  }
}

function parseField<S extends z.ZodTypeAny>(schema: S, value: unknown, field: string): z.output<S> {
  const result = schema.safeParse(value ?? '');
  if (!result.success) {
    throw new BadRequestException({
      message: result.error.issues[0]?.message ?? `Invalid ${field}`,
      details: result.error.issues.map((i) => ({ path: field, message: i.message })),
    });
  }
  return result.data;
}
