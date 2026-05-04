import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './user.schema';
import { KeycloakService } from '../auth/keycloak.service';
import { EmailService } from '../email/email.service';
import { Content, ContentDocument } from '../content/content.schema';
import { StudentService } from '../student/student.service';
import {
  FACE_ID_DUPLICATE_THRESHOLD,
  normalizeFaceIdNumber,
} from '../auth/face-id.constants';

const DEFAULT_CLASSES = ['1A1', '1A2', '1A3', '1A4', '1A5'];

type TeachingAssignmentInput = {
  subject?: string;
  classes?: string[];
};

type TeachingAssignment = {
  subject: string;
  classes: string[];
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Content.name) private contentModel: Model<ContentDocument>,
    private keycloakService: KeycloakService,
    private emailService: EmailService,
    private studentService: StudentService,
    private configService: ConfigService,
  ) {}

  private normalizeClassName(value?: string | null) {
    return (value || '').trim().toLowerCase();
  }

  private normalizeReference(value?: string | null) {
    return (value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  private normalizeStudentLevel(value?: string | null): 'debutant' | 'intermediaire' | 'avance' {
    const normalized = String(value || '')
      .trim()
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
      const subject = String(assignment?.subject || '').trim();
      const subjectKey = this.normalizeReference(subject);
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
        const subject = String(subjectValue || '').trim();
        const subjectKey = this.normalizeReference(subject);
        if (!subject || !subjectKey || assignmentMap.has(subjectKey)) {
          return;
        }

        assignmentMap.set(subjectKey, {
          subject,
          classes: fallbackClasses,
        });
      },
    );

    return Array.from(assignmentMap.values());
  }

  private isCourseAssignmentVisibleForClass(
    assignment: { classes: string[] },
    className?: string,
  ) {
    const normalizedClassName = this.normalizeClassName(className);
    if (!normalizedClassName) {
      return true;
    }

    return assignment.classes
      .map((value) => this.normalizeClassName(value))
      .includes(normalizedClassName);
  }

  private filterTeacherContentsByCurrentCourses(
    teacher: any,
    contents: any[],
    className?: string,
  ) {
    const allowedCourseKeys = new Set(
      this.getTeacherCourseAssignments(teacher)
        .filter((assignment) =>
          this.isCourseAssignmentVisibleForClass(assignment, className),
        )
        .map((assignment) => this.normalizeReference(assignment.subject))
        .filter(Boolean),
    );

    if (allowedCourseKeys.size === 0) {
      return [];
    }

    const allowedCourseAliases = new Set(allowedCourseKeys);
    contents
      .filter((content) => String(content?.type || '').toLowerCase() === 'course')
      .forEach((course) => {
        const matchingCourseKey = [
          course?.title,
          course?.courseId,
          course?._id,
        ]
          .map((value) => this.normalizeReference(String(value || '')))
          .find((value) => allowedCourseKeys.has(value));

        if (!matchingCourseKey) {
          return;
        }

        [course?._id, course?.courseId, course?.title]
          .map((value) => this.normalizeReference(String(value || '')))
          .filter(Boolean)
          .forEach((value) => allowedCourseAliases.add(value));
      });

    return contents.filter((content) => {
      const candidateKeys = [
        content?.courseId,
        content?.title,
        content?._id,
      ]
        .map((value) => this.normalizeReference(String(value || '')))
        .filter(Boolean);

      return candidateKeys.some((courseKey) =>
        allowedCourseAliases.has(courseKey),
      );
    });
  }

  private hammingDistance(left: string, right: string) {
    if (left.length !== right.length) {
      return Number.POSITIVE_INFINITY;
    }

    return Array.from(left).reduce(
      (distance, bit, index) => distance + (bit === right[index] ? 0 : 1),
      0,
    );
  }

  private normalizeReminderClassName(value?: string | null) {
    return (value || '').trim().toUpperCase();
  }

  private normalizeReminderLevel(level?: string | null) {
    const normalized = String(level || '')
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

  private referencesMatch(
    sourceValue?: string | null,
    ...candidateValues: Array<string | null | undefined>
  ) {
    const normalizedSource = this.normalizeReference(sourceValue);
    if (!normalizedSource) {
      return false;
    }

    return candidateValues.some(
      (value) => this.normalizeReference(value) === normalizedSource,
    );
  }

  private isVisibleToClass(content: any, normalizedClassName: string) {
    const visibleClasses = Array.isArray(content?.visibleToClasses)
      ? content.visibleToClasses
          .map((value: string) => this.normalizeClassName(value))
          .filter(Boolean)
      : [];

    if (content?.visibleToAllClasses) {
      return true;
    }

    if (!normalizedClassName) {
      return visibleClasses.length === 0;
    }

    return (
      visibleClasses.length === 0 ||
      visibleClasses.includes(normalizedClassName)
    );
  }

  private buildProgressMetricsForStudent(student: any, contents: any[]) {
    const normalizedClassName = this.normalizeClassName(student?.className);
    const studentLevel = this.normalizeStudentLevel(student?.profileData?.level);
    const activeContents = contents.filter(
      (content) => content?.isActive !== false,
    );
    const visibleQuizIds = this.resolveProgressVisibleQuizIds(
      contents,
      studentLevel,
      normalizedClassName,
    );
    const teacherCourseKeys = new Set(
      activeContents
        .filter(
          (content) => String(content?.type || '').toLowerCase() === 'course',
        )
        .filter((content) =>
          this.isVisibleToClass(content, normalizedClassName),
        )
        .flatMap((content) => [
          this.normalizeReference(String(content?._id || '')),
          this.normalizeReference(String(content?.courseId || '')),
          this.normalizeReference(String(content?.title || '')),
        ])
        .filter(Boolean),
    );

    const visibleTrackableMaterials = contents.filter((content) =>
      this.isProgressTrackableContent(
        content,
        normalizedClassName,
        studentLevel,
        visibleQuizIds,
      ),
    );
    const trackableMaterials = visibleTrackableMaterials.filter((content) => {
      if (teacherCourseKeys.size === 0) {
        return true;
      }

      const courseKey = this.normalizeReference(String(content?.courseId || ''));
      return !!courseKey && teacherCourseKeys.has(courseKey);
    });
    const courseIds = [
      ...new Set(
        trackableMaterials
          .map((content) => this.normalizeReference(String(content?.courseId || '')))
          .filter(Boolean),
      ),
    ];

    const progressEntries = Array.isArray(student?.learningProgress)
      ? student.learningProgress
      : [];
    const rawCompletedMaterialIds = new Set<string>(
      progressEntries
        .filter((entry: any) => {
          const status = String(entry?.status || '').toLowerCase();
          return status === 'completed' || status === 'passed';
        })
        .map((entry: any) => String(entry?.contentId || '').trim())
        .filter(Boolean),
    );
    const completedMaterialIds = this.buildEffectiveCompletedMaterialIds(
      trackableMaterials,
      rawCompletedMaterialIds,
    );

    const completedCourseCount = courseIds.filter((courseId) => {
      const courseMaterials = trackableMaterials.filter(
        (content) => this.normalizeReference(String(content?.courseId || '')) === courseId,
      );

      return (
        courseMaterials.length > 0 &&
        courseMaterials.every((content) =>
          completedMaterialIds.has(String(content?._id || '').trim()),
        )
      );
    }).length;

    const completedMaterialCount = trackableMaterials.filter((content) =>
      completedMaterialIds.has(String(content?._id || '').trim()),
    ).length;
    const pendingScopeMap = trackableMaterials.reduce((scopes, content) => {
        const contentId = String(content?._id || '').trim();
        if (!contentId || completedMaterialIds.has(contentId)) {
          return scopes;
        }

        const chapterLabel = String(content?.chapterId || '').trim();
        const partLabel = String(content?.partId || '').trim();
        const scopeLabel = partLabel
          ? chapterLabel
            ? `${chapterLabel} / ${partLabel}`
            : partLabel
          : chapterLabel;

        if (scopeLabel) {
          const scopeKey = this.normalizeReference(scopeLabel);
          if (scopeKey && !scopes.has(scopeKey)) {
            scopes.set(scopeKey, scopeLabel);
          }
        }

        return scopes;
      }, new Map<string, string>());
    const pendingContentScopes = Array.from(pendingScopeMap.values()).sort((left: string, right: string) =>
      left.localeCompare(right, 'fr', { numeric: true }),
    );
    const totalUnits = trackableMaterials.length + courseIds.length;
    const completedUnits = completedMaterialCount + completedCourseCount;
    const globalProgress =
      totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;

    return {
      globalProgress,
      progressDetails: {
        completedMaterials: completedMaterialCount,
        totalMaterials: trackableMaterials.length,
        completedCourses: completedCourseCount,
        totalCourses: courseIds.length,
        completedUnits,
        totalUnits,
      },
      pendingContentScopes,
    };
  }

  private buildLevelProgressMetricsForStudent(
    student: any,
    contents: any[],
    dashboard?: any,
  ) {
    const contentQuizMap = new Map<string, any>();
    const isQuizWithQuestions = (quiz: any) => {
      const quizId = String(quiz?._id || quiz?.id || '').trim();
      if (!quizId) {
        return false;
      }

      const type = String(quiz?.type || quiz?.contentType || '').trim().toLowerCase();
      const questions = Array.isArray(quiz?.quizQuestions)
        ? quiz.quizQuestions
        : [];
      const questionCount = Number(quiz?.quizQuestionCount || questions.length || 0);

      return type === 'quiz' && questionCount > 0;
    };
    const addContentQuiz = (quiz: any) => {
      if (isQuizWithQuestions(quiz)) {
        contentQuizMap.set(String(quiz?._id || quiz?.id || '').trim(), quiz);
      }
    };

    contents.forEach(addContentQuiz);
    (Array.isArray(dashboard?.quizzes) ? dashboard.quizzes : []).forEach(addContentQuiz);

    const recommendationSource =
      Array.isArray(dashboard?.recommendationAnalysis?.recommendedContents)
        && dashboard.recommendationAnalysis.recommendedContents.length > 0
        ? dashboard.recommendationAnalysis.recommendedContents
        : Array.isArray(dashboard?.recommendations)
          ? dashboard.recommendations
          : Array.isArray(dashboard?.contents)
            ? dashboard.contents
            : [];
    const recommendationDisplayItems = recommendationSource
      .filter((item: any) => {
        const type = String(item?.type || item?.contentType || '').trim().toLowerCase();
        if (type === 'quiz') {
          return isQuizWithQuestions(item);
        }

        return ['document', 'video'].includes(type);
      })
      .slice(0, 6);
    const recommendationQuizItems = recommendationDisplayItems.filter(isQuizWithQuestions);

    const scorableQuizIds = new Set<string>([
      ...Array.from(contentQuizMap.keys()),
      ...recommendationQuizItems
        .map((quiz) => String(quiz?._id || quiz?.id || '').trim())
        .filter(Boolean),
    ]);

    const progressEntries = Array.isArray(student?.learningProgress)
      ? student.learningProgress
      : [];
    const progressByQuizId = new Map<string, any>();

    progressEntries.forEach((entry: any) => {
      const quizId = String(entry?.contentId || '').trim();
      if (!quizId || !scorableQuizIds.has(quizId)) {
        return;
      }

      const status = String(entry?.status || '').trim().toLowerCase();
      const score = Number(entry?.score);
      if (!['completed', 'passed'].includes(status) && !Number.isFinite(score)) {
        return;
      }

      progressByQuizId.set(quizId, entry);
    });

    const totalQuizzes = contentQuizMap.size + recommendationQuizItems.length;
    const scoredQuizzes = Array.from(progressByQuizId.values()).map((entry) => {
      const score = Number(entry?.score);
      if (Number.isFinite(score)) {
        return Math.max(0, Math.min(100, Math.round(score)));
      }

      return String(entry?.status || '').trim().toLowerCase() === 'passed' ? 100 : 0;
    });
    const attemptedQuizzes = scoredQuizzes.length;
    const scoreSum = scoredQuizzes.reduce((sum, score) => sum + score, 0);
    const levelProgress = totalQuizzes > 0 ? Math.round(scoreSum / totalQuizzes) : 0;

    return {
      levelProgress,
      quizProgressDetails: {
        attemptedQuizzes,
        totalQuizzes,
        averageAttemptScore:
          attemptedQuizzes > 0 ? Math.round(scoreSum / attemptedQuizzes) : 0,
      },
    };
  }

  private buildEffectiveCompletedMaterialIds(
    materials: any[],
    rawCompletedMaterialIds: Set<string>,
  ) {
    const effectiveCompletedIds = new Set<string>();
    const materialsByCourse = new Map<string, any[]>();

    materials.forEach((material) => {
      const courseKey = this.normalizeReference(String(material?.courseId || ''));
      const bucket = materialsByCourse.get(courseKey) || [];
      bucket.push(material);
      materialsByCourse.set(courseKey, bucket);
    });

    materialsByCourse.forEach((courseMaterials) => {
      let hasIncompleteRequiredContent = false;
      courseMaterials
        .sort((left, right) => this.compareProgressMaterialOrder(left, right))
        .forEach((material) => {
          const contentId = String(material?._id || '').trim();
          const type = String(material?.type || '').trim().toLowerCase();
          const isCompleted = contentId && rawCompletedMaterialIds.has(contentId);

          if (type !== 'quiz') {
            if (isCompleted) {
              effectiveCompletedIds.add(contentId);
            } else {
              hasIncompleteRequiredContent = true;
            }
            return;
          }

          if (isCompleted && !hasIncompleteRequiredContent) {
            effectiveCompletedIds.add(contentId);
          }
        });
    });

    return effectiveCompletedIds;
  }

  private compareProgressMaterialOrder(left: any, right: any) {
    const leftChapter = this.extractProgressSequenceNumber(left?.chapterId);
    const rightChapter = this.extractProgressSequenceNumber(right?.chapterId);
    if (leftChapter !== rightChapter) {
      return leftChapter - rightChapter;
    }

    const leftPart = this.extractProgressSequenceNumber(left?.partId);
    const rightPart = this.extractProgressSequenceNumber(right?.partId);
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }

    const leftType = this.progressMaterialTypeOrder(left);
    const rightType = this.progressMaterialTypeOrder(right);
    if (leftType !== rightType) {
      return leftType - rightType;
    }

    return String(left?.title || '').localeCompare(String(right?.title || ''), 'fr');
  }

  private extractProgressSequenceNumber(value: unknown) {
    const match = String(value || '').match(/(\d+)/);
    return match?.[1] ? Number(match[1]) : 9999;
  }

  private progressMaterialTypeOrder(material: any) {
    const type = String(material?.type || '').trim().toLowerCase();
    if (type === 'document') return 1;
    if (type === 'video') return 2;
    if (type === 'quiz') return 3;
    return 9;
  }

  private isProgressTrackableContent(
    content: any,
    normalizedClassName: string,
    studentLevel: 'debutant' | 'intermediaire' | 'avance',
    visibleQuizIds: Set<string>,
  ) {
    const type = String(content?.type || '').toLowerCase();
    if (!['document', 'video', 'quiz'].includes(type)) {
      return false;
    }

    if (!this.isVisibleToClass(content, normalizedClassName)) {
      return false;
    }

    if (type !== 'quiz') {
      return content?.isActive !== false;
    }

    return visibleQuizIds.has(String(content?._id || '').trim());
  }

  private resolveProgressVisibleQuizIds(
    contents: any[],
    studentLevel: 'debutant' | 'intermediaire' | 'avance',
    normalizedClassName: string,
  ) {
    const selectedQuizByScope = new Map<string, any>();

    contents
      .filter((content) => String(content?.type || '').toLowerCase() === 'quiz')
      .filter((content) => this.isVisibleToClass(content, normalizedClassName))
      .filter((content) => {
        const questions = Array.isArray(content?.quizQuestions) ? content.quizQuestions : [];
        return questions.length > 0 && this.normalizeStudentLevel(content?.quizDifficulty) === studentLevel;
      })
      .forEach((content) => {
        const scopeKey = [
          String(content?.teacherEmail || '').trim().toLowerCase(),
          this.normalizeReference(content?.courseId),
          this.normalizeReference(content?.chapterId),
          this.normalizeReference(content?.partId),
          this.normalizeStudentLevel(content?.quizDifficulty),
        ].join('|');
        const current = selectedQuizByScope.get(scopeKey);

        if (!current || this.shouldPreferProgressQuiz(content, current)) {
          selectedQuizByScope.set(scopeKey, content);
        }
      });

    return new Set(
      Array.from(selectedQuizByScope.values())
        .map((content) => String(content?._id || '').trim())
        .filter(Boolean),
    );
  }

  private shouldPreferProgressQuiz(candidate: any, current: any) {
    const candidateActive = candidate?.isActive !== false;
    const currentActive = current?.isActive !== false;

    if (candidateActive !== currentActive) {
      return candidateActive;
    }

    return String(candidate?._id || '') > String(current?._id || '');
  }

  private normalizeClassList(
    values: Array<string | null | undefined>,
  ): string[] {
    return [
      ...new Set(values.map((value) => value?.trim() || '').filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  private resolveTeachingAssignments(
    assignedClasses: string[],
    teachingSubjects: string[] = [],
    teachingAssignments: TeachingAssignmentInput[] = [],
  ): TeachingAssignment[] {
    const normalizedAssignedClasses = this.normalizeClassList(
      assignedClasses || [],
    );
    const classLookup = new Map(
      normalizedAssignedClasses.map((className) => [
        className.toLowerCase(),
        className,
      ]),
    );
    const assignmentMap = new Map<string, TeachingAssignment>();
    const hasDetailedAssignments = teachingAssignments.some(
      (assignment) => !!assignment?.subject?.trim(),
    );

    const addAssignment = (subjectValue?: string, classValues?: string[]) => {
      const subject = (subjectValue || '').trim();
      if (!subject) {
        return;
      }

      const requestedClasses = this.normalizeClassList(classValues || []);
      const classes =
        requestedClasses.length > 0
          ? requestedClasses
              .map((className) => classLookup.get(className.toLowerCase()))
              .filter((className): className is string => !!className)
          : normalizedAssignedClasses;

      if (classes.length === 0) {
        return;
      }

      const subjectKey = subject.toLowerCase();
      const existing = assignmentMap.get(subjectKey);
      if (existing) {
        existing.classes = this.normalizeClassList([
          ...existing.classes,
          ...classes,
        ]);
        return;
      }

      assignmentMap.set(subjectKey, {
        subject,
        classes: this.normalizeClassList(classes),
      });
    };

    if (hasDetailedAssignments) {
      teachingAssignments.forEach((assignment) =>
        addAssignment(assignment?.subject, assignment?.classes),
      );
    } else {
      teachingSubjects.forEach((subject) =>
        addAssignment(subject, normalizedAssignedClasses),
      );
    }

    return Array.from(assignmentMap.values()).sort((left, right) =>
      left.subject.localeCompare(right.subject, 'fr'),
    );
  }

  private async normalizeUserRoleFields(user: User): Promise<User> {
    let shouldPersist = false;

    if (user.role === 'teacher') {
      const normalizedAssignedClasses = this.normalizeClassList([
        ...(user.assignedClasses || []),
        user.className,
      ]);
      const normalizedTeachingSubjects = this.normalizeClassList(
        this.resolveTeachingAssignments(
          normalizedAssignedClasses,
          (user as any).teachingSubjects || [],
          (user as any).teachingAssignments || [],
        ).map((assignment) => assignment.subject),
      );
      const normalizedTeachingAssignments = this.resolveTeachingAssignments(
        normalizedAssignedClasses,
        normalizedTeachingSubjects,
        (user as any).teachingAssignments || [],
      );

      if ((user.className || null) !== null) {
        user.className = null;
        shouldPersist = true;
      }

      if (
        JSON.stringify(user.assignedClasses || []) !==
        JSON.stringify(normalizedAssignedClasses)
      ) {
        user.assignedClasses = normalizedAssignedClasses;
        shouldPersist = true;
      }

      if (
        JSON.stringify((user as any).teachingSubjects || []) !==
        JSON.stringify(normalizedTeachingSubjects)
      ) {
        (user as any).teachingSubjects = normalizedTeachingSubjects;
        shouldPersist = true;
      }

      if (
        JSON.stringify((user as any).teachingAssignments || []) !==
        JSON.stringify(normalizedTeachingAssignments)
      ) {
        (user as any).teachingAssignments = normalizedTeachingAssignments;
        shouldPersist = true;
      }
    }

    if (user.role === 'student') {
      const normalizedAssignedClasses = this.normalizeClassList(
        user.assignedClasses || [],
      );
      const normalizedClassName = (user.className || '').trim();
      const resolvedClassName =
        normalizedClassName || normalizedAssignedClasses[0] || null;

      if ((user.className || null) !== resolvedClassName) {
        user.className = resolvedClassName;
        shouldPersist = true;
      }

      if ((user.assignedClasses || []).length > 0) {
        user.assignedClasses = [];
        shouldPersist = true;
      }

      if (((user as any).teachingSubjects || []).length > 0) {
        (user as any).teachingSubjects = [];
        shouldPersist = true;
      }

      if (((user as any).teachingAssignments || []).length > 0) {
        (user as any).teachingAssignments = [];
        shouldPersist = true;
      }
    }

    if (shouldPersist) {
      await user.save();
    }

    return user;
  }

  private mapUserForResponse(user: User) {
    const normalizedAssignedClasses = this.normalizeClassList(
      user.assignedClasses || [],
    );
    const plainUser =
      typeof (user as any).toObject === 'function'
        ? (user as any).toObject()
        : user;
    const primaryClassName =
      user.role === 'teacher'
        ? normalizedAssignedClasses.join(', ')
        : (user.className || '').trim();

    return {
      ...plainUser,
      className: primaryClassName,
      assignedClasses: normalizedAssignedClasses,
      teachingSubjects: this.normalizeClassList(
        this.resolveTeachingAssignments(
          normalizedAssignedClasses,
          (user as any).teachingSubjects || [],
          (user as any).teachingAssignments || [],
        ).map((assignment) => assignment.subject),
      ),
      teachingAssignments: this.resolveTeachingAssignments(
        normalizedAssignedClasses,
        (user as any).teachingSubjects || [],
        (user as any).teachingAssignments || [],
      ),
    };
  }

  async getUserByKeycloakId(keycloakId: string): Promise<User> {
    const user = await this.userModel.findOne({ keycloakId });
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    return this.normalizeUserRoleFields(user);
  }

  async getAllUsers(): Promise<any[]> {
    const users = await this.userModel.find();
    const normalizedUsers = await Promise.all(
      users.map((user) => this.normalizeUserRoleFields(user)),
    );

    return normalizedUsers.map((user) => this.mapUserForResponse(user));
  }

  async getDistinctStudentClasses(): Promise<string[]> {
    const classes = await this.userModel.distinct('className', {
      role: 'student',
      className: { $nin: [null, ''] },
    });

    const normalizedClasses = classes
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => !!value);

    return [...new Set([...DEFAULT_CLASSES, ...normalizedClasses])].sort(
      (a, b) => a.localeCompare(b, 'fr'),
    );
  }

  async getTeacherCourseMembers(
    keycloakId: string,
    selectedClassName?: string,
  ) {
    const existingTeacher = await this.userModel.findOne({ keycloakId });
    const teacher = existingTeacher
      ? await this.normalizeUserRoleFields(existingTeacher)
      : null;

    if (!teacher) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (teacher.role !== 'teacher') {
      throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
    }

    const assignedClasses = this.normalizeClassList([
      ...(teacher.assignedClasses || []),
      teacher.className,
    ]);

    const normalizedSelectedClass = (selectedClassName || '').trim();
    const filteredClasses = normalizedSelectedClass
      ? assignedClasses.filter(
          (className) => className === normalizedSelectedClass,
        )
      : assignedClasses;

    const studentQuery =
      filteredClasses.length > 0
        ? {
            role: 'student',
            className: { $in: filteredClasses },
          }
        : {
            role: 'student',
            _id: { $in: [] },
          };

    const [students, rawContents] = await Promise.all([
      this.userModel
        .find(studentQuery)
        .sort({ firstName: 1, lastName: 1, email: 1 })
        .lean()
        .exec(),
      this.contentModel
        .find({
          teacherEmail: new RegExp(
            `^\\s*${this.escapeRegex(teacher.email || '')}\\s*$`,
            'i',
          ),
        })
        .lean()
        .exec(),
    ]);
    const contents = this.filterTeacherContentsByCurrentCourses(
      teacher,
      rawContents,
      normalizedSelectedClass || undefined,
    );
    return {
      classes: assignedClasses,
      selectedClass: normalizedSelectedClass || 'all',
      totalStudents: students.length,
      students: await Promise.all(
        students.map(async (student: any) => {
          let studentVisibleContentIds = new Set<string>();
          let dashboard: any = null;
          try {
            dashboard = await this.studentService.getDashboard(
              undefined,
              (student.className || '').trim() || undefined,
              String(student.keycloakId || '').trim() || undefined,
              student.email || undefined,
            );

            studentVisibleContentIds = new Set(
              (Array.isArray(dashboard?.contents) ? dashboard.contents : [])
                .map((content: any) => String(content?._id || '').trim())
                .filter(Boolean),
            );
          } catch {
            studentVisibleContentIds = new Set<string>();
          }

          const currentStudentContents = studentVisibleContentIds.size > 0
            ? contents.filter((content: any) =>
                studentVisibleContentIds.has(String(content?._id || '').trim()),
              )
            : contents;
          const progressMetrics = this.buildProgressMetricsForStudent(
            student,
            currentStudentContents,
          );
          const levelMetrics = this.buildLevelProgressMetricsForStudent(
            student,
            currentStudentContents,
            dashboard,
          );
          return {
            id: String(student._id),
            fullName:
              `${student.firstName || ''} ${student.lastName || ''}`.trim() ||
              student.email,
            email: student.email || '',
            className: (student.className || '').trim(),
            avatarDataUrl: student.profileData?.avatarDataUrl || '',
            lastActivityAt:
              student.lastLogin ||
              student.updatedAt ||
              student.createdAt ||
              null,
            learningProgress: Array.isArray(student.learningProgress)
              ? student.learningProgress.map((entry: any) => ({
                  contentId: String(entry?.contentId || '').trim(),
                  contentType: String(entry?.contentType || '').trim(),
                  status: String(entry?.status || '')
                    .trim()
                    .toLowerCase(),
                  score:
                    typeof entry?.score === 'number'
                      ? Number(entry.score)
                      : null,
                  completedAt: entry?.completedAt || null,
                  updatedAt: entry?.updatedAt || null,
                }))
              : [],
            globalProgress: progressMetrics.globalProgress,
            levelProgress: levelMetrics.levelProgress,
            quizProgressDetails: levelMetrics.quizProgressDetails,
            progressDetails: {
              completedMaterials: progressMetrics.progressDetails.completedMaterials,
              totalMaterials: progressMetrics.progressDetails.totalMaterials,
              completedCourses: progressMetrics.progressDetails.completedCourses,
              totalCourses: progressMetrics.progressDetails.totalCourses,
              completedUnits: progressMetrics.progressDetails.completedUnits,
              totalUnits: progressMetrics.progressDetails.totalUnits,
            },
            pendingContentScopes: progressMetrics.pendingContentScopes,
          };
        }),
      ),
    };
  }

  async getTeacherExamReminders(
    keycloakId: string,
    selectedClassName?: string,
  ) {
    const existingTeacher = await this.userModel.findOne({ keycloakId });
    const teacher = existingTeacher
      ? await this.normalizeUserRoleFields(existingTeacher)
      : null;

    if (!teacher) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (teacher.role !== 'teacher') {
      throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
    }

    const assignedClasses = this.normalizeClassList([
      ...(teacher.assignedClasses || []),
      teacher.className,
    ]);

    const normalizedSelectedClass = (selectedClassName || '').trim();
    const filteredClasses = normalizedSelectedClass
      ? assignedClasses.filter(
          (className) => className === normalizedSelectedClass,
        )
      : assignedClasses;
    const normalizedTeacherAssignedClasses = filteredClasses
      .map((className) => this.normalizeReminderClassName(className))
      .filter(Boolean);

    const studentQuery =
      filteredClasses.length > 0
        ? {
            role: 'student',
            className: { $in: filteredClasses },
          }
        : {
            role: 'student',
            _id: { $in: [] },
          };

    const [students, rawContents] = await Promise.all([
      this.userModel
        .find(studentQuery)
        .sort({ firstName: 1, lastName: 1, email: 1 })
        .lean()
        .exec(),
      this.contentModel
        .find({
          teacherEmail: new RegExp(
            `^\\s*${this.escapeRegex(teacher.email || '')}\\s*$`,
            'i',
          ),
        })
        .lean()
        .exec(),
    ]);

    const contents = this.filterTeacherContentsByCurrentCourses(
      teacher,
      rawContents,
      normalizedSelectedClass || undefined,
    );
    const activeContents = contents.filter(
      (content) => content?.isActive !== false,
    );
    const visibleAssignments = this.getTeacherCourseAssignments(teacher).filter(
      (assignment) =>
        this.isCourseAssignmentVisibleForClass(
          assignment,
          normalizedSelectedClass || undefined,
        ),
    );
    const courseMap = new Map<
      string,
      {
        id: string;
        course: string;
        chapters: string[];
        dueDates: string[];
        visibleToAllClasses: boolean;
        visibleToClasses: string[];
        chapterAliases: Map<string, string>;
        materials: any[];
      }
    >();
    const courseAliases = new Map<string, string>();

    const addCourseAlias = (courseKey: string, value: unknown) => {
      const alias = this.normalizeReference(String(value || ''));
      if (courseKey && alias) {
        courseAliases.set(alias, courseKey);
      }
    };

    visibleAssignments.forEach((assignment) => {
      const courseName = String(assignment.subject || '').trim();
      const normalizedCourseKey = this.normalizeReference(courseName);
      if (!courseName || !normalizedCourseKey || courseMap.has(normalizedCourseKey)) {
        return;
      }

      courseMap.set(normalizedCourseKey, {
        id: courseName,
        course: courseName,
        chapters: [],
        dueDates: [],
        visibleToAllClasses: false,
        visibleToClasses: assignment.classes,
        chapterAliases: new Map<string, string>(),
        materials: [],
      });
      addCourseAlias(normalizedCourseKey, courseName);
    });

    activeContents
      .filter((content: any) => String(content?.type || '').toLowerCase() === 'course')
      .forEach((course: any) => {
        const matchingCourseKey = [course?.title, course?.courseId, course?._id]
          .map((value) => this.normalizeReference(String(value || '')))
          .find((value) => courseMap.has(value));

        if (!matchingCourseKey) {
          return;
        }

        addCourseAlias(matchingCourseKey, course?._id);
        addCourseAlias(matchingCourseKey, course?.courseId);
        addCourseAlias(matchingCourseKey, course?.title);
      });

    const resolveCourseKey = (content: any) => {
      const candidates = [content?.courseId, content?.title, content?._id]
        .map((value) => this.normalizeReference(String(value || '')))
        .filter(Boolean);
      return (
        candidates.map((value) => courseAliases.get(value)).find(Boolean) ||
        candidates.find((value) => courseMap.has(value)) ||
        ''
      );
    };

    activeContents
      .filter((content: any) => String(content?.type || '').toLowerCase() === 'chapter')
      .forEach((content: any) => {
        const normalizedCourseKey = resolveCourseKey(content);
        if (!normalizedCourseKey || !courseMap.has(normalizedCourseKey)) {
          return;
        }

        const current = courseMap.get(normalizedCourseKey)!;
        const chapterName = String(
          content?.title || content?.chapterId || '',
        ).trim();
        if (chapterName && !current.chapters.includes(chapterName)) {
          current.chapters.push(chapterName);
        }

        [content?._id, content?.chapterId, content?.title]
          .map((value) => this.normalizeReference(String(value || '')))
          .filter(Boolean)
          .forEach((value) => current.chapterAliases.set(value, chapterName));
      });

    activeContents.forEach((content: any) => {
      const normalizedCourseKey = resolveCourseKey(content);
      if (!normalizedCourseKey) {
        return;
      }

      const courseName = courseMap.get(normalizedCourseKey)?.course || String(content?.courseId || content?.title || '').trim();

      if (!courseMap.has(normalizedCourseKey)) {
        courseMap.set(normalizedCourseKey, {
          id: courseName,
          course: courseName,
          chapters: [],
          dueDates: [],
          visibleToAllClasses: false,
          visibleToClasses: [],
          chapterAliases: new Map<string, string>(),
          materials: [],
        });
      }

      const current = courseMap.get(normalizedCourseKey)!;
      const chapterReference = String(content?.chapterId || '').trim();
      const chapterName =
        current.chapterAliases.get(this.normalizeReference(chapterReference)) ||
        (String(content?.type || '').toLowerCase() === 'chapter'
          ? String(content?.title || chapterReference).trim()
          : chapterReference);
      if (chapterName && !current.chapters.includes(chapterName)) {
        current.chapters.push(chapterName);
      }

      const dueDateCandidate = String(
        content?.dueDateTime || content?.dueDate || '',
      ).trim();
      if (dueDateCandidate) {
        current.dueDates.push(dueDateCandidate);
      }

      if (content?.visibleToAllClasses === true) {
        current.visibleToAllClasses = true;
      }

      const visibleToClasses = Array.isArray(content?.visibleToClasses)
        ? content.visibleToClasses
            .map((value: string) => `${value || ''}`.trim())
            .filter(Boolean)
        : [];

      current.visibleToClasses = this.normalizeClassList([
        ...current.visibleToClasses,
        ...visibleToClasses,
      ]);

      if (this.isReminderTrackableContent(content)) {
        current.materials.push(content);
      }
    });

    const studentDashboards = await Promise.all(
      students.map(async (student: any) => {
        const dashboard = await this.studentService.getDashboard(
          undefined,
          (student.className || '').trim() || undefined,
          String(student.keycloakId || '').trim() || undefined,
          student.email || undefined,
        );

        return {
          student,
          dashboard,
        };
      }),
    );

    const exams = Array.from(courseMap.values())
      .map((course) => {
        const targetStudents = studentDashboards.filter(({ student }) => {
          if (course.materials.length === 0) {
            return this.isReminderCourseVisibleForStudent(
              course,
              student,
              normalizedTeacherAssignedClasses,
            );
          }

          return (
            this.resolveReminderVisibleMaterialsForStudent(
              course,
              student,
              normalizedTeacherAssignedClasses,
            ).length > 0
          );
        });

        const studentsAtRisk = targetStudents
          .map(({ student }) => {
            const visibleMaterials =
              this.resolveReminderVisibleMaterialsForStudent(
                course,
                student,
                normalizedTeacherAssignedClasses,
              );
            const completedContentIds =
              this.buildCompletedReminderContentIdSet(student);
            const chapterStatuses =
              this.buildExamReminderChapterStatusesForStudent(
                course,
                student,
                normalizedTeacherAssignedClasses,
              );
            const missingChapters = chapterStatuses
              .filter((chapter) => !chapter.isCompleted)
              .map((chapter) => chapter.label);
            const totalMaterials = visibleMaterials.length;
            const completedMaterials = visibleMaterials.filter(
              (material: any) =>
                completedContentIds.has(String(material?._id || '').trim()),
            ).length;
            const progress =
              totalMaterials > 0
                ? Math.round((completedMaterials / totalMaterials) * 100)
                : 100;

            return {
              id: String(student?._id || ''),
              name:
                `${student?.firstName || ''} ${student?.lastName || ''}`.trim() ||
                student?.email ||
                'Etudiant',
              email: String(student?.email || '').trim(),
              progress,
              completedContents: completedMaterials,
              totalContents: totalMaterials,
              missingChapters,
            };
          })
          .filter((student) => student.missingChapters.length > 0);

        const chapters = [...course.chapters].sort((a, b) =>
          a.localeCompare(b, 'fr', { numeric: true }),
        );

        return {
          id: course.id,
          course: course.course,
          date: this.formatReminderExamDate(course.dueDates),
          time: this.formatReminderExamTime(course.dueDates),
          location: 'A definir',
          chapters,
          studentsCount: targetStudents.length,
          studentEmails: targetStudents.map(({ student }) =>
            String(student?.email || '').trim(),
          ),
          remindersSent: 0,
          studentsAtRisk,
        };
      })
      .sort((a, b) =>
        a.course.localeCompare(b.course, 'fr', { sensitivity: 'base' }),
      );

    return {
      classes: assignedClasses,
      selectedClass: normalizedSelectedClass || 'all',
      exams,
    };
  }

  private buildExamReminderChapterStatusesForStudent(
    course: any,
    student: any,
    normalizedTeacherAssignedClasses: string[],
  ) {
    const completedContentIds =
      this.buildCompletedReminderContentIdSet(student);

    const visibleMaterials = this.resolveReminderVisibleMaterialsForStudent(
      course,
      student,
      normalizedTeacherAssignedClasses,
    );

    const chapterMap = new Map<string, any[]>();
    visibleMaterials.forEach((material: any) => {
      const chapterReference = String(material?.chapterId || '').trim();
      const chapterLabel =
        course?.chapterAliases?.get?.(
          this.normalizeReference(chapterReference),
        ) || chapterReference;
      if (!chapterLabel) {
        return;
      }

      const normalizedChapterKey = this.normalizeReference(chapterLabel);
      if (!normalizedChapterKey) {
        return;
      }

      if (!chapterMap.has(normalizedChapterKey)) {
        chapterMap.set(normalizedChapterKey, []);
      }

      chapterMap.get(normalizedChapterKey)!.push(material);
    });

    return Array.from(chapterMap.entries()).map(([_, materials]) => {
      const label = String(materials[0]?.chapterId || 'Chapitre').trim();
      const isCompleted =
        materials.length === 0 ||
        materials.every((material: any) =>
          completedContentIds.has(String(material?._id || '').trim()),
        );

      return {
        label,
        isCompleted,
      };
    });
  }

  private buildCompletedReminderContentIdSet(student: any) {
    return new Set(
      (Array.isArray(student?.learningProgress) ? student.learningProgress : [])
        .filter((entry: any) => {
          const status = String(entry?.status || '')
            .trim()
            .toLowerCase();
          return status === 'completed' || status === 'passed';
        })
        .map((entry: any) => String(entry?.contentId || '').trim())
        .filter(Boolean),
    );
  }

  private resolveReminderVisibleMaterialsForStudent(
    course: any,
    student: any,
    normalizedTeacherAssignedClasses: string[],
  ) {
    const normalizedStudentClass = this.normalizeReminderClassName(
      student?.className,
    );
    const studentLevel = this.normalizeReminderLevel(
      student?.profileData?.level,
    );

    return (Array.isArray(course?.materials) ? course.materials : []).filter(
      (material: any) =>
        this.isContentVisibleForReminderStudent(
          material,
          normalizedStudentClass,
          normalizedTeacherAssignedClasses,
          studentLevel,
        ),
    );
  }

  private isContentVisibleForReminderStudent(
    item: any,
    normalizedStudentClass: string,
    normalizedTeacherAssignedClasses: string[],
    studentLevel: 'debutant' | 'intermediaire' | 'avance',
  ) {
    if (!normalizedStudentClass) {
      return false;
    }

    if (item?.visibleToAllClasses === true) {
      if (normalizedTeacherAssignedClasses.length === 0) {
        return true;
      }

      return normalizedTeacherAssignedClasses.includes(normalizedStudentClass);
    }

    const allowedClasses = Array.isArray(item?.visibleToClasses)
      ? item.visibleToClasses
          .map((value: string) => this.normalizeReminderClassName(value))
          .filter(Boolean)
      : [];

    if (allowedClasses.length > 0) {
      if (!allowedClasses.includes(normalizedStudentClass)) {
        return false;
      }
    } else if (
      !normalizedTeacherAssignedClasses.includes(normalizedStudentClass)
    ) {
      return false;
    }

    const normalizedType = String(item?.type || '')
      .trim()
      .toLowerCase();
    if (normalizedType !== 'quiz') {
      return true;
    }

    const questions = Array.isArray(item?.quizQuestions)
      ? item.quizQuestions
      : [];
    if (questions.length === 0) {
      return false;
    }

    const difficulty = this.normalizeReminderLevel(item?.quizDifficulty);
    if (!difficulty) {
      return true;
    }

    return difficulty === studentLevel;
  }

  private isReminderCourseVisibleForStudent(
    course: any,
    student: any,
    normalizedTeacherAssignedClasses: string[],
  ) {
    const normalizedStudentClass = this.normalizeReminderClassName(
      student?.className,
    );

    if (!normalizedStudentClass) {
      return false;
    }

    if (course?.visibleToAllClasses === true) {
      return (
        normalizedTeacherAssignedClasses.length === 0 ||
        normalizedTeacherAssignedClasses.includes(normalizedStudentClass)
      );
    }

    const allowedClasses = Array.isArray(course?.visibleToClasses)
      ? course.visibleToClasses
          .map((value: string) => this.normalizeReminderClassName(value))
          .filter(Boolean)
      : [];

    if (allowedClasses.length > 0) {
      return allowedClasses.includes(normalizedStudentClass);
    }

    return normalizedTeacherAssignedClasses.includes(normalizedStudentClass);
  }

  private isReminderTrackableContent(content: any) {
    const normalizedType = String(content?.type || '')
      .trim()
      .toLowerCase();
    if (normalizedType === 'document' || normalizedType === 'video') {
      return true;
    }

    if (normalizedType !== 'quiz') {
      return false;
    }

    return (
      !Array.isArray(content?.quizQuestions) || content.quizQuestions.length > 0
    );
  }

  private formatReminderExamDate(values: string[]) {
    const resolvedDate = this.resolveNearestReminderDate(values);
    if (!resolvedDate) {
      return 'Date non definie';
    }

    return resolvedDate.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  private formatReminderExamTime(values: string[]) {
    const resolvedDate = this.resolveNearestReminderDate(values);
    if (!resolvedDate) {
      return 'Heure non definie';
    }

    return resolvedDate.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private resolveNearestReminderDate(values: string[]) {
    const parsedDates = values
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());

    return parsedDates[0] || null;
  }

  private escapeRegex(value: string) {
    return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async getProfileByKeycloakId(
    keycloakId: string,
    fallbackEmail?: string,
    fallbackUsername?: string,
  ) {
    const existingUser = await this.userModel.findOne({ keycloakId });
    const user = existingUser
      ? await this.normalizeUserRoleFields(existingUser)
      : null;
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const profileData = user.profileData || {};

    const resolvedEmail = user.email || fallbackEmail || '';
    const resolvedFullName =
      profileData.fullName ||
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      fallbackUsername ||
      resolvedEmail;

    return {
      fullName: resolvedFullName,
      email: resolvedEmail,
      className:
        user.role === 'teacher'
          ? this.normalizeClassList(user.assignedClasses || []).join(', ')
          : user.className || '',
      assignedClasses: this.normalizeClassList(user.assignedClasses || []),
      phone: profileData.phone || '',
      birthdate: profileData.birthdate || '',
      specialization: profileData.specialization || '',
      address: profileData.address || '',
      bio: profileData.bio || '',
      avatarDataUrl: profileData.avatarDataUrl || '',
      faceIdEnabled: !!profileData.faceIdHash,
    };
  }

  async saveFaceIdByKeycloakId(keycloakId: string, faceHash: string) {
    const user = await this.userModel.findOne({ keycloakId });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const existingFaceUsers = await this.userModel
      .find({
        keycloakId: { $ne: keycloakId },
        role: { $in: ['teacher', 'student'] },
        'profileData.faceIdHash': { $type: 'string' },
      })
      .select('email firstName lastName profileData.faceIdHash')
      .exec();

    const conflictingUser = existingFaceUsers.find((candidate) => {
      const existingHash = String(candidate.profileData?.faceIdHash || '');
      return (
        this.hammingDistance(faceHash, existingHash) <=
        this.faceIdDuplicateThreshold()
      );
    });

    if (conflictingUser) {
      throw new HttpException(
        'Ce Face ID est deja associe a un autre compte. Utilisez un visage unique pour ce compte.',
        HttpStatus.CONFLICT,
      );
    }

    await this.userModel.updateOne(
      { _id: user._id, keycloakId: user.keycloakId },
      {
        $set: {
          'profileData.faceIdHash': faceHash,
          'profileData.faceIdEnabledAt': new Date().toISOString(),
        },
      },
    );

    return {
      faceIdEnabled: true,
      ownerEmail: user.email,
      ownerKeycloakId: user.keycloakId,
    };
  }

  private faceIdDuplicateThreshold() {
    return normalizeFaceIdNumber(
      this.configService.get('FACE_ID_DUPLICATE_THRESHOLD'),
      FACE_ID_DUPLICATE_THRESHOLD,
    );
  }

  async updateProfileByKeycloakId(
    keycloakId: string,
    payload: {
      fullName: string;
      email: string;
      phone: string;
      birthdate: string;
      specialization: string;
      address: string;
      bio?: string;
      avatarDataUrl?: string;
    },
  ) {
    const user = await this.userModel.findOne({ keycloakId });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const fullName = payload.fullName.trim();
    const [firstName, ...lastNameParts] = fullName.split(/\s+/);
    const lastName = lastNameParts.join(' ').trim() || user.lastName;

    user.firstName = firstName || user.firstName;
    user.lastName = lastName;
    user.profileData = {
      ...(user.profileData || {}),
      fullName,
      phone: payload.phone,
      birthdate: payload.birthdate,
      specialization: payload.specialization,
      address: payload.address,
      bio: payload.bio || '',
      avatarDataUrl:
        payload.avatarDataUrl !== undefined
          ? payload.avatarDataUrl || ''
          : user.profileData?.avatarDataUrl || '',
    };

    await user.save();

    return this.getProfileByKeycloakId(keycloakId);
  }

  async isPasswordChanged(keycloakId: string): Promise<boolean> {
    const user = await this.userModel.findOne({ keycloakId });
    return user ? user.passwordChanged : false;
  }

  async markPasswordChanged(keycloakId: string): Promise<void> {
    await this.userModel.updateOne(
      { keycloakId },
      {
        passwordChanged: true,
        lastPasswordChange: new Date(),
        isBlocked: false,
      },
    );
  }

  async handleFirstLogin(keycloakId: string): Promise<void> {
    const user = await this.userModel.findOne({ keycloakId });

    if (!user) return;

    if (!user.firstLoginAt) {
      user.firstLoginAt = new Date();
      user.isBlocked = false;
      await user.save();
    }
  }

  async checkAndBlockIfNeeded(
    keycloakId: string,
    roles: string[] = [],
  ): Promise<boolean> {
    const user = await this.userModel.findOne({ keycloakId });

    if (!user) return false;
    if (user.isBlocked) return true;

    // Only teacher and student roles are subject to forced password change/blocking.
    if (!roles.some((role) => ['teacher', 'student'].includes(role)))
      return false;

    if (user.firstLoginAt && !user.passwordChanged) {
      const hours =
        (Date.now() - user.firstLoginAt.getTime()) / (1000 * 60 * 60);

      if (hours > 24) {
        user.isBlocked = true;
        await user.save();

        try {
          await this.keycloakService.updateUserEnabled(keycloakId, false);
        } catch (error: any) {
          this.logger.warn(
            `[BLOCK USER] Mongo user blocked but Keycloak disable failed for ${keycloakId}: ${error?.message || error}`,
          );
        }

        return true;
      }
    }

    return false;
  }
}
