import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ContentService } from './content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { GenerateQuizDto } from './dto/generate-quiz.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { extname } from 'path';

const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024;

@Controller('api/contents')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  findAll(
    @Query('teacherEmail') teacherEmail?: string,
    @Query('className') className?: string,
  ) {
    return this.contentService.findAll(teacherEmail, className);
  }

  @Get('tree')
  findTree() {
    return this.contentService.findTree();
  }

  @Get('overview')
  findOverview() {
    return this.contentService.findOverview();
  }

  @Get('dashboard-stats')
  findDashboardStats(
    @Query('teacherEmail') teacherEmail?: string,
    @Query('className') className?: string,
  ) {
    return this.contentService.findTeacherDashboardStats(teacherEmail, className);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contentService.findOne(id);
  }

  @Post()
  create(@Body() createDto: CreateContentDto) {
    return this.contentService.create(createDto);
  }

  @Post('generate-quiz')
  @UseInterceptors(
    FileInterceptor('chapterFile', {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        const allowed = /\.(pdf|docx)$/i;
        if (!allowed.test(file.originalname)) {
          return callback(
            new Error('Only PDF and DOCX are allowed for chapter quiz generation.'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  generateQuiz(
    @Body() body: Record<string, unknown>,
    @UploadedFile() chapterFile?: { originalname: string; buffer: Buffer },
  ) {
    const dto: GenerateQuizDto = {
      title: String(body?.title || ''),
      description: body?.description ? String(body.description) : undefined,
      difficulty: body?.difficulty ? String(body.difficulty) : undefined,
      sourceChapter: body?.sourceChapter ? String(body.sourceChapter) : undefined,
      courseId: body?.courseId ? String(body.courseId) : undefined,
      chapterId: body?.chapterId ? String(body.chapterId) : undefined,
      partId: body?.partId ? String(body.partId) : undefined,
      questionCount:
        body?.questionCount !== undefined && body?.questionCount !== null
          ? Number(body.questionCount)
          : undefined,
    };

    return this.contentService.generateQuizQuestions(dto, chapterFile);
  }

  @Post('generate-flashcards')
  generateFlashcards(@Body() body: Record<string, unknown>) {
    return this.contentService.generateFlashcards({
      subject: String(body?.subject || ''),
      difficulty: body?.difficulty ? String(body.difficulty) : undefined,
      questionCount:
        body?.questionCount !== undefined && body?.questionCount !== null
          ? Number(body.questionCount)
          : undefined,
    });
  }

  @Post('parse-quiz')
  @UseInterceptors(
    FileInterceptor('quizFile', {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        const allowed = /\.(pdf|docx)$/i;
        if (!allowed.test(file.originalname)) {
          return callback(
            new Error('Only PDF and DOCX are allowed for quiz preview parsing.'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  parseQuiz(@UploadedFile() quizFile?: { originalname: string; buffer: Buffer }) {
    if (!quizFile) {
      throw new BadRequestException('Le fichier du quiz est obligatoire.');
    }

    return this.contentService.parseQuizQuestionsFromUpload(quizFile);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateContentDto) {
    return this.contentService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contentService.remove(id);
  }

  @Delete('course/:courseId')
  removeCourse(
    @Param('courseId') courseId: string,
    @Query('teacherEmail') teacherEmail?: string,
  ) {
    return this.contentService.removeCourse(courseId, teacherEmail);
  }

  @Post(':id/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, callback) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const fileExtName = extname(file.originalname);
          const sanitizedName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_.]/g, '');
          callback(null, `${sanitizedName}-${uniqueSuffix}${fileExtName}`);
        },
      }),
      fileFilter: (_req, file, callback) => {
        const allowed = /\.(pdf|doc|docx|mp4|mov|avi|webm|mkv)$/i;
        if (!allowed.test(file.originalname)) {
          return callback(
            new Error('Only PDF, DOC, DOCX, MP4, MOV, AVI, WEBM and MKV are allowed.'),
            false,
          );
        }
        callback(null, true);
      },
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
    }),
  )
  async uploadFile(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_SIZE_BYTES })
        .build({ fileIsRequired: true }),
    ) file: any,
  ) {
    const fileUrl = `/uploads/${file.filename}`;
    const content = await this.contentService.attachFileUrl(
      id,
      fileUrl,
      file.originalname,
    );
    return {
      message: 'File uploaded and linked to content',
      content,
      fileUrl,
    };
  }
}
