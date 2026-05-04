import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { Content, ContentDocument } from './content.schema';
import { CreateContentDto } from './dto/create-content.dto';
import { GenerateQuizDto } from './dto/generate-quiz.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { User } from '../users/user.schema';

type UploadedChapterFile = {
  originalname: string;
  buffer: Buffer;
};

type QuestionCandidate = {
  sentence: string;
  answer: string;
  highlightedSentence: string;
  kind: 'count' | 'role' | 'definition' | 'generic';
  subject: string;
};

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Content.name) private contentModel: Model<ContentDocument>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  private buildTeacherFilter(teacherEmail?: string) {
    const normalizedTeacherEmail = teacherEmail?.trim().toLowerCase();
    return normalizedTeacherEmail ? { teacherEmail: normalizedTeacherEmail } : {};
  }

  private normalizeEmail(value?: string) {
    return value?.trim().toLowerCase() || '';
  }

  private normalizeText(value: string) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private normalizeContentReference(value?: string) {
    return this.normalizeText(String(value || ''))
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeClassName(value?: string) {
    return `${value || ''}`.trim().toUpperCase();
  }

  private normalizeClassList(values: Array<string | null | undefined>) {
    return [
      ...new Set(
        values
          .map(value => this.normalizeClassName(value || ''))
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right, 'fr'));
  }

  private normalizeCourseKey(value?: string) {
    return this.normalizeContentReference(value);
  }

  private async getTeacherByEmail(teacherEmail?: string) {
    const normalizedTeacherEmail = this.normalizeEmail(teacherEmail);
    if (!normalizedTeacherEmail) {
      return null;
    }

    return this.userModel
      .findOne({
        role: 'teacher',
        email: normalizedTeacherEmail,
      })
      .lean()
      .exec();
  }

  private getTeacherAssignedClasses(teacher?: any) {
    return this.normalizeClassList([
      teacher?.className,
      ...(Array.isArray(teacher?.assignedClasses) ? teacher.assignedClasses : []),
    ]);
  }

  private getTeacherCourseAssignments(teacher?: any) {
    const fallbackClasses = this.getTeacherAssignedClasses(teacher);
    const assignments = Array.isArray(teacher?.teachingAssignments)
      ? teacher.teachingAssignments
      : [];
    const assignmentMap = new Map<string, { subject: string; classes: string[] }>();

    assignments.forEach((assignment: any) => {
      const subject = `${assignment?.subject || ''}`.trim();
      const subjectKey = this.normalizeCourseKey(subject);
      if (!subject || !subjectKey) {
        return;
      }

      const classes = this.normalizeClassList(
        Array.isArray(assignment?.classes) ? assignment.classes : [],
      );
      assignmentMap.set(subjectKey, {
        subject,
        classes: classes.length ? classes : fallbackClasses,
      });
    });

    (Array.isArray(teacher?.teachingSubjects) ? teacher.teachingSubjects : []).forEach(
      (subjectValue: string) => {
        const subject = `${subjectValue || ''}`.trim();
        const subjectKey = this.normalizeCourseKey(subject);
        if (!subject || !subjectKey || assignmentMap.has(subjectKey)) {
          return;
        }

        assignmentMap.set(subjectKey, {
          subject,
          classes: fallbackClasses,
        });
      },
    );

    return Array.from(assignmentMap.values()).sort((left, right) =>
      left.subject.localeCompare(right.subject, 'fr'),
    );
  }

  private isCourseAllowedForClass(
    assignment: { classes: string[] },
    className?: string,
  ) {
    const normalizedClassName = this.normalizeClassName(className);
    return !normalizedClassName || assignment.classes.includes(normalizedClassName);
  }

  private isContentVisibleForClass(content: any, className?: string) {
    const normalizedClassName = this.normalizeClassName(className);
    if (!normalizedClassName) {
      return true;
    }

    if (content?.visibleToAllClasses === true) {
      return true;
    }

    const visibleClasses = this.normalizeClassList(
      Array.isArray(content?.visibleToClasses) ? content.visibleToClasses : [],
    );

    return visibleClasses.length === 0 || visibleClasses.includes(normalizedClassName);
  }

  private getContentCourseLabel(content: Partial<Content>) {
    return `${content?.courseId || content?.title || ''}`.trim();
  }

  private async assertTeacherCanUseCourse(payload: Partial<Content>) {
    const teacherEmail = this.normalizeEmail(payload.teacherEmail);
    if (!teacherEmail) {
      return;
    }

    const teacher = await this.getTeacherByEmail(teacherEmail);
    if (!teacher) {
      throw new BadRequestException('Enseignant introuvable.');
    }

    const assignments = this.getTeacherCourseAssignments(teacher);
    if (assignments.length === 0) {
      throw new BadRequestException(
        "Aucun cours n'est attribue a cet enseignant par l'admin.",
      );
    }

    const requestedCourse = this.getContentCourseLabel(payload);
    const requestedCourseKey = this.normalizeCourseKey(requestedCourse);
    const isAllowed = assignments.some(
      assignment => this.normalizeCourseKey(assignment.subject) === requestedCourseKey,
    );

    if (!requestedCourseKey || !isAllowed) {
      throw new BadRequestException(
        "Vous pouvez ajouter du contenu uniquement dans les cours attribues par l'admin.",
      );
    }
  }

  private matchesContentReference(...values: Array<string | undefined>) {
    const normalizedValues = values
      .map(value => this.normalizeContentReference(value))
      .filter(Boolean);

    if (normalizedValues.length <= 1) {
      return normalizedValues.length === 1;
    }

    const [firstValue, ...otherValues] = normalizedValues;
    return otherValues.some(value => value === firstValue);
  }

  private async buildTeacherAvatarMap(teacherEmails: string[]) {
    const normalizedEmails = [...new Set(teacherEmails.map(email => this.normalizeEmail(email)).filter(Boolean))];
    if (normalizedEmails.length === 0) {
      return new Map<string, string>();
    }

    const teachers = await this.userModel
      .find(
        {
          role: 'teacher',
          email: { $in: normalizedEmails },
        },
        { email: 1, profileData: 1 },
      )
      .lean()
      .exec();

    return new Map<string, string>(
      teachers.map(teacher => [
        this.normalizeEmail(teacher.email),
        teacher.profileData?.avatarDataUrl || '',
      ]),
    );
  }

  private async enrichTeacherProfiles<T extends { teacherEmail?: string; teacherAvatarDataUrl?: string }>(
    items: T[],
  ): Promise<T[]> {
    const avatarMap = await this.buildTeacherAvatarMap(items.map(item => item.teacherEmail || ''));

    return items.map(item => ({
      ...this.normalizeContentPayload(item),
      teacherAvatarDataUrl:
        item.teacherAvatarDataUrl ||
        avatarMap.get(this.normalizeEmail(item.teacherEmail)) ||
        '',
    }));
  }

  private normalizeContentPayload<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map(item => this.normalizeContentPayload(item)) as T;
    }

    if (value instanceof Date) {
      return (Number.isNaN(value.getTime()) ? undefined : value.toISOString()) as T;
    }

    if (this.isObjectIdLike(value)) {
      return value.toHexString() as T;
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
          key,
          this.normalizeContentPayload(entryValue),
        ]),
      ) as T;
    }

    if (typeof value === 'string') {
      return this.repairEncoding(value) as T;
    }

    return value;
  }

  private isObjectIdLike(value: unknown): value is Types.ObjectId {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Types.ObjectId).toHexString === 'function'
    );
  }

  private repairEncoding(value: string): string {
    if (!value) {
      return value;
    }

    let repaired = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

    for (let index = 0; index < 3; index += 1) {
      if (!this.looksCorrupted(repaired)) {
        break;
      }

      try {
        const bytes = Uint8Array.from(
          Array.from(repaired).map(character => character.charCodeAt(0) & 0xff),
        );
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

        if (!decoded || decoded === repaired) {
          break;
        }

        repaired = decoded;
      } catch {
        break;
      }
    }

    return repaired
      .replace(/Vid[^a-zA-Z0-9]{0,6}(?:o|éo|eo)/gi, 'Vid\u00e9o')
      .replace(/ajout[^a-zA-Z0-9]{0,6}(?:e|ee)/gi, 'ajout\u00e9e')
      .replace(/Document de cours ajout[^a-zA-Z0-9]{0,6}/gi, 'Document de cours ajout\u00e9')
      .replace(/cr[^a-zA-Z0-9]{0,6}/gi, 'cr\u00e9')
      .replace(/Ã©|Ã¨|Ãª|Ã |Ã§|Ã¹|Ã´|Ã«|Ã¯/g, '\u00e9')
      .replace(/Vidé+o/gi, 'Vid\u00e9o')
      .replace(/ajouté+e/gi, 'ajout\u00e9e')
      .trim();
  }

  private looksCorrupted(value: string): boolean {
    return (
      /[ÃÂâ]/.test(value) ||
      /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
      value.includes('VidÃ') ||
      value.includes('ajoutÃ') ||
      value.includes('Vid?') ||
      value.includes('ajout?')
    );
  }

  async create(createContentDto: CreateContentDto): Promise<Content> {
    this.validateQuizPayloadRules(createContentDto);
    const normalizedDto = this.normalizeVisibilityPayload(
      this.normalizeQuizPayload(createContentDto),
    );
    await this.assertTeacherCanUseCourse(normalizedDto);
    const content = new this.contentModel(normalizedDto);
    const savedContent = await content.save();
    await this.deactivateSiblingQuizzes(savedContent.toObject());
    const [enrichedContent] = await this.enrichTeacherProfiles([savedContent.toObject()]);
    return enrichedContent as Content;
  }

  async findAll(teacherEmail?: string, className?: string): Promise<Content[]> {
    const normalizedTeacherEmail = this.normalizeEmail(teacherEmail);
    const [teacher, rawContents] = await Promise.all([
      this.getTeacherByEmail(normalizedTeacherEmail),
      this.contentModel.find(this.buildTeacherFilter(teacherEmail)).lean().exec(),
    ]);

    if (!normalizedTeacherEmail) {
      const visibleContents = rawContents.filter(content =>
        this.isContentVisibleForClass(content, className),
      );
      return this.enrichTeacherProfiles(visibleContents) as Promise<Content[]>;
    }

    const assignments = this.getTeacherCourseAssignments(teacher);
    const allowedCourseKeys = new Set(
      assignments
        .filter(assignment => this.isCourseAllowedForClass(assignment, className))
        .map(assignment => this.normalizeCourseKey(assignment.subject)),
    );

    const visibleContents = rawContents.filter(content => {
      const contentCourseKey = this.normalizeCourseKey(
        this.getContentCourseLabel(content as Content),
      );

      if (!contentCourseKey || !allowedCourseKeys.has(contentCourseKey)) {
        return false;
      }

      return this.isContentVisibleForClass(content, className);
    });

    const existingCourseKeys = new Set(
      visibleContents
        .map(content => this.normalizeCourseKey(this.getContentCourseLabel(content as Content)))
        .filter(Boolean),
    );
    const placeholders = assignments
      .filter(assignment => this.isCourseAllowedForClass(assignment, className))
      .filter(assignment => !existingCourseKeys.has(this.normalizeCourseKey(assignment.subject)))
      .map(assignment => ({
        type: 'course',
        title: assignment.subject,
        courseId: assignment.subject,
        description: '',
        teacherName: [teacher?.firstName, teacher?.lastName].filter(Boolean).join(' ').trim(),
        teacherEmail: normalizedTeacherEmail,
        visibleToAllClasses: false,
        visibleToClasses: assignment.classes,
        isActive: true,
      }));

    return this.enrichTeacherProfiles([...visibleContents, ...placeholders]) as Promise<Content[]>;
  }

  async findTree(): Promise<any[]> {
    const contents = await this.enrichTeacherProfiles(
      await this.contentModel.find().lean().exec(),
    );
    const courses = contents.filter(item => item.type === 'course');
    const chapters = contents.filter(item => item.type === 'chapter');
    const parts = contents.filter(item => item.type === 'part');
    const materials = contents.filter(item =>
      ['document', 'video', 'quiz'].includes(item.type),
    );

    return courses.map(course => {
      const courseKey = String(course._id || course.courseId || course.title || '');
      const courseContents = materials.filter(
        mat =>
          this.matchesContentReference(
            mat.courseId,
            courseKey,
            course.title,
            course.courseId,
          ) && !this.hasMeaningfulValue(mat.chapterId),
      );
      const courseChapters = chapters
        .filter(chapter =>
          this.matchesContentReference(
            chapter.courseId,
            courseKey,
            course.title,
            course.courseId,
          ),
        )
        .map(chapter => {
          const chapterKey = String(chapter._id || chapter.chapterId || chapter.title || '');
          const chapterMaterials = materials.filter(
            mat =>
              this.matchesContentReference(
                mat.courseId,
                courseKey,
                course.title,
                course.courseId,
              ) &&
              this.matchesContentReference(
                mat.chapterId,
                chapterKey,
                chapter.title,
                chapter.chapterId,
              ),
          );
          const chapterParts = parts
            .filter(part =>
              this.matchesContentReference(
                part.courseId,
                courseKey,
                course.title,
                course.courseId,
              ) &&
              this.matchesContentReference(
                part.chapterId,
                chapterKey,
                chapter.title,
                chapter.chapterId,
              ),
            )
            .map(part => ({
              ...part,
              materials: chapterMaterials.filter(material =>
                this.matchesContentReference(
                  material.partId,
                  String(part._id || part.partId || part.title || ''),
                  part.title,
                  part.partId,
                ),
              ),
            }));

          const chapterQuizzes = chapterMaterials.filter(
            mat =>
              mat.type === 'quiz' &&
              !this.hasMeaningfulValue(mat.partId),
          );
          const chapterContents = chapterMaterials.filter(
            mat => !this.hasMeaningfulValue(mat.partId),
          );

          return {
            ...chapter,
            parts: chapterParts,
            chapterContents,
            chapterQuizzes,
          };
        });

      return {
        ...course,
        courseContents,
        chapters: courseChapters,
      };
    });
  }

  async findOverview(): Promise<any[]> {
    const tree = await this.findTree();
    return tree.map(course => {
      const chapterCount = course.chapters.length;
      const partCount = course.chapters.reduce(
        (sum, ch) => sum + (ch.parts?.length ?? 0),
        0,
      );
      const docCount = course.chapters.reduce(
        (sum, ch) =>
          sum +
          ch.parts.reduce(
            (ps, pt) =>
              ps + (pt.materials?.filter(m => m.type === 'document').length ?? 0),
            0,
          ) +
          (ch.chapterContents?.filter(m => m.type === 'document').length ?? 0),
        0,
      ) + (course.courseContents?.filter(m => m.type === 'document').length ?? 0);
      const videoCount = course.chapters.reduce(
        (sum, ch) =>
          sum +
          ch.parts.reduce(
            (ps, pt) =>
              ps + (pt.materials?.filter(m => m.type === 'video').length ?? 0),
            0,
          ) +
          (ch.chapterContents?.filter(m => m.type === 'video').length ?? 0),
        0,
      ) + (course.courseContents?.filter(m => m.type === 'video').length ?? 0);
      const quizCount = course.chapters.reduce(
        (sum, ch) =>
          sum +
          ch.parts.reduce(
            (ps, pt) =>
              ps + (pt.materials?.filter(m => m.type === 'quiz').length ?? 0),
            0,
          ) +
          (ch.chapterContents?.filter(m => m.type === 'quiz').length ?? 0),
        0,
      ) + (course.courseContents?.filter(m => m.type === 'quiz').length ?? 0);

      return {
        id: course._id,
        title: course.title,
        description: course.description,
        chapterCount,
        partCount,
        docCount,
        videoCount,
        quizCount,
        isActive: course.isActive,
      };
    });
  }

  async findTeacherDashboardStats(teacherEmail?: string, className?: string) {
    const normalizedTeacherEmail = teacherEmail?.trim().toLowerCase();
    if (!normalizedTeacherEmail) {
      return {
        totalCourses: 0,
        totalStudents: 0,
        assignedClasses: [],
      };
    }

    const teacher = await this.userModel
      .findOne({
        role: 'teacher',
        email: normalizedTeacherEmail,
      })
      .lean()
      .exec();

    const assignedClasses = this.getTeacherAssignedClasses(teacher);
    const selectedClassName = this.normalizeClassName(className);
    const filteredClasses =
      selectedClassName && assignedClasses.includes(selectedClassName)
        ? [selectedClassName]
        : assignedClasses;
    const allowedCourseKeys = new Set(
      this.getTeacherCourseAssignments(teacher)
        .filter(assignment => this.isCourseAllowedForClass(assignment, selectedClassName))
        .map(assignment => this.normalizeCourseKey(assignment.subject)),
    );

    const [totalCourses, totalStudents] = await Promise.all([
      allowedCourseKeys.size > 0
        ? Promise.resolve(allowedCourseKeys.size)
        : this.contentModel.distinct('courseId', {
            teacherEmail: normalizedTeacherEmail,
          }).then(courseIds => courseIds.filter(Boolean).length),
      filteredClasses.length > 0
        ? this.userModel.countDocuments({
            role: 'student',
            className: { $in: filteredClasses },
          })
        : Promise.resolve(0),
    ]);

    return {
      totalCourses,
      totalStudents,
      assignedClasses,
      selectedClass: selectedClassName || 'all',
    };
  }

  async findOne(id: string): Promise<Content> {
    this.assertValidContentId(id);
    const content = await this.contentModel.findById(id).lean().exec();
    if (!content) {
      throw new NotFoundException(`Content #${id} not found`);
    }
    const [enrichedContent] = await this.enrichTeacherProfiles([content]);
    return enrichedContent as Content;
  }

  async generateQuizQuestions(dto: GenerateQuizDto, chapterFile?: UploadedChapterFile) {
    const apiKey = this.configService.get<string>('HUGGINGFACE_API_KEY');
    const model =
      this.configService.get<string>('HUGGINGFACE_QUIZ_MODEL') ||
      'Qwen/Qwen2.5-7B-Instruct';
    const questionCount = Math.max(1, Math.min(40, Number(dto.questionCount) || 10));
    const difficulty = (dto.difficulty || 'moyen').trim();
    const chapterScope = `${dto.sourceChapter || dto.chapterId || chapterFile?.originalname || ''}`
      .replace(/\.[^.]+$/, '')
      .trim();

    if (!`${dto.title || ''}`.trim()) {
      throw new BadRequestException('Le titre du quiz est obligatoire.');
    }

    if (!chapterScope) {
      throw new BadRequestException(
        'Le chapitre source est obligatoire pour generer le quiz.',
      );
    }

    const chapterContext = chapterFile
      ? await this.extractTextFromUploadedChapterFile(chapterFile)
      : await this.buildQuizChapterContext(dto, chapterScope);
    const questions = apiKey
      ? await this.generateStructuredQuizWithHuggingFace(
          chapterContext,
          questionCount,
          model,
          apiKey,
          difficulty,
          chapterScope,
        ).catch(error => {
          this.logger.warn(
            `[HUGGINGFACE CHAT QUIZ] fallback local apres erreur: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return this.generateLocalQuizQuestions(
            chapterContext,
            questionCount,
            difficulty,
            chapterScope,
          );
        })
      : this.generateLocalQuizQuestions(
          chapterContext,
          questionCount,
          difficulty,
          chapterScope,
        );

    if (questions.length === 0) {
      throw new InternalServerErrorException(
        "Aucune question exploitable n'a ete generee.",
      );
    }

    return {
      questions: questions.slice(0, questionCount),
      model,
      sourceChapter: chapterScope,
    };
  }

  async generateFlashcards(dto: {
    subject: string;
    difficulty?: string;
    questionCount?: number;
  }) {
    const subject = this.compactWhitespace(String(dto.subject || '').trim());
    const subjectKey = this.normalizeContentReference(subject);
    const difficulty = this.compactWhitespace(String(dto.difficulty || 'facile').trim());
    const questionCount = Math.max(1, Math.min(10, Number(dto.questionCount) || 10));
    const apiKey = this.configService.get<string>('HUGGINGFACE_API_KEY');
    const model =
      this.configService.get<string>('HUGGINGFACE_QUIZ_MODEL') ||
      'Qwen/Qwen2.5-7B-Instruct';

    if (!subject) {
      throw new BadRequestException('La matiere est obligatoire.');
    }

    if (!apiKey) {
      return {
        flashcards: this.buildLocalFlashcards(subject, difficulty, questionCount),
        model,
        source: 'local',
      };
    }

    try {
      const timeoutMs = Math.max(
        2500,
        Number(this.configService.get<string>('HUGGINGFACE_FLASHCARDS_TIMEOUT_MS')) ||
          7000,
      );
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);
      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.25,
          max_tokens: 1200,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'flashcard_generation',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  flashcards: {
                    type: 'array',
                    minItems: questionCount,
                    maxItems: questionCount,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        question: { type: 'string' },
                        answer: { type: 'string' },
                      },
                      required: ['question', 'answer'],
                    },
                  },
                },
                required: ['flashcards'],
              },
            },
          },
          messages: [
            {
              role: 'system',
              content: [
                'Tu es un assistant pedagogique expert en revision par flashcards.',
                'Retourne uniquement un JSON valide conforme au schema.',
                'Chaque flashcard doit contenir une question claire et une reponse courte mais complete.',
                'Les questions et reponses doivent etre en francais.',
                'Toutes les questions doivent etre strictement liees a la matiere demandee.',
                'Ne pose jamais de question sur les flashcards, la revision ou la methode de memorisation.',
                'Les questions doivent etre differentes entre elles et couvrir des notions variees.',
              ].join(' '),
            },
            {
              role: 'user',
              content: `Genere ${questionCount} flashcards nouvelles pour la matiere "${subject}" avec un niveau ${difficulty}. Variation de session: ${Date.now()}-${Math.random()}.`,
            },
          ],
        }),
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as any;
      const rawContent = `${data?.choices?.[0]?.message?.content || ''}`.trim();
      const parsed = JSON.parse(rawContent);
      const flashcards = Array.isArray(parsed?.flashcards)
        ? parsed.flashcards
            .map((card: any, index: number) => ({
              id: `flashcard-${index + 1}`,
              question: this.repairEncoding(this.compactWhitespace(`${card?.question || ''}`)),
              answer: this.repairEncoding(this.compactWhitespace(`${card?.answer || ''}`)),
              subject,
              difficulty,
            }))
            .filter((card: any) => card.question && card.answer)
            .slice(0, questionCount)
        : [];
      const uniqueQuestionCount = new Set(
        flashcards.map((card: any) => this.normalizeContentReference(card.question)),
      ).size;
      const isValidGeneration =
        flashcards.length === questionCount &&
        uniqueQuestionCount === questionCount &&
        flashcards.every((card: any) => this.isFlashcardRelevantToSubject(card, subjectKey));

      return {
        flashcards: isValidGeneration
          ? flashcards
          : this.buildLocalFlashcards(subject, difficulty, questionCount),
        model,
        source: isValidGeneration ? 'huggingface' : 'local',
      };
    } catch (error) {
      this.logger.warn(
        `[HUGGINGFACE FLASHCARDS] fallback local apres erreur: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        flashcards: this.buildLocalFlashcards(subject, difficulty, questionCount),
        model,
        source: 'local',
      };
    }
  }

  private buildLocalFlashcards(subject: string, difficulty: string, count: number) {
    const subjectKey = this.normalizeContentReference(subject);
    const infographieCards = [
      {
        question: "Quel est le role principal d'un infographiste ?",
        answer: "Un infographiste cree des supports visuels clairs pour communiquer une idee, une information ou une emotion.",
      },
      {
        question: "A quoi sert le montage video ?",
        answer: "Le montage video assemble, coupe et organise des images, du son et des effets pour raconter une histoire claire.",
      },
      {
        question: "Quels outils sont souvent utilises en infographie ?",
        answer: "Les outils principaux sont l'ordinateur, les logiciels de creation graphique, les images, les polices et les couleurs.",
      },
      {
        question: "Pourquoi la couleur est-elle importante dans une affiche ?",
        answer: "La couleur attire l'attention, organise les informations et transmet une ambiance ou un message.",
      },
      {
        question: "Qu'est-ce qu'une image bitmap ?",
        answer: "Une image bitmap est composee de pixels et perd de la qualite si elle est trop agrandie.",
      },
      {
        question: "Qu'est-ce qu'une image vectorielle ?",
        answer: "Une image vectorielle est composee de formes mathematiques et peut etre agrandie sans perte de qualite.",
      },
      {
        question: "Pourquoi utilise-t-on des calques dans un logiciel graphique ?",
        answer: "Les calques permettent de separer, organiser et modifier les elements d'un projet sans tout changer.",
      },
      {
        question: "A quoi sert la typographie dans une creation visuelle ?",
        answer: "La typographie rend le texte lisible, hierarchise l'information et renforce le style du visuel.",
      },
      {
        question: "Pourquoi faut-il respecter la resolution d'une image ?",
        answer: "La resolution garantit une bonne qualite d'affichage ou d'impression et evite une image floue.",
      },
      {
        question: "Que signifie exporter un projet graphique ou video ?",
        answer: "Exporter transforme le projet de travail en fichier final partageable, comme PNG, PDF ou MP4.",
      },
      {
        question: "A quoi sert le cadrage dans une video ?",
        answer: "Le cadrage choisit ce qui apparait dans l'image pour guider le regard et renforcer le message.",
      },
      {
        question: "Pourquoi ajoute-t-on des transitions dans un montage ?",
        answer: "Les transitions rendent le passage entre deux plans plus fluide et aident a structurer la video.",
      },
      {
        question: "Quel est le role du contraste dans un visuel ?",
        answer: "Le contraste rend les elements importants plus visibles et ameliore la lisibilite.",
      },
      {
        question: "Pourquoi faut-il organiser les fichiers d'un projet video ?",
        answer: "Organiser les fichiers permet de retrouver rapidement les images, sons et videos pendant le montage.",
      },
      {
        question: "A quoi sert une charte graphique ?",
        answer: "Une charte graphique fixe les couleurs, polices et styles pour garder une identite visuelle coherente.",
      },
    ];
    const mathCards = [
      {
        question: 'Que represente une addition ?',
        answer: 'Une addition permet de reunir plusieurs quantites pour trouver une somme.',
      },
      {
        question: 'Quel est le resultat de 2 + 2 ?',
        answer: '4',
      },
      {
        question: 'Que represente une soustraction ?',
        answer: 'Une soustraction permet de retirer une quantite ou de calculer une difference.',
      },
      {
        question: "Comment appelle-t-on le resultat d'une multiplication ?",
        answer: "Le resultat d'une multiplication s'appelle un produit.",
      },
      {
        question: 'A quoi sert une division ?',
        answer: 'Une division sert a partager une quantite en parts egales ou a trouver combien de fois un nombre contient un autre.',
      },
      {
        question: "Qu'est-ce qu'un nombre pair ?",
        answer: 'Un nombre pair est un nombre divisible par 2 sans reste.',
      },
      {
        question: "Qu'est-ce qu'une fraction ?",
        answer: "Une fraction represente une partie d'un tout avec un numerateur et un denominateur.",
      },
      {
        question: 'Que signifie simplifier une fraction ?',
        answer: 'Simplifier une fraction signifie diviser le numerateur et le denominateur par un meme nombre pour obtenir une fraction equivalente.',
      },
      {
        question: "Qu'est-ce qu'un pourcentage ?",
        answer: 'Un pourcentage est une proportion exprimee sur 100.',
      },
      {
        question: "Comment calcule-t-on le perimetre d'un rectangle ?",
        answer: "Le perimetre d'un rectangle se calcule avec 2 fois la longueur plus 2 fois la largeur.",
      },
      {
        question: "Comment calcule-t-on l'aire d'un rectangle ?",
        answer: "L'aire d'un rectangle se calcule en multipliant la longueur par la largeur.",
      },
      {
        question: 'Que represente une equation ?',
        answer: "Une equation est une egalite contenant une inconnue que l'on cherche a trouver.",
      },
      {
        question: "Qu'est-ce qu'une moyenne ?",
        answer: 'Une moyenne se calcule en additionnant les valeurs puis en divisant par le nombre de valeurs.',
      },
      {
        question: 'Que signifie arrondir un nombre ?',
        answer: 'Arrondir un nombre consiste a le remplacer par une valeur plus simple et proche.',
      },
      {
        question: "A quoi sert l'ordre des operations ?",
        answer: "L'ordre des operations indique quelles operations effectuer en premier pour obtenir le bon resultat.",
      },
    ];
    const genericTopics = [
      ['definition', `Qu'est-ce que ${subject} ?`, `${subject} est une matiere qui regroupe des notions, methodes et exemples a comprendre et appliquer.`],
      ['role', `Quel est le role principal de ${subject} ?`, `Le role principal de ${subject} est d'aider a resoudre des problemes et a organiser les connaissances.`],
      ['outil', `Citez un outil ou une methode importante en ${subject}.`, `Un outil important en ${subject} est une methode de travail qui permet d'analyser, pratiquer et verifier les resultats.`],
      ['exemple', `Donnez un exemple d'application de ${subject}.`, `Un exemple d'application de ${subject} consiste a utiliser une notion du cours dans une situation concrete.`],
      ['importance', `Pourquoi ${subject} est-elle importante ?`, `${subject} est importante parce qu'elle developpe des competences utiles pour comprendre et realiser des projets.`],
      ['etape', `Quelle est une etape essentielle pour reviser ${subject} ?`, `Une etape essentielle est de lire la notion, refaire un exemple puis verifier sa reponse.`],
      ['erreur', `Quelle erreur faut-il eviter en ${subject} ?`, `Il faut eviter d'apprendre sans comprendre et toujours verifier les definitions, exemples et resultats.`],
      ['resume', `Comment resumer une notion en ${subject} ?`, `On resume une notion avec sa definition, son role, un exemple et les mots-cles importants.`],
      ['pratique', `Pourquoi pratiquer des exercices en ${subject} ?`, `La pratique aide a memoriser les notions et a savoir les utiliser dans des situations variees.`],
      ['verification', `Comment verifier une reponse en ${subject} ?`, `On verifie une reponse en comparant avec la definition, les etapes du cours et un exemple correct.`],
    ].map(([id, question, answer]) => ({ id, question, answer }));
    const pool = subjectKey.includes('infographie') || subjectKey.includes('montage')
      ? infographieCards
      : subjectKey.includes('math')
        ? mathCards
        : genericTopics;
    return this.shuffleFlashcardPool(pool).slice(0, count).map((card, index) => ({
      id: `local-flashcard-${index + 1}`,
      question: card.question,
      answer: card.answer,
      subject,
      difficulty,
    }));
  }

  private shuffleFlashcardPool<T>(cards: T[]) {
    return [...cards].sort(() => Math.random() - 0.5);
  }

  private isFlashcardRelevantToSubject(
    card: { question?: string; answer?: string },
    subjectKey: string,
  ) {
    const text = this.normalizeContentReference(`${card.question || ''} ${card.answer || ''}`);
    if (
      text.includes('flashcard') ||
      text.includes('carte revision') ||
      text.includes('revision') ||
      text.includes('memorisation')
    ) {
      return false;
    }

    if (subjectKey.includes('math')) {
      return [
        'addition', 'soustraction', 'multiplication', 'division', 'somme',
        'nombre', 'fraction', 'equation', 'calcul', 'perimetre', 'aire',
        'moyenne', 'pourcentage', 'operation', 'resultat',
      ].some(keyword => text.includes(keyword));
    }

    if (subjectKey.includes('infographie') || subjectKey.includes('montage')) {
      return [
        'infograph', 'montage', 'video', 'visuel', 'image', 'couleur', 'calque',
        'typographie', 'resolution', 'export', 'cadrage', 'transition',
        'graphique', 'logiciel',
      ].some(keyword => text.includes(keyword));
    }

    const subjectWords = subjectKey
      .split(' ')
      .filter(word => word.length >= 4 && !['base', 'niveau'].includes(word));
    return subjectWords.length === 0 || subjectWords.some(word => text.includes(word));
  }

  async parseQuizQuestionsFromUpload(file: UploadedChapterFile) {
    const extension = extname(file.originalname || '').toLowerCase();
    let rawText = '';

    if (extension === '.pdf') {
      const parser = new PDFParse({ data: file.buffer });
      const parsedPdf = await parser.getText();
      rawText = parsedPdf.text || '';
      await parser.destroy();
    } else if (extension === '.docx') {
      const parsedDoc = await mammoth.extractRawText({ buffer: file.buffer });
      rawText = parsedDoc.value || '';
    } else if (extension === '.doc') {
      throw new BadRequestException(
        'Le format DOC n\'est pas pris en charge pour l\'aperçu modifiable. Utilisez PDF ou DOCX.',
      );
    } else {
      throw new BadRequestException(
        'Le fichier du quiz doit etre au format PDF ou DOCX.',
      );
    }

    const parsedQuestions = this.parseQuizText(rawText);
    return {
      questions:
        parsedQuestions.length > 0
          ? parsedQuestions
          : this.generateLocalQuizQuestions(
              rawText,
              10,
              'moyen',
              file.originalname || 'quiz',
            ),
    };
  }

  async update(id: string, updateContentDto: UpdateContentDto): Promise<Content> {
    this.assertValidContentId(id);
    const currentContent = await this.contentModel.findById(id).lean().exec();
    if (!currentContent) {
      throw new NotFoundException(`Content #${id} not found`);
    }

    this.validateQuizPayloadRules(updateContentDto, currentContent as Content);
    const normalizedDto = this.normalizeVisibilityPayload(
      this.normalizeQuizUpdatePayload(updateContentDto, currentContent as Content),
    );
    await this.assertTeacherCanUseCourse({
      ...(currentContent as Content),
      ...normalizedDto,
    });
    const updateOperation = this.buildContentUpdateOperation(normalizedDto);
    const existing = await this.contentModel
      .findByIdAndUpdate(id, updateOperation, { new: true, lean: true })
      .exec();
    if (!existing) {
      throw new NotFoundException(`Content #${id} not found`);
    }
    await this.deactivateSiblingQuizzes(existing);
    const [enrichedContent] = await this.enrichTeacherProfiles([existing]);
    return enrichedContent as Content;
  }

  private buildContentUpdateOperation(payload: Partial<UpdateContentDto>) {
    const unsetFields = ['partId', 'chapterId', 'courseId', 'fileUrl', 'fileName', 'source'].filter(
      field => field in payload && !this.hasMeaningfulValue(payload[field as keyof UpdateContentDto]),
    );

    if (!unsetFields.length) {
      return payload;
    }

    const updatePayload = { ...payload } as Record<string, unknown>;
    unsetFields.forEach(field => {
      delete updatePayload[field];
    });

    return {
      $set: updatePayload,
      $unset: unsetFields.reduce(
        (acc, field) => {
          acc[field] = 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  private normalizeQuizScopeValue(value?: string) {
    return `${value || ''}`.trim().toLowerCase();
  }

  private async deactivateSiblingQuizzes(content: Partial<Content> & { _id?: unknown }) {
    if (String(content?.type || '').toLowerCase() !== 'quiz') {
      return;
    }

    const teacherEmail = this.normalizeEmail(content?.teacherEmail);
    const courseId = this.normalizeQuizScopeValue(content?.courseId);
    const chapterId = this.normalizeQuizScopeValue(content?.chapterId);
    const partId = this.normalizeQuizScopeValue(content?.partId);
    const quizDifficulty = this.normalizeQuizScopeValue(content?.quizDifficulty);
    const contentId = String(content?._id || '').trim();

    if (!teacherEmail || !courseId || !chapterId || !quizDifficulty || !contentId) {
      return;
    }

    const baseFilter: Record<string, unknown> = {
      _id: { $ne: new Types.ObjectId(contentId) },
      type: 'quiz',
      teacherEmail,
      courseId: new RegExp(`^\\s*${this.escapeRegex(courseId)}\\s*$`, 'i'),
      chapterId: new RegExp(`^\\s*${this.escapeRegex(chapterId)}\\s*$`, 'i'),
      quizDifficulty: new RegExp(`^\\s*${this.escapeRegex(quizDifficulty)}\\s*$`, 'i'),
      isActive: { $ne: false },
    };

    if (partId) {
      baseFilter.partId = new RegExp(`^\\s*${this.escapeRegex(partId)}\\s*$`, 'i');
    } else {
      baseFilter.$or = [
        { partId: { $exists: false } },
        { partId: null },
        { partId: '' },
      ];
    }

    await this.contentModel.updateMany(
      baseFilter,
      {
        $set: {
          isActive: false,
        },
      },
    );
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async remove(id: string): Promise<void> {
    this.assertValidContentId(id);
    const result = await this.contentModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Content #${id} not found`);
    }
  }

  async removeCourse(courseId: string, teacherEmail?: string): Promise<void> {
    const result = await this.contentModel
      .deleteMany({
        courseId,
        ...this.buildTeacherFilter(teacherEmail),
      })
      .exec();
    if (!result.deletedCount) {
      throw new NotFoundException(`Course "${courseId}" not found`);
    }
  }

  async attachFileUrl(id: string, fileUrl: string, fileName?: string): Promise<Content> {
    this.assertValidContentId(id);
    const currentContent = await this.contentModel.findById(id).exec();
    if (!currentContent) {
      throw new NotFoundException(`Content #${id} not found`);
    }

    const updatePayload: Partial<Content> = { fileUrl };
    if (fileName) {
      updatePayload.fileName = fileName;
    }
    if (currentContent.type === 'video') {
      updatePayload.source = fileUrl;
    }

    const content = await this.contentModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .exec();
    if (!content) {
      throw new NotFoundException(`Content #${id} not found`);
    }

    if (
      content.type === 'quiz' &&
      (!Array.isArray(content.quizQuestions) || content.quizQuestions.length === 0)
    ) {
      const parsedQuestions = await this.parseQuizQuestionsFromFile(fileUrl);
      if (parsedQuestions.length > 0) {
        const parsedContent = await this.contentModel
          .findByIdAndUpdate(
            id,
            {
              quizQuestions: parsedQuestions,
              quizQuestionCount: parsedQuestions.length,
            },
            { new: true },
          )
          .exec();

        if (parsedContent) {
          const [enrichedParsedContent] = await this.enrichTeacherProfiles([
            parsedContent.toObject(),
          ]);
          return enrichedParsedContent as Content;
        }
      }
    }

    const [enrichedContent] = await this.enrichTeacherProfiles([content.toObject()]);
    return enrichedContent as Content;
  }

  private async parseQuizQuestionsFromFile(fileUrl: string) {
    const relativePath = fileUrl.replace(/^\/+/, '').replace(/\//g, '\\');
    const filePath = join(process.cwd(), relativePath);
    const extension = extname(filePath).toLowerCase();

    let rawText = '';
    if (extension === '.pdf') {
      const buffer = await readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const parsedPdf = await parser.getText();
      rawText = parsedPdf.text || '';
      await parser.destroy();
    } else if (extension === '.docx') {
      rawText = await this.extractDocxText(filePath);
    } else {
      return [];
    }

    return this.parseQuizText(rawText);
  }

  private async extractDocxText(filePath: string): Promise<string> {
    const parsedDoc = await mammoth.extractRawText({ path: filePath });
    return parsedDoc.value || '';
  }

  private parseQuizText(rawText: string) {
    const text = rawText
      .replace(/\r/g, '')
      .replace(/[•??â€¢â—âœ…]/g, '')
      .replace(/[–—]/g, '-')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text) {
      return [];
    }

    const questionBlocks = text
      .split(/\n(?=(?:Quiz\s*\d+\s*:|Question(?:\s*n)?\s*\d+\s*:?|Question\s*:|Q\s*\d+\s*:|\d+\s*[\.\)]\s))/i)
      .map(block => block.trim())
      .filter(Boolean);

    const parsedQuestions = questionBlocks
      .map((block, index) => this.parseQuizBlock(block, index))
      .filter(question => question !== null);

    return parsedQuestions.length > 0
      ? parsedQuestions
      : this.parseNumberedQuestions(text) || this.parseQuizByGlobalPattern(text);
  }

  private parseQuizBlock(block: string, index: number) {
    const lines = block
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const questionLineIndex = lines.findIndex(
      line =>
        this.normalizedText(line).startsWith('question :') ||
        /^Q\s*\d+\s*:/i.test(line) ||
        /^Question(?:\s*n)?\s*\d+\s*:?/i.test(line) ||
        /^\d+\s*[\.\)]\s+/.test(line),
    );
    const questionLine =
      questionLineIndex >= 0 ? lines[questionLineIndex] : undefined;

    if (!questionLine) {
      return this.parseQuestionWithoutAnswer(block, index);
    }

    const optionLines = lines.filter(
      line => this.isQuizOptionLine(line),
    );
    const firstOptionIndex = lines.findIndex(
      line => this.isQuizOptionLine(line),
    );
    const promptFromHeader = questionLine
      .replace(/^(?:Question(?:\s*n)?\s*\d+|Question|Q\s*\d+|\d+)\s*[:\.\)]?\s*/i, '')
      .trim();
    const promptFromBody =
      firstOptionIndex > questionLineIndex
        ? lines
            .slice(questionLineIndex + 1, firstOptionIndex)
            .join(' ')
            .trim()
        : '';
    const prompt = promptFromHeader || promptFromBody;

    const answerLine = lines.find(line => {
      const normalized = this.normalizedText(line);
      return (
        normalized.startsWith('bonne reponse :') ||
        normalized.startsWith('bonne reponse =') ||
        normalized.startsWith('reponse correcte :') ||
        normalized.startsWith('reponse correcte =') ||
        normalized.startsWith('reponse :') ||
        normalized.startsWith('reponse =') ||
        normalized.startsWith('correct answer :') ||
        normalized.startsWith('correct answer =')
      );
    });

    if (!prompt || !answerLine) {
      return (
        this.parseInlineQuizBlock(block, index) ||
        this.parseQuestionWithoutAnswer(block, index)
      );
    }

    const options = optionLines.map(line => {
      const match = line.match(/^([A-Z]|\d+)\s*[\.\)\/:-]\s*(.*)$/i);
      return {
        label: this.normalizeOptionLabel(match?.[1] || ''),
        text: match?.[2]?.trim() || '',
      };
    });

    const correctAnswers = this.extractCorrectAnswers(answerLine, options);
    if (correctAnswers.length === 0 || options.length === 0) {
      return (
        this.parseInlineQuizBlock(block, index) ||
        this.parseQuestionWithoutAnswer(block, index)
      );
    }

    return {
      id: `parsed-question-${index + 1}`,
      prompt,
      type: correctAnswers.length > 1 ? 'multiple' : 'single',
      options,
      correctAnswers,
      explanation: answerLine.replace(/^.*?:\s*/i, '').trim(),
    };
  }

  private parseInlineQuizBlock(block: string, index: number) {
    const compactBlock = block.replace(/\s+/g, ' ').trim();
    const answerMatch = compactBlock.match(
      /(?:Bonne\s+réponse|Bonne\s+reponse|Bonne\s+rÃ©ponse|Réponse\s+correcte|Reponse\s+correcte|RÃ©ponse\s+correcte|Réponse|Reponse|RÃ©ponse|Correct\s+answer)\s*[:=]\s*(.*)$/i,
    );

    if (!answerMatch?.[1]) {
      return null;
    }

    const questionOptionsPart = compactBlock.replace(answerMatch[0], '').trim();
    const promptMatch = questionOptionsPart.match(
      /(?:Question(?:\s*n)?\s*\d+|Question|Q\s*\d+|\d+)\s*[:\.\)]?\s*(.*?)\s+(?:[A-Da-d]|\d+)\s*[\.\)\/:-]\s+/i,
    );

    if (!promptMatch?.[1]) {
      return null;
    }

    const prompt = promptMatch[1].trim();
    const optionsText = questionOptionsPart.slice(promptMatch[0].length - 3).trim();
    const options = this.extractInlineOptions(optionsText);
    if (options.length === 0) {
      return null;
    }

    const correctAnswers = this.extractCorrectAnswers(answerMatch[0], options);
    if (correctAnswers.length === 0) {
      return null;
    }

    return {
      id: `parsed-question-${index + 1}`,
      prompt,
      type: correctAnswers.length > 1 ? 'multiple' : 'single',
      options,
      correctAnswers,
      explanation: (answerMatch[2] || answerMatch[1]).trim(),
    };
  }

  private extractInlineOptions(optionsText: string) {
    const optionRegex = /([A-Da-d]|\d+)\s*[\.\)\/:-]\s*(.*?)(?=\s+(?:[A-Da-d]|\d+)\s*[\.\)\/:-]\s|$)/g;
    const options: Array<{ label: string; text: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = optionRegex.exec(optionsText)) !== null) {
      options.push({
        label: this.normalizeOptionLabel(match[1]),
        text: match[2].trim(),
      });
    }

    return options;
  }

  private parseQuestionWithoutAnswer(block: string, index: number) {
    const compactBlock = block.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const headingMatch = compactBlock.match(
      /^(?:Quiz\s*\d+\s*:.*?\s+)?(?:Question(?:\s*n)?\s*\d+|Question|Q\s*\d+)\s*:?\s*(.*)$/i,
    );

    if (!headingMatch?.[1]) {
      return null;
    }

    const body = headingMatch[1].trim();
    const optionRegex = /([A-Da-d]|\d+)\s*[\.\)\/:-]\s*(.*?)(?=(?:(?:[A-Da-d]|\d+)\s*[\.\)\/:-]\s)|$)/g;
    const options: Array<{ label: string; text: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = optionRegex.exec(body)) !== null) {
      options.push({
        label: this.normalizeOptionLabel(match[1]),
        text: match[2].trim(),
      });
    }

    if (options.length < 2) {
      return null;
    }

    const firstOptionIndex = body.search(/(?:[A-Da-d]|\d+)\s*[\.\)\/:-]\s*/);
    if (firstOptionIndex < 0) {
      return null;
    }

    const prompt = body.slice(0, firstOptionIndex).trim();
    if (!prompt) {
      return null;
    }

    return {
      id: `parsed-question-${index + 1}`,
      prompt,
      type: 'single',
      options,
      correctAnswers: [],
      explanation: 'Aucune correction nâ€™a Ã©tÃ© trouvÃ©e dans le fichier importÃ©.',
    };
  }

  private parseNumberedQuestions(text: string) {
    const blocks = text
      .split(/\n\s*(?=\d+\.\s)/)
      .map(block => block.trim())
      .filter(Boolean);

    const parsed = blocks
      .map((block, index) => this.parseNumberedQuestionBlock(block, index))
      .filter(question => question !== null);

    return parsed.length > 0 ? parsed : null;
  }

  private parseNumberedQuestionBlock(block: string, index: number) {
    const compactBlock = block.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    const promptMatch = compactBlock.match(/^\d+[\.\)]\s*(.*?)(?=\s+(?:[A-D]|\d+)[\.\)\/:-]\s)/i);
    if (!promptMatch?.[1]) {
      return null;
    }

    const optionsText = compactBlock
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/(?:Réponse|Reponse|RÃ©ponse|Bonne\s+réponse|Bonne\s+reponse|Correct\s+answer)\s*[:=]\s*.*$/i, '')
      .trim();

    const optionRegex = /([A-D]|\d+)\s*[\.\)\/:-]\s*(.*?)(?=\s+(?:[A-D]|\d+)\s*[\.\)\/:-]\s|$)/gi;
    const options: Array<{ label: string; text: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = optionRegex.exec(optionsText)) !== null) {
      options.push({
        label: this.normalizeOptionLabel(match[1]),
        text: match[2].trim(),
      });
    }

    if (options.length < 2) {
      return null;
    }
    const correctAnswers = this.extractCorrectAnswers(compactBlock, options);
    if (correctAnswers.length === 0) {
      return null;
    }

    return {
      id: `parsed-question-${index + 1}`,
      prompt: promptMatch[1].trim(),
      type: correctAnswers.length > 1 ? 'multiple' : 'single',
      options,
      correctAnswers,
      explanation: correctAnswers.join(', '),
    };
  }

  private isQuizOptionLine(line: string) {
    return /^(?:[A-Za-z]|\d+)\s*[\.\)\/:-]\s+\S+/.test(line);
  }

  private normalizeOptionLabel(rawLabel: string) {
    const value = `${rawLabel || ''}`.trim().toUpperCase();
    if (/^\d+$/.test(value)) {
      const numericIndex = Number(value) - 1;
      return this.optionLabel(Math.max(0, numericIndex));
    }

    return value.charAt(0);
  }

  private extractCorrectAnswers(
    answerLine: string,
    options: Array<{ label: string; text: string }>,
  ) {
    const normalizedLine = `${answerLine || ''}`.trim();

    const byLabelsMatch = normalizedLine.match(/[:=]\s*([A-Za-z0-9](?:\s*,\s*[A-Za-z0-9])*)/i);
    if (byLabelsMatch?.[1]) {
      const answers = byLabelsMatch[1]
        .split(',')
        .map(answer => this.normalizeOptionLabel(answer))
        .filter(answer => options.some(option => option.label === answer));

      if (answers.length > 0) {
        return [...new Set(answers)];
      }
    }

    const normalizedAnswerText = this.normalizedText(
      normalizedLine.replace(/^.*?[:=]\s*/, ''),
    );
    if (!normalizedAnswerText) {
      return [];
    }

    const matchedOptions = options
      .filter(option => this.normalizedText(option.text) === normalizedAnswerText)
      .map(option => option.label);

    return [...new Set(matchedOptions)];
  }

  private parseQuizByGlobalPattern(text: string) {
    const normalized = text.replace(/\n+/g, '\n');
    const regex =
      /(?:Quiz\s*\d+\s*:.*?\n)?(?:Question|Q\s*\d+)\s*:\s*([\s\S]*?)\s+A[\.\)]\s+([\s\S]*?)\s+B[\.\)]\s+([\s\S]*?)\s+C[\.\)]\s+([\s\S]*?)(?:\s+D[\.\)]\s+([\s\S]*?))?\s+(?:Bonne\s+réponse|Bonne\s+reponse|Bonne\s+rÃ©ponse|Réponse\s+correcte|Reponse\s+correcte|RÃ©ponse\s+correcte|Réponse|Reponse|RÃ©ponse)\s*:\s*([A-Z](?:\s*,\s*[A-Z])*)(?:[\.\)]\s*([\s\S]*?))?(?=\n\s*Quiz\s*\d+\s*:|$)/gi;

    const parsedQuestions: any[] = [];
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = regex.exec(normalized)) !== null) {
      index += 1;
      const options = [
        { label: 'A', text: match[2].trim() },
        { label: 'B', text: match[3].trim() },
        { label: 'C', text: match[4].trim() },
      ];

      if (match[5]?.trim()) {
        options.push({ label: 'D', text: match[5].trim() });
      }

      parsedQuestions.push({
        id: `parsed-question-${index}`,
        prompt: match[1].trim(),
        type: match[6].includes(',') ? 'multiple' : 'single',
        options,
        correctAnswers: match[6]
          .split(',')
          .map(answer => answer.trim().toUpperCase())
          .filter(Boolean),
        explanation: (match[7] || match[6]).trim(),
      });
    }

    return parsedQuestions;
  }

  private normalizedText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private normalizeQuizPayload<T extends Partial<CreateContentDto>>(payload: T): T {
    if (payload.type !== 'quiz') {
      return payload;
    }

    const normalizedDueDateTime = this.resolveDueDateTime(payload);
    const normalizedDueDate = this.resolveDueDate(payload, normalizedDueDateTime);
    const normalizedQuizQuestions = this.normalizeQuizQuestionsPayload(payload.quizQuestions);
    const quizDisplayMode =
      payload.quizDisplayMode === 'standalone' ||
      (!this.hasMeaningfulValue(payload.chapterId) && !this.hasMeaningfulValue(payload.partId))
        ? 'standalone'
        : 'scoped';

    return {
      ...payload,
      chapterId: quizDisplayMode === 'standalone' ? undefined : payload.chapterId,
      partId: quizDisplayMode === 'standalone' ? undefined : payload.partId,
      dueDate: normalizedDueDate,
      dueDateTime: normalizedDueDateTime,
      quizDisplayMode,
      quizQuestions: normalizedQuizQuestions,
      quizAttempts: payload.quizAttempts ?? 1,
      quizPassingScore: payload.quizPassingScore ?? 70,
      quizQuestionCount:
        payload.quizQuestionCount ??
        (normalizedQuizQuestions.length ? normalizedQuizQuestions.length : undefined),
    };
  }

  private normalizeQuizUpdatePayload<T extends Partial<UpdateContentDto>>(
    payload: T,
    currentContent: Partial<Content>,
  ): T {
    const targetType = payload.type ?? currentContent.type;
    if (targetType !== 'quiz') {
      return payload;
    }

    const normalizedDueDateTime =
      payload.dueDate === undefined && payload.dueDateTime === undefined
        ? currentContent.dueDateTime
        : this.resolveDueDateTime(payload);

    const normalizedDueDate =
      payload.dueDate === undefined && payload.dueDateTime === undefined
        ? currentContent.dueDate
        : this.resolveDueDate(payload, normalizedDueDateTime);

    const nextQuestions =
      payload.quizQuestions !== undefined
        ? this.normalizeQuizQuestionsPayload(payload.quizQuestions)
        : this.normalizeQuizQuestionsPayload(currentContent.quizQuestions);
    const quizDisplayMode =
      payload.quizDisplayMode === 'standalone' ||
      ((payload.quizDisplayMode === undefined
        ? currentContent.quizDisplayMode
        : payload.quizDisplayMode) === 'standalone') ||
      (!this.hasMeaningfulValue(payload.chapterId ?? currentContent.chapterId) &&
        !this.hasMeaningfulValue(payload.partId ?? currentContent.partId))
        ? 'standalone'
        : 'scoped';

    return {
      ...payload,
      chapterId:
        quizDisplayMode === 'standalone'
          ? undefined
          : payload.chapterId ?? currentContent.chapterId,
      partId:
        quizDisplayMode === 'standalone'
          ? undefined
          : payload.partId ?? currentContent.partId,
      dueDate: normalizedDueDate,
      dueDateTime: normalizedDueDateTime,
      quizQuestions: nextQuestions,
      quizDurationMinutes:
        payload.quizDurationMinutes ?? currentContent.quizDurationMinutes,
      quizMode: payload.quizMode ?? currentContent.quizMode,
      quizDifficulty: payload.quizDifficulty ?? currentContent.quizDifficulty,
      quizDisplayMode,
      quizSourceChapter:
        payload.quizSourceChapter ?? currentContent.quizSourceChapter,
      quizAttempts: payload.quizAttempts ?? currentContent.quizAttempts,
      quizPassingScore:
        payload.quizPassingScore ?? currentContent.quizPassingScore,
      quizQuestionCount:
        payload.quizQuestionCount ??
        (nextQuestions?.length ? nextQuestions.length : currentContent.quizQuestionCount),
    };
  }

  private normalizeQuizQuestionsPayload(
    questions: unknown,
  ): NonNullable<CreateContentDto['quizQuestions']> {
    if (!Array.isArray(questions)) {
      return [];
    }

    return questions
      .map((question: any, questionIndex: number) => {
        const options = Array.isArray(question?.options)
          ? question.options
              .map((option: any, optionIndex: number) => ({
                label: `${option?.label || String.fromCharCode(65 + optionIndex)}`
                  .trim()
                  .toUpperCase(),
                text: this.repairEncoding(this.compactWhitespace(`${option?.text || ''}`)),
              }))
              .filter(option => option.text)
          : [];

        const availableLabels = options.map(option => option.label);
        const correctAnswers: string[] = Array.isArray(question?.correctAnswers)
          ? Array.from(
              new Set(
                question.correctAnswers.reduce((answers: string[], answer: unknown) => {
                  const normalizedAnswer = `${answer || ''}`.trim().toUpperCase();
                  if (availableLabels.includes(normalizedAnswer)) {
                    answers.push(normalizedAnswer);
                  }
                  return answers;
                }, []),
              ),
            )
          : [];

        const normalizedType = `${question?.type || 'single'}`.trim().toLowerCase() === 'multiple'
          ? 'multiple'
          : 'single';

        return {
          id: `${question?.id || `quiz-question-${questionIndex + 1}`}`.trim(),
          prompt: this.repairEncoding(this.compactWhitespace(`${question?.prompt || ''}`)),
          type: normalizedType,
          options,
          correctAnswers:
            normalizedType === 'single' ? correctAnswers.slice(0, 1) : correctAnswers,
          explanation: this.repairEncoding(
            this.compactWhitespace(`${question?.explanation || ''}`),
          ) || undefined,
        };
      })
      .filter(question => question.prompt && question.options.length > 0);
  }

  private normalizeVisibilityPayload<T extends Partial<CreateContentDto>>(payload: T): T {
    const normalizedVisibleToClasses = Array.isArray(payload.visibleToClasses)
      ? [...new Set(payload.visibleToClasses.map(value => `${value || ''}`.trim()).filter(Boolean))]
      : undefined;

    if (payload.visibleToAllClasses === undefined && normalizedVisibleToClasses === undefined) {
      return payload;
    }

    const visibleToAllClasses =
      payload.visibleToAllClasses === undefined
        ? false
        : Boolean(payload.visibleToAllClasses);

    return {
      ...payload,
      visibleToAllClasses,
      visibleToClasses: visibleToAllClasses ? [] : normalizedVisibleToClasses || [],
    };
  }

  private assertValidContentId(id: string) {
    if (!/^[a-f\d]{24}$/i.test((id || '').trim())) {
      throw new BadRequestException('Identifiant de contenu invalide.');
    }
  }

  private resolveDueDateTime(payload: Partial<CreateContentDto>) {
    if (payload.dueDateTime) {
      return payload.dueDateTime;
    }

    if (!payload.dueDate) {
      return undefined;
    }

    const dueDate = new Date(payload.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return undefined;
    }

    return dueDate;
  }

  private resolveDueDate(
    payload: Partial<CreateContentDto>,
    normalizedDueDateTime?: Date | string,
  ) {
    if (payload.dueDate) {
      return payload.dueDate;
    }

    if (!normalizedDueDateTime) {
      return undefined;
    }

    return normalizedDueDateTime;
  }

  private validateQuizPayloadRules(
    payload: Partial<CreateContentDto>,
    currentContent?: Partial<Content>,
  ) {
    const targetType = payload.type ?? currentContent?.type;
    if (targetType !== 'quiz') {
      return;
    }
    const isUpdate = Boolean(currentContent);
    const isConvertingToQuiz =
      isUpdate && currentContent?.type !== 'quiz' && payload.type === 'quiz';
    const hasDateUpdate =
      payload.dueDate !== undefined || payload.dueDateTime !== undefined;

    const mergedPayload = {
      ...currentContent,
      ...payload,
    };

    const requiredFields: Array<{ key: keyof typeof mergedPayload; message: string }> = [
      { key: 'title', message: 'Le titre du quiz est obligatoire.' },
      { key: 'description', message: 'La description du quiz est obligatoire.' },
      { key: 'quizMode', message: 'Le type de quiz est obligatoire.' },
      { key: 'quizDifficulty', message: 'Le niveau de difficulte est obligatoire.' },
      { key: 'quizSourceChapter', message: 'Le chapitre source est obligatoire.' },
    ];

    for (const field of requiredFields) {
      if (!this.hasMeaningfulValue(mergedPayload[field.key])) {
        throw new BadRequestException(field.message);
      }
    }

    const shouldValidateDate =
      !isUpdate || isConvertingToQuiz || hasDateUpdate;
    if (!shouldValidateDate) {
      return;
    }

    if (
      !this.hasMeaningfulValue(mergedPayload.dueDate) &&
      !this.hasMeaningfulValue(mergedPayload.dueDateTime)
    ) {
      throw new BadRequestException(
        'La date du quiz est obligatoire et doit etre strictement superieure a aujourd\'hui.',
      );
    }

    const candidateDates = [mergedPayload.dueDate, mergedPayload.dueDateTime].filter(value =>
      this.hasMeaningfulValue(value),
    );

    for (const candidateDate of candidateDates) {
      if (!this.isStrictlyAfterToday(candidateDate)) {
        throw new BadRequestException(
          'La date du quiz doit etre strictement superieure a aujourd\'hui.',
        );
      }
    }
  }

  private hasMeaningfulValue(value: unknown) {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return true;
  }

  private isStrictlyAfterToday(value: unknown) {
    const parsedDate = new Date(value as string | Date);
    if (Number.isNaN(parsedDate.getTime())) {
      return false;
    }

    const candidateDay = new Date(parsedDate);
    candidateDay.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return candidateDay.getTime() > today.getTime();
  }

  private buildHuggingFaceQuizErrorMessage(status: number, details: string) {
    let apiMessage = '';
    let errorType = '';

    try {
      const parsed = JSON.parse(details || '{}');
      apiMessage = `${parsed?.error || parsed?.message || ''}`.trim();
      errorType = `${parsed?.estimated_time || parsed?.warning || ''}`.trim();
    } catch {
      apiMessage = `${details || ''}`.trim();
    }

    if (status === 401 || status === 403) {
      return 'Hugging Face: cle API invalide ou refusee. Verifiez HUGGINGFACE_API_KEY dans .env.';
    }

    if (status === 429) {
      return 'Hugging Face: quota limite atteint.';
    }

    if (status === 404) {
      return 'Hugging Face: modele indisponible. Verifiez HUGGINGFACE_QUIZ_MODEL.';
    }

    if (apiMessage) {
      return `Hugging Face: ${apiMessage}`;
    }

    if (errorType) {
      return `Hugging Face: ${errorType}`;
    }

    return "La generation du quiz via Hugging Face a echoue.";
  }

  private async buildQuizChapterContext(dto: GenerateQuizDto, chapterScope: string) {
    const chapterRegex = new RegExp(`^\\s*${this.escapeRegex(chapterScope)}\\s*$`, 'i');
    const chapterFilters: Record<string, unknown> = {
      type: 'chapter',
      title: chapterRegex,
    };
    const relatedContentFilters: Record<string, unknown> = {
      chapterId: chapterRegex,
      type: { $in: ['part', 'document', 'video'] },
    };

    if (`${dto.courseId || ''}`.trim()) {
      chapterFilters.courseId = dto.courseId;
      relatedContentFilters.courseId = dto.courseId;
    }

    const [chapterNodes, relatedContents] = await Promise.all([
      this.contentModel.find(chapterFilters).lean().exec(),
      this.contentModel.find(relatedContentFilters).lean().exec(),
    ]);
    const chapterContents = [...chapterNodes, ...relatedContents];
    if (chapterContents.length === 0) {
      throw new NotFoundException(
        `Aucun contenu trouve pour le chapitre "${chapterScope}".`,
      );
    }

    const textBlocks: string[] = [];
    for (const item of chapterContents) {
      const block = [
        item.type ? `Type: ${item.type}` : '',
        item.title ? `Titre: ${item.title}` : '',
        item.description ? `Description: ${item.description}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      if (block) {
        textBlocks.push(block);
      }

      if (
        item.type === 'document' &&
        item.fileUrl &&
        /\.(pdf|docx)$/i.test(item.fileUrl)
      ) {
        try {
          const extractedText = await this.extractTextFromUpload(item.fileUrl);
          if (extractedText) {
            textBlocks.push(extractedText);
          }
        } catch (error) {
          this.logger.warn(
            `Extraction de texte ignoree pour ${item.fileUrl}: ${String(error)}`,
          );
        }
      }
    }

    const combinedText = this.compactWhitespace(textBlocks.join('\n\n'));
    if (!combinedText) {
      throw new BadRequestException(
        `Le chapitre "${chapterScope}" ne contient pas assez de texte pour generer un quiz.`,
      );
    }

    return combinedText.slice(0, 12000);
  }

  private async extractTextFromUpload(fileUrl: string) {
    const relativePath = fileUrl.replace(/^\/+/, '').replace(/\//g, '\\');
    const filePath = join(process.cwd(), relativePath);
    const extension = extname(filePath).toLowerCase();

    if (extension === '.pdf') {
      const buffer = await readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const parsedPdf = await parser.getText();
      const rawText = parsedPdf.text || '';
      await parser.destroy();
      return rawText;
    }

    if (extension === '.docx') {
      return this.extractDocxText(filePath);
    }

    return '';
  }

  private async extractTextFromUploadedChapterFile(file: UploadedChapterFile) {
    const extension = extname(file.originalname || '').toLowerCase();

    try {
      if (extension === '.pdf') {
        const parser = new PDFParse({ data: file.buffer });
        const parsedPdf = await parser.getText();
        const rawText = parsedPdf.text || '';
        await parser.destroy();
        const extractedText = this.compactWhitespace(rawText).slice(0, 12000);

        if (!extractedText) {
          throw new BadRequestException(
            'Le fichier PDF du chapitre est vide ou illisible.',
          );
        }

        return extractedText;
      }

      if (extension === '.docx') {
        const parsedDoc = await mammoth.extractRawText({ buffer: file.buffer });
        const extractedText = this.compactWhitespace(parsedDoc.value || '').slice(0, 12000);

        if (!extractedText) {
          throw new BadRequestException(
            'Le fichier DOCX du chapitre est vide ou illisible.',
          );
        }

        return extractedText;
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `[HUGGINGFACE QUIZ] chapter file parsing failed file=${file.originalname} error=${String(error)}`,
      );
      throw new BadRequestException(
        'Impossible de lire le fichier du chapitre. Utilisez un PDF ou DOCX lisible.',
      );
    }

    throw new BadRequestException(
      'Le chapitre source doit etre au format PDF ou DOCX.',
    );
  }

  private generateLocalQuizQuestions(
    chapterContext: string,
    questionCount: number,
    difficulty: string,
    chapterScope: string,
  ) {
    const candidates = this.buildQuestionCandidates(chapterContext);
    const questions: any[] = [];
    const usedPrompts = new Set<string>();

    for (const candidate of candidates) {
      if (questions.length >= questionCount) {
        break;
      }

      const prompt = this.buildLocalFallbackPrompt(candidate);
      const normalizedPrompt = this.normalizedText(prompt);
      if (!prompt || usedPrompts.has(normalizedPrompt)) {
        continue;
      }

      const distractors = this.buildDistractors(
        candidate.answer,
        candidates.map(item => item.answer),
      );
      if (distractors.length < 2) {
        continue;
      }

      const optionValues = this.shuffleArray([
        candidate.answer,
        ...distractors.slice(0, 3),
      ]).slice(0, 4);
      const correctIndex = optionValues.findIndex(
        option => option.toLowerCase() === candidate.answer.toLowerCase(),
      );

      if (correctIndex < 0) {
        continue;
      }

      questions.push({
        id: `local-question-${questions.length + 1}`,
        prompt,
        type: 'single',
        options: optionValues.map((option, index) => ({
          label: this.optionLabel(index),
          text: option,
        })),
        correctAnswers: [this.optionLabel(correctIndex)],
        explanation: `Question generee localement a partir du chapitre "${chapterScope}" (${difficulty}).`,
      });
      usedPrompts.add(normalizedPrompt);
    }

    if (questions.length > 0) {
      return questions;
    }

    return this.generateSimpleLocalQuizQuestions(
      chapterContext,
      questionCount,
      difficulty,
      chapterScope,
    );
  }

  private generateSimpleLocalQuizQuestions(
    chapterContext: string,
    questionCount: number,
    difficulty: string,
    chapterScope: string,
  ) {
    const sentences = this.compactWhitespace(chapterContext)
      .split(/(?<=[\.\!\?])\s+/)
      .map(sentence => this.cleanCandidatePart(sentence))
      .filter(sentence => sentence.length >= 30)
      .slice(0, Math.max(1, questionCount));

    return sentences.map((sentence, index) => {
      const trimmedSentence = sentence.slice(0, 180);
      const wrongOptions = [
        "Une information qui n'est pas indiquee dans le chapitre",
        'Une definition generale sans lien direct',
        'Un exemple hors sujet',
      ];

      return {
        id: `local-simple-question-${index + 1}`,
        prompt: `Quelle affirmation correspond au chapitre "${chapterScope}" ?`,
        type: 'single',
        options: [trimmedSentence, ...wrongOptions].map((option, optionIndex) => ({
          label: this.optionLabel(optionIndex),
          text: option,
        })),
        correctAnswers: ['A'],
        explanation: `Question generee localement a partir du contenu importe (${difficulty}).`,
      };
    });
  }

  private buildQuestionCandidates(chapterContext: string) {
    const sentences = chapterContext
      .split(/(?<=[\.\!\?])\s+/)
      .map(sentence => this.compactWhitespace(sentence))
      .filter(sentence => sentence.length >= 40 && sentence.length <= 240);

    const uniqueSentences = [...new Set(sentences)];
    const candidates = uniqueSentences
      .map(sentence => {
        return this.extractQuestionCandidate(sentence);
      })
      .filter(
        (
          candidate,
        ): candidate is QuestionCandidate =>
          !!candidate,
      );

    return this.shuffleArray(candidates);
  }

  private extractQuestionCandidate(sentence: string): QuestionCandidate | null {
    const normalizedSentence = this.compactWhitespace(sentence);

    const countPattern = normalizedSentence.match(
      /^(.{3,80}?)\s+(?:contient|comprend|possede|comporte)\s+(\d+\s+\w+(?:\s+\w+){0,2})/i,
    );
    if (countPattern) {
      const subject = this.cleanCandidatePart(countPattern[1]);
      const answer = this.cleanCandidatePart(countPattern[2]);
      if (this.isValidQuizAnswer(answer) && this.isValidQuizSubject(subject)) {
        return {
          sentence: normalizedSentence,
          answer,
          highlightedSentence: normalizedSentence.replace(answer, `<hl> ${answer} <hl>`),
          kind: 'count',
          subject,
        };
      }
    }

    const rolePattern = normalizedSentence.match(
      /^(.{3,80}?)\s+(?:permet de|sert a|est utilise pour|a pour role de)\s+(.{8,120})$/i,
    );
    if (rolePattern) {
      const subject = this.cleanCandidatePart(rolePattern[1]);
      const answer = this.cleanCandidatePart(rolePattern[2]);
      if (this.isValidQuizAnswer(answer) && this.isValidQuizSubject(subject)) {
        return {
          sentence: normalizedSentence,
          answer,
          highlightedSentence: normalizedSentence.replace(answer, `<hl> ${answer} <hl>`),
          kind: 'role',
          subject,
        };
      }
    }

    const definitionPattern = normalizedSentence.match(
      /^(.{3,80}?)\s+(?:est|designe|correspond a|se definit comme|consiste en)\s+(.{8,140})$/i,
    );
    if (definitionPattern) {
      const subject = this.cleanCandidatePart(definitionPattern[1]);
      const answer = this.cleanCandidatePart(definitionPattern[2]);
      if (this.isValidQuizAnswer(answer) && this.isValidQuizSubject(subject)) {
        return {
          sentence: normalizedSentence,
          answer,
          highlightedSentence: normalizedSentence.replace(answer, `<hl> ${answer} <hl>`),
          kind: 'definition',
          subject,
        };
      }
    }

    const genericAnswer = this.extractCleanAnswerSpan(normalizedSentence);
    if (!genericAnswer) {
      return null;
    }

    return {
      sentence: normalizedSentence,
      answer: genericAnswer,
      highlightedSentence: normalizedSentence.replace(genericAnswer, `<hl> ${genericAnswer} <hl>`),
      kind: 'generic',
      subject: '',
    };
  }

  private async generateQuestionsWithHuggingFace(
    candidates: QuestionCandidate[],
    questionCount: number,
    model: string,
    apiKey: string,
    difficulty: string,
    chapterScope: string,
  ) {
    const questions: any[] = [];
    const usedPrompts = new Set<string>();
    let useLocalFallback = false;

    for (const candidate of candidates) {
      if (questions.length >= questionCount) {
        break;
      }

      let prompt = '';

      if (!useLocalFallback) {
        try {
          prompt = await this.generateQuestionPromptWithHuggingFace(
            model,
            apiKey,
            candidate.highlightedSentence,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error || '');
          if (
            message.toLowerCase().includes('modele indisponible') ||
            message.toLowerCase().includes('404')
          ) {
            this.logger.warn(
              `[HUGGINGFACE QUIZ] fallback to local generation because model "${model}" is unavailable.`,
            );
            useLocalFallback = true;
            prompt = this.buildLocalFallbackPrompt(candidate);
          } else {
            throw error;
          }
        }
      } else {
        prompt = this.buildLocalFallbackPrompt(candidate);
      }

      const normalizedPrompt = this.normalizedText(prompt);
      if (!prompt || usedPrompts.has(normalizedPrompt)) {
        continue;
      }

      const distractors = this.buildDistractors(
        candidate.answer,
        candidates.map(item => item.answer),
      );
      if (distractors.length < 2) {
        continue;
      }

      const optionValues = this.shuffleArray([
        candidate.answer,
        ...distractors.slice(0, 3),
      ]).slice(0, 4);
      const correctIndex = optionValues.findIndex(
        option => option.toLowerCase() === candidate.answer.toLowerCase(),
      );

      if (correctIndex < 0) {
        continue;
      }

      questions.push({
        id: `ai-question-${questions.length + 1}`,
        prompt,
        type: 'single',
        options: optionValues.map((option, index) => ({
          label: this.optionLabel(index),
          text: option,
        })),
        correctAnswers: [this.optionLabel(correctIndex)],
        explanation: `Question generee a partir du chapitre "${chapterScope}" (${difficulty}).`,
      });
      usedPrompts.add(normalizedPrompt);
    }

    return questions;
  }

  private async generateStructuredQuizWithHuggingFace(
    chapterContext: string,
    questionCount: number,
    model: string,
    apiKey: string,
    difficulty: string,
    chapterScope: string,
  ) {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2200,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'quiz_generation',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                questions: {
                  type: 'array',
                  minItems: questionCount,
                  maxItems: questionCount,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      prompt: { type: 'string' },
                      options: {
                        type: 'array',
                        minItems: 4,
                        maxItems: 4,
                        items: { type: 'string' },
                      },
                      correctAnswers: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 1,
                        items: { type: 'string' },
                      },
                      explanation: { type: 'string' },
                    },
                    required: ['prompt', 'options', 'correctAnswers', 'explanation'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: [
              'Tu es un assistant pedagogique expert en creation de QCM.',
              'Tu dois produire uniquement des questions precises, claires et completes en francais.',
              'Chaque question doit tester une information reelle du chapitre fourni.',
              'Les 4 propositions doivent etre completes, grammaticalement correctes et plausibles.',
              'La bonne reponse doit etre le texte exact d une option, pas une lettre.',
              'Interdiction de produire des reponses vagues comme "par", "de", "du", "un mot", ou des fragments incomplets.',
              'Interdiction de poser des questions floues ou tronquees.',
              'Retourne uniquement un JSON valide conforme au schema.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Genere ${questionCount} questions QCM en francais pour un niveau ${difficulty}.`,
              `Chapitre source: ${chapterScope}.`,
              'Contraintes:',
              '- Chaque question doit etre auto-suffisante.',
              '- Chaque question doit avoir exactement 4 choix.',
              '- Une seule bonne reponse.',
              '- Les distracteurs doivent etre credibles.',
              '- Les reponses doivent etre completes et precises.',
              '- Les explications doivent etre courtes mais utiles.',
              '',
              'Contenu du chapitre:',
              chapterContext,
            ].join('\n'),
          },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      this.logger.error(
        `[HUGGINGFACE CHAT QUIZ] generation failed status=${response.status} details=${details}`,
      );
      throw new BadRequestException(
        this.buildHuggingFaceQuizErrorMessage(response.status, details),
      );
    }

    const data = (await response.json()) as any;
    const rawContent = `${data?.choices?.[0]?.message?.content || ''}`.trim();

    if (!rawContent) {
      throw new InternalServerErrorException(
        "La reponse Hugging Face est vide pour la generation du quiz.",
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawContent);
    } catch (error) {
      this.logger.error(
        `[HUGGINGFACE CHAT QUIZ] invalid JSON payload content=${rawContent} error=${String(error)}`,
      );
      throw new InternalServerErrorException(
        "La reponse Hugging Face n'est pas un JSON valide.",
      );
    }

    const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];

    return rawQuestions
      .map((rawQuestion: any, index: number) => {
        const prompt = this.repairEncoding(
          this.compactWhitespace(`${rawQuestion?.prompt || ''}`),
        );
        const rawOptions = Array.isArray(rawQuestion?.options) ? rawQuestion.options : [];
        const options = rawOptions
          .map((option: string, optionIndex: number) => ({
            label: this.optionLabel(optionIndex),
            text: this.repairEncoding(
              this.compactWhitespace(`${option || ''}`),
            ),
          }))
          .filter(option => option.text.length >= 5)
          .slice(0, 4);

        const correctValues = Array.isArray(rawQuestion?.correctAnswers)
          ? rawQuestion.correctAnswers.map((value: string) => this.compactWhitespace(`${value || ''}`))
          : [];

        const correctLabels = correctValues
          .map(correctValue => {
            const matchingOption = options.find(
              option => option.text.toLowerCase() === correctValue.toLowerCase(),
            );
            return matchingOption?.label || '';
          })
          .filter(Boolean);

        if (
          !prompt ||
          options.length !== 4 ||
          correctLabels.length !== 1 ||
          options.some(option => !this.isValidQuizAnswer(option.text))
        ) {
          return null;
        }

        return {
          id: `ai-question-${index + 1}`,
          prompt,
          type: 'single',
          options,
          correctAnswers: [correctLabels[0]],
          explanation:
            this.repairEncoding(
              this.compactWhitespace(`${rawQuestion?.explanation || ''}`),
            ) ||
            `Question generee via Hugging Face a partir du chapitre "${chapterScope}".`,
        };
      })
      .filter((question): question is NonNullable<typeof question> => !!question);
  }

  private buildLocalFallbackPrompt(candidate: {
    sentence: string;
    answer: string;
    highlightedSentence: string;
    kind?: string;
    subject?: string;
  }) {
    const subject = this.cleanCandidatePart(candidate.subject || '');

    if (candidate.kind === 'count' && subject) {
      return `Combien ${subject} contient-il ?`;
    }

    if (candidate.kind === 'role' && subject) {
      return `Quel est le role de ${subject} ?`;
    }

    if (candidate.kind === 'definition' && subject) {
      return `Quelle est la definition de ${subject} ?`;
    }

    const blankedSentence = this.compactWhitespace(
      candidate.sentence.replace(candidate.answer, '_____'),
    );
    return `Completez l'enonce suivant de facon precise : ${blankedSentence}`;
  }

  private async generateQuestionPromptWithHuggingFace(
    model: string,
    apiKey: string,
    highlightedSentence: string,
  ) {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: highlightedSentence,
          options: {
            wait_for_model: true,
            use_cache: false,
          },
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      this.logger.error(
        `[HUGGINGFACE QUIZ] generation failed status=${response.status} details=${details}`,
      );
      throw new BadRequestException(
        this.buildHuggingFaceQuizErrorMessage(response.status, details),
      );
    }

    const data = (await response.json()) as any;
    const generatedText = Array.isArray(data)
      ? data.map(item => `${item?.generated_text || ''}`.trim()).find(Boolean)
      : `${data?.generated_text || ''}`.trim();

    return this.compactWhitespace(`${generatedText || ''}`.replace(/^question\s*:\s*/i, ''));
  }

  private buildDistractors(correctAnswer: string, answerPool: string[]) {
    const uniquePool = [
      ...new Set(
        answerPool
          .map(answer => this.compactWhitespace(answer))
          .filter(answer => this.isValidQuizAnswer(answer)),
      ),
    ];

    const distractors = uniquePool.filter(
      answer =>
        answer.toLowerCase() !== correctAnswer.toLowerCase() &&
        !answer.toLowerCase().includes(correctAnswer.toLowerCase()) &&
        !correctAnswer.toLowerCase().includes(answer.toLowerCase()) &&
        Math.abs(answer.length - correctAnswer.length) <= 45,
    );

    return this.shuffleArray(distractors);
  }

  private extractCleanAnswerSpan(sentence: string) {
    const patterns = [
      /\b\d+\s+\w+(?:\s+\w+){0,2}\b/,
      /\b[A-Z][a-zA-Z0-9-]+(?:\s+[A-Z]?[a-zA-Z0-9-]+){1,5}\b/,
      /\b[a-zA-Z0-9-]{4,}(?:\s+[a-zA-Z0-9-]{4,}){1,5}\b/,
    ];

    for (const pattern of patterns) {
      const matches = sentence.match(pattern) || [];
      for (const match of matches) {
        const value = this.cleanCandidatePart(match);
        if (this.isValidQuizAnswer(value)) {
          return value;
        }
      }
    }

    return '';
  }

  private cleanCandidatePart(value: string) {
    return this.compactWhitespace(
      `${value || ''}`
        .replace(/^[\s:;,\-]+/, '')
        .replace(/[\s:;,\-]+$/, '')
        .replace(/[()]/g, ''),
    );
  }

  private isValidQuizSubject(value: string) {
    const cleaned = this.cleanCandidatePart(value);
    return cleaned.length >= 3 && cleaned.length <= 80 && !/^(il|elle|cela|ceci|on)$/i.test(cleaned);
  }

  private isValidQuizAnswer(value: string) {
    const cleaned = this.cleanCandidatePart(value);
    if (cleaned.length < 5 || cleaned.length > 120) {
      return false;
    }

    if (/^(par|de|du|des|la|le|les|un|une|et|ou|en|a|au|aux)$/i.test(cleaned)) {
      return false;
    }

    if (!/[a-zA-Z0-9]/.test(cleaned)) {
      return false;
    }

    if (cleaned.split(/\s+/).length === 1 && !/\d/.test(cleaned)) {
      return false;
    }

    return true;
  }

  private compactWhitespace(value: string) {
    return `${value || ''}`.replace(/\s+/g, ' ').trim();
  }

  private shuffleArray<T>(items: T[]) {
    const clonedItems = [...items];

    for (let index = clonedItems.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [clonedItems[index], clonedItems[swapIndex]] = [
        clonedItems[swapIndex],
        clonedItems[index],
      ];
    }

    return clonedItems;
  }

  private optionLabel(index: number) {
    return String.fromCharCode(65 + Math.max(0, index));
  }
}



