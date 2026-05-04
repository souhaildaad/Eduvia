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
};

type ClubRecommendation = ClubSeed & {
  id: string;
  score: number;
  recommendationRate: number;
  matchedCourses: string[];
  matchedKeywords: string[];
  recommendationReason: string;
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
    const recommendations = this.rankClubs(courses).slice(0, normalizedLimit);

    return {
      source,
      studiedCourses: courses.slice(0, 8).map(({ title, score, studiedCount }) => ({
        title,
        score,
        studiedCount,
      })),
      recommendations,
      clubs: this.rankClubs(courses),
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
      .select({ learningProgress: 1 })
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
    };
    current.score += weight;
    current.studiedCount += 1;
    courseMap.set(key, current);
  }

  private rankClubs(courses: StudiedCourse[]): ClubRecommendation[] {
    const maxScore = Math.max(...courses.map((course) => course.score), 1);

    return CLUBS.map((club) => {
      const clubKeywords = this.clubKeywords(club);
      const matchedCourses = new Set<string>();
      const matchedKeywords = new Set<string>();
      let score = 0;

      courses.forEach((course) => {
        const courseText = this.normalizeReference(course.title);
        const matches = clubKeywords.filter(
          (keyword) =>
            courseText.includes(keyword) ||
            keyword.includes(courseText) ||
            this.keywordAliases(keyword).some((alias) => courseText.includes(alias)),
        );

        if (matches.length > 0) {
          matchedCourses.add(course.title);
          matches.forEach((keyword) => matchedKeywords.add(keyword));
          score += course.score * Math.min(matches.length, 3);
        }
      });

      const boostedScore = score + this.domainBoost(club, courses);

      return {
        ...this.toClubView(club),
        score: Number(boostedScore.toFixed(2)),
        recommendationRate: Math.min(
          100,
          Math.round((boostedScore / (maxScore * 3)) * 100),
        ),
        matchedCourses: Array.from(matchedCourses).slice(0, 4),
        matchedKeywords: Array.from(matchedKeywords).slice(0, 8),
        recommendationReason: this.buildReason(club, Array.from(matchedCourses)),
      };
    }).sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' });
    });
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

  private buildReason(club: ClubSeed, matchedCourses: string[]) {
    if (matchedCourses.length > 0) {
      return `Recommande car tes cours les plus etudies correspondent a ${club.category}: ${matchedCourses.slice(0, 2).join(', ')}.`;
    }

    return `Club propose pour explorer le domaine ${club.category}.`;
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
