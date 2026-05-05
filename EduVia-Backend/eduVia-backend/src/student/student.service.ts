import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { readdir, readFile, stat } from 'fs/promises';
import { Model, Types } from 'mongoose';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { basename, extname, join } from 'path';
import { ContentService } from '../content/content.service';
import { User } from '../users/user.schema';
import { ForumRequest } from './forum-request.schema';
import {
  FlashcardSession,
  FlashcardSessionDocument,
} from './flashcard-session.schema';
import { PlannerTask } from '../planner/planner-task.schema';

type StudentLevel = 'debutant' | 'intermediaire' | 'avance';

type StudentContent = {
  _id: string;
  type: string;
  title: string;
  description?: string;
  courseId?: string;
  chapterId?: string;
  partId?: string;
  fileUrl?: string;
  fileName?: string;
  source?: string;
  teacherName?: string;
  teacherEmail?: string;
  teacherAvatarDataUrl?: string;
  visibleToAllClasses?: boolean;
  visibleToClasses?: string[];
  dueDate?: string;
  dueDateTime?: string;
  quizDurationMinutes?: number;
  quizMode?: string;
  quizDifficulty?: string;
  quizAttempts?: number;
  quizPassingScore?: number;
  quizQuestionCount?: number;
  quizQuestions?: unknown[];
  isActive?: boolean;
  quizAvailability?: {
    status: 'open' | 'closed';
    reason: 'available' | 'deadline_passed';
    dueDateTime?: string;
    dueDate?: string;
    remainingMinutes?: number;
    remainingSeconds?: number;
    quizDurationMinutes?: number;
  };
  progressStatus?: ProgressStatus;
  isCompleted?: boolean;
  isLocked?: boolean;
  canMarkCompleted?: boolean;
  completionButton?: {
    label: string;
    variant: 'neutral' | 'success';
    disabled: boolean;
  };
};

type ProgressStatus = 'not_started' | 'in_progress' | 'completed' | 'passed';

type RecommendationAnalysis = {
  weakAcquis: any[];
  recommendedContents: any[];
  summary: {
    attemptsAnalyzed: number;
    averageScore: number;
    lastScore: number;
    lastQuizTitle: string;
    lastSubmittedAt: string;
    weakAcquisCount: number;
    recommendationCount: number;
    updatedAt: string;
  };
};

