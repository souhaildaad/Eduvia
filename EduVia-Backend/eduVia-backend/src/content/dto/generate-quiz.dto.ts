import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateQuizDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsString()
  sourceChapter?: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  chapterId?: string;

  @IsOptional()
  @IsString()
  partId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  questionCount?: number;
}
