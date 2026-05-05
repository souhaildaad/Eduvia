import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { StudentService } from './student.service';

@Controller('api/student')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('student')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Get('dashboard')
  getDashboard(
    @Query('level') level: string | undefined,
    @Query('className') className: string | undefined,
    @Request() req: any,
  ) {
    return this.studentService.getDashboard(level, className, req.user?.userId, req.user?.email);
  }

  @Get('quizzes')
  getQuizzes(
    @Query('level') level: string | undefined,
    @Query('className') className: string | undefined,
    @Request() req: any,
  ) {
    return this.studentService.getQuizzes(level, className, req.user?.userId, req.user?.email);
  }

  @Get('progress')
  getProgress(
    @Query('level') level: string | undefined,
    @Query('className') className: string | undefined,
    @Request() req: any,
  ) {
    return this.studentService.getProgress(level, className, req.user?.userId, req.user?.email);
  }

  @Get('leaderboard')
  getLeaderboard(
    @Query('level') level: string | undefined,
    @Query('className') className: string | undefined,
    @Request() req: any,
  ) {
    return this.studentService.getWeeklyLeaderboard(
      level,
      className,
      req.user?.userId,
      req.user?.email,
    );
  }

  @Post('level')
  updateLevel(
    @Body()
    body: {
      level: string;
      assessmentResult?: Record<string, unknown>;
    },
    @Request() req: any,
  ) {
    return this.studentService.updateStudentLevel(
      body,
      req.user?.userId,
      req.user?.email,
    );
  }

  @Post('portfolio/course-summary')
  getPortfolioCourseSummary(
    @Body() body: { courseId?: string; level?: string },
    @Request() req: any,
  ) {
    return this.studentService.getPortfolioCourseSummary(
      body,
      req.user?.userId,
      req.user?.email,
    );
  }

  @Post('portfolio/remediation-quiz')
  generatePortfolioRemediationQuiz(
    @Body()
    body: {
      acquis?: string;
      courseId?: string;
      chapterId?: string;
      level?: string;
    },
    @Request() req: any,
  ) {
    return this.studentService.generatePortfolioRemediationQuiz(
      body,
      req.user?.userId,
      req.user?.email,
    );
  }

  @Post('progress')
  updateProgress(
    @Body()
    body: {
      contentId: string;
      status?: 'not_started' | 'in_progress' | 'completed' | 'passed';
      score?: number;
    },
    @Request() req: any,
  ) {
    return this.studentService.updateProgress(body, req.user?.userId, req.user?.email);
  }

  @Post('assistant/ask')
  askAssistant(
    @Body()
    body: {
      question: string;
      level?: string;
      className?: string;
      courseId?: string;
      chapterId?: string;
    },
    @Request() req: any,
  ) {
    return this.studentService.askAssistant(body, req.user?.userId, req.user?.email);
  }

  @Post('flashcards/start')
  startFlashcardSession(
    @Body()
    body: {
      subject: string;
      difficulty?: 'facile' | 'intermediaire' | 'difficile';
      questionCount?: number;
    },
    @Request() req: any,
  ) {
    return this.studentService.startFlashcardSession(
      body,
      req.user?.userId,
      req.user?.email,
    );
  }

  @Post('flashcards/:sessionId/submit')
  submitFlashcardSession(
    @Param('sessionId') sessionId: string,
    @Body()
    body: {
      answers?: Array<{
        cardId?: string;
        userAnswer?: string;
        revealed?: boolean;
      }>;
      remainingSeconds?: number;
      timedOut?: boolean;
    },
    @Request() req: any,
  ) {
    return this.studentService.submitFlashcardSession(
      sessionId,
      body,
      req.user?.userId,
      req.user?.email,
    );
  }

  @Get('flashcards/sessions')
  getFlashcardSessions(@Request() req: any) {
    return this.studentService.getFlashcardSessions(
      req.user?.userId,
      req.user?.email,
    );
  }

  @Get('forum/requests')
  getForumRequests(@Query('search') search: string | undefined, @Request() req: any) {
    return this.studentService.getForumRequests(
      search,
      req.user?.userId,
      req.user?.email,
      req.user?.username,
    );
  }

  @Post('forum/requests')
  createForumRequest(
    @Body() body: { subject: string; message: string },
    @Request() req: any,
  ) {
    return this.studentService.createForumRequest(
      body,
      req.user?.userId,
      req.user?.email,
      req.user?.username,
    );
  }

  @Delete('forum/requests/:requestId')
  deleteForumRequest(@Param('requestId') requestId: string, @Request() req: any) {
    return this.studentService.deleteForumRequest(
      requestId,
      req.user?.userId,
      req.user?.email,
      req.user?.username,
    );
  }

  @Get('forum/requests/:requestId/chat')
  getForumChat(@Param('requestId') requestId: string, @Request() req: any) {
    return this.studentService.getForumChat(
      requestId,
      req.user?.userId,
      req.user?.email,
      req.user?.username,
    );
  }

  @Post('forum/requests/:requestId/chat/messages')
  sendForumChatMessage(
    @Param('requestId') requestId: string,
    @Body()
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
    @Request() req: any,
  ) {
    return this.studentService.sendForumChatMessage(
      requestId,
      body,
      req.user?.userId,
      req.user?.email,
      req.user?.username,
    );
  }
}