type ChatbotKnowledgeChunk = {
  source: string;
  text: string;
  tokens: string[];
};

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);
  private chatbotKnowledgeCache: Promise<ChatbotKnowledgeChunk[]> | null = null;

  constructor(
    private readonly contentService: ContentService,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ForumRequest.name)
    private readonly forumRequestModel: Model<ForumRequest>,
    @InjectModel(FlashcardSession.name)
    private readonly flashcardSessionModel: Model<FlashcardSessionDocument>,
    @InjectModel(PlannerTask.name)
    private readonly plannerTaskModel: Model<PlannerTask>,
  ) {}

  async getDashboard(
    level?: string,
    className?: string,
    userId?: string,
    email?: string,
  ) {
    const studentLevel = this.normalizeLevel(level);
    const normalizedClassName = await this.resolveStudentClassName(className, userId, email);
    const contents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(contents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(contents);
    let classmatesCount = normalizedClassName
      ? await this.userModel.countDocuments({
          role: 'student',
          className: {
            $regex: this.buildExactClassRegex(normalizedClassName),
            $options: 'i',
          },
        })
      : 0;

    if (normalizedClassName && classmatesCount === 0 && (userId || email)) {
      classmatesCount = 1;
    }
    const visibleContents = contents
      .filter(item =>
        this.isContentInCurrentTeacherCourse(
          item,
          teacherCourseAssignmentMap,
          normalizedClassName,
        ),
      );
    const hierarchyVisibleContents = this.filterVisibleContentHierarchy(
      visibleContents,
      studentLevel,
      normalizedClassName,
      teacherAssignedClassMap,
    );
    const progress = await this.buildStudentProgress(
      hierarchyVisibleContents,
      normalizedClassName,
      userId,
      email,
    );
    const student = await this.findConnectedStudent(userId, email);
    const recommendationAnalysis = await this.buildRecommendationAnalysis(
      hierarchyVisibleContents,
      Array.isArray(student?.learningProgress) ? student.learningProgress : [],
    );
    const quizzes = hierarchyVisibleContents.filter(item => this.isQuiz(item));
    const documents = hierarchyVisibleContents.filter(item => this.isDocument(item));
    const videos = hierarchyVisibleContents.filter(item => this.isVideo(item));
    const courses = this.buildCourseTree(
      hierarchyVisibleContents,
      progress.progressByContentId || {},
    );

    return {
      level: studentLevel,
      stats: {
        totalCourses: courses.length,
        totalDocuments: documents.length,
        totalVideos: videos.length,
        totalQuizzes: quizzes.length,
        totalItems: visibleContents.length,
        classmatesCount,
      },
      progress,
      courses,
      recommendations: recommendationAnalysis.recommendedContents.length > 0
        ? recommendationAnalysis.recommendedContents
        : hierarchyVisibleContents
            .filter(item => this.isDocument(item) || this.isVideo(item) || this.isQuiz(item))
            .slice(0, 8),
      recommendationAnalysis,
      quizzes,
      contents: hierarchyVisibleContents,
    };
  }

  async getQuizzes(
    level?: string,
    className?: string,
    userId?: string,
    email?: string,
  ) {
    const studentLevel = this.normalizeLevel(level);
    const normalizedClassName = await this.resolveStudentClassName(className, userId, email);
    const contents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(contents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(contents);

    const scopedContents = contents.filter(
      item =>
        this.isContentInCurrentTeacherCourse(
          item,
          teacherCourseAssignmentMap,
          normalizedClassName,
        ),
    );
    return this.filterVisibleContentHierarchy(
      scopedContents,
      studentLevel,
      normalizedClassName,
      teacherAssignedClassMap,
    ).filter(
        item =>
        this.isQuiz(item) &&
        Array.isArray(item.quizQuestions) &&
        item.quizQuestions.length > 0,
    );
  }

  async getProgress(
    level?: string,
    className?: string,
    userId?: string,
    email?: string,
  ) {
    const studentLevel = this.normalizeLevel(level);
    const normalizedClassName = await this.resolveStudentClassName(className, userId, email);
    const contents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(contents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(contents);
    const visibleContents = contents
      .filter(item =>
        this.isContentInCurrentTeacherCourse(
          item,
          teacherCourseAssignmentMap,
          normalizedClassName,
        ),
      );
    const hierarchyVisibleContents = this.filterVisibleContentHierarchy(
      visibleContents,
      studentLevel,
      normalizedClassName,
      teacherAssignedClassMap,
    );

    return this.buildStudentProgress(hierarchyVisibleContents, normalizedClassName, userId, email);
  }

  async getWeeklyLeaderboard(
    level?: string,
    className?: string,
    userId?: string,
    email?: string,
  ) {
    const requestedLevel = this.normalizeLevel(level);
    const normalizedClassName = await this.resolveStudentClassName(className, userId, email);
    const connectedStudent = await this.findConnectedStudentProfile(userId, email);
    if (!connectedStudent) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const week = this.currentWeekRange();
    const contents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(contents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(contents);
    const classStudents = normalizedClassName
      ? await this.findLeaderboardClassStudents(normalizedClassName)
      : [];
    const students = this.ensureConnectedStudentInLeaderboard(
      classStudents,
      connectedStudent,
      userId,
      email,
    );
    const studentEmails = students
      .map(student => String(student?.email || '').trim().toLowerCase())
      .filter(Boolean);
    const studentIds = students
      .map(student => String(student?.keycloakId || '').trim())
      .filter(Boolean);
    const [completedTasks, forumRequests] = await Promise.all([
      this.findWeeklyCompletedTasks(studentEmails, week.start, week.end),
      this.findWeeklyForumRequests(studentEmails, studentIds),
    ]);
    const taskCountByEmail = this.countWeeklyTasksByEmail(completedTasks);
    const forumCountByIdentity = this.countWeeklyForumActivity(
      forumRequests,
      week.start,
      week.end,
    );

    const rows = students
      .map(student => {
        const studentLevel = this.normalizeLevel(student?.profileData?.level || requestedLevel);
        const scopedContents = contents
          .filter(item =>
            this.isContentInCurrentTeacherCourse(
              item,
              teacherCourseAssignmentMap,
              normalizedClassName,
            ),
          );
        const visibleContents = this.filterVisibleContentHierarchy(
          scopedContents,
          studentLevel,
          normalizedClassName,
          teacherAssignedClassMap,
        );
        return this.buildLeaderboardRow(
          student,
          visibleContents,
          week.start,
          week.end,
          taskCountByEmail,
          forumCountByIdentity,
          userId,
          email,
        );
      })
      .filter(row => !level || row.levelKey === requestedLevel)
      .sort((left, right) => {
        if (right.points !== left.points) return right.points - left.points;
        if (right.average !== left.average) return right.average - left.average;
        return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' });
      })
      .map((row, index) => ({
        ...row,
        rank: index + 1,
      }));

    const currentStudent = rows.find(row => row.isCurrentStudent) || null;
    const nextTarget = currentStudent && currentStudent.rank > 1
      ? rows[currentStudent.rank - 2]
      : null;

    return {
      className: normalizedClassName,
      week: {
        startsAt: week.start.toISOString(),
        endsAt: week.end.toISOString(),
        label: this.formatWeekRangeLabel(week.start, week.end),
      },
      filters: ['tous', 'debutant', 'intermediaire', 'avance'],
      topStudents: rows.slice(0, 3),
      students: rows,
      currentStudent,
      encouragement: currentStudent && nextTarget
        ? {
            pointsToNextRank: Math.max(1, nextTarget.points - currentStudent.points + 1),
            targetRank: nextTarget.rank,
            message: `Tu es a ${Math.max(1, nextTarget.points - currentStudent.points + 1)} points du Top ${nextTarget.rank}. Termine 1 cours supplementaire pour monter au classement.`,
          }
        : {
            pointsToNextRank: 0,
            targetRank: currentStudent?.rank || 1,
            message: currentStudent?.rank === 1
              ? 'Bravo, tu es en tete cette semaine.'
              : 'Continue tes efforts pour monter au classement.',
          },
    };
  }

  async updateProgress(
    body: {
      contentId: string;
      status?: ProgressStatus;
      score?: number;
      submittedAt?: string;
      questionAttempts?: any[];
    },
    userId?: string,
    email?: string,
  ) {
    const contentId = String(body.contentId || '').trim();
    if (!contentId || !Types.ObjectId.isValid(contentId)) {
      throw new HttpException('contentId invalide.', HttpStatus.BAD_REQUEST);
    }

    const nextStatus = this.normalizeProgressStatus(body.status);
    const student = await this.findConnectedStudentDocument(userId, email);
    if (!student) {
      throw new HttpException('Etudiant introuvable.', HttpStatus.NOT_FOUND);
    }

    const allContents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const content = allContents.find(item => String(item._id || '').trim() === contentId);
    if (!content) {
      throw new HttpException('Contenu introuvable.', HttpStatus.NOT_FOUND);
    }
    const normalizedClassName = this.normalizeClassName(student.className || '');
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(allContents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(allContents);
    const scopedContents = allContents.filter(item =>
      this.isContentInCurrentTeacherCourse(
        item,
        teacherCourseAssignmentMap,
        normalizedClassName,
      ),
    );
    const visibleContentIds = new Set(
      this.filterVisibleContentHierarchy(
        scopedContents,
        this.normalizeLevel(student.profileData?.level),
        normalizedClassName,
        teacherAssignedClassMap,
      ).map(item => String(item._id || '').trim()),
    );

    if (
      !visibleContentIds.has(contentId)
    ) {
      throw new HttpException('Contenu non accessible.', HttpStatus.FORBIDDEN);
    }

    const currentEntries = Array.isArray(student.learningProgress)
      ? [...student.learningProgress]
      : [];
    const currentIndex = currentEntries.findIndex(
      entry => String(entry?.contentId || '').trim() === contentId,
    );
    const updatedEntry = {
      contentId,
      contentType: String(content.type || '').toLowerCase(),
      status: nextStatus,
      score: typeof body.score === 'number' ? body.score : null,
      submittedAt: body.submittedAt ? new Date(body.submittedAt) : new Date(),
      questionAttempts: Array.isArray(body.questionAttempts)
        ? body.questionAttempts
        : this.buildQuestionAttemptsFromProgressPayload(content, body),
      completedAt:
        nextStatus === 'completed' || nextStatus === 'passed' ? new Date() : null,
      updatedAt: new Date(),
    };
    const attemptSnapshot = {
      score: updatedEntry.score,
      status: updatedEntry.status,
      submittedAt: updatedEntry.submittedAt,
      questionAttempts: updatedEntry.questionAttempts,
    };

    if (currentIndex >= 0) {
      const currentAttemptHistory = Array.isArray(currentEntries[currentIndex]?.attemptHistory)
        ? currentEntries[currentIndex].attemptHistory
        : [];
      currentEntries[currentIndex] = {
        ...currentEntries[currentIndex],
        ...updatedEntry,
        attemptHistory: [...currentAttemptHistory, attemptSnapshot].slice(-10),
      };
    } else {
      currentEntries.push({
        ...updatedEntry,
        attemptHistory: [attemptSnapshot],
      });
    }

    student.learningProgress = currentEntries as any;
    await student.save();

    return {
      success: true,
      progress: await this.getProgress(undefined, student.className || undefined, userId, email),
      entry: updatedEntry,
    };
  }

  async updateStudentLevel(
    body: { level?: string; assessmentResult?: Record<string, unknown> },
    userId?: string,
    email?: string,
  ) {
    const student = await this.findConnectedStudentDocument(userId, email);
    if (!student) {
      throw new HttpException('Etudiant introuvable.', HttpStatus.NOT_FOUND);
    }

    const level = this.normalizeLevel(body?.level);
    student.profileData = {
      ...(student.profileData || {}),
      level,
      levelLabel: this.levelDisplayLabel(level),
      levelUpdatedAt: new Date().toISOString(),
      initialAssessmentCompleted: true,
      initialAssessment:
        body?.assessmentResult && typeof body.assessmentResult === 'object'
          ? body.assessmentResult
          : student.profileData?.initialAssessment || null,
    };
    await student.save();

    return {
      success: true,
      level,
      levelLabel: this.levelDisplayLabel(level),
    };
  }

  async getPortfolioCourseSummary(
    body: { courseId?: string; level?: string },
    userId?: string,
    email?: string,
  ) {
    const student = await this.findConnectedStudentProfile(userId, email);
    if (!student) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const normalizedClassName = this.normalizeClassName(student.className || '');
    const requestedLevel = this.normalizeLevel(body?.level || student.profileData?.level);
    const courseKey = this.normalizeContentReference(body?.courseId || '');
    if (!courseKey) {
      throw new HttpException('courseId obligatoire.', HttpStatus.BAD_REQUEST);
    }

    const allContents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(allContents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(allContents);
    const visibleContents = this.filterVisibleContentHierarchy(
      allContents.filter(item =>
        this.isContentInCurrentTeacherCourse(
          item,
          teacherCourseAssignmentMap,
          normalizedClassName,
        ),
      ),
      requestedLevel,
      normalizedClassName,
      teacherAssignedClassMap,
    );
    const courseContents = visibleContents.filter(
      item => this.courseGroupKeyForPortfolio(item) === courseKey,
    );

    if (courseContents.length === 0) {
      throw new HttpException('Cours introuvable dans votre espace.', HttpStatus.NOT_FOUND);
    }

    return this.buildPortfolioCourseSummary(courseContents, requestedLevel);
  }

  async generatePortfolioRemediationQuiz(
    body: { acquis?: string; courseId?: string; chapterId?: string; level?: string },
    userId?: string,
    email?: string,
  ) {
    const student = await this.findConnectedStudentProfile(userId, email);
    if (!student) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const acquis = this.repairEncoding(String(body?.acquis || '')).trim();
    const level = this.normalizeLevel(body?.level || student.profileData?.level);
    const normalizedClassName = this.normalizeClassName(student.className || '');
    const allContents = (await this.contentService.findAll()).map(item =>
      this.toPlainContent(item),
    );
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(allContents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(allContents);
    const visibleContents = this.filterVisibleContentHierarchy(
      allContents.filter(item =>
        this.isContentInCurrentTeacherCourse(
          item,
          teacherCourseAssignmentMap,
          normalizedClassName,
        ),
      ),
      level,
      normalizedClassName,
      teacherAssignedClassMap,
    );
    const remediationContents = this.findPortfolioRemediationContents(
      visibleContents,
      acquis,
      body?.courseId || '',
      body?.chapterId || '',
    );
    const source = await this.extractPortfolioCourseText(remediationContents);

    try {
      const generated = await this.generatePortfolioRemediationQuestionsWithHuggingFace({
        acquis,
        level,
        documentText: source.documentText,
        quizText: source.quizText,
        courseId: remediationContents.find(item => item.courseId)?.courseId || body?.courseId || '',
        chapterId: remediationContents.find(item => item.chapterId)?.chapterId || body?.chapterId || '',
      });

      return this.buildPortfolioRemediationQuizContent(
        generated,
        acquis,
        remediationContents.find(item => item.courseId)?.courseId || body?.courseId || '',
        remediationContents.find(item => item.chapterId)?.chapterId || body?.chapterId || '',
        level,
        'Hugging Face',
      );
    } catch (error) {
      this.logger.warn(
        `[PORTFOLIO REMEDIATION QUIZ] fallback local apres erreur: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.buildPortfolioRemediationQuizContent(
        this.buildLocalPortfolioRemediationQuestionsFromSource(
          acquis,
          [source.documentText, source.quizText, source.metadataText].filter(Boolean).join(' '),
          10,
        ),
        acquis,
        remediationContents.find(item => item.courseId)?.courseId || body?.courseId || '',
        remediationContents.find(item => item.chapterId)?.chapterId || body?.chapterId || '',
        level,
        'generation locale',
      );
    }
  }

  async startFlashcardSession(
    body: { subject: string; difficulty?: string; questionCount?: number },
    userId?: string,
    email?: string,
  ) {
    const student = await this.findConnectedStudentProfile(userId, email);
    if (!student) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const subject = this.compactWhitespace(String(body?.subject || ''));
    if (!subject) {
      throw new HttpException('La matiere est obligatoire.', HttpStatus.BAD_REQUEST);
    }

    const difficulty = this.normalizeFlashcardDifficulty(body?.difficulty);
    const questionCount = Math.max(1, Math.min(10, Number(body?.questionCount) || 10));
    const durationSeconds = this.flashcardDurationSeconds(difficulty);
    const generated = await this.contentService.generateFlashcards({
      subject,
      difficulty,
      questionCount,
    });
    const cards = (Array.isArray((generated as any)?.flashcards)
      ? (generated as any).flashcards
      : [])
      .slice(0, questionCount)
      .map((card: any, index: number) => ({
        id: String(card?.id || `flashcard-${index + 1}`),
        question: this.repairEncoding(String(card?.question || '')).trim(),
        answer: this.repairEncoding(String(card?.answer || '')).trim(),
        subject,
        difficulty,
        userAnswer: '',
        isCorrect: false,
        revealed: false,
      }))
      .filter((card: any) => card.question && card.answer);

    if (cards.length === 0) {
      throw new HttpException(
        'Aucune flashcard disponible pour cette matiere.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await new this.flashcardSessionModel({
      ownerEmail: String(student.email || email || '').trim().toLowerCase(),
      ownerUserId: String(student.keycloakId || userId || '').trim() || null,
      subject,
      difficulty,
      questionCount: cards.length,
      durationSeconds,
      cards,
      status: 'in_progress',
      correctCount: 0,
      reviewedCount: 0,
      score: 0,
      startedAt: new Date(),
      remainingSeconds: durationSeconds,
      source: String((generated as any)?.source || 'local'),
      model: String((generated as any)?.model || ''),
    }).save();

    return this.toFlashcardSessionView(session.toObject(), true);
  }

  async submitFlashcardSession(
    sessionId: string,
    body: {
      answers?: Array<{ cardId?: string; userAnswer?: string; revealed?: boolean }>;
      remainingSeconds?: number;
      timedOut?: boolean;
    },
    userId?: string,
    email?: string,
  ) {
    const session = await this.findOwnedFlashcardSession(sessionId, userId, email);
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const answerMap = new Map(
      answers.map(answer => [
        String(answer?.cardId || '').trim(),
        {
          userAnswer: String(answer?.userAnswer || '').trim(),
          revealed: answer?.revealed === true,
        },
      ]),
    );

    const cards = (Array.isArray(session.cards) ? session.cards : []).map((card: any) => {
      const submitted = answerMap.get(String(card?.id || '').trim());
      const userAnswer = this.compactWhitespace(submitted?.userAnswer || '');
      const revealed = submitted?.revealed === true && !!userAnswer;
      const isCorrect = revealed
        ? this.isFlashcardAnswerCorrect(userAnswer, String(card?.answer || ''))
        : false;

      return {
        ...card,
        userAnswer,
        revealed,
        isCorrect,
      };
    });
    const reviewedCount = cards.filter((card: any) => card.revealed).length;
    const correctCount = cards.filter((card: any) => card.isCorrect).length;
    const totalCount = Math.max(1, cards.length);
    const score = Math.round((correctCount / totalCount) * 100);

    session.cards = cards as any;
    session.reviewedCount = reviewedCount;
    session.correctCount = correctCount;
    session.score = score;
    session.status = body?.timedOut ? 'expired' : 'completed';
    session.completedAt = new Date();
    session.remainingSeconds =
      typeof body?.remainingSeconds === 'number'
        ? Math.max(0, Math.floor(body.remainingSeconds))
        : null;

    await session.save();

    return this.toFlashcardSessionView(session.toObject(), true);
  }

  async getFlashcardSessions(userId?: string, email?: string) {
    const student = await this.findConnectedStudentProfile(userId, email);
    if (!student) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const sessions = await this.flashcardSessionModel
      .find({
        ownerEmail: String(student.email || email || '').trim().toLowerCase(),
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec();

    return {
      sessions: sessions.map(session => this.toFlashcardSessionView(session, false)),
    };
  }

  async askAssistant(body: {
    question: string;
    level?: string;
    className?: string;
    courseId?: string;
    chapterId?: string;
  }, userId?: string, email?: string) {
    const question = (body.question || '').trim();
    if (!question) {
      throw new HttpException('La question est obligatoire.', HttpStatus.BAD_REQUEST);
    }

    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ||
      this.configService.get<string>('OPENAI_KEY');

    const studentLevel = this.normalizeLevel(body.level);
    const normalizedClassName = await this.resolveStudentClassName(body.className, userId, email);
    const contents = (await this.contentService.findAll()).map(item => this.toPlainContent(item));
    const teacherAssignedClassMap = await this.buildTeacherAssignedClassMap(contents);
    const teacherCourseAssignmentMap =
      await this.buildTeacherCourseAssignmentMap(contents);
    const visibleContents = contents
      .filter(item =>
        this.isContentInCurrentTeacherCourse(
          item,
          teacherCourseAssignmentMap,
          normalizedClassName,
        ),
      );
    const hierarchyVisibleContents = this.filterVisibleContentHierarchy(
      visibleContents,
      studentLevel,
      normalizedClassName,
      teacherAssignedClassMap,
    );
    const relevantContents = hierarchyVisibleContents
      .filter(item => !body.courseId || item.courseId === body.courseId)
      .filter(item => !body.chapterId || item.chapterId === body.chapterId)
      .slice(0, 20);
    const chatbotTrainContext = await this.findChatbotTrainContext(question);

    const context = relevantContents
      .map(item => {
        const parts = [
          `type=${item.type}`,
          item.courseId ? `cours=${item.courseId}` : '',
          item.chapterId ? `chapitre=${item.chapterId}` : '',
          item.title ? `titre=${item.title}` : '',
          item.description ? `description=${item.description}` : '',
        ].filter(Boolean);

        return `- ${parts.join(' | ')}`;
      })
      .join('\n');

    const model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4.1-mini';
    const systemPrompt = [
      "Tu es un assistant pedagogique d'EduVia.",
      'Tu reponds toujours en francais simple, clair et utile.',
      "Tu peux aider sur toute matiere: informatique, mathematiques, reseaux, bases de donnees, algorithmique, exercices, definitions et methodologie.",
      "Quand un contexte du dossier chatbot train est fourni, priorise ce contexte et n'invente pas de detail absent.",
      "Quand l'etudiant pose une question, donne d'abord une reponse directe, puis une breve explication, puis un petit exemple si c'est pertinent.",
      "Si la question est un exercice, guide l'etudiant sans donner une reponse inutilement vague.",
      `Niveau de l'etudiant: ${studentLevel}.`,
      chatbotTrainContext ? `Contexte du dossier chatbot train:\n${chatbotTrainContext}` : '',
      context ? `Contexte visible dans la plateforme:\n${context}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!apiKey) {
      if (chatbotTrainContext) {
        return {
          answer: this.buildChatbotTrainAnswer(question, chatbotTrainContext),
        };
      }

      return {
        answer: this.buildLocalAssistantAnswer(
          question,
          relevantContents,
          studentLevel,
          chatbotTrainContext,
        ),
      };
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/responses',
        {
          model,
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: systemPrompt }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: question }],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      );

      const answer =
        response.data?.output_text ||
        response.data?.output?.[0]?.content?.find((item: any) => item?.type === 'output_text')
          ?.text ||
        "Je n'ai pas pu generer de reponse pour le moment.";

      return { answer };
    } catch (error: any) {
      if (chatbotTrainContext) {
        return {
          answer: this.buildChatbotTrainAnswer(question, chatbotTrainContext),
        };
      }

      return {
        answer: this.buildLocalAssistantAnswer(
          question,
          relevantContents,
          studentLevel,
          chatbotTrainContext,
        ),
      };
    }
  }

  private buildChatbotTrainAnswer(question: string, chatbotTrainContext: string) {
    const passages = chatbotTrainContext
      .split(/\n\n+/)
      .map(block => block.trim())
      .filter(Boolean)
      .slice(0, 3);
    const cleanedPassages = passages.map(block =>
      block
        .replace(/^Source:\s*([^\n]+)\n/i, 'Source: $1. ')
        .replace(/\s+/g, ' ')
        .trim(),
    );

    return [
      "J'ai trouve dans le dossier chatbot train des passages lies a votre question.",
      ...cleanedPassages,
      "Reponse courte: utilisez ces elements comme base du cours, puis precisez la notion si vous voulez une explication plus ciblee ou un exercice.",
    ].join(' ');
  }

  private async findChatbotTrainContext(question: string) {
    const normalizedQuestion = this.normalizeContentReference(question);
    if (
      normalizedQuestion === 'bonjour' ||
      normalizedQuestion === 'salut' ||
      normalizedQuestion === 'hello'
    ) {
      return '';
    }

    const queryTokens = this.tokenizeRecommendationText(question);
    if (queryTokens.length === 0) {
      return '';
    }

    const chunks = await this.loadChatbotTrainKnowledge().catch(error => {
      this.logger.warn(
        `[CHATBOT TRAIN] contexte indisponible: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [] as ChatbotKnowledgeChunk[];
    });
    if (chunks.length === 0) {
      return '';
    }

    return chunks
      .map(chunk => ({
        chunk,
        score: queryTokens.reduce(
          (total, token) => total + (chunk.tokens.includes(token) ? 1 : 0),
          0,
        ),
      }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || right.chunk.text.length - left.chunk.text.length)
      .slice(0, 4)
      .map(item => `Source: ${item.chunk.source}\n${item.chunk.text}`)
      .join('\n\n');
  }

  private loadChatbotTrainKnowledge() {
    if (!this.chatbotKnowledgeCache) {
      this.chatbotKnowledgeCache = this.buildChatbotTrainKnowledge();
    }

    return this.chatbotKnowledgeCache;
  }

  private async buildChatbotTrainKnowledge(): Promise<ChatbotKnowledgeChunk[]> {
    const dataDir = join(process.cwd(), 'chatbot train', 'data');
    const files = await this.listKnowledgeFiles(dataDir);
    const chunks: ChatbotKnowledgeChunk[] = [];

    for (const filePath of files.slice(0, 45)) {
      try {
        const rawText = await this.extractChatbotTrainingText(filePath);
        const source = basename(filePath);
        this.splitKnowledgeText(rawText, source).forEach(chunk => chunks.push(chunk));

        if (chunks.length >= 180) {
          break;
        }
      } catch (error) {
        this.logger.warn(
          `[CHATBOT TRAIN] fichier ignore ${basename(filePath)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return chunks;
  }

  private async listKnowledgeFiles(rootDir: string): Promise<string[]> {
    const entries = await readdir(rootDir);
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(rootDir, entry);
      const entryStat = await stat(fullPath);

      if (entryStat.isDirectory()) {
        files.push(...(await this.listKnowledgeFiles(fullPath)));
        continue;
      }

      if (/\.(pdf|docx)$/i.test(entry)) {
        files.push(fullPath);
      }
    }

    return files.sort((left, right) => basename(left).localeCompare(basename(right), 'fr'));
  }

  private async extractChatbotTrainingText(filePath: string) {
    const extension = extname(filePath).toLowerCase();

    if (extension === '.pdf') {
      const buffer = await readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const parsedPdf = await parser.getText();
      await parser.destroy();
      return this.compactWhitespace(parsedPdf.text || '').slice(0, 16000);
    }

    if (extension === '.docx') {
      const parsedDoc = await mammoth.extractRawText({ path: filePath });
      return this.compactWhitespace(parsedDoc.value || '').slice(0, 16000);
    }

    return '';
  }

  private splitKnowledgeText(rawText: string, source: string): ChatbotKnowledgeChunk[] {
    const text = this.compactWhitespace(rawText);
    if (text.length < 80) {
      return [];
    }

    const chunks: ChatbotKnowledgeChunk[] = [];
    const chunkSize = 900;
    const overlap = 160;

    for (let index = 0; index < text.length; index += chunkSize - overlap) {
      const chunkText = text.slice(index, index + chunkSize).trim();
      if (chunkText.length < 80) {
        continue;
      }

      chunks.push({
        source,
        text: chunkText,
        tokens: this.tokenizeRecommendationText(`${source} ${chunkText}`),
      });
    }

    return chunks;
  }

  private buildQuestionAttemptsFromProgressPayload(
    content: StudentContent,
    body: { score?: number; questionAttempts?: any[] },
  ) {
    if (Array.isArray(body.questionAttempts)) {
      return body.questionAttempts;
    }

    if (!this.isQuiz(content) || !Array.isArray(content.quizQuestions)) {
      return [];
    }

    const score = typeof body.score === 'number' ? Math.max(0, Math.min(100, body.score)) : 0;
    const totalQuestions = content.quizQuestions.length;
    const correctCount = Math.round((score / 100) * totalQuestions);

    return content.quizQuestions.map((question: any, index) => ({
      questionId: String(question?.id || `question-${index + 1}`),
      prompt: this.repairEncoding(String(question?.prompt || '')),
      explanation: this.repairEncoding(String(question?.explanation || '')),
      courseId: content.courseId || '',
      chapterId: content.chapterId || '',
      isCorrect: index < correctCount,
    }));
  }

  private async buildRecommendationAnalysis(
    contents: StudentContent[],
    progressEntries: any[],
  ): Promise<RecommendationAnalysis> {
    const attempts = this.buildRecommendationAttempts(contents, progressEntries);
    const weakAcquis = this.buildWeakAcquis(attempts);
    const recommendedContents = weakAcquis.length
      ? this.buildRecommendedContents(attempts, weakAcquis, contents, 8)
      : [];
    const aiRecommendedQuiz = weakAcquis.length
      ? await this.generateGoogleAiRecommendedQuiz(weakAcquis, contents)
      : null;
    const targetedContents = aiRecommendedQuiz
      ? [aiRecommendedQuiz, ...recommendedContents].slice(0, 8)
      : recommendedContents;
    const averageScore = attempts.length
      ? Math.round(
          attempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) /
            attempts.length,
        )
      : 0;
    const lastAttempt = attempts[0];

    return {
      weakAcquis,
      recommendedContents: targetedContents,
      summary: {
        attemptsAnalyzed: attempts.length,
        averageScore,
        lastScore: Math.round(Number(lastAttempt?.score || 0)),
        lastQuizTitle: String(lastAttempt?.quizTitle || ''),
        lastSubmittedAt: String(lastAttempt?.submittedAt || ''),
        weakAcquisCount: weakAcquis.length,
        recommendationCount: targetedContents.length,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  private async generateGoogleAiRecommendedQuiz(
    weakAcquis: any[],
    contents: StudentContent[],
  ): Promise<any | null> {
    const apiKey =
      this.configService.get<string>('GOOGLE_AI_STUDENT_API_KEY') ||
      this.configService.get<string>('GEMINI_API_KEY') ||
      this.configService.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      return this.buildLocalRecommendedQuiz(weakAcquis);
    }

    const focusAreas = weakAcquis.slice(0, 3);
    const relatedContents = contents
      .filter(content => this.isDocument(content) || this.isVideo(content) || this.isQuiz(content))
      .filter(content =>
        focusAreas.some(area =>
          this.normalizeContentReference(content.courseId) ===
            this.normalizeContentReference(area.courseId) ||
          this.normalizeContentReference(content.chapterId) ===
            this.normalizeContentReference(area.chapterId),
        ),
      )
      .slice(0, 8);
    const context = [
      'Acquis faibles:',
      ...focusAreas.map(area =>
        `- ${area.label}: ${area.reason} Mots cles: ${(area.keywords || []).join(', ')}`,
      ),
      '',
      'Contenus visibles:',
      ...relatedContents.map(content =>
        `- ${content.type} | ${content.title} | cours=${content.courseId || ''} | chapitre=${content.chapterId || ''} | description=${content.description || ''}`,
      ),
    ].join('\n');

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const modelName =
        this.configService.get<string>('GOOGLE_AI_STUDENT_MODEL') ||
        'gemini-1.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName });
      const response = await model.generateContent([
        [
          'Genere un quiz QCM de remediation en francais pour EduVia.',
          'Retourne uniquement un JSON valide, sans markdown.',
          'Schema exact: {"questions":[{"prompt":"...","options":["...","...","...","..."],"correctAnswer":"...","explanation":"..."}]}',
          'Contraintes: 4 questions, exactement 4 options par question, une seule bonne reponse, explication courte.',
          'Les questions doivent cibler les acquis faibles fournis.',
          '',
          context,
        ].join('\n'),
      ]);
      const text = response.response.text().trim();
      const parsed = this.parseGoogleAiQuizJson(text);
      const questions = this.normalizeGoogleAiQuizQuestions(parsed?.questions || []);

      if (questions.length > 0) {
        return this.buildAiRecommendedQuizContent(questions, weakAcquis, 'Google AI Student API');
      }
    } catch (error) {
      this.logger.warn(
        `[GOOGLE AI RECOMMENDATION QUIZ] fallback local apres erreur: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.buildLocalRecommendedQuiz(weakAcquis);
  }

  private parseGoogleAiQuizJson(text: string) {
    const cleaned = String(text || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonText =
      firstBrace >= 0 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;

    return JSON.parse(jsonText);
  }

  private normalizeGoogleAiQuizQuestions(rawQuestions: any[]) {
    return rawQuestions
      .map((question, index) => {
        const options = Array.isArray(question?.options)
          ? question.options
              .map((option: unknown) => this.repairEncoding(String(option || '')).trim())
              .filter(Boolean)
              .slice(0, 4)
          : [];
        const correctAnswer = this.repairEncoding(String(question?.correctAnswer || '')).trim();
        const correctIndex = options.findIndex(
          option => option.toLowerCase() === correctAnswer.toLowerCase(),
        );

        if (!question?.prompt || options.length !== 4 || correctIndex < 0) {
          return null;
        }

        return {
          id: `google-ai-recommendation-${index + 1}`,
          prompt: this.repairEncoding(String(question.prompt || '')).trim(),
          type: 'single',
          options: options.map((option, optionIndex) => ({
            label: this.optionLabel(optionIndex),
            text: option,
          })),
          correctAnswers: [this.optionLabel(correctIndex)],
          explanation:
            this.repairEncoding(String(question?.explanation || '')).trim() ||
            'Question generee pour renforcer vos acquis faibles.',
        };
      })
      .filter(Boolean);
  }

  private buildLocalRecommendedQuiz(weakAcquis: any[]) {
    const areas = weakAcquis.slice(0, 4);
    if (areas.length === 0) {
      return null;
    }

    const questions = areas.map((area, index) => {
      const keywords = Array.isArray(area.keywords) ? area.keywords : [];
      const correct = String(area.label || keywords[0] || 'notion a renforcer');
      const distractors = [
        keywords[1] || 'une notion deja maitrisee',
        keywords[2] || 'un chapitre sans lien',
        'une reponse incomplete',
      ];

      return {
        id: `local-ai-recommendation-${index + 1}`,
        prompt: `Quelle notion devez-vous revoir en priorite selon vos erreurs recentes ?`,
        type: 'single',
        options: [correct, ...distractors].slice(0, 4).map((option, optionIndex) => ({
          label: this.optionLabel(optionIndex),
          text: option,
        })),
        correctAnswers: ['A'],
        explanation: area.reason || 'Cette question cible une notion fragile detectee dans vos derniers quiz.',
      };
    });

    return this.buildAiRecommendedQuizContent(questions, weakAcquis, 'generation locale');
  }

  private buildAiRecommendedQuizContent(
    questions: any[],
    weakAcquis: any[],
    providerLabel: string,
  ) {
    const focusAreas = weakAcquis.slice(0, 3);
    const focusKeywords = Array.from(
      new Set(
        focusAreas.flatMap(area => (Array.isArray(area.keywords) ? area.keywords : [])),
      ),
    ).slice(0, 6);
    const firstArea = focusAreas[0] || {};

    return {
      _id: `google-ai-recommended-quiz-${Date.now()}`,
      type: 'quiz',
      title: `Quiz sur ${firstArea.label || 'vos acquis faibles'} : Notions fondamentales`,
      description: 'Quiz IA recommande pour travailler vos acquis faibles.',
      courseId: firstArea.courseId || '',
      chapterId: firstArea.chapterId || '',
      quizMode: 'ai-recommendation',
      quizDifficulty: 'Debutant',
      quizDurationMinutes: 10,
      quizAttempts: 5,
      quizPassingScore: 70,
      quizQuestionCount: questions.length,
      quizQuestions: questions,
      isActive: true,
      recommendationScore: 999,
      focusLabels: focusAreas.map(area => area.label).filter(Boolean),
      focusKeywords,
      recommendationReason: `Quiz IA recommande pour travailler ${focusKeywords.slice(0, 4).join(', ') || 'vos acquis faibles'}. Genere par ${providerLabel} a partir de vos acquis faibles.`,
    };
  }

  private buildRecommendationAttempts(contents: StudentContent[], progressEntries: any[]) {
    const contentById = new Map(
      contents.map(content => [String(content._id || '').trim(), content]),
    );
    const attempts: any[] = [];

    progressEntries.forEach(entry => {
      const contentId = String(entry?.contentId || '').trim();
      const content = contentById.get(contentId);
      if (!content || !this.isQuiz(content)) {
        return;
      }

      const history = Array.isArray(entry?.attemptHistory) && entry.attemptHistory.length > 0
        ? entry.attemptHistory
        : [entry];

      history.forEach((attempt: any) => {
        const questionAttempts = Array.isArray(attempt?.questionAttempts)
          ? attempt.questionAttempts
          : Array.isArray(entry?.questionAttempts)
            ? entry.questionAttempts
            : [];
        const score = Number(attempt?.score ?? entry?.score ?? 0);

        if (questionAttempts.length === 0 && score >= 100) {
          return;
        }

        attempts.push({
          quizId: contentId,
          quizTitle: content.title || 'Quiz',
          score,
          courseId: content.courseId || '',
          chapterId: content.chapterId || '',
          submittedAt: this.serializeDate(attempt?.submittedAt || entry?.submittedAt || entry?.updatedAt),
          questionAttempts: questionAttempts.length
            ? questionAttempts
            : this.buildQuestionAttemptsFromProgressPayload(content, { score }),
        });
      });
    });

    return attempts.sort((left, right) =>
      String(right.submittedAt || '').localeCompare(String(left.submittedAt || '')),
    );
  }

  private buildWeakAcquis(attempts: any[]) {
    const areas = new Map<string, any>();

    attempts.forEach(attempt => {
      (Array.isArray(attempt.questionAttempts) ? attempt.questionAttempts : []).forEach(
        (question: any) => {
          const courseId = String(question?.courseId || attempt.courseId || '').trim();
          const chapterId = String(question?.chapterId || attempt.chapterId || '').trim();
          const keywords = this.tokenizeRecommendationText(
            [
              question?.prompt,
              question?.explanation,
              question?.selectedAnswerText,
              chapterId,
              courseId,
            ]
              .filter(Boolean)
              .join(' '),
          );
          const keywordKey = keywords.slice(0, 2).join('-') || 'notion';
          const areaKey =
            [this.normalizeContentReference(chapterId), this.normalizeContentReference(courseId), keywordKey]
              .filter(Boolean)
              .join('||') ||
            `${attempt.quizId || 'quiz'}||${question?.questionId || keywordKey}`;

          if (!areas.has(areaKey)) {
            areas.set(areaKey, {
              key: areaKey,
              label: this.buildWeakAreaLabel(keywords, chapterId, courseId),
              courseId: courseId || null,
              chapterId: chapterId || null,
              keywords: [],
              incorrectQuestions: 0,
              totalQuestions: 0,
            });
          }

          const area = areas.get(areaKey);
          area.totalQuestions += 1;
          if (question?.isCorrect !== true) {
            area.incorrectQuestions += 1;
          }

          keywords.slice(0, 8).forEach(keyword => {
            if (!area.keywords.includes(keyword)) {
              area.keywords.push(keyword);
            }
          });
        },
      );
    });

    return Array.from(areas.values())
      .filter(area => area.incorrectQuestions > 0)
      .map(area => {
        const severity = Math.round(
          (area.incorrectQuestions / Math.max(1, area.totalQuestions)) * 100,
        );

        return {
          key: area.key,
          label: area.label,
          severity,
          severityLabel: severity >= 80 ? 'Priorite haute' : severity >= 50 ? 'A renforcer' : 'A surveiller',
          incorrectQuestions: area.incorrectQuestions,
          totalQuestions: area.totalQuestions,
          successRate: Math.max(0, 100 - severity),
          keywords: area.keywords.slice(0, 10),
          courseId: area.courseId,
          chapterId: area.chapterId,
          reason: this.buildWeakAreaReason(area.label, area.chapterId, area.courseId),
        };
      })
      .sort((left, right) =>
        right.severity - left.severity ||
        right.incorrectQuestions - left.incorrectQuestions,
      )
      .slice(0, 6);
  }

  private buildRecommendedContents(
    attempts: any[],
    weakAcquis: any[],
    contents: StudentContent[],
    maxRecommendations: number,
  ) {
    const attemptedQuizIds = new Set(
      attempts.map(attempt => String(attempt.quizId || '').trim()).filter(Boolean),
    );
    const ranked: any[] = [];

    contents
      .filter(content => this.isDocument(content) || this.isVideo(content) || this.isQuiz(content))
      .filter(content => !this.isQuiz(content) || (Array.isArray(content.quizQuestions) && content.quizQuestions.length > 0))
      .forEach(content => {
        const contentTokens = new Set(
          this.tokenizeRecommendationText(
            [
              content.title,
              content.description,
              content.courseId,
              content.chapterId,
              content.partId,
              content.fileName,
              content.source,
            ]
              .filter(Boolean)
              .join(' '),
          ),
        );
        let bestArea: any = null;
        let bestScore = 0;

        weakAcquis.forEach(area => {
          let score = Math.round(Number(area.severity || 0) / 25);

          if (
            this.normalizeContentReference(content.courseId) &&
            this.normalizeContentReference(content.courseId) ===
              this.normalizeContentReference(area.courseId)
          ) {
            score += 10;
          }
          if (
            this.normalizeContentReference(content.chapterId) &&
            this.normalizeContentReference(content.chapterId) ===
              this.normalizeContentReference(area.chapterId)
          ) {
            score += 14;
          }

          const overlapCount = (Array.isArray(area.keywords) ? area.keywords : []).filter(
            (keyword: string) => contentTokens.has(keyword),
          ).length;
          score += overlapCount * 4;
          score += this.isQuiz(content) ? 5 : this.isDocument(content) ? 3 : 2;

          if (score > bestScore) {
            bestScore = score;
            bestArea = area;
          }
        });

        if (!bestArea || bestScore < 8) {
          return;
        }

        const isAttemptedQuiz = this.isQuiz(content) && attemptedQuizIds.has(String(content._id || '').trim());
        ranked.push({
          ...content,
          recommendationScore: bestScore,
          isAttemptedQuiz,
          focusLabels: bestArea.label ? [bestArea.label] : [],
          focusKeywords: Array.isArray(bestArea.keywords) ? bestArea.keywords.slice(0, 5) : [],
          recommendationReason: this.buildContentRecommendationReason(
            content,
            bestArea.label || 'les notions fragiles',
            isAttemptedQuiz,
          ),
        });
      });

    ranked.sort((left, right) =>
      Number(left.isAttemptedQuiz) - Number(right.isAttemptedQuiz) ||
      Number(right.recommendationScore || 0) - Number(left.recommendationScore || 0),
    );

    const selected = ranked.filter(item => !item.isAttemptedQuiz).slice(0, maxRecommendations);
    if (!selected.some(item => this.isQuiz(item))) {
      const fallbackQuiz = ranked.find(item => this.isQuiz(item));
      if (fallbackQuiz) {
        selected.unshift(fallbackQuiz);
      }
    }

    const seen = new Set<string>();
    return selected
      .filter(item => {
        const id = String(item._id || '').trim();
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      })
      .slice(0, maxRecommendations);
  }

  private tokenizeRecommendationText(value: string) {
    const stopWords = new Set([
      'ainsi', 'alors', 'avec', 'avoir', 'bonne', 'cela', 'chapitre', 'comment',
      'correcte', 'cours', 'dans', 'des', 'donc', 'elle', 'etre', 'faire',
      'fois', 'leur', 'mais', 'meme', 'nous', 'pour', 'plus', 'partie',
      'quel', 'quelle', 'question', 'quiz', 'reponse', 'sans', 'sont', 'sous',
      'tout', 'tres', 'une', 'votre', 'vous',
    ]);

    const normalized = this.normalizeContentReference(value);
    const tokens = normalized
      .split(/[^a-z0-9]+/i)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !stopWords.has(token));

    return Array.from(new Set(tokens));
  }

  private buildWeakAreaLabel(keywords: string[], chapterId?: string, courseId?: string) {
    const keywordLabel = keywords
      .slice(0, 3)
      .map(keyword => keyword.charAt(0).toUpperCase() + keyword.slice(1))
      .join(', ');

    return keywordLabel || chapterId || courseId || 'Notion a renforcer';
  }

  private buildWeakAreaReason(label: string, chapterId?: string, courseId?: string) {
    const lowered = String(label || 'cette notion').toLowerCase();
    if (chapterId && courseId) {
      return `Des erreurs reviennent sur ${lowered} dans ${chapterId} du cours ${courseId}.`;
    }
    if (chapterId) {
      return `Des erreurs reviennent sur ${lowered} dans ${chapterId}.`;
    }
    if (courseId) {
      return `Des erreurs reviennent sur ${lowered} dans le cours ${courseId}.`;
    }

    return `Des erreurs reviennent sur ${lowered}.`;
  }

  private buildContentRecommendationReason(
    content: StudentContent,
    weakAreaLabel: string,
    isRetryQuiz: boolean,
  ) {
    const area = String(weakAreaLabel || 'les notions fragiles').toLowerCase();
    const location = content.chapterId
      ? ` dans ${content.chapterId}`
      : content.courseId
        ? ` dans le cours ${content.courseId}`
        : '';

    if (this.isQuiz(content)) {
      return `${isRetryQuiz ? 'Quiz conseille a refaire' : 'Quiz conseille'} pour verifier ${area}${location}.`;
    }
    if (this.isVideo(content)) {
      return `Video conseillee pour revoir ${area}${location}.`;
    }

    return `Document conseille pour renforcer ${area}${location}.`;
  }

  private optionLabel(index: number) {
    return String.fromCharCode(65 + Math.max(0, index));
  }

  async getForumRequests(
    search?: string,
    userId?: string,
    email?: string,
    username?: string,
  ) {
    const connectedStudent = await this.findConnectedStudentProfile(userId, email);
    const connectedUserId = String(
      connectedStudent?.keycloakId || userId || '',
    ).trim();
    const connectedEmail = String(
      connectedStudent?.email || email || '',
    ).trim().toLowerCase();
    const connectedUsername = String(username || '').trim().toLowerCase();
    const searchTerm = (search || '').trim().toLowerCase();

    const requests = await this.forumRequestModel
      .find({})
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const studentAvatarMap = await this.buildForumStudentAvatarMap(requests);

    const mappedRequests = requests
      .map(request =>
        this.toForumRequestView(
          request,
          connectedUserId,
          connectedEmail,
          connectedUsername,
          studentAvatarMap,
        ),
      )
      .filter(request => {
        if (!searchTerm) {
          return true;
        }

        return (
          request.author.toLowerCase().includes(searchTerm) ||
          request.level.toLowerCase().includes(searchTerm) ||
          request.title.toLowerCase().includes(searchTerm) ||
          request.message.toLowerCase().includes(searchTerm)
        );
      });

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const repliesToday = requests.reduce((total, request) => {
      const authorId = String(request.authorUserId || '').trim();
      const todaysReplies = Array.isArray(request.messages)
        ? request.messages.filter(message => {
            if (String(message.senderUserId || '').trim() === authorId) {
              return false;
            }

            const createdAt = new Date(message.createdAt as unknown as string).getTime();
            if (Number.isNaN(createdAt)) {
              return false;
            }

            return createdAt >= dayStart && createdAt < dayEnd;
          }).length
        : 0;

      return total + todaysReplies;
    }, 0);

    return {
      stats: {
        openQuestions: mappedRequests.length,
        repliesToday,
        resolutionRate: 0,
      },
      requests: mappedRequests,
    };
  }

  async createForumRequest(
    body: { subject: string; message: string },
    userId?: string,
    email?: string,
    username?: string,
  ) {
    const subject = (body?.subject || '').trim();
    const message = (body?.message || '').trim();

    if (!subject) {
      throw new HttpException('Le sujet est obligatoire.', HttpStatus.BAD_REQUEST);
    }

    if (!message) {
      throw new HttpException('Le message est obligatoire.', HttpStatus.BAD_REQUEST);
    }

    const connectedStudent = await this.findConnectedStudentProfile(userId, email);
    const normalizedUserId = String(connectedStudent?.keycloakId || userId || '').trim();
    if (!normalizedUserId) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }
    const normalizedEmail = String(connectedStudent?.email || email || '')
      .trim()
      .toLowerCase();
    const normalizedUsername = String(username || '').trim();

    const created = await this.forumRequestModel.create({
      authorUserId: normalizedUserId,
      authorEmail: normalizedEmail || `${normalizedUserId}@eduvia.local`,
      authorName: this.buildUserDisplayName(connectedStudent, normalizedUsername),
      authorClassName: this.formatStudentLevel(connectedStudent?.className || ''),
      subject,
      message,
      status: 'En attente',
      messages: [],
    });

    return {
      request: this.toForumRequestView(
        created.toObject(),
        normalizedUserId,
        normalizedEmail,
        normalizedUsername.toLowerCase(),
        this.buildSingleStudentAvatarMap(
          normalizedUserId,
          String(connectedStudent?.profileData?.avatarDataUrl || '').trim(),
        ),
      ),
    };
  }

  async deleteForumRequest(
    requestId: string,
    userId?: string,
    email?: string,
    username?: string,
  ) {
    const request = await this.findForumRequestById(requestId);

    await this.forumRequestModel.deleteOne({ _id: request._id }).exec();

    return { success: true };
  }

  async getForumChat(
    requestId: string,
    userId?: string,
    email?: string,
    username?: string,
  ) {
    const request = await this.findForumRequestById(requestId);
    const connectedStudent = await this.findConnectedStudentProfile(userId, email);
    const connectedUserId = String(
      connectedStudent?.keycloakId || userId || '',
    ).trim();
    const connectedEmail = String(
      connectedStudent?.email || email || '',
    ).trim().toLowerCase();
    const connectedUsername = String(username || '').trim().toLowerCase();
    const studentAvatarMap = await this.buildForumStudentAvatarMap([request.toObject()]);

    return {
      request: this.toForumRequestView(
        request.toObject(),
        connectedUserId,
        connectedEmail,
        connectedUsername,
        studentAvatarMap,
      ),
      messages: this.toForumChatMessages(request.toObject(), connectedUserId, studentAvatarMap),
    };
  }

  async sendForumChatMessage(
    requestId: string,
    body: {
      message: string;
      attachments?: Array<{
        kind: 'document' | 'video';
        name: string;
        mimeType?: string;
        dataUrl?: string;
      }>;
      transcript?: string;
    },
    userId?: string,
    email?: string,
    username?: string,
  ) {
    const text = (body?.message || '').trim();
    const attachments = this.normalizeForumAttachments(body?.attachments);
    const transcript = String(body?.transcript || '').trim();
    if (!text && attachments.length === 0) {
      throw new HttpException('Le message est obligatoire.', HttpStatus.BAD_REQUEST);
    }

    const request = await this.findForumRequestById(requestId);
    const connectedStudent = await this.findConnectedStudentProfile(userId, email);
    const normalizedUserId = String(connectedStudent?.keycloakId || userId || '').trim();
    if (!normalizedUserId) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }
    const normalizedEmail = String(connectedStudent?.email || email || '')
      .trim()
      .toLowerCase();
    const normalizedUsername = String(username || '').trim();

    const senderUserId = normalizedUserId;
    const senderEmail = normalizedEmail;
    const senderName = this.buildUserDisplayName(connectedStudent, normalizedUsername);
    const senderClassName = this.formatStudentLevel(connectedStudent?.className || '');

    const nextMessages = [
      ...(Array.isArray(request.messages) ? request.messages : []),
      {
        senderUserId,
        senderName,
        senderClassName,
        text: text || transcript || 'Reponse envoyee.',
        attachments,
        transcript,
        createdAt: new Date(),
      },
    ];

    const hasReplyFromAnotherStudent = nextMessages.some(
      message => String(message.senderUserId || '').trim() !== String(request.authorUserId || '').trim(),
    );

    request.messages = nextMessages as any;
    request.status = hasReplyFromAnotherStudent ? 'En discussion' : 'En attente';
    await request.save();
    const studentAvatarMap = await this.buildForumStudentAvatarMap([request.toObject()]);

    return {
      request: this.toForumRequestView(
        request.toObject(),
        senderUserId,
        senderEmail,
        normalizedUsername.toLowerCase(),
        studentAvatarMap,
      ),
      messages: this.toForumChatMessages(request.toObject(), senderUserId, studentAvatarMap),
    };
  }

  private buildLocalAssistantAnswer(
    question: string,
    contents: StudentContent[],
    level: StudentLevel,
    chatbotTrainContext = '',
  ) {
    const normalizedQuestion = this.normalizeText(question);
    const courseNames = Array.from(
      new Set(contents.map(item => item.courseId).filter((item): item is string => !!item)),
    );
    const chapterNames = Array.from(
      new Set(contents.map(item => item.chapterId).filter((item): item is string => !!item)),
    );

    const contextualHeader =
      courseNames.length > 0
        ? `Je me base sur vos cours visibles dans EduVia: ${courseNames.join(', ')}.`
        : `Je vous reponds au niveau ${level}.`;

    if (chatbotTrainContext.trim()) {
      const firstContext = chatbotTrainContext
        .split(/\n\n+/)
        .slice(0, 2)
        .join(' ')
        .replace(/^Source:\s*[^ ]+\s*/i, '')
        .slice(0, 900);

      return [
        "D'apres le dossier chatbot train, voici les elements les plus proches de votre question.",
        firstContext,
        "Je peux aussi reformuler ce passage ou vous proposer un exercice cible sur cette notion.",
      ].join(' ');
    }

    if (
      normalizedQuestion.includes('bonjour') ||
      normalizedQuestion.includes('salut') ||
      normalizedQuestion.includes("j'ai besoin d'aide") ||
      normalizedQuestion.includes("jai besoin d'aide") ||
      normalizedQuestion === 'aide'
    ) {
      return `${contextualHeader} Dites-moi simplement la notion ou l'exercice qui vous bloque, par exemple: "c'est quoi une jointure ?", "explique if else", "donne-moi un exercice sur les boucles", ou "resume le chapitre 1".`;
    }

    if (normalizedQuestion.includes('machine learning') || normalizedQuestion.includes('apprentissage automatique')) {
      return [
        "Le machine learning est une branche de l'intelligence artificielle qui permet a un systeme d'apprendre a partir des donnees sans etre programme regle par regle.",
        "En pratique, on donne des exemples a un modele, puis il apprend des relations utiles pour predire, classer ou recommander.",
        "Exemple simple: detecter si un email est un spam a partir d'emails deja etiquetes.",
      ].join(' ');
    }

    if (normalizedQuestion.includes('jointure') || normalizedQuestion.includes('join')) {
      return [
        "Une jointure en SQL sert a combiner des lignes provenant de plusieurs tables a partir d'une condition de correspondance.",
        "INNER JOIN garde seulement les lignes communes. LEFT JOIN garde toutes les lignes de la table de gauche meme sans correspondance.",
        "Exemple: relier une table Etudiants et une table Inscriptions avec l'identifiant de l'etudiant.",
      ].join(' ');
    }

    if (normalizedQuestion.includes('if else') || normalizedQuestion.includes('if') || normalizedQuestion.includes('else')) {
      return [
        "La structure if ... else permet d'executer une action si une condition est vraie, et une autre si elle est fausse.",
        "Exemple: si note >= 10 alors Afficher(\"Admis\"), sinon Afficher(\"Ajourné\").",
        "Si vous voulez, je peux aussi vous proposer un petit exercice corrige sur if ... else.",
      ].join(' ');
    }

    if (normalizedQuestion.includes('algorithme')) {
      return [
        "Un algorithme est une suite finie et ordonnee d'etapes permettant de resoudre un probleme.",
        "On le decrit avant le code pour clarifier les entrees, les traitements et les sorties.",
        "Exemple: lire deux nombres, calculer leur somme, puis afficher le resultat.",
      ].join(' ');
    }

    if (normalizedQuestion.includes('sql')) {
      return [
        "SQL est le langage utilise pour interroger et manipuler une base de donnees relationnelle.",
        "Les commandes les plus connues sont SELECT, INSERT, UPDATE et DELETE.",
        "Exemple: SELECT nom FROM etudiants WHERE moyenne >= 10;",
      ].join(' ');
    }

    if (normalizedQuestion.includes('exercice')) {
      return [
        `${contextualHeader} Voici une methode simple pour reussir un exercice:`,
        "1. identifier les donnees d'entree et la sortie attendue.",
        "2. decomposer le probleme en petites etapes.",
        "3. ecrire d'abord l'algorithme ou la logique.",
        "4. seulement apres, passer au code ou a la reponse finale.",
        "Si vous me collez l'enonce exact, je peux vous guider pas a pas.",
      ].join(' ');
    }

    if (normalizedQuestion.includes('resume') || normalizedQuestion.includes('resumer') || normalizedQuestion.includes('chapitre')) {
      const chaptersText =
        chapterNames.length > 0 ? `Chapitres visibles: ${chapterNames.join(', ')}.` : '';
      return `${contextualHeader} ${chaptersText} Donnez-moi le nom du chapitre ou copiez un passage, et je vous ferai un resume clair, court et adapte a votre niveau.`;
    }

    return [
      contextualHeader,
      "Je peux vous aider sur les definitions, les exercices, les quiz, SQL, algorithmique, machine learning, mathematiques et autres matieres.",
      "Ecrivez votre question de facon un peu plus precise et je vous repondrai clairement.",
      `Exemple: "explique la difference entre INNER JOIN et LEFT JOIN" ou "donne-moi un exercice sur ${courseNames[0] || 'ce cours'}".`,
    ].join(' ');
  }

  private compactWhitespace(value: string) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  private normalizeFlashcardDifficulty(
    value?: string,
  ): 'facile' | 'intermediaire' | 'difficile' {
    const normalized = this.normalizeText(String(value || ''));
    if (normalized.startsWith('int') || normalized.includes('moyen')) {
      return 'intermediaire';
    }

    if (normalized.startsWith('diff') || normalized.startsWith('ava')) {
      return 'difficile';
    }

    return 'facile';
  }

  private flashcardDurationSeconds(
    difficulty: 'facile' | 'intermediaire' | 'difficile',
  ) {
    if (difficulty === 'intermediaire') {
      return 120;
    }

    if (difficulty === 'difficile') {
      return 60;
    }

    return 180;
  }

  private isFlashcardAnswerCorrect(userAnswer: string, expectedAnswer: string) {
    const normalize = (value: string) =>
      this.normalizeText(value)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const user = normalize(userAnswer);
    const expected = normalize(expectedAnswer);

    if (expected.length > 0 && expected.length < 3) {
      return user.split(' ').includes(expected) || user.includes(expected);
    }

    if (user.length < 3 || expected.length < 3) {
      return false;
    }

    if (expected.includes(user) || user.includes(expected)) {
      return true;
    }

    const stopWords = new Set([
      'avec', 'aux', 'bonne', 'ces', 'cite', 'comme', 'dans', 'definit', 'des',
      'donc', 'donne', 'elle', 'est', 'etre', 'exemple', 'faire', 'lie', 'les',
      'leur', 'leurs', 'notion', 'par', 'pas', 'plus', 'pour', 'que', 'qui',
      'reponse', 'role', 'son', 'sont', 'sur', 'une', 'utilise', 'utiliser',
    ]);
    const toKeywords = (value: string) =>
      value
        .split(' ')
        .filter(word => word.length >= 4 && !stopWords.has(word));
    const userKeywords = new Set(toKeywords(user));
    const expectedKeywords = toKeywords(expected);
    if (userKeywords.size === 0 || expectedKeywords.length === 0) {
      return false;
    }

    const sharedCount = expectedKeywords.filter(word => userKeywords.has(word)).length;
    const expectedRatio = sharedCount / expectedKeywords.length;
    const userRatio = sharedCount / userKeywords.size;
    return sharedCount >= 1 && user.length >= 12 && (expectedRatio >= 0.2 || userRatio >= 0.2);
  }

  private async findOwnedFlashcardSession(
    sessionId: string,
    userId?: string,
    email?: string,
  ) {
    if (!Types.ObjectId.isValid(sessionId)) {
      throw new HttpException('Session flashcards introuvable.', HttpStatus.NOT_FOUND);
    }

    const student = await this.findConnectedStudentProfile(userId, email);
    if (!student) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const session = await this.flashcardSessionModel.findById(sessionId).exec();
    const ownerEmail = String(session?.ownerEmail || '').trim().toLowerCase();
    const currentEmail = String(student.email || email || '').trim().toLowerCase();

    if (!session || ownerEmail !== currentEmail) {
      throw new HttpException('Session flashcards introuvable.', HttpStatus.NOT_FOUND);
    }

    return session;
  }

  private toFlashcardSessionView(session: any, includeAnswers: boolean) {
    const cards = (Array.isArray(session?.cards) ? session.cards : []).map((card: any) => ({
      id: String(card?.id || ''),
      question: this.repairEncoding(String(card?.question || '')),
      answer: includeAnswers ? this.repairEncoding(String(card?.answer || '')) : undefined,
      subject: this.repairEncoding(String(card?.subject || session?.subject || '')),
      difficulty: this.normalizeFlashcardDifficulty(card?.difficulty || session?.difficulty),
      userAnswer: String(card?.userAnswer || ''),
      revealed: card?.revealed === true,
      correct: card?.isCorrect === true,
    }));

    return {
      id: String(session?._id || session?.id || ''),
      subject: this.repairEncoding(String(session?.subject || '')),
      difficulty: this.normalizeFlashcardDifficulty(session?.difficulty),
      questionCount: Number(session?.questionCount || cards.length || 0),
      durationSeconds: Number(session?.durationSeconds || 0),
      cards,
      status: String(session?.status || 'in_progress'),
      correctCount: Number(session?.correctCount || 0),
      reviewedCount: Number(session?.reviewedCount || 0),
      score: Number(session?.score || 0),
      startedAt: this.serializeDate(session?.startedAt),
      completedAt: this.serializeDate(session?.completedAt),
      remainingSeconds:
        typeof session?.remainingSeconds === 'number' ? session.remainingSeconds : null,
      source: String(session?.source || ''),
      model: String(session?.model || ''),
    };
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

  private buildCourseTree(
    contents: StudentContent[],
    progressByContentId: Record<string, string> = {},
  ) {
    const courseItems = contents.filter(item => this.isCourse(item));
    const chapterItems = contents.filter(item => this.isChapter(item));
    const partItems = contents.filter(item => this.isPart(item));
    const materialItems = contents.filter(
      item => this.isDocument(item) || this.isVideo(item) || this.isQuiz(item),
    );

    const fallbackCourseIds = new Set(
      contents
        .map(item => item.courseId)
        .filter((item): item is string => !!item),
    );

    const visibleCourseItems =
      courseItems.length > 0
        ? courseItems
        : Array.from(fallbackCourseIds).map(courseId => ({
            _id: courseId,
            type: 'course',
            title: courseId,
            courseId,
          })) as StudentContent[];

    return visibleCourseItems.map(course => {
      const courseKey = String(course._id || course.courseId || course.title);
      const chapters = chapterItems
        .filter(chapter =>
          this.matchesContentReference(chapter.courseId, courseKey, course.title, course.courseId),
        )
        .map(chapter => {
          const chapterStructure = this.buildChapterStructure(
            chapter,
            course,
            materialItems,
            partItems,
            progressByContentId,
          );

          return {
            ...chapter,
            parts: chapterStructure.parts,
            directMaterials: chapterStructure.directMaterials,
          };
        });

      const inferredChapters =
        chapters.length > 0
          ? chapters
          : this.inferChaptersForCourse(course, materialItems, partItems, progressByContentId);

      return this.decorateCourseProgress({
        ...course,
        chapters: inferredChapters,
      });
    });
  }

  private async buildStudentProgress(
    visibleContents: StudentContent[],
    normalizedClassName: string,
    userId?: string,
    email?: string,
  ) {
    const student = await this.findConnectedStudent(userId, email);
    const progressEntries = Array.isArray(student?.learningProgress)
      ? student.learningProgress
      : [];
    const trackableMaterials = visibleContents.filter(
      item =>
        (this.isDocument(item) || this.isVideo(item) || this.isQuiz(item)),
    );
    const visibleCourseIds = [
      ...new Set(
        trackableMaterials
          .map(item => this.normalizeContentReference(item.courseId))
          .filter(Boolean),
      ),
    ];
    const completedMaterialIds = new Set(
      progressEntries
        .filter(entry => ['completed', 'passed'].includes(String(entry?.status || '').toLowerCase()))
        .map(entry => String(entry?.contentId || '').trim())
        .filter(Boolean),
    );
    const completedCourses = visibleCourseIds.filter(courseId => {
      const courseMaterials = trackableMaterials.filter(
        item => this.normalizeContentReference(item.courseId) === courseId,
      );

      return (
        courseMaterials.length > 0 &&
        courseMaterials.every(item =>
          completedMaterialIds.has(String(item._id || '').trim()),
        )
      );
    });
    const completedMaterials = trackableMaterials.filter(item =>
      completedMaterialIds.has(String(item._id || '').trim()),
    );
    const totalUnits = trackableMaterials.length + visibleCourseIds.length;
    const completedUnits = completedMaterials.length + completedCourses.length;

    return {
      className: normalizedClassName,
      globalProgress: totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0,
      totals: {
        completedMaterials: completedMaterials.length,
        totalMaterials: trackableMaterials.length,
        completedCourses: completedCourses.length,
        totalCourses: visibleCourseIds.length,
        completedUnits,
        totalUnits,
      },
      completedContentIds: Array.from(completedMaterialIds),
      progressByContentId: Object.fromEntries(
        progressEntries
          .map(entry => [
            String(entry?.contentId || '').trim(),
            String(entry?.status || '').trim().toLowerCase() || 'not_started',
          ])
          .filter(([contentId]) => !!contentId),
      ),
    };
  }

  private decorateMaterialsProgress(
    materials: StudentContent[],
    progressByContentId: Record<string, string> = {},
  ) {
    return materials.map(material => {
      const contentId = String(material._id || '').trim();
      const progressStatus = this.normalizeProgressStatus(progressByContentId[contentId]);
      const isCompleted = progressStatus === 'completed' || progressStatus === 'passed';

      return {
        ...material,
        progressStatus,
        isCompleted,
        isLocked: false,
        canMarkCompleted: true,
        completionButton: {
          label: isCompleted ? 'Termine' : 'Marquer termine',
          variant: isCompleted ? 'success' : 'neutral',
          disabled: false,
        },
      };
    });
  }

  private decorateCourseProgress(course: any) {
    const orderedMaterials = this.flattenCourseMaterials(course);
    const lockStates = new Map<string, boolean>();
    let hasIncompleteRequiredContent = false;

    for (const material of orderedMaterials) {
      const contentId = String(material?._id || '').trim();
      const isCompleted = !!material?.isCompleted;
      const materialType = String(material?.type || '').toLowerCase();
      const isQuiz = materialType === 'quiz';

      if (!isQuiz) {
        lockStates.set(contentId, false);
        if (!isCompleted) {
          hasIncompleteRequiredContent = true;
        }
        continue;
      }

      lockStates.set(contentId, hasIncompleteRequiredContent);
    }

    const applyLockState = (materials: any[]) =>
      materials.map((material: any) => {
        const contentId = String(material?._id || '').trim();
        const isCompleted = !!material?.isCompleted;
        const isLocked = lockStates.get(contentId) === true;

        return {
          ...material,
          isLocked,
          canMarkCompleted: !isLocked,
          completionButton: {
            label: isCompleted ? 'Termine' : 'Marquer termine',
            variant: isCompleted ? 'success' : 'neutral',
            disabled: isLocked,
          },
        };
      });

    const chapters = Array.isArray(course?.chapters)
      ? course.chapters.map((chapter: any) => ({
          ...chapter,
          directMaterials: applyLockState(
            Array.isArray(chapter?.directMaterials) ? chapter.directMaterials : [],
          ),
          parts: Array.isArray(chapter?.parts)
            ? chapter.parts.map((part: any) => ({
                ...part,
                materials: applyLockState(Array.isArray(part?.materials) ? part.materials : []),
              }))
            : [],
        }))
      : [];

    const completedItems = orderedMaterials.filter((material: any) => material?.isCompleted).length;
    const totalItems = orderedMaterials.length;

    return {
      ...course,
      chapters,
      courseProgress: {
        completedItems,
        totalItems,
        label: `${completedItems} elements termines sur ${totalItems}`,
        isCompleted: totalItems > 0 && completedItems === totalItems,
        percent: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
      },
    };
  }

  private flattenCourseMaterials(course: any) {
    const flattened: any[] = [];
    const chapters = Array.isArray(course?.chapters) ? course.chapters : [];

    for (const chapter of chapters) {
      const directMaterials = Array.isArray(chapter?.directMaterials) ? chapter.directMaterials : [];
      flattened.push(...directMaterials);

      const parts = Array.isArray(chapter?.parts) ? chapter.parts : [];
      for (const part of parts) {
        const materials = Array.isArray(part?.materials) ? part.materials : [];
        flattened.push(...materials);
      }
    }

    return flattened;
  }

  private inferChaptersForCourse(
    course: StudentContent,
    materialItems: StudentContent[],
    partItems: StudentContent[],
    progressByContentId: Record<string, string> = {},
  ) {
    const chapterNames = Array.from(
      new Set(
        materialItems
          .filter(item =>
            this.matchesContentReference(item.courseId, course.title, String(course._id || ''), course.courseId),
          )
          .map(item => item.chapterId)
          .filter((item): item is string => !!item),
      ),
    );

    return chapterNames.map(chapterName => {
      const chapterParts = partItems
        .filter(part =>
          this.matchesContentReference(part.chapterId, chapterName),
        )
        .map(part => ({
          ...part,
          materials: this.decorateMaterialsProgress(
            materialItems.filter(
              material =>
                this.matchesContentReference(
                  material.partId,
                  part.title,
                  String(part._id || ''),
                  part.partId,
                ),
            ),
            progressByContentId,
          ),
        }));

      return {
        _id: chapterName,
        type: 'chapter',
        title: chapterName,
        courseId: course.title,
        ...this.buildChapterStructure(
          {
            _id: chapterName,
            title: chapterName,
            chapterId: chapterName,
          } as StudentContent,
          course,
          materialItems,
          partItems,
          progressByContentId,
          chapterParts,
        ),
      };
    });
  }

  private buildChapterStructure(
    chapter: StudentContent,
    course: StudentContent,
    materialItems: StudentContent[],
    partItems: StudentContent[],
    progressByContentId: Record<string, string> = {},
    predefinedParts?: any[],
  ) {
    const chapterKey = String(chapter._id || chapter.chapterId || chapter.title);
    const matchesCourse = (item: { courseId?: string }) =>
      this.matchesContentReference(
        item?.courseId,
        course.title,
        String(course._id || ''),
        course.courseId,
      );
    const explicitParts =
      predefinedParts ||
      partItems
        .filter(part =>
          matchesCourse(part) &&
          this.matchesContentReference(part.chapterId, chapterKey, chapter.title, chapter.chapterId),
        )
        .map(part => {
          const partKey = String(part._id || part.partId || part.title);
          const materials = materialItems.filter(
              material =>
                matchesCourse(material) &&
                this.matchesContentReference(material.partId, partKey, part.title, part.partId),
          );

          return {
            ...part,
            materials: this.decorateMaterialsProgress(materials, progressByContentId),
          };
        });

    const inferredPartNames =
      explicitParts.length > 0
        ? []
        : Array.from(
            new Set(
              materialItems
                .filter(material =>
                  matchesCourse(material) &&
                  this.matchesContentReference(
                    material.chapterId,
                    chapter.title,
                    chapterKey,
                    chapter.chapterId,
                  ),
                )
                .map(material => material.partId)
                .filter((item): item is string => !!item),
            ),
          );

    const inferredParts = inferredPartNames.map(partName => ({
      _id: partName,
      type: 'part',
      title: partName,
      chapterId: chapter.title,
      materials: this.decorateMaterialsProgress(
        materialItems.filter(material =>
          this.matchesContentReference(material.partId, partName),
        ),
        progressByContentId,
      ),
    }));

    const parts = explicitParts.length > 0 ? explicitParts : inferredParts;
    const directMaterials = this.decorateMaterialsProgress(
      materialItems.filter(
        material =>
          matchesCourse(material) &&
          this.matchesContentReference(material.chapterId, chapter.title, chapterKey, chapter.chapterId) &&
          (!material.partId ||
            !parts.some((part: any) =>
              this.matchesContentReference(
                material.partId,
                part.title,
                String(part._id || ''),
                part.partId,
              ),
            )),
      ),
      progressByContentId,
    );

    return {
      parts,
      directMaterials,
    };
  }

  private filterVisibleContentHierarchy(
    contents: StudentContent[],
    level: StudentLevel,
    className?: string,
    teacherAssignedClassMap: Map<string, string[]> = new Map(),
  ) {
    const visibleQuizIds = this.resolveVisibleQuizIds(
      contents,
      level,
      className,
      teacherAssignedClassMap,
    );
    const selfVisible = new Map(
      contents.map(item => [
        this.contentIdentity(item),
        this.isVisibleToStudent(item, level, className, teacherAssignedClassMap, visibleQuizIds),
      ]),
    );
    const byType = {
      courses: contents.filter(item => this.isCourse(item)),
      chapters: contents.filter(item => this.isChapter(item)),
      parts: contents.filter(item => this.isPart(item)),
    };

    const isItemSelfVisible = (item?: StudentContent) =>
      !item || selfVisible.get(this.contentIdentity(item)) === true;

    const findCourse = (item: StudentContent) =>
      byType.courses.find(course =>
        this.matchesContentReference(
          item.courseId,
          String(course._id || ''),
          course.courseId,
          course.title,
        ),
      );

    const findChapter = (item: StudentContent) =>
      byType.chapters.find(chapter => {
        const sameChapter = this.matchesContentReference(
          item.chapterId,
          String(chapter._id || ''),
          chapter.chapterId,
          chapter.title,
        );

        if (!sameChapter) {
          return false;
        }

        if (!item.courseId || !chapter.courseId) {
          return true;
        }

        return this.matchesContentReference(item.courseId, chapter.courseId);
      });

    const findPart = (item: StudentContent) =>
      byType.parts.find(part => {
        const samePart = this.matchesContentReference(
          item.partId,
          String(part._id || ''),
          part.partId,
          part.title,
        );

        if (!samePart) {
          return false;
        }

        const sameCourse =
          !item.courseId ||
          !part.courseId ||
          this.matchesContentReference(item.courseId, part.courseId);
        const sameChapter =
          !item.chapterId ||
          !part.chapterId ||
          this.matchesContentReference(item.chapterId, part.chapterId);

        return sameCourse && sameChapter;
      });

    return contents.filter(item => {
      if (!isItemSelfVisible(item)) {
        return false;
      }

      const course = findCourse(item);
      if (course && !isItemSelfVisible(course)) {
        return false;
      }

      if (this.isCourse(item)) {
        return true;
      }

      const chapter = findChapter(item);
      if (chapter && !isItemSelfVisible(chapter)) {
        return false;
      }

      if (this.isChapter(item)) {
        return true;
      }

      const part = findPart(item);
      if (part && !isItemSelfVisible(part)) {
        return false;
      }

      return true;
    });
  }

  private contentIdentity(item: StudentContent) {
    return String(item?._id || item?.courseId || item?.title || '').trim();
  }

  private isVisibleToStudent(
    item: StudentContent,
    level: StudentLevel,
    className?: string,
    teacherAssignedClassMap: Map<string, string[]> = new Map(),
    visibleQuizIds: Set<string> = new Set(),
  ) {
    if (item.isActive === false && !visibleQuizIds.has(String(item._id || '').trim())) {
      return false;
    }

    if (!this.isVisibleForClass(item, className, teacherAssignedClassMap)) {
      return false;
    }

    if (!this.isQuiz(item)) {
      return true;
    }

    const quizQuestions = Array.isArray(item.quizQuestions) ? item.quizQuestions : [];
    if (quizQuestions.length === 0) {
      return false;
    }

    const difficulty = this.normalizeLevel(item.quizDifficulty);
    if (!difficulty) {
      return true;
    }

    return difficulty === level;
  }

  private resolveVisibleQuizIds(
    contents: StudentContent[],
    level: StudentLevel,
    className?: string,
    teacherAssignedClassMap: Map<string, string[]> = new Map(),
  ) {
    const selectedQuizByScope = new Map<string, StudentContent>();

    contents
      .filter(item => this.isQuiz(item))
      .filter(item => this.isVisibleForClass(item, className, teacherAssignedClassMap))
      .filter(item => {
        const quizQuestions = Array.isArray(item.quizQuestions) ? item.quizQuestions : [];
        return quizQuestions.length > 0 && this.normalizeLevel(item.quizDifficulty) === level;
      })
      .forEach(item => {
        const scopeKey = [
          (item.teacherEmail || '').trim().toLowerCase(),
          this.normalizeContentReference(item.courseId),
          this.normalizeContentReference(item.chapterId),
          this.normalizeContentReference(item.partId),
          this.normalizeLevel(item.quizDifficulty),
        ].join('|');
        const current = selectedQuizByScope.get(scopeKey);

        if (!current || this.shouldPreferQuiz(item, current)) {
          selectedQuizByScope.set(scopeKey, item);
        }
      });

    return new Set(
      Array.from(selectedQuizByScope.values())
        .map(item => String(item._id || '').trim())
        .filter(Boolean),
    );
  }

  private shouldPreferQuiz(candidate: StudentContent, current: StudentContent) {
    const candidateActive = candidate.isActive !== false;
    const currentActive = current.isActive !== false;

    if (candidateActive !== currentActive) {
      return candidateActive;
    }

    return String(candidate._id || '') > String(current._id || '');
  }

  private isVisibleForClass(
    item: StudentContent,
    className?: string,
    teacherAssignedClassMap: Map<string, string[]> = new Map(),
  ) {
    const normalizedClassName = this.normalizeClassName(className);
    const teacherEmail = (item.teacherEmail || '').trim().toLowerCase();
    const teacherAssignedClasses = teacherAssignedClassMap.get(teacherEmail) || [];

    if (item.visibleToAllClasses === true) {
      return true;
    }

    const allowedClasses = Array.isArray(item.visibleToClasses)
      ? item.visibleToClasses.map(value => this.normalizeClassName(value)).filter(Boolean)
      : [];

    if (this.isCourse(item) && allowedClasses.length === 0) {
      return false;
    }

    if (allowedClasses.length > 0) {
      return !!normalizedClassName && allowedClasses.includes(normalizedClassName);
    }

    return !!normalizedClassName && teacherAssignedClasses.includes(normalizedClassName);
  }

  private async buildTeacherAssignedClassMap(contents: StudentContent[]) {
    const teacherEmails = Array.from(
      new Set(
        contents
          .map(item => (item.teacherEmail || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    if (teacherEmails.length === 0) {
      return new Map<string, string[]>();
    }

    const teachers = await this.userModel
      .find({
        role: 'teacher',
        email: { $in: teacherEmails },
      })
      .lean()
      .exec();

    return new Map(
      teachers.map(teacher => {
        const assignedClasses = [
          teacher?.className,
          ...(Array.isArray(teacher?.assignedClasses) ? teacher.assignedClasses : []),
        ]
          .map(value => this.normalizeClassName(value || ''))
          .filter(Boolean);

        return [
          String(teacher?.email || '').trim().toLowerCase(),
          Array.from(new Set(assignedClasses)),
        ] as [string, string[]];
      }),
    );
  }

  private async buildTeacherCourseAssignmentMap(contents: StudentContent[]) {
    const teacherEmails = Array.from(
      new Set(
        contents
          .map(item => (item.teacherEmail || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    if (teacherEmails.length === 0) {
      return new Map<string, Map<string, string[]>>();
    }

    const teachers = await this.userModel
      .find({
        role: 'teacher',
        email: { $in: teacherEmails },
      })
      .lean()
      .exec();

    return new Map(
      teachers.map(teacher => [
        String(teacher?.email || '').trim().toLowerCase(),
        this.buildCourseAssignmentMapForTeacher(teacher),
      ] as [string, Map<string, string[]>]),
    );
  }

  private buildCourseAssignmentMapForTeacher(teacher: any) {
    const fallbackClasses = [
      teacher?.className,
      ...(Array.isArray(teacher?.assignedClasses) ? teacher.assignedClasses : []),
    ]
      .map(value => this.normalizeClassName(value || ''))
      .filter(Boolean);
    const fallbackClassList = Array.from(new Set(fallbackClasses));
    const courseMap = new Map<string, string[]>();

    (Array.isArray(teacher?.teachingAssignments)
      ? teacher.teachingAssignments
      : []
    ).forEach((assignment: any) => {
      const subject = String(assignment?.subject || '').trim();
      const subjectKey = this.normalizeContentReference(subject);
      if (!subjectKey) {
        return;
      }

      const classes = (Array.isArray(assignment?.classes) ? assignment.classes : [])
        .map((value: string) => this.normalizeClassName(value || ''))
        .filter(Boolean);

      courseMap.set(subjectKey, classes.length ? Array.from(new Set(classes)) : fallbackClassList);
    });

    (Array.isArray(teacher?.teachingSubjects) ? teacher.teachingSubjects : []).forEach(
      (subjectValue: string) => {
        const subjectKey = this.normalizeContentReference(subjectValue);
        if (!subjectKey || courseMap.has(subjectKey)) {
          return;
        }

        courseMap.set(subjectKey, fallbackClassList);
      },
    );

    return courseMap;
  }

  private isContentInCurrentTeacherCourse(
    item: StudentContent,
    teacherCourseAssignmentMap: Map<string, Map<string, string[]>>,
    className?: string,
  ) {
    const teacherEmail = (item.teacherEmail || '').trim().toLowerCase();
    if (!teacherEmail) {
      return true;
    }

    const courseMap = teacherCourseAssignmentMap.get(teacherEmail);
    if (!courseMap) {
      return false;
    }

    const courseKey = this.normalizeContentReference(item.courseId || item.title);
    if (!courseKey || !courseMap.has(courseKey)) {
      return false;
    }

    const assignedClasses = courseMap.get(courseKey) || [];
    const normalizedClassName = this.normalizeClassName(className);
    return !normalizedClassName || assignedClasses.includes(normalizedClassName);
  }

  private normalizeClassName(value?: string) {
    return (value || '').trim().toUpperCase();
  }

  private async findLeaderboardClassStudents(className: string) {
    try {
      return await this.userModel
        .find({
          role: 'student',
          className: {
            $regex: this.buildExactClassRegex(className),
            $options: 'i',
          },
        })
        .select({
          keycloakId: 1,
          email: 1,
          firstName: 1,
          lastName: 1,
          className: 1,
          profileData: 1,
          learningProgress: 1,
        })
        .lean()
        .exec();
    } catch (error) {
      this.logger.warn(
        `Impossible de charger les etudiants du classement: ${(error as Error)?.message || error}`,
      );
      return [];
    }
  }

  private ensureConnectedStudentInLeaderboard(
    students: any[],
    connectedStudent: any,
    userId?: string,
    email?: string,
  ) {
    const safeStudents = Array.isArray(students) ? students : [];
    const connectedEmail = String(email || connectedStudent?.email || '').trim().toLowerCase();
    const connectedId = String(userId || connectedStudent?.keycloakId || '').trim();
    const alreadyIncluded = safeStudents.some(student => {
      const studentEmail = String(student?.email || '').trim().toLowerCase();
      const studentId = String(student?.keycloakId || '').trim();
      return (
        (!!connectedId && studentId === connectedId) ||
        (!!connectedEmail && studentEmail === connectedEmail)
      );
    });

    return alreadyIncluded ? safeStudents : [connectedStudent, ...safeStudents].filter(Boolean);
  }

  private async findWeeklyCompletedTasks(
    studentEmails: string[],
    weekStart: Date,
    weekEnd: Date,
  ) {
    if (!studentEmails.length) {
      return [];
    }

    try {
      return await this.plannerTaskModel
        .find({
          completed: true,
          ownerEmail: { $in: studentEmails },
          updatedAt: { $gte: weekStart, $lte: weekEnd },
        } as any)
        .lean()
        .exec();
    } catch (error) {
      this.logger.warn(
        `Impossible de charger les taches du classement: ${(error as Error)?.message || error}`,
      );
      return [];
    }
  }

  private async findWeeklyForumRequests(studentEmails: string[], studentIds: string[]) {
    const filters: any[] = [];
    if (studentEmails.length) {
      filters.push({ authorEmail: { $in: studentEmails } });
    }
    if (studentIds.length) {
      filters.push({ authorUserId: { $in: studentIds } });
      filters.push({ 'messages.senderUserId': { $in: studentIds } });
    }

    if (!filters.length) {
      return [];
    }

    try {
      return await this.forumRequestModel
        .find({ $or: filters })
        .lean()
        .exec();
    } catch (error) {
      this.logger.warn(
        `Impossible de charger l'activite forum du classement: ${(error as Error)?.message || error}`,
      );
      return [];
    }
  }

  private buildExactClassRegex(value: string) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^\\s*${escaped}\\s*$`;
  }

  private currentWeekRange(reference = new Date()) {
    const start = new Date(reference);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  private formatWeekRangeLabel(start: Date, end: Date) {
    const formatter = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
    });
    const endFormatter = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    return `Semaine du ${formatter.format(start)} - ${endFormatter.format(end)}`;
  }

  private buildLeaderboardRow(
    student: any,
    visibleContents: StudentContent[],
    weekStart: Date,
    weekEnd: Date,
    taskCountByEmail: Map<string, number>,
    forumCountByIdentity: Map<string, number>,
    userId?: string,
    email?: string,
  ) {
    const progressEntries = Array.isArray(student?.learningProgress)
      ? student.learningProgress
      : [];
    const visibleContentIds = new Set(
      visibleContents.map(item => String(item._id || '').trim()).filter(Boolean),
    );
    const trackableMaterials = visibleContents.filter(item =>
      this.isDocument(item) || this.isVideo(item) || this.isQuiz(item),
    );
    const visibleCourseIds = [
      ...new Set(
        trackableMaterials
          .map(item => this.normalizeContentReference(item.courseId))
          .filter(Boolean),
      ),
    ];
    const completedMaterialIds = new Set(
      progressEntries
        .filter((entry: any) =>
          visibleContentIds.has(String(entry?.contentId || '').trim()) &&
          ['completed', 'passed'].includes(String(entry?.status || '').toLowerCase()),
        )
        .map((entry: any) => String(entry?.contentId || '').trim())
        .filter(Boolean),
    );
    const completedCourseCount = visibleCourseIds.filter(courseId => {
      const courseMaterials = trackableMaterials.filter(
        item => this.normalizeContentReference(item.courseId) === courseId,
      );

      return (
        courseMaterials.length > 0 &&
        courseMaterials.every(item =>
          completedMaterialIds.has(String(item._id || '').trim()),
        )
      );
    }).length;
    const weeklyProgressEntries = progressEntries.filter((entry: any) => {
      const completedAt = this.parseValidDate(entry?.completedAt || entry?.updatedAt || entry?.submittedAt);
      return (
        completedAt &&
        completedAt >= weekStart &&
        completedAt <= weekEnd &&
        visibleContentIds.has(String(entry?.contentId || '').trim())
      );
    });
    const weeklyCompletedCount = weeklyProgressEntries.filter((entry: any) =>
      ['completed', 'passed'].includes(String(entry?.status || '').toLowerCase()),
    ).length;
    const quizScores = progressEntries
      .filter((entry: any) => {
        const contentId = String(entry?.contentId || '').trim();
        const content = visibleContents.find(item => String(item._id || '').trim() === contentId);
        const status = String(entry?.status || '').toLowerCase();
        return (
          content &&
          this.isQuiz(content) &&
          typeof entry?.score === 'number' &&
          ['completed', 'passed'].includes(status)
        );
      })
      .map((entry: any) => Math.max(0, Math.min(100, Number(entry.score))));
    const weeklyQuizScoreBonus = weeklyProgressEntries
      .filter((entry: any) => typeof entry?.score === 'number')
      .reduce((sum: number, entry: any) => sum + Math.round(Math.max(0, Math.min(100, Number(entry.score))) * 2), 0);
    const average = quizScores.length
      ? Math.round(quizScores.reduce((sum, score) => sum + score, 0) / quizScores.length)
      : 0;
    const studentEmail = String(student?.email || '').trim().toLowerCase();
    const studentId = String(student?.keycloakId || '').trim();
    const forumActivity =
      (studentEmail ? forumCountByIdentity.get(`email:${studentEmail}`) || 0 : 0) +
      (studentId ? forumCountByIdentity.get(`id:${studentId}`) || 0 : 0);
    const completedTasks = studentEmail ? taskCountByEmail.get(studentEmail) || 0 : 0;
    const points =
      weeklyCompletedCount * 150 +
      completedCourseCount * 120 +
      weeklyQuizScoreBonus +
      forumActivity * 35 +
      completedTasks * 45 +
      average * 5;
    const levelKey = this.normalizeLevel(student?.profileData?.level);

    return {
      id: String(student?._id || studentId || studentEmail),
      rank: 0,
      name: this.buildUserDisplayName(student),
      avatarDataUrl: String(student?.profileData?.avatarDataUrl || '').trim(),
      levelKey,
      level: this.levelDisplayLabel(levelKey),
      className: this.normalizeClassName(student?.className || ''),
      points,
      courses: completedCourseCount,
      average,
      weeklyStats: {
        completedItems: weeklyCompletedCount,
        quizScoreBonus: weeklyQuizScoreBonus,
        forumActivity,
        completedTasks,
      },
      isCurrentStudent:
        (!!userId && studentId === String(userId || '').trim()) ||
        (!!email && studentEmail === String(email || '').trim().toLowerCase()),
    };
  }

  private parseValidDate(value: unknown) {
    if (!value) {
      return null;
    }

    const date = new Date(value as any);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private countWeeklyTasksByEmail(tasks: any[]) {
    const counts = new Map<string, number>();

    for (const task of Array.isArray(tasks) ? tasks : []) {
      const email = String(task?.ownerEmail || '').trim().toLowerCase();
      if (!email) {
        continue;
      }
      counts.set(email, (counts.get(email) || 0) + 1);
    }

    return counts;
  }

  private countWeeklyForumActivity(requests: any[], weekStart: Date, weekEnd: Date) {
    const counts = new Map<string, number>();
    const add = (key: string, createdAt: unknown) => {
      const date = this.parseValidDate(createdAt);
      if (!key || !date || date < weekStart || date > weekEnd) {
        return;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    };

    for (const request of Array.isArray(requests) ? requests : []) {
      const authorEmail = String(request?.authorEmail || '').trim().toLowerCase();
      const authorUserId = String(request?.authorUserId || '').trim();
      add(authorEmail ? `email:${authorEmail}` : '', request?.createdAt);
      add(authorUserId ? `id:${authorUserId}` : '', request?.createdAt);

      for (const message of Array.isArray(request?.messages) ? request.messages : []) {
        const senderUserId = String(message?.senderUserId || '').trim();
        add(senderUserId ? `id:${senderUserId}` : '', message?.createdAt);
      }
    }

    return counts;
  }

  private levelDisplayLabel(level: StudentLevel) {
    switch (level) {
      case 'intermediaire':
        return 'Intermediaire';
      case 'avance':
        return 'Avance';
      default:
        return 'Debutant';
    }
  }

  private async resolveStudentClassName(
    providedClassName?: string,
    userId?: string,
    email?: string,
  ) {
    const connectedStudent = await this.findConnectedStudent(userId, email);
    if ((userId || email) && !connectedStudent) {
      throw new HttpException('Session etudiant invalide.', HttpStatus.UNAUTHORIZED);
    }

    const normalizedConnectedClassName = this.normalizeClassName(connectedStudent?.className || '');
    if (normalizedConnectedClassName) {
      return normalizedConnectedClassName;
    }

    const normalizedProvidedClassName = this.normalizeClassName(providedClassName);
    if (normalizedProvidedClassName) {
      return normalizedProvidedClassName;
    }

    return '';
  }

  private async findConnectedStudent(userId?: string, email?: string) {
    if (!userId && !email) {
      return null;
    }

    const emailQuery = (email || '').trim().toLowerCase();
    const identityQuery =
      userId && emailQuery
        ? { $or: [{ keycloakId: userId }, { email: emailQuery }] }
        : userId
          ? { keycloakId: userId }
          : { email: emailQuery };

    return this.userModel
      .findOne({
        role: 'student',
        ...identityQuery,
      })
      .select({ className: 1, learningProgress: 1 })
      .lean()
      .exec();
  }

  private async findConnectedStudentDocument(userId?: string, email?: string) {
    if (!userId && !email) {
      return null;
    }

    const emailQuery = (email || '').trim().toLowerCase();
    const identityQuery =
      userId && emailQuery
        ? { $or: [{ keycloakId: userId }, { email: emailQuery }] }
        : userId
          ? { keycloakId: userId }
          : { email: emailQuery };

    return this.userModel
      .findOne({
        role: 'student',
        ...identityQuery,
      })
      .exec();
  }

  private async findConnectedStudentProfile(userId?: string, email?: string) {
    if (!userId && !email) {
      return null;
    }

    const emailQuery = (email || '').trim().toLowerCase();
    const identityQuery =
      userId && emailQuery
        ? { $or: [{ keycloakId: userId }, { email: emailQuery }] }
        : userId
          ? { keycloakId: userId }
          : { email: emailQuery };

    return this.userModel
      .findOne({
        role: 'student',
        ...identityQuery,
      })
      .select({ keycloakId: 1, email: 1, firstName: 1, lastName: 1, className: 1, profileData: 1, learningProgress: 1 })
      .lean()
      .exec();
  }

  private async findForumRequestById(requestId: string) {
    if (!Types.ObjectId.isValid(requestId)) {
      throw new HttpException('Demande introuvable.', HttpStatus.NOT_FOUND);
    }

    const request = await this.forumRequestModel.findById(requestId).exec();
    if (!request) {
      throw new HttpException('Demande introuvable.', HttpStatus.NOT_FOUND);
    }

    return request;
  }

  private toForumRequestView(
    request: any,
    connectedUserId: string,
    connectedEmail: string,
    connectedUsername: string,
    studentAvatarMap: Map<string, string> = new Map(),
  ) {
    const authorUserId = String(request.authorUserId || '').trim();
    const nonAuthorReplies = Array.isArray(request.messages)
      ? request.messages.filter(
          (message: any) =>
            String(message?.senderUserId || '').trim() !== authorUserId,
        ).length
      : 0;
    const latestNonAuthorMessage = Array.isArray(request.messages)
      ? [...request.messages]
          .reverse()
          .find(
            (message: any) =>
              String(message?.senderUserId || '').trim() !== authorUserId,
          )
      : null;

    const status = nonAuthorReplies > 0 ? 'En discussion' : 'En attente';
    const requestId = String(request._id || request.id || '');
    const isMine =
      authorUserId === connectedUserId ||
      String(request.authorEmail || '').trim().toLowerCase() === connectedEmail ||
      String(request.authorEmail || '').trim().toLowerCase() === connectedUsername;

    return {
      id: requestId,
      author: String(request.authorName || 'Etudiant'),
      authorAvatarDataUrl: studentAvatarMap.get(authorUserId) || '',
      level: this.formatStudentLevel(request.authorClassName),
      title: String(request.subject || ''),
      message: String(request.message || ''),
      time: this.formatRelativeTime(request.createdAt),
      replies: nonAuthorReplies,
      status,
      canDelete: true,
      isMine,
      lastResponderName: String(latestNonAuthorMessage?.senderName || '').trim(),
      createdAt: request.createdAt,
    };
  }

  private toForumChatMessages(
    request: any,
    viewerUserId = '',
    studentAvatarMap: Map<string, string> = new Map(),
  ) {
    const normalizedViewerUserId = String(viewerUserId || '').trim();
    const authorUserId = String(request.authorUserId || '').trim();
    const baseMessage = {
      id: `initial-${String(request._id || request.id || '')}`,
      senderType: 'request' as const,
      senderName: String(request.authorName || 'Etudiant'),
      senderAvatarDataUrl: studentAvatarMap.get(authorUserId) || '',
      senderLevel: this.formatStudentLevel(request.authorClassName),
      text: String(request.message || ''),
      attachments: [],
      transcript: '',
      time: this.formatRelativeTime(request.createdAt),
      createdAt: request.createdAt,
    };

    const visibleMessages = Array.isArray(request.messages)
      ? request.messages.filter((message: any) => {
          const senderUserId = String(message?.senderUserId || '').trim();
          if (!normalizedViewerUserId || normalizedViewerUserId === authorUserId) {
            return true;
          }

          return senderUserId === authorUserId || senderUserId === normalizedViewerUserId;
        })
      : [];

    const conversation = visibleMessages.map((message: any, index: number) => ({
          id: `${String(request._id || request.id || '')}-${index}`,
          senderType:
            String(message?.senderUserId || '').trim() ===
            authorUserId
              ? ('author' as const)
              : ('helper' as const),
          senderName: String(message?.senderName || 'Etudiant'),
          senderAvatarDataUrl:
            studentAvatarMap.get(String(message?.senderUserId || '').trim()) || '',
          senderLevel: this.formatStudentLevel(message?.senderClassName),
          text: String(message?.text || ''),
          attachments: this.normalizeForumAttachments(message?.attachments),
          transcript: String(message?.transcript || ''),
          time: this.formatRelativeTime(message?.createdAt),
          createdAt: message?.createdAt,
        }));

    return [baseMessage, ...conversation];
  }

  private normalizeForumAttachments(attachments: any[] = []) {
    return (Array.isArray(attachments) ? attachments : [])
      .map((attachment: any) => {
        const kind = attachment?.kind === 'video' ? 'video' : 'document';
        const name = String(attachment?.name || (kind === 'video' ? 'reponse-video.webm' : 'document')).trim();
        const mimeType = String(attachment?.mimeType || '').trim();
        const dataUrl = String(attachment?.dataUrl || '').trim();
        return { kind, name, mimeType, dataUrl };
      })
      .filter((attachment) => !!attachment.name && !!attachment.dataUrl)
      .slice(0, 3);
  }

  private formatRelativeTime(value?: string | Date) {
    if (!value) {
      return "A l'instant";
    }

    const target = new Date(value).getTime();
    if (Number.isNaN(target)) {
      return "A l'instant";
    }

    const diffInMinutes = Math.floor((Date.now() - target) / 60000);
    if (diffInMinutes <= 0) {
      return "A l'instant";
    }

    if (diffInMinutes < 60) {
      return `Il y a ${diffInMinutes} min`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `Il y a ${diffInHours} h`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    return `Il y a ${diffInDays} j`;
  }

  private buildUserDisplayName(user?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null, username?: string) {
    const firstName = String(user?.firstName || '').trim();
    const lastName = String(user?.lastName || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) {
      return fullName;
    }

    const emailPrefix = String(user?.email || username || '')
      .split('@')[0]
      .trim();
    return emailPrefix || 'Etudiant';
  }

  private async buildForumStudentAvatarMap(requests: any[]) {
    const userIds = new Set<string>();

    for (const request of Array.isArray(requests) ? requests : []) {
      const authorUserId = String(request?.authorUserId || '').trim();
      if (authorUserId) {
        userIds.add(authorUserId);
      }

      if (Array.isArray(request?.messages)) {
        for (const message of request.messages) {
          const senderUserId = String(message?.senderUserId || '').trim();
          if (senderUserId) {
            userIds.add(senderUserId);
          }
        }
      }
    }

    if (userIds.size === 0) {
      return new Map<string, string>();
    }

    const students = await this.userModel
      .find({
        role: 'student',
        keycloakId: { $in: Array.from(userIds) },
      })
      .select({ keycloakId: 1, profileData: 1 })
      .lean()
      .exec();

    return new Map(
      students.map(student => [
        String(student?.keycloakId || '').trim(),
        String(student?.profileData?.avatarDataUrl || '').trim(),
      ]),
    );
  }

  private buildSingleStudentAvatarMap(userId: string, avatarDataUrl: string) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return new Map<string, string>();
    }

    return new Map([[normalizedUserId, String(avatarDataUrl || '').trim()]]);
  }

  private formatStudentLevel(value?: string) {
    const normalized = String(value || '')
      .trim()
      .toUpperCase();
    return normalized ? `${normalized} Informatique` : 'Etudiant';
  }

  private courseGroupKeyForPortfolio(item: StudentContent) {
    const value = item.courseId || item.title || '';
    return this.normalizeContentReference(value) || 'cours';
  }

  private async buildPortfolioCourseSummary(contents: StudentContent[], level: StudentLevel) {
    const courseTitle =
      contents.find(item => this.isCourse(item))?.title ||
      contents.find(item => item.courseId)?.courseId ||
      contents[0]?.title ||
      'Cours';
    const documents = contents.filter(item => this.isDocument(item));
    const quizzes = contents.filter(item => this.isQuiz(item));
    const source = await this.extractPortfolioCourseText(contents);
    const summarySourceText = [source.documentText, source.quizText].filter(Boolean).join(' ');
    const fallbackSourceText = summarySourceText || source.metadataText;
    const aiSummary = await this.generatePortfolioCourseSummaryWithHuggingFace({
      courseTitle,
      documentCount: documents.length,
      quizCount: quizzes.length,
      teacherName: contents.find(item => item.teacherName)?.teacherName || 'Teacher User',
      level,
      documentText: source.documentText,
      quizText: source.quizText,
    });

    if (aiSummary) {
      return aiSummary;
    }

    const notions = this.extractPortfolioNotions(
      contents,
      source.documentText,
      source.quizText,
      source.metadataText,
    ).slice(0, 10);
    const primaryNotion = notions[0]?.notion || courseTitle;

    return {
      courseTitle,
      level: this.levelDisplayLabel(level),
      resourceCount: documents.length,
      quizCount: quizzes.length,
      teacherName: contents.find(item => item.teacherName)?.teacherName || 'Teacher User',
      overview:
        this.buildPortfolioOverview(
          courseTitle,
          documents.length,
          quizzes.length,
          notions,
          fallbackSourceText,
          !!source.documentText,
          !!source.quizText,
        ),
      notions,
      details: notions.map((item, index) => ({
        title: `${index + 1}. ${item.notion}`,
        explanation:
          `${item.notion} est une notion importante du cours ${courseTitle}. ${item.explanation}`,
        bullets: [
          item.explanation,
          `Exemple ou usage: ${item.example}`,
        ],
      })),
      nextActions: [
        `Lire la fiche structuree puis revenir aux supports originaux du cours ${courseTitle}.`,
        'Passer ou repasser le quiz du cours pour verifier la comprehension des notions expliquees.',
        `Commencer la revision par ${primaryNotion}, puis expliquer cette notion avec un exemple.`,
      ],
      revisionPlan: notions.slice(0, 5).map((item, index) => ({
        step: index + 1,
        text: `Etape ${index + 1}: revoir ${item.notion} et noter les erreurs dans le portfolio.`,
      })),
      glossary: notions.map(item => `${item.notion}: ${item.explanation}`).slice(0, 8),
      generatedAt: new Date().toISOString(),
    };
  }

  private async extractPortfolioCourseText(contents: StudentContent[]) {
    const documentBlocks: string[] = [];
    const quizBlocks: string[] = [];
    const metadataBlocks: string[] = [];

    for (const item of contents) {
      const fileUrl = String(item.fileUrl || item.source || '').trim();
      if (this.isDocument(item) && /\.(pdf|docx)$/i.test(fileUrl)) {
        try {
          const extracted = await this.extractStudentUploadText(fileUrl);
          if (extracted && extracted.length >= 80) {
            documentBlocks.push(extracted);
          }
        } catch (error) {
          this.logger.warn(
            `[PORTFOLIO SUMMARY] extraction ignoree file=${fileUrl} error=${String(error)}`,
          );
        }
      }

      if (this.isQuiz(item)) {
        const quizText = this.extractPortfolioQuizText(item);
        if (quizText) {
          quizBlocks.push(quizText);
        }
      }

      if ((this.isDocument(item) || this.isQuiz(item)) && item.description) {
        metadataBlocks.push(String(item.description));
      }
    }

    return {
      documentText: this.compactWhitespace(documentBlocks.join(' ')).slice(0, 22000),
      quizText: this.compactWhitespace(quizBlocks.join(' ')).slice(0, 9000),
      metadataText: this.compactWhitespace(metadataBlocks.join(' ')).slice(0, 6000),
    };
  }

  private extractPortfolioQuizText(item: StudentContent) {
    const questions = Array.isArray(item.quizQuestions) ? item.quizQuestions : [];
    if (questions.length === 0) {
      return '';
    }

    const lines = questions.slice(0, 20).flatMap((question: any, index) => {
      const prompt = this.repairEncoding(String(question?.prompt || '')).trim();
      const explanation = this.repairEncoding(String(question?.explanation || '')).trim();
      const correctAnswers = Array.isArray(question?.correctAnswers)
        ? question.correctAnswers
        : [];
      const options = Array.isArray(question?.options) ? question.options : [];
      const correctOptionTexts = options
        .filter((option: any) => correctAnswers.includes(option?.label))
        .map((option: any) => this.repairEncoding(String(option?.text || '')).trim())
        .filter(Boolean);

      return [
        prompt ? `Question ${index + 1}: ${prompt}` : '',
        correctOptionTexts.length ? `Reponse attendue: ${correctOptionTexts.join(', ')}` : '',
        explanation ? `Explication: ${explanation}` : '',
      ].filter(Boolean);
    });

    return this.compactWhitespace(lines.join(' '));
  }

  private async extractStudentUploadText(fileUrl: string) {
    const relativePath = fileUrl.replace(/^\/+/, '').replace(/\//g, '\\');
    const filePath = join(process.cwd(), relativePath);
    const extension = extname(filePath).toLowerCase();

    if (extension === '.pdf') {
      const buffer = await readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const parsedPdf = await parser.getText();
      const rawText = parsedPdf.text || '';
      await parser.destroy();
      return this.compactWhitespace(rawText);
    }

    if (extension === '.docx') {
      const parsedDoc = await mammoth.extractRawText({ path: filePath });
      return this.compactWhitespace(parsedDoc.value || '');
    }

    return '';
  }

  private async generatePortfolioCourseSummaryWithHuggingFace(input: {
    courseTitle: string;
    documentCount: number;
    quizCount: number;
    teacherName: string;
    level: StudentLevel;
    documentText: string;
    quizText: string;
  }) {
    const apiKey = this.configService.get<string>('HUGGINGFACE_API_KEY');
    const model =
      this.configService.get<string>('HUGGINGFACE_SUMMARY_MODEL') ||
      this.configService.get<string>('HUGGINGFACE_QUIZ_MODEL') ||
      'Qwen/Qwen2.5-7B-Instruct';
    const sourceText = this.compactWhitespace([
      input.documentText ? `DOCUMENTS DU COURS:\n${input.documentText}` : '',
      input.quizText ? `QUIZ DU COURS:\n${input.quizText}` : '',
    ].filter(Boolean).join('\n\n')).slice(0, 18000);

    if (!apiKey || sourceText.length < 80) {
      return null;
    }

    const prompt = [
      `Tu generes le resume automatique Portfolio du cours "${input.courseTitle}" pour EduVia.`,
      'Utilise uniquement le texte extrait des documents PDF/DOCX et les quiz fournis ci-dessous.',
      'Ignore totalement les videos, les titres generiques de ressources et les noms comme "Partie 1", "Video ajoutee", "Document de cours ajoute" si le contenu reel ne les explique pas.',
      'Produis un resume detaille, dynamique et specifique au contenu. Ne recopie pas un template statique.',
      'Retourne uniquement un JSON valide, sans markdown, avec cette forme exacte:',
      '{"overview":"...","notions":[{"notion":"...","explanation":"...","importance":"...","example":"..."}],"details":[{"title":"1. ...","explanation":"...","bullets":["...","..."]}],"nextActions":["...","...","..."],"revisionPlan":[{"step":1,"text":"..."}],"glossary":["terme: definition"]}',
      'Contraintes: 6 a 10 notions, 6 a 10 details, 3 actions, 5 etapes de revision, 6 a 10 entrees de glossaire. Langue francaise simple. Chaque notion doit venir du contenu document/quiz.',
      `Niveau etudiant: ${this.levelDisplayLabel(input.level)}.`,
      `Contenu a analyser:\n${sourceText}`,
    ].join('\n');

    try {
      const response = await this.fetchHuggingFaceChatWithTimeout({
        apiKey,
        model,
        timeoutMs: 12000,
        messages: [
          {
            role: 'system',
            content:
              'Tu es un assistant pedagogique. Tu reponds uniquement en JSON valide pour alimenter une interface Portfolio.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.25,
        maxTokens: 1800,
      });

      const details = await response.text();
      if (!response.ok) {
        this.logger.warn(
          `[PORTFOLIO SUMMARY HF] generation failed status=${response.status} details=${details.slice(0, 500)}`,
        );
        return null;
      }

      const payload = JSON.parse(details);
      const rawContent = String(payload?.choices?.[0]?.message?.content || '').trim();
      const jsonPayload = this.parsePortfolioSummaryJson(rawContent);
      return this.normalizePortfolioAiSummary(jsonPayload, input);
    } catch (error) {
      this.logger.warn(
        `[PORTFOLIO SUMMARY HF] fallback local apres erreur: ${String(error)}`,
      );
      return null;
    }
  }

  private parsePortfolioSummaryJson(rawContent: string) {
    const cleaned = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_error) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return null;
      }
      try {
        return JSON.parse(match[0]);
      } catch (_nestedError) {
        return null;
      }
    }
  }

  private normalizePortfolioAiSummary(payload: any, input: {
    courseTitle: string;
    documentCount: number;
    quizCount: number;
    teacherName: string;
    level: StudentLevel;
  }) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const notions = Array.isArray(payload.notions)
      ? payload.notions
          .map((item: any) => ({
            notion: this.cleanPortfolioNotion(String(item?.notion || '')),
            explanation: this.compactWhitespace(String(item?.explanation || '')).slice(0, 360),
            importance: this.compactWhitespace(String(item?.importance || '')).slice(0, 260),
            example: this.compactWhitespace(String(item?.example || '')).slice(0, 220),
          }))
          .filter((item: any) => item.notion && item.explanation)
          .slice(0, 10)
      : [];

    if (notions.length < 3) {
      return null;
    }

    const details = Array.isArray(payload.details)
      ? payload.details
          .map((item: any, index: number) => ({
            title: this.compactWhitespace(String(item?.title || `${index + 1}. ${notions[index]?.notion || input.courseTitle}`)).slice(0, 100),
            explanation: this.compactWhitespace(String(item?.explanation || notions[index]?.explanation || '')).slice(0, 520),
            bullets: Array.isArray(item?.bullets)
              ? item.bullets.map((bullet: any) => this.compactWhitespace(String(bullet || '')).slice(0, 220)).filter(Boolean).slice(0, 4)
              : [notions[index]?.importance, notions[index]?.example].filter(Boolean),
          }))
          .filter((item: any) => item.title && item.explanation)
          .slice(0, 10)
      : notions.map((item, index) => ({
          title: `${index + 1}. ${item.notion}`,
          explanation: item.explanation,
          bullets: [item.importance, item.example].filter(Boolean),
        }));

    const nextActions = this.normalizePortfolioStringList(payload.nextActions, [
      `Relire les documents du cours ${input.courseTitle} en ciblant les notions du tableau.`,
      'Refaire le quiz associe pour verifier la comprehension.',
      `Commencer la revision par ${notions[0]?.notion || input.courseTitle}.`,
    ], 3);

    const revisionPlan = Array.isArray(payload.revisionPlan)
      ? payload.revisionPlan
          .map((item: any, index: number) => ({
            step: Number(item?.step) || index + 1,
            text: this.compactWhitespace(String(item?.text || '')).slice(0, 220),
          }))
          .filter((item: any) => item.text)
          .slice(0, 5)
      : notions.slice(0, 5).map((item, index) => ({
          step: index + 1,
          text: `Revoir ${item.notion}, puis refaire une question du quiz liee a cette notion.`,
        }));

    const glossary = this.normalizePortfolioStringList(
      payload.glossary,
      notions.map(item => `${item.notion}: ${item.explanation}`),
      8,
    );

    return {
      courseTitle: input.courseTitle,
      level: this.levelDisplayLabel(input.level),
      resourceCount: input.documentCount,
      quizCount: input.quizCount,
      teacherName: input.teacherName,
      overview:
        this.compactWhitespace(String(payload.overview || '')).slice(0, 900) ||
        `Ce resume du cours ${input.courseTitle} est genere par Hugging Face a partir des documents et quiz du cours. Les videos ne sont pas incluses.`,
      notions,
      details,
      nextActions,
      revisionPlan,
      glossary,
      generatedAt: new Date().toISOString(),
      source: 'huggingface',
    };
  }

  private normalizePortfolioStringList(value: unknown, fallback: string[], limit: number) {
    const source = Array.isArray(value) ? value : fallback;
    const normalized = source
      .map(item => this.compactWhitespace(String(item || '')).slice(0, 260))
      .filter(Boolean)
      .slice(0, limit);

    return normalized.length > 0 ? normalized : fallback.slice(0, limit);
  }

  private async fetchHuggingFaceChatWithTimeout(input: {
    apiKey: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    timeoutMs: number;
    temperature: number;
    maxTokens: number;
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      return await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private findPortfolioRemediationContents(
    contents: StudentContent[],
    acquis: string,
    courseId: string,
    chapterId: string,
  ) {
    const weakKey = this.normalizeContentReference(acquis);
    const courseKey = this.normalizeContentReference(courseId);
    const chapterKey = this.normalizeContentReference(chapterId);
    const sourceItems = contents.filter(item => this.isDocument(item) || this.isQuiz(item));

    const directMatches = sourceItems.filter(item => {
      const haystack = [
        item.courseId,
        item.chapterId,
        item.partId,
        item.title,
        item.description,
      ].map(value => this.normalizeContentReference(value || '')).join(' ');

      return (
        (!!weakKey && haystack.includes(weakKey)) ||
        (!!courseKey && haystack.includes(courseKey)) ||
        (!!chapterKey && haystack.includes(chapterKey))
      );
    });

    return directMatches.length > 0 ? directMatches : sourceItems;
  }

  private async generatePortfolioRemediationQuestionsWithHuggingFace(input: {
    acquis: string;
    level: StudentLevel;
    documentText: string;
    quizText: string;
    courseId: string;
    chapterId: string;
  }) {
    const apiKey = this.configService.get<string>('HUGGINGFACE_API_KEY');
    const model =
      this.configService.get<string>('HUGGINGFACE_QUIZ_MODEL') ||
      'Qwen/Qwen2.5-7B-Instruct';
    const sourceText = this.compactWhitespace([
      input.documentText ? `DOCUMENTS:\n${input.documentText}` : '',
      input.quizText ? `QUIZ EXISTANTS:\n${input.quizText}` : '',
    ].filter(Boolean).join('\n\n')).slice(0, 14000);

    if (!apiKey || sourceText.length < 80) {
      return this.buildLocalPortfolioRemediationQuestionsFromSource(input.acquis, sourceText, 10);
    }

    const prompt = [
      `Genere un quiz de remediation EduVia sur l'acquis faible "${input.acquis}".`,
      'Utilise uniquement le contenu reel fourni: documents et quiz existants du parcours. Ignore les videos.',
      'Les 10 questions doivent etre liees a la matiere/acquis, sans repetition, et de bonne qualite pedagogique.',
      'Chaque question a 4 options A, B, C, D, une seule bonne reponse et une explication courte.',
      'Retourne uniquement ce JSON valide: {"questions":[{"id":"q1","prompt":"...","type":"single","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."}],"correctAnswers":["A"],"explanation":"..."}]}',
      `Niveau: ${this.levelDisplayLabel(input.level)}. Cours: ${input.courseId || 'parcours'}. Chapitre: ${input.chapterId || input.acquis}.`,
      `Contenu:\n${sourceText}`,
    ].join('\n');

    const response = await this.fetchHuggingFaceChatWithTimeout({
      apiKey,
      model,
      timeoutMs: 15000,
      messages: [
        {
          role: 'system',
          content:
            'Tu crees uniquement des quiz JSON valides, sans markdown, sans texte hors JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.35,
      maxTokens: 1800,
    });
    const details = await response.text();
    if (!response.ok) {
      throw new Error(`Hugging Face remediation failed ${response.status}: ${details.slice(0, 300)}`);
    }

    const payload = JSON.parse(details);
    const rawContent = String(payload?.choices?.[0]?.message?.content || '').trim();
    const parsed = this.parsePortfolioSummaryJson(rawContent);
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const normalized = this.normalizePortfolioRemediationQuestions(questions, input.acquis);
    return normalized.length >= 6
      ? normalized
      : this.buildLocalPortfolioRemediationQuestionsFromSource(input.acquis, sourceText, 10);
  }

  private normalizePortfolioRemediationQuestions(questions: any[], acquis: string) {
    const seen = new Set<string>();
    return questions
      .map((question, index) => ({
        id: String(question?.id || `portfolio-remediation-${index + 1}`),
        prompt: this.compactWhitespace(String(question?.prompt || '')).slice(0, 260),
        type: 'single',
        options: Array.isArray(question?.options)
          ? question.options.slice(0, 4).map((option: any, optionIndex: number) => ({
              label: String(option?.label || String.fromCharCode(65 + optionIndex)).slice(0, 1).toUpperCase(),
              text: this.compactWhitespace(String(option?.text || '')).slice(0, 180),
            }))
          : [],
        correctAnswers: Array.isArray(question?.correctAnswers)
          ? question.correctAnswers.slice(0, 1)
          : ['A'],
        explanation:
          this.compactWhitespace(String(question?.explanation || '')).slice(0, 240) ||
          `Question ciblee sur ${acquis}.`,
      }))
      .filter(question => question.prompt && question.options.length === 4)
      .filter(question => {
        const key = this.normalizeContentReference(question.prompt);
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }

  private buildPortfolioOverview(
    courseTitle: string,
    resourceCount: number,
    quizCount: number,
    notions: Array<{ notion: string }>,
    sourceText: string,
    hasReadableDocuments: boolean,
    hasQuizText: boolean,
  ) {
    const firstSentences = this.extractPortfolioSentences(sourceText, hasReadableDocuments || hasQuizText).slice(0, 4).join(' ');
    const notionsLabel = notions.map(item => item.notion).slice(0, 6).join(', ');

    return this.compactWhitespace(
      [
        hasReadableDocuments
          ? `Ce resume du cours ${courseTitle} est genere a partir du texte reel des documents publies par l'enseignant.`
          : `Ce resume du cours ${courseTitle} utilise les quiz existants et les informations disponibles car aucun texte lisible n'a ete extrait des documents.`,
        `EduVia a analyse ${resourceCount} document(s) et ${quizCount} quiz lie(s). Les videos ne sont pas incluses dans ce resume.`,
        firstSentences || `Les notions principales detectees sont ${notionsLabel || courseTitle}.`,
        `Lis d'abord la vue d'ensemble, puis utilise le tableau de synthese pour verifier chaque notion avec son usage concret.`,
      ].join(' '),
    );
  }

  private extractPortfolioNotions(
    contents: StudentContent[],
    documentText: string,
    quizText: string,
    metadataText: string,
  ) {
    const readableSourceText = this.compactWhitespace([documentText, quizText].filter(Boolean).join(' '));
    const textCandidates = this.extractPortfolioSentences(readableSourceText, true)
      .map(sentence => this.buildPortfolioNotionFromSentence(sentence))
      .filter((item): item is NonNullable<typeof item> => !!item);

    const uniqueTextCandidates = this.uniquePortfolioNotions([
      ...textCandidates,
      ...this.buildPortfolioConceptsFromText(readableSourceText),
    ]);

    if (readableSourceText) {
      return uniqueTextCandidates;
    }

    const metadataCandidates = this.extractPortfolioSentences(metadataText, false)
      .map(sentence => this.buildPortfolioNotionFromSentence(sentence))
      .filter((item): item is NonNullable<typeof item> => !!item);
    if (metadataCandidates.length >= 4) {
      return this.uniquePortfolioNotions(metadataCandidates);
    }

    const candidates = contents
      .filter(item => this.isDocument(item) || this.isQuiz(item))
      .flatMap(item => [
        item.title,
        item.description,
      ])
      .map(value => this.repairEncoding(String(value || '')).trim())
      .filter(value => value.length >= 3);
    const unique = [...new Set(candidates)]
      .map(value => value.replace(/\.(pdf|docx|mp4)$/i, '').trim())
      .filter(Boolean);

    return unique.map((value, index) => ({
      notion: this.compactWhitespace(value).slice(0, 70),
      explanation:
        index === 0
          ? `Elle donne la vue d'ensemble necessaire pour comprendre le reste du cours.`
          : `Elle relie les supports du cours a une competence concrete a maitriser.`,
      importance:
        `Savoir expliquer ${this.compactWhitespace(value).slice(0, 45)} et l'appliquer dans une situation concrete.`,
      example:
        `Associer ${this.compactWhitespace(value).slice(0, 45)} a un exercice, un document ou un quiz du cours.`,
    }));
  }

  private extractPortfolioSentences(sourceText: string, fromDocument = false) {
    const normalizedText = this.compactWhitespace(sourceText);
    const sentenceLikeParts = normalizedText
      .split(/(?<=[.!?])\s+|(?:\s{2,})|(?:\s[-•]\s)|(?:\n+)/)
      .flatMap(part => this.splitLongPortfolioSentence(part));

    return sentenceLikeParts
      .map(sentence => this.compactWhitespace(sentence))
      .filter(sentence => sentence.length >= (fromDocument ? 55 : 35) && sentence.length <= 360)
      .filter(sentence => !/^(document|quiz|titre|description|chapitre|partie)\s*:/i.test(sentence))
      .filter(sentence => !/\b(video ajoutee|document de cours ajoute|ressource)\b/i.test(sentence))
      .slice(0, 80);
  }

  private splitLongPortfolioSentence(value: string) {
    const text = this.compactWhitespace(value);
    if (text.length <= 360) {
      return [text];
    }

    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += 260) {
      chunks.push(text.slice(index, index + 320));
    }
    return chunks;
  }

  private buildPortfolioNotionFromSentence(sentence: string) {
    const cleanedSentence = this.cleanPortfolioSourceSentence(this.repairEncoding(sentence));
    const definitionMatch = cleanedSentence.match(
      /^(.{4,70}?)\s+(?:est|sont|designe|correspond a|consiste en|permet de|sert a)\s+(.{12,180})/i,
    );
    const rawNotion = definitionMatch?.[1] || this.extractPortfolioKeyword(cleanedSentence);
    const notion = this.cleanPortfolioNotion(rawNotion);
    if (!notion) {
      return null;
    }

    return {
      notion,
      explanation: cleanedSentence,
      importance: `Savoir expliquer ${notion} et l'appliquer dans une situation concrete du cours.`,
      example: this.compactWhitespace(definitionMatch?.[2] || cleanedSentence).slice(0, 180),
    };
  }

  private uniquePortfolioNotions(items: Array<{
    notion: string;
    explanation: string;
    importance: string;
    example: string;
  }>) {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = this.normalizeContentReference(item.notion);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private extractPortfolioKeywordLegacy(sentence: string) {
    const match = sentence.match(/\b[A-ZÀ-Ö][A-Za-zÀ-ÿ0-9'-]{3,}(?:\s+[A-Za-zÀ-ÿ0-9'-]{3,}){0,3}/);
    return match?.[0] || '';
  }

  private extractPortfolioKeyword(sentence: string) {
    const cleaned = this.cleanPortfolioSourceSentence(sentence);
    const codeLike = cleaned.match(/\b(?:langage\s+C|programme\s+C|fonction\s+main|chaine\s+de\s+caracteres|mots\s+reserves|bibliotheque\s+standard|compilateur\s+C|instruction\s+return|boucle\s+for|boucle\s+while|structure\s+d[' ]un\s+programme)\b/i);
    if (codeLike?.[0]) {
      return codeLike[0];
    }

    const importantPhrase = cleaned.match(
      /\b(?:algorithme|reseau|base de donnees|programmation|programme|fonction|variable|commentaire|compilateur|instruction|condition|boucle|tableau|structure|classe|objet|requete|serveur|client|composant|service|controller|endpoint|projet|complexite|graphe|quiz|question)\b(?:\s+(?:de|du|des|d'|en|a|avec|sans|pour|sur)\s+\w{3,}){0,2}/i,
    );
    if (importantPhrase?.[0]) {
      return importantPhrase[0];
    }

    const tokens = cleaned
      .split(/[^A-Za-z0-9]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 4)
      .filter(token => !this.isPortfolioStopword(token));

    return tokens.slice(0, 3).join(' ');
  }

  private cleanPortfolioSourceSentence(value: string) {
    return this.compactWhitespace(value)
      .replace(/^(?:question\s+\d+\s*:|reponse attendue\s*:|explication\s*:)\s*/i, '')
      .replace(/^(?:document|quiz)\s+[^.]{1,90}\.\s*/i, '')
      .replace(/\b(video ajoutee|ressource|document de cours ajoute)\b/gi, '')
      .trim();
  }

  private buildPortfolioConceptsFromText(sourceText: string) {
    const cleanedSource = this.cleanPortfolioSourceSentence(sourceText);
    if (!cleanedSource) {
      return [];
    }

    const sentences = this.extractPortfolioSentences(cleanedSource, true);
    const terms = this.extractPortfolioTerms(cleanedSource).slice(0, 12);

    return terms.map(term => {
      const matchingSentence =
        sentences.find(sentence => this.normalizeText(sentence).includes(this.normalizeText(term))) ||
        `Le cours explique ${term} a travers les documents et les questions de quiz disponibles.`;

      return {
        notion: this.cleanPortfolioNotion(term),
        explanation: this.compactWhitespace(matchingSentence).slice(0, 260),
        importance: `Savoir expliquer ${term} et l'utiliser dans les exercices ou quiz du cours.`,
        example: `Reprendre un passage du document ou une question du quiz qui utilise ${term}.`,
      };
    }).filter(item => item.notion);
  }

  private extractPortfolioTerms(sourceText: string) {
    const normalizedForPatterns = this.compactWhitespace(sourceText);
    const patternTerms = [
      'langage C',
      'programme C',
      'structure du programme',
      'fonction main',
      'chaine de caracteres',
      'mots reserves',
      'commentaire',
      'compilateur',
      'bibliotheque',
      'instruction return',
      'boucle for',
      'boucle while',
      'variable',
      'algorithme',
      'complexite',
      'base de donnees',
      'requete SQL',
      'reseau',
      'composant',
      'service',
      'controller',
      'Spring Boot',
      'Angular',
      'React',
      'Python',
      'Java',
    ].filter(term => new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i').test(normalizedForPatterns));

    const frequencies = new Map<string, number>();
    normalizedForPatterns
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 4)
      .filter(token => !this.isPortfolioStopword(token))
      .forEach(token => {
        const label = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
        frequencies.set(label, (frequencies.get(label) || 0) + 1);
      });

    const frequentTerms = Array.from(frequencies.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([term]) => term)
      .filter(term => !/^(partie|chapitre|document|video)$/i.test(term));

    return [...new Set([...patternTerms, ...frequentTerms])];
  }

  private isPortfolioStopword(value: string) {
    const normalized = this.normalizeText(value);
    return new Set([
      'avec',
      'ainsi',
      'alors',
      'apres',
      'avant',
      'avoir',
      'bien',
      'cette',
      'celui',
      'comme',
      'cours',
      'dans',
      'dont',
      'elle',
      'elles',
      'entre',
      'etre',
      'font',
      'leur',
      'leurs',
      'lors',
      'mais',
      'meme',
      'pour',
      'plus',
      'puis',
      'quand',
      'quel',
      'quelle',
      'reste',
      'sont',
      'sous',
      'tout',
      'tous',
      'tres',
      'utilise',
      'vers',
      'votre',
      'vous',
    ]).has(normalized);
  }

  private cleanPortfolioNotion(value: string) {
    const cleaned = this.compactWhitespace(value)
      .replace(/^(le|la|les|un|une|des|du|de|d')\s+/i, '')
      .replace(/[:;,.]+$/g, '')
      .slice(0, 70);
    if (cleaned.length < 3 || /^(titre|description|chapitre|partie)$/i.test(cleaned)) {
      return '';
    }
    return cleaned;
  }

  private buildPortfolioRemediationQuizContent(
    questions: any[],
    acquis: string,
    courseId: string,
    chapterId: string,
    level: StudentLevel,
    providerLabel: string,
  ) {
    const seenPrompts = new Set<string>();
    const normalizedQuestions = questions.map((question, index) => ({
      id: String(question?.id || `portfolio-remediation-${index + 1}`),
      prompt: this.repairEncoding(String(question?.prompt || '')).trim(),
      type: 'single',
      options: Array.isArray(question?.options)
        ? question.options.slice(0, 4)
        : [],
      correctAnswers: Array.isArray(question?.correctAnswers)
        ? question.correctAnswers.slice(0, 1)
        : ['A'],
      explanation:
        this.repairEncoding(String(question?.explanation || '')).trim() ||
        `Question ciblee sur ${acquis || 'un acquis faible'}.`,
    })).filter(question => question.prompt && question.options.length === 4)
      .filter(question => {
        const key = this.normalizeContentReference(question.prompt);
        if (!key || seenPrompts.has(key)) {
          return false;
        }
        seenPrompts.add(key);
        return true;
      })
      .slice(0, 10);

    return {
      _id: `portfolio-remediation-${Date.now()}`,
      type: 'quiz',
      title: `Renforcer l'acquis ${acquis || 'cible'}`,
      description: `Quiz cible genere par ${providerLabel} a partir du contenu reel du cours.`,
      courseId,
      chapterId,
      quizMode: 'portfolio-remediation',
      quizDifficulty: this.levelDisplayLabel(level),
      quizDurationMinutes: 10,
      quizAttempts: 5,
      quizPassingScore: 70,
      quizQuestionCount: normalizedQuestions.length,
      quizQuestions: normalizedQuestions,
      isActive: true,
      focusLabels: [acquis].filter(Boolean),
      focusKeywords: [acquis, courseId, chapterId].filter(Boolean),
      recommendationScore: 999,
      recommendationReason: `Quiz cible sur ${acquis || 'vos acquis faibles'} genere pour mettre a jour votre portfolio.`,
    };
  }

  private buildLocalPortfolioRemediationQuestions(acquis: string, count: number) {
    const label = this.repairEncoding(acquis || 'la notion cible').trim();
    return Array.from({ length: count }, (_value, index) => ({
      id: `local-portfolio-remediation-${index + 1}`,
      prompt:
        index % 2 === 0
          ? `Quelle action aide a renforcer ${label} ?`
          : `Comment verifier une vraie comprehension de ${label} ?`,
      type: 'single',
      options: [
        {
          label: 'A',
          text:
            index % 2 === 0
              ? `Relire le support qui explique directement ${label}, puis refaire un exercice cible`
              : `Expliquer ${label} avec ses propres mots puis l'appliquer`,
        },
        { label: 'B', text: 'Repondre au hasard sans consulter le feedback' },
        { label: 'C', text: 'Ignorer les erreurs precedentes' },
        { label: 'D', text: 'Changer uniquement le titre du chapitre' },
      ],
      correctAnswers: ['A'],
      explanation: `Cette question cible ${label} d'apres les acquis faibles detectes.`,
    }));
  }

  private buildLocalPortfolioRemediationQuestionsFromSource(acquis: string, sourceText: string, count: number) {
    const label = this.repairEncoding(acquis || 'la notion cible').trim();
    const notions = this.extractPortfolioNotions([], sourceText, '', '')
      .map(item => item.notion)
      .filter(Boolean)
      .filter(item => this.normalizeContentReference(item) !== this.normalizeContentReference(label))
      .slice(0, Math.max(3, count));
    const targets = [label, ...notions].filter(Boolean);

    return Array.from({ length: count }, (_value, index) => {
      const target = targets[index % targets.length] || label;
      const variants = [
        {
          prompt: `Quelle affirmation explique correctement ${target} dans ce cours ?`,
          correct: `Une notion a relier au contenu du cours et a appliquer dans un exercice`,
        },
        {
          prompt: `Quelle action permet de consolider ${target} apres une erreur ?`,
          correct: `Revoir le passage du document puis refaire une question ciblee`,
        },
        {
          prompt: `Comment verifier que ${target} est vraiment compris ?`,
          correct: `L'expliquer avec ses propres mots puis l'utiliser dans un exemple`,
        },
        {
          prompt: `Pourquoi ${target} est important pour progresser dans la matiere ?`,
          correct: `Parce qu'il sert a resoudre les activites et quiz lies au cours`,
        },
      ];
      const variant = variants[index % variants.length];

      return {
        id: `local-portfolio-remediation-${index + 1}`,
        prompt: variant.prompt,
        type: 'single',
        options: [
          { label: 'A', text: variant.correct },
          { label: 'B', text: 'Repondre au hasard sans lire le document' },
          { label: 'C', text: 'Ignorer le feedback des quiz precedents' },
          { label: 'D', text: 'Changer uniquement le nom du chapitre' },
        ],
        correctAnswers: ['A'],
        explanation: `Cette question cible ${target} a partir du contenu disponible dans le parcours.`,
      };
    });
  }

  private normalizeLevel(level?: string): StudentLevel {
    const normalized = (level || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (normalized.startsWith('int') || normalized.includes('moyen')) {
      return 'intermediaire';
    }

    if (normalized.startsWith('ava') || normalized.includes('difficile')) {
      return 'avance';
    }

    return 'debutant';
  }

  private normalizeProgressStatus(status?: string): ProgressStatus {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus === 'not_started') return 'not_started';
    if (normalizedStatus === 'in_progress') return 'in_progress';
    if (normalizedStatus === 'passed') return 'passed';
    return 'completed';
  }

  private toPlainContent(item: any): StudentContent {
    const plainContent: StudentContent = {
      _id: String(item._id),
      type: this.repairEncoding(`${item.type || ''}`),
      title: this.repairEncoding(`${item.title || ''}`),
      description: this.repairEncoding(`${item.description || ''}`),
      courseId: this.repairEncoding(`${item.courseId || ''}`),
      chapterId: this.repairEncoding(`${item.chapterId || ''}`),
      partId: this.repairEncoding(`${item.partId || ''}`),
      fileUrl: item.fileUrl,
      fileName: this.repairEncoding(`${item.fileName || ''}`),
      source: this.repairEncoding(`${item.source || ''}`),
      teacherName: this.repairEncoding(`${item.teacherName || ''}`),
      teacherEmail: this.repairEncoding(`${item.teacherEmail || ''}`),
      teacherAvatarDataUrl: item.teacherAvatarDataUrl,
      visibleToAllClasses: item.visibleToAllClasses === true,
      visibleToClasses: Array.isArray(item.visibleToClasses)
        ? item.visibleToClasses
            .map((value: unknown) => this.normalizeClassName(`${value || ''}`))
            .filter(Boolean)
        : [],
      dueDate: this.serializeDate(item.dueDate),
      quizMode: this.repairEncoding(`${item.quizMode || ''}`),
      quizDifficulty: this.repairEncoding(`${item.quizDifficulty || ''}`),
      quizAttempts: item.quizAttempts,
      quizPassingScore: item.quizPassingScore,
      quizQuestionCount: item.quizQuestionCount,
      quizQuestions: this.normalizeQuizQuestions(item.quizQuestions),
      dueDateTime: this.serializeDate(item.dueDateTime),
      quizDurationMinutes: item.quizDurationMinutes,
      isActive: item.isActive,
    };

    if (this.isQuiz(plainContent)) {
      plainContent.quizAvailability = this.buildQuizAvailability(plainContent);
    }

    return plainContent;
  }

  private normalizeQuizQuestions(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    return value.map(question => ({
      ...(question as Record<string, unknown>),
      id: this.repairEncoding(`${(question as any)?.id || ''}`),
      prompt: this.repairEncoding(`${(question as any)?.prompt || ''}`),
      explanation: this.repairEncoding(`${(question as any)?.explanation || ''}`),
      correctAnswers: Array.isArray((question as any)?.correctAnswers)
        ? (question as any).correctAnswers.map((answer: unknown) =>
            this.repairEncoding(`${answer || ''}`),
          )
        : [],
      options: Array.isArray((question as any)?.options)
        ? (question as any).options.map((option: any) => ({
            ...option,
            label: this.repairEncoding(`${option?.label || ''}`),
            text: this.repairEncoding(`${option?.text || ''}`),
          }))
        : [],
    }));
  }

  private repairEncoding(value: string): string {
    if (!value) {
      return value;
    }

    let repaired = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

    for (let index = 0; index < 3; index += 1) {
      if (!/[ÃÂâ�]/.test(repaired) && !repaired.includes('�')) {
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
      .replace(/Ã©/g, 'é')
      .replace(/Ã¨/g, 'è')
      .replace(/Ãª/g, 'ê')
      .replace(/Ã /g, 'à')
      .replace(/Ã§/g, 'ç')
      .replace(/Ã¹/g, 'ù')
      .replace(/Ã´/g, 'ô')
      .replace(/Ã«/g, 'ë')
      .replace(/Ã¯/g, 'ï')
      .replace(/�/g, "'")
      .trim();
  }

  private buildQuizAvailability(item: StudentContent) {
    const effectiveDueDateTime = this.resolveQuizDueDateTime(item);
    const durationMinutes = this.normalizeDuration(item.quizDurationMinutes);

    if (!effectiveDueDateTime) {
      return {
        status: 'open' as const,
        reason: 'available' as const,
        quizDurationMinutes: durationMinutes,
      };
    }

    const now = Date.now();
    const remainingMs = effectiveDueDateTime.getTime() - now;

    if (remainingMs <= 0) {
      return {
        status: 'closed' as const,
        reason: 'deadline_passed' as const,
        dueDateTime: effectiveDueDateTime.toISOString(),
        dueDate: item.dueDate,
        remainingMinutes: 0,
        remainingSeconds: 0,
        quizDurationMinutes: durationMinutes,
      };
    }

    return {
      status: 'open' as const,
      reason: 'available' as const,
      dueDateTime: effectiveDueDateTime.toISOString(),
      dueDate: item.dueDate,
      remainingMinutes: Math.ceil(remainingMs / 60000),
      remainingSeconds: Math.ceil(remainingMs / 1000),
      quizDurationMinutes: durationMinutes,
    };
  }

  private resolveQuizDueDateTime(item: StudentContent) {
    const candidate = item.dueDateTime ?? item.dueDate;
    if (!candidate) {
      return undefined;
    }

    const parsedDate = new Date(candidate);
    if (Number.isNaN(parsedDate.getTime())) {
      return undefined;
    }

    return parsedDate;
  }

  private normalizeDuration(duration?: number) {
    if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) {
      return undefined;
    }

    return duration;
  }

  private serializeDate(value: unknown) {
    if (!value) {
      return undefined;
    }

    const parsedDate = new Date(value as string | number | Date);
    if (Number.isNaN(parsedDate.getTime())) {
      return undefined;
    }

    return parsedDate.toISOString();
  }

  private isCourse(item: StudentContent) {
    return (item.type || '').toLowerCase() === 'course';
  }

  private isChapter(item: StudentContent) {
    return (item.type || '').toLowerCase() === 'chapter';
  }

  private isPart(item: StudentContent) {
    return (item.type || '').toLowerCase() === 'part';
  }

  private isDocument(item: StudentContent) {
    return (item.type || '').toLowerCase() === 'document';
  }

  private isVideo(item: StudentContent) {
    return (item.type || '').toLowerCase() === 'video';
  }

  private isQuiz(item: StudentContent) {
    return (item.type || '').toLowerCase() === 'quiz';
  }
}
