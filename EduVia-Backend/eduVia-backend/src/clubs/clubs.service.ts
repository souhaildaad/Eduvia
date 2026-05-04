import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content, ContentDocument } from '../content/content.schema';
import { User } from '../users/user.schema';
import { CLUBS, ClubSeed } from './clubs.data';

type StudiedCourse = {
  key: string;
  title: string;
  score: number;
  studiedCount: number;
  quizAverageScore?: number;
  recentScore?: number;
};

type ClubRecommendation = ClubSeed & {
  id: string;
  score: number;
  recommendationRate: number;
  matchedCourses: string[];
  matchedKeywords: string[];
  recommendationReason: string;
};

type StudentRecommendationSignals = {
  className: string;
  specialization: string;
  profileTokens: string[];
  recentKeywords: string[];
  averageQuizScore: number;
  progressMomentum: number;
  contactedClubIds: Set<string>;
  ignoredClubIds: Set<string>;
};

@Injectable()
export class ClubsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Content.name)
    private readonly contentModel: Model<ContentDocument>,
  ) {}

  async getClubs(userId?: string, email?: string, limit = 6) {
    try {
      const recommendationPayload = await this.getRecommendations(
        userId,
        email,
        limit,
      );

      return {
        clubs: recommendationPayload.clubs,
        total: CLUBS.length,
        source: recommendationPayload.source,
        studiedCourses: recommendationPayload.studiedCourses,
        recommendations: recommendationPayload.recommendations,
      };
    } catch (error: any) {
      if (error?.getStatus?.() !== HttpStatus.UNAUTHORIZED) {
        throw error;
      }

      return {
        clubs: CLUBS.map((club) => this.toClubView(club)),
        total: CLUBS.length,
        source: 'static-clubs',
        studiedCourses: [],
        recommendations: [],
      };
    }
  }

  async getStaticClubs() {
    return {
      clubs: CLUBS.map((club) => this.toClubView(club)),
      total: CLUBS.length,
    };
  }

  async getRecommendations(userId?: string, email?: string, limit = 6) {
    const normalizedLimit = Math.max(1, Math.min(20, Number(limit) || 6));
    const student = await this.findConnectedStudent(userId, email);
    const contents = await this.contentModel.find({}).lean().exec();
    const contentById = this.buildContentById(contents);
    const courseTitleByReference = this.buildCourseTitleByReference(contents);
    const studiedCourses =
      student && Array.isArray(student.learningProgress)
        ? this.buildStudentStudiedCourses(
            student.learningProgress,
            contentById,
            courseTitleByReference,
          )
        : [];
    const studentSignals = this.buildStudentSignals(
      student,
      contentById,
      courseTitleByReference,
    );
    const source =
      studiedCourses.length > 0
        ? 'student-progress'
        : 'global-studied-courses';
    const courses =
      studiedCourses.length > 0
        ? studiedCourses
        : await this.buildGlobalStudiedCourses(
            contentById,
            courseTitleByReference,
          );
    const rankedClubs = this.rankClubs(courses, studentSignals);
    const recommendations = rankedClubs.slice(0, normalizedLimit);

    return {
      source,
      studiedCourses: courses.slice(0, 8).map(({ title, score, studiedCount }) => ({
        title,
        score,
        studiedCount,
      })),
      recommendations,
      clubs: rankedClubs,
    };
  }

  private async findConnectedStudent(userId?: string, email?: string) {
    if (!userId && !email) {
      return null;
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const identityQuery =
      userId && normalizedEmail
        ? { $or: [{ keycloakId: userId }, { email: normalizedEmail }] }
        : userId
          ? { keycloakId: userId }
          : { email: normalizedEmail };

    const student = await this.userModel
      .findOne({
        role: 'student',
        ...identityQuery,
      })
      .select({ learningProgress: 1, className: 1, profileData: 1 })
      .lean()
      .exec();

    return student;
  }

  private buildContentById(contents: any[]) {
    return new Map(
      contents
        .map((content) => [String(content?._id || '').trim(), content] as const)
        .filter(([id]) => !!id),
    );
  }

  private buildCourseTitleByReference(contents: any[]) {
    const titleMap = new Map<string, string>();

    contents
      .filter((content) => String(content?.type || '').toLowerCase() === 'course')
      .forEach((content) => {
        const title = String(content?.title || content?.courseId || '').trim();
        if (!title) {
          return;
        }

        [content?._id, content?.courseId, content?.title]
          .map((value) => this.normalizeReference(String(value || '')))
          .filter(Boolean)
          .forEach((reference) => titleMap.set(reference, title));
      });

    return titleMap;
  }

  private buildStudentStudiedCourses(
    progressEntries: any[],
    contentById: Map<string, any>,
    courseTitleByReference: Map<string, string>,
  ) {
    const courseMap = new Map<string, StudiedCourse>();

    progressEntries.forEach((entry) => {
      const content = contentById.get(String(entry?.contentId || '').trim());
      if (!content) {
        return;
      }

      this.addCourseScore(
        courseMap,
        content,
        this.progressWeight(entry),
        courseTitleByReference,
        entry,
      );
    });

    return this.sortCourses(courseMap);
  }

  private async buildGlobalStudiedCourses(
    contentById: Map<string, any>,
    courseTitleByReference: Map<string, string>,
  ) {
    const students = await this.userModel
      .find({
        role: 'student',
        learningProgress: { $exists: true, $ne: [] },
      })
      .select({ learningProgress: 1 })
      .lean()
      .exec();
    const courseMap = new Map<string, StudiedCourse>();

    students.forEach((student: any) => {
      (Array.isArray(student.learningProgress) ? student.learningProgress : []).forEach(
        (entry: any) => {
          const content = contentById.get(String(entry?.contentId || '').trim());
          if (!content) {
            return;
          }

          this.addCourseScore(
            courseMap,
            content,
            this.progressWeight(entry),
            courseTitleByReference,
            entry,
          );
        },
      );
    });

    if (courseMap.size === 0) {
      Array.from(contentById.values())
        .filter((content) => String(content?.type || '').toLowerCase() === 'course')
        .forEach((content) =>
          this.addCourseScore(courseMap, content, 1, courseTitleByReference),
        );
    }

    return this.sortCourses(courseMap);
  }

  private addCourseScore(
    courseMap: Map<string, StudiedCourse>,
    content: any,
    weight: number,
    courseTitleByReference: Map<string, string>,
    progressEntry?: any,
  ) {
    if (weight <= 0) {
      return;
    }

    const title = this.resolveCourseTitle(content, courseTitleByReference);
    const key = this.normalizeReference(title);
    if (!key) {
      return;
    }

    const current = courseMap.get(key) || {
      key,
      title,
      score: 0,
      studiedCount: 0,
      quizAverageScore: 0,
      recentScore: 0,
    };
    current.score += weight;
    current.studiedCount += 1;
    current.quizAverageScore = this.mergeAverageScore(
      current.quizAverageScore,
      current.studiedCount,
      this.extractProgressScore(progressEntry),
    );
    if (this.isRecentProgress(progressEntry)) {
      current.recentScore = (current.recentScore || 0) + weight;
    }
    courseMap.set(key, current);
  }

  private rankClubs(
    courses: StudiedCourse[],
    signals: StudentRecommendationSignals = this.emptyStudentSignals(),
  ): ClubRecommendation[] {
    const maxScore = Math.max(...courses.map((course) => course.score), 1);

    return CLUBS.map((club) => {
      const clubKeywords = this.clubKeywords(club);
      const clubId = this.toClubView(club).id;
      const matchedCourses = new Set<string>();
      const matchedKeywords = new Set<string>();
      let courseMatchScore = 0;

      courses.forEach((course) => {
        const courseText = this.normalizeReference(course.title);
        const matches = clubKeywords.filter((keyword) =>
          this.isKeywordMatch(courseText, keyword),
        );

        if (matches.length > 0) {
          matchedCourses.add(course.title);
          matches.forEach((keyword) => matchedKeywords.add(keyword));
          courseMatchScore += course.score * Math.min(matches.length, 3);
        }
      });

      const categoryScore = this.categoryFitScore(club, courses, signals);
      const progressScore = this.recentInterestScore(clubKeywords, signals);
      const quizScore = this.quizPerformanceScore(clubKeywords, courses, signals);
      const specialtyScore = this.specialtyScore(clubKeywords, signals);
      const manualTagScore = this.domainBoost(club, courses);
      const interactionPenalty =
        signals.ignoredClubIds.has(clubId) ? 8 : signals.contactedClubIds.has(clubId) ? 2 : 0;
      const baselineScore = this.baselineExplorationScore(club, signals);
      const finalScore = Math.max(
        0,
        courseMatchScore +
          categoryScore +
          progressScore +
          quizScore +
          specialtyScore +
          manualTagScore +
          baselineScore -
          interactionPenalty,
      );
      const scoreCeiling = Math.max(maxScore * 3 + 18, 24);

      return {
        ...this.toClubView(club),
        score: Number(finalScore.toFixed(2)),
        recommendationRate: Math.min(
          100,
          Math.max(8, Math.round((finalScore / scoreCeiling) * 100)),
        ),
        matchedCourses: Array.from(matchedCourses).slice(0, 4),
        matchedKeywords: Array.from(matchedKeywords).slice(0, 8),
        recommendationReason: this.buildReason(club, Array.from(matchedCourses), {
          courseMatchScore,
          progressScore,
          quizScore,
          specialtyScore,
          categoryScore,
        }),
      };
    }).sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' });
    });
  }

  private buildStudentSignals(
    student: any,
    contentById: Map<string, any>,
    courseTitleByReference: Map<string, string>,
  ): StudentRecommendationSignals {
    if (!student) {
      return this.emptyStudentSignals();
    }

    const progressEntries = Array.isArray(student.learningProgress)
      ? student.learningProgress
      : [];
    const recentKeywords = new Set<string>();
    const quizScores: number[] = [];
    let recentProgressWeight = 0;

    progressEntries.forEach((entry: any) => {
      const content = contentById.get(String(entry?.contentId || '').trim());
      const score = Number(entry?.score);
      if (Number.isFinite(score)) {
        quizScores.push(Math.max(0, Math.min(100, score)));
      }

      if (this.isRecentProgress(entry)) {
        recentProgressWeight += this.progressWeight(entry);
        [
          this.resolveCourseTitle(content, courseTitleByReference),
          content?.title,
          content?.chapterId,
          content?.partId,
          content?.quizDifficulty,
        ]
          .flatMap((value) => this.tokenize(value))
          .forEach((token) => recentKeywords.add(token));
      }
    });

    const profileTokens = [
      student.className,
      student.profileData?.className,
      student.profileData?.specialization,
      student.profileData?.specialite,
      student.profileData?.bio,
    ].flatMap((value) => this.tokenize(value));
    const interactions = student.profileData?.clubInteractions || {};

    return {
      className: String(student.className || student.profileData?.className || '').trim(),
      specialization: String(
        student.profileData?.specialization || student.profileData?.specialite || '',
      ).trim(),
      profileTokens: [...new Set(profileTokens)],
      recentKeywords: Array.from(recentKeywords),
      averageQuizScore: quizScores.length
        ? Math.round(quizScores.reduce((sum, score) => sum + score, 0) / quizScores.length)
        : 0,
      progressMomentum: Math.min(1, recentProgressWeight / 12),
      contactedClubIds: new Set(
        Array.isArray(interactions.contacted) ? interactions.contacted.map(String) : [],
      ),
      ignoredClubIds: new Set(
        Array.isArray(interactions.ignored) ? interactions.ignored.map(String) : [],
      ),
    };
  }

  private emptyStudentSignals(): StudentRecommendationSignals {
    return {
      className: '',
      specialization: '',
      profileTokens: [],
      recentKeywords: [],
      averageQuizScore: 0,
      progressMomentum: 0,
      contactedClubIds: new Set(),
      ignoredClubIds: new Set(),
    };
  }

  private domainBoost(club: ClubSeed, courses: StudiedCourse[]) {
    const domainKeywords = this.clubKeywords(club);
    const courseTokens = courses.flatMap((course) =>
      this.normalizeReference(course.title).split(' ').filter(Boolean),
    );

    return domainKeywords.reduce(
      (boost, keyword) =>
        boost +
        (courseTokens.some((token) => this.keywordAliases(keyword).includes(token))
          ? 0.5
          : 0),
      0,
    );
  }

  private categoryFitScore(
    club: ClubSeed,
    courses: StudiedCourse[],
    signals: StudentRecommendationSignals,
  ) {
    const clubKeywords = this.clubKeywords(club);
    const categoryTokens = this.tokenize(club.category);
    const courseTokens = courses.flatMap((course) => this.tokenize(course.title));
    const profileMatches = signals.profileTokens.filter((token) =>
      clubKeywords.some((keyword) => this.isKeywordMatch(token, keyword)),
    ).length;
    const courseCategoryMatches = categoryTokens.filter((token) =>
      courseTokens.some((courseToken) => this.isKeywordMatch(courseToken, token)),
    ).length;

    return Math.min(8, profileMatches * 1.5 + courseCategoryMatches * 1.2);
  }

  private recentInterestScore(
    clubKeywords: string[],
    signals: StudentRecommendationSignals,
  ) {
    const recentMatches = signals.recentKeywords.filter((token) =>
      clubKeywords.some((keyword) => this.isKeywordMatch(token, keyword)),
    ).length;

    return Math.min(9, recentMatches * 1.4 + signals.progressMomentum * 4);
  }

  private quizPerformanceScore(
    clubKeywords: string[],
    courses: StudiedCourse[],
    signals: StudentRecommendationSignals,
  ) {
    const matchedCourseHasQuizScore = courses.some((course) => {
      const courseTokens = this.tokenize(course.title);
      const hasMatch = courseTokens.some((token) =>
        clubKeywords.some((keyword) => this.isKeywordMatch(token, keyword)),
      );
      return hasMatch && Number(course.quizAverageScore || 0) > 0;
    });
    const averageScore =
      courses
        .map((course) => Number(course.quizAverageScore || 0))
        .filter((score) => score > 0)
        .reduce((sum, score, _index, scores) => sum + score / scores.length, 0) ||
      signals.averageQuizScore;

    if (!averageScore) {
      return 0;
    }

    const bestScoreBonus = Math.max(0, Math.min(100, averageScore)) / 100;
    return matchedCourseHasQuizScore ? 2 + bestScoreBonus * 6 : bestScoreBonus * 3;
  }

  private specialtyScore(
    clubKeywords: string[],
    signals: StudentRecommendationSignals,
  ) {
    const profileMatches = signals.profileTokens.filter((token) =>
      clubKeywords.some((keyword) => this.isKeywordMatch(token, keyword)),
    ).length;

    return Math.min(10, profileMatches * 2);
  }

  private baselineExplorationScore(club: ClubSeed, signals: StudentRecommendationSignals) {
    const broadCategories = ['culture', 'humanitaire', 'entrepreneuriat', 'innovation'];
    const category = this.normalizeReference(club.category);
    const broadBonus = broadCategories.some((token) => category.includes(token)) ? 2 : 0;
    const profileBonus = signals.profileTokens.length > 0 ? 1 : 0;

    return 3 + broadBonus + profileBonus;
  }

  private buildReason(
    club: ClubSeed,
    matchedCourses: string[],
    scores?: {
      courseMatchScore: number;
      progressScore: number;
      quizScore: number;
      specialtyScore: number;
      categoryScore: number;
    },
  ) {
    if (matchedCourses.length > 0) {
      const reasons = [
        `cours alignes avec ${club.category}: ${matchedCourses.slice(0, 2).join(', ')}`,
      ];
      if (Number(scores?.quizScore || 0) > 0) {
        reasons.push('bons scores de quiz');
      }
      if (Number(scores?.progressScore || 0) > 0) {
        reasons.push('interet recent');
      }
      if (Number(scores?.specialtyScore || 0) > 0) {
        reasons.push('specialite/profil compatible');
      }

      return `Recommande selon ${reasons.join(' + ')}.`;
    }

    if (
      Number(scores?.categoryScore || 0) > 0 ||
      Number(scores?.specialtyScore || 0) > 0
    ) {
      return `Club propose car ton profil ou ta classe se rapproche du domaine ${club.category}.`;
    }

    return `Club propose pour explorer le domaine ${club.category}, avec un score de decouverte non nul.`;
  }

  private mergeAverageScore(currentAverage: number | undefined, count: number, nextScore: number | null) {
    if (nextScore === null) {
      return currentAverage || 0;
    }

    const previousCount = Math.max(0, count - 1);
    const previousTotal = (currentAverage || 0) * previousCount;

    return Math.round((previousTotal + nextScore) / Math.max(1, count));
  }

  private extractProgressScore(entry: any): number | null {
    const score = Number(entry?.score);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  }

  private isRecentProgress(entry: any) {
    if (!entry) {
      return false;
    }

    const rawDate = entry.updatedAt || entry.completedAt || entry.submittedAt;
    const date = rawDate ? new Date(rawDate) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return false;
    }

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    return Date.now() - date.getTime() <= thirtyDaysMs;
  }

  private isKeywordMatch(text: string, keyword: string) {
    const normalizedText = this.normalizeReference(text);
    const normalizedKeyword = this.normalizeReference(keyword);
    if (!normalizedText || !normalizedKeyword) {
      return false;
    }

    return (
      normalizedText.includes(normalizedKeyword) ||
      normalizedKeyword.includes(normalizedText) ||
      this.keywordAliases(normalizedKeyword).some((alias) =>
        normalizedText.includes(alias),
      )
    );
  }

  private progressWeight(entry: any) {
    const status = String(entry?.status || '').toLowerCase();
    const score = Number(entry?.score);
    const scoreBonus = Number.isFinite(score) ? Math.max(0, Math.min(score, 100)) / 100 : 0;

    if (status === 'passed') return 3 + scoreBonus;
    if (status === 'completed') return 2.5 + scoreBonus;
    if (status === 'in_progress') return 1.5;
    if (status === 'not_started') return 0.25;
    return 1;
  }

  private resolveCourseTitle(content: any, courseTitleByReference: Map<string, string>) {
    const reference = this.normalizeReference(String(content?.courseId || ''));
    const resolvedCourseTitle = reference
      ? courseTitleByReference.get(reference)
      : '';

    if (resolvedCourseTitle) {
      return resolvedCourseTitle;
    }

    return String(
      content?.courseId ||
        (String(content?.type || '').toLowerCase() === 'course' ? content?.title : '') ||
        content?.title ||
        '',
    ).trim();
  }

  private sortCourses(courseMap: Map<string, StudiedCourse>) {
    return Array.from(courseMap.values()).sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' });
    });
  }

  private toClubView(club: ClubSeed) {
    return {
      id: this.normalizeReference(club.name).replace(/\s+/g, '-'),
      ...club,
    };
  }

  private clubKeywords(club: ClubSeed) {
    const text = [
      club.name,
      club.category,
      club.description,
      ...club.objectives,
      ...club.activities,
    ].join(' ');

    return [
      ...new Set([
        ...this.normalizeReference(text)
          .split(/[^a-z0-9.+#]+/)
          .filter((token) => token.length > 2),
        ...this.manualKeywordsForClub(club),
      ]),
    ];
  }

  private manualKeywordsForClub(club: ClubSeed) {
    const category = this.normalizeReference(club.category);
    const keywords: string[] = [];

    if (category.includes('programmation')) {
      keywords.push('algorithmique', 'algo', 'java', 'python', 'web', 'developpement');
    }
    if (category.includes('robotique') || category.includes('electronique')) {
      keywords.push('arduino', 'iot', 'embarque', 'mecanique', 'automatique');
    }
    if (category.includes('reseaux')) {
      keywords.push('reseau', 'network', 'cisco', 'securite', 'cloud');
    }
    if (category.includes('tic') || category.includes('web')) {
      keywords.push('web', 'jee', 'javascript', 'mean', 'php', 'dotnet', 'mobile');
    }
    if (category.includes('entrepreneuriat') || category.includes('junior')) {
      keywords.push('projet', 'business', 'startup', 'management', 'marketing');
    }
    if (category.includes('genie civil')) {
      keywords.push('civil', 'batiment', 'construction', 'structure');
    }
    if (category.includes('automobile')) {
      keywords.push('automobile', 'mecanique', 'moteur');
    }

    return keywords;
  }

  private keywordAliases(keyword: string) {
    const aliases: Record<string, string[]> = {
      developpement: ['dev', 'development', 'programming', 'programmation'],
      programmation: ['programming', 'code', 'coding', 'java', 'python'],
      algorithmique: ['algorithme', 'algo', 'algorithm'],
      web: ['javascript', 'typescript', 'html', 'css', 'frontend', 'backend'],
      cloud: ['devops', 'docker', 'kubernetes', 'aws', 'azure'],
      reseaux: ['reseau', 'network', 'networking'],
      reseau: ['reseaux', 'network', 'networking'],
      electronique: ['electronics', 'embedded', 'embarque'],
      embarques: ['embarque', 'embedded', 'iot'],
      mecanique: ['mechanical', 'cao', 'solidworks'],
      entrepreneuriat: ['entrepreneurship', 'startup', 'business'],
      technologie: ['technology', 'tech', 'innovation'],
      informatique: ['computer', 'computing', 'tic'],
      securite: ['security', 'cybersecurity', 'cyber'],
      genie: ['engineering', 'ingenierie'],
    };

    return aliases[keyword] || [keyword];
  }

  private tokenize(value?: string) {
    return this.normalizeReference(value)
      .split(/[^a-z0-9.+#]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
      .flatMap((token) => [token, ...this.keywordAliases(token)])
      .filter(Boolean);
  }

  private normalizeReference(value?: string) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/\.net/g, 'dotnet')
      .replace(/\s+/g, ' ');
  }
}
