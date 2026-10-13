import { Inject, Injectable, Logger } from '@nestjs/common';
import { CvDocument, CvDocumentSchema, CvSection, JobStage } from '@cvb/shared';
import { z, ZodTypeAny } from 'zod';
import { createContext, describeRemovals, Removal, verifyContact, verifyDraft, verifyEducationItem, verifyExperienceItem, verifySkills, verifySummary } from '../../grounding/verifier';
import { LLM_CLIENT, LlmClient, LlmOutputError, LlmToolRequest } from '../../llm/llm.types';
import {
  applySectionChange,
  assembleCv,
  AssembledCv,
  SectionChange,
  documentToText,
  toContact,
  toEducationItem,
  toExperienceItem,
  toSkillGroups,
} from './assemble';
import {
  contactJsonSchema,
  ContactDraftSchema,
  CvDraftSchema,
  cvDraftJsonSchema,
  EducationDraftSchema,
  educationJsonSchema,
  ExperienceDraftSchema,
  experienceJsonSchema,
  SkillGroupDraftSchema,
  skillsJsonSchema,
  SummaryDraftSchema,
  summaryJsonSchema,
  type EducationDraft,
  type ExperienceDraft,
} from './draft';
import {
  AnsweredQuestion,
  APPLY_ANSWER_SYSTEM,
  buildApplyAnswerMessage,
  buildGenerateMessage,
  buildInvalidOutputMessage,
  buildRepairMessage,
  GENERATE_SYSTEM,
} from './prompts';

const GENERATE_TOOL = {
  name: 'submit_cv_draft',
  description: 'Submit the structured CV draft built strictly from the candidate material.',
  inputSchema: cvDraftJsonSchema as unknown as Record<string, unknown>,
};

export interface GenerateInput {
  targetRole: string;
  sourceText: string;
  answers: AnsweredQuestion[];
  onStage?: (stage: JobStage) => Promise<void>;
}

export interface ApplyAnswerInput {
  targetRole: string;
  sourceText: string;
  answers: AnsweredQuestion[];
  document: CvDocument;
  section: CvSection;
  itemId: string | null;
  question: string;
  answer: string;
}

export interface ApplyAnswerResult {
  change: SectionChange;
  removals: (Removal & { itemId: string | null })[];
}

export class ItemNotFoundError extends Error {
  override name = 'ItemNotFoundError';
}

@Injectable()
export class CvPipeline {
  private readonly logger = new Logger(CvPipeline.name);

  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  /**
   * draft → verify → (one repair pass if needed) → verify → assemble.
   * The second verification is final: whatever is still unsupported is dropped.
   */
  async generate(input: GenerateInput): Promise<AssembledCv> {
    const corpusText = [input.sourceText, ...input.answers.map((a) => a.answer)].join('\n\n');
    const ctx = createContext(corpusText, input.targetRole);
    const message = buildGenerateMessage(input.targetRole, input.sourceText, input.answers);

    await input.onStage?.('drafting');
    const draft = await this.callAndParse(
      { system: GENERATE_SYSTEM, user: message, tool: GENERATE_TOOL, maxTokens: 8000, purpose: 'generate' },
      CvDraftSchema,
    );

    await input.onStage?.('verifying');
    let verified = verifyDraft(draft, ctx);
    if (verified.removals.length > 0) {
      this.logger.log(`Draft had ${verified.removals.length} unsupported claims; running repair pass`);
      try {
        const repaired = await this.callAndParse(
          {
            system: GENERATE_SYSTEM,
            user: buildRepairMessage(message, draft, describeRemovals(verified.removals)),
            tool: GENERATE_TOOL,
            maxTokens: 8000,
            purpose: 'repair',
          },
          CvDraftSchema,
        );
        const second = verifyDraft(repaired, ctx);
        // Never let the repair make things worse.
        if (second.removals.length <= verified.removals.length) verified = second;
      } catch (err) {
        // The first, already-verified draft is still safe to use.
        this.logger.warn(`Repair pass failed, keeping verified first draft: ${(err as Error).message}`);
      }
    }
    return assembleCv(verified);
  }

  async applyAnswer(input: ApplyAnswerInput): Promise<ApplyAnswerResult> {
    const { document: doc, section, itemId } = input;
    // Hand-edited CV content is the user's own statement, so it is part of the corpus.
    const corpusText = [input.sourceText, documentToText(doc), ...input.answers.map((a) => a.answer), input.answer].join('\n\n');
    const ctx = createContext(corpusText, input.targetRole);
    const removals: Removal[] = [];

    const plan = this.planSection(doc, section, itemId);
    const raw = await this.callAndParse(
      {
        system: APPLY_ANSWER_SYSTEM,
        user: buildApplyAnswerMessage({
          targetRole: input.targetRole,
          sourceText: input.sourceText,
          answers: input.answers,
          section,
          currentSection: plan.current,
          question: input.question,
          answer: input.answer,
          addsNewItem: plan.addsNewItem,
        }),
        tool: { name: 'submit_section_update', description: `Submit the updated ${section} section.`, inputSchema: plan.jsonSchema },
        maxTokens: 4000,
        purpose: `apply_answer:${section}`,
      },
      plan.schema,
    );

    const change = plan.toChange(raw, ctx, removals);
    // Validate the merged result exactly like a user edit would be validated.
    CvDocumentSchema.parse(applySectionChange(doc, change));
    return { change, removals: removals.map((r) => ({ ...r, itemId })) };
  }

  private planSection(doc: CvDocument, section: CvSection, itemId: string | null): SectionPlan {
    switch (section) {
      case 'contact':
        return {
          current: doc.contact,
          addsNewItem: false,
          jsonSchema: wrap('contact', contactJsonSchema),
          schema: z.object({ contact: ContactDraftSchema }),
          toChange: (r, ctx, rem) => ({ kind: 'replace-section', section: 'contact', value: toContact(verifyContact(r.contact, ctx, rem)) }),
        };
      case 'summary':
        return {
          current: doc.summary,
          addsNewItem: false,
          jsonSchema: wrap('summary', summaryJsonSchema),
          schema: z.object({ summary: SummaryDraftSchema }),
          toChange: (r, ctx, rem) => ({ kind: 'replace-section', section: 'summary', value: verifySummary(r.summary, ctx, rem).text }),
        };
      case 'skills':
        return {
          current: doc.skills.map(({ name, items }) => ({ name, items })),
          addsNewItem: false,
          jsonSchema: wrap('skills', skillsJsonSchema),
          schema: z.object({ skills: z.array(SkillGroupDraftSchema).max(12) }),
          toChange: (r, ctx, rem) => ({ kind: 'replace-section', section: 'skills', value: toSkillGroups(verifySkills(r.skills, ctx, rem)) }),
        };
      case 'experience':
        return planListSection(doc.experience, 'experience', itemId, {
          jsonSchema: experienceJsonSchema,
          schema: ExperienceDraftSchema,
          verify: (item: ExperienceDraft, ctx, rem) => verifyExperienceItem(item, 0, ctx, rem),
          toItem: toExperienceItem,
        });
      case 'education':
        return planListSection(doc.education, 'education', itemId, {
          jsonSchema: educationJsonSchema,
          schema: EducationDraftSchema,
          verify: (item: EducationDraft, ctx, rem) => verifyEducationItem(item, 0, ctx, rem),
          toItem: toEducationItem,
        });
    }
  }

  /** One LLM call with schema validation, plus one corrective retry on malformed output. */
  private async callAndParse<S extends ZodTypeAny>(req: LlmToolRequest, schema: S): Promise<z.output<S>> {
    const first = schema.safeParse(await this.llm.callTool(req));
    if (first.success) return first.data;

    const issues = first.error.issues.slice(0, 10).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    this.logger.warn(`${req.purpose}: invalid tool input, retrying once:\n${issues}`);
    const second = schema.safeParse(
      await this.llm.callTool({ ...req, user: buildInvalidOutputMessage(req.user, issues), purpose: `${req.purpose}:retry` }),
    );
    if (second.success) return second.data;
    throw new LlmOutputError(`Model returned invalid ${req.tool.name} input twice`);
  }
}

type VerifyCtx = ReturnType<typeof createContext>;

interface SectionPlan {
  current: unknown;
  addsNewItem: boolean;
  jsonSchema: Record<string, unknown>;
  schema: ZodTypeAny;
  // `raw` has already been validated by `schema`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toChange: (raw: any, ctx: VerifyCtx, removals: Removal[]) => SectionChange;
}

function wrap(key: string, schema: unknown): Record<string, unknown> {
  return { type: 'object', properties: { [key]: schema }, required: [key] };
}

function planListSection<Draft, Item extends { id: string }>(
  list: Item[],
  section: 'experience' | 'education',
  itemId: string | null,
  spec: {
    jsonSchema: unknown;
    schema: ZodTypeAny;
    verify: (item: Draft, ctx: VerifyCtx, rem: Removal[]) => Draft | null;
    toItem: (item: Draft, id?: string) => Item;
  },
): SectionPlan {
  if (itemId === null) {
    // A section-level question ("any other experience?") can only add entries.
    return {
      current: list.map(({ id: _id, ...rest }) => rest),
      addsNewItem: true,
      jsonSchema: wrap('newItems', { type: 'array', items: spec.jsonSchema }),
      schema: z.object({ newItems: z.array(spec.schema).max(5) }),
      toChange: (r: { newItems: Draft[] }, ctx, rem) => {
        const added = r.newItems.map((i) => spec.verify(i, ctx, rem)).filter((i): i is Draft => i !== null);
        return { kind: 'append-items', section, items: added.map((i) => spec.toItem(i)) } as unknown as SectionChange;
      },
    };
  }

  const index = list.findIndex((i) => i.id === itemId);
  if (index === -1) throw new ItemNotFoundError(`The ${section} entry this question refers to no longer exists`);
  const { id: _id, ...current } = list[index]!;
  return {
    current,
    addsNewItem: false,
    jsonSchema: wrap('item', spec.jsonSchema),
    schema: z.object({ item: spec.schema }),
    toChange: (r: { item: Draft }, ctx, rem) => {
      const verified = spec.verify(r.item, ctx, rem);
      // A failed verification must never delete the user's entry; keep the original.
      const item = verified ? spec.toItem(verified, itemId) : list[index]!;
      return { kind: 'replace-item', section, itemId, item } as unknown as SectionChange;
    },
  };
}
