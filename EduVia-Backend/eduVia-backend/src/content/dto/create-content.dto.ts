import { Type } from 'class-transformer';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

function isStrictlyAfterToday(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return true;
  }

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

function IsAfterToday(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAfterToday',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isStrictlyAfterToday(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} doit etre superieure a la date d'aujourd'hui.`;
        },
      },
    });
  };
}

class QuizQuestionOptionDto {
  @IsString()
  label: string;

  @IsString()
  text: string;
}

class QuizQuestionDto {
  @IsString()
  id: string;

  @IsString()
  prompt: string;

  @IsString()
  type: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionOptionDto)
  options: QuizQuestionOptionDto[];

  @IsArray()
  @IsString({ each: true })
  correctAnswers: string[];

  @IsOptional()
  @IsString()
  explanation?: string;
}

export class CreateContentDto {
  @IsNotEmpty()
  @IsString()
  type: string;

  @IsNotEmpty()
  @IsString()
  title: string;

  @ValidateIf(o => o.type === 'quiz' || o.description !== undefined)
  @IsNotEmpty({ message: 'La description du quiz est obligatoire.' })
  @IsString()
  description?: string;

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
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  teacherName?: string;

  @IsOptional()
  @IsString()
  teacherEmail?: string;

  @IsOptional()
  @IsString()
  teacherAvatarDataUrl?: string;

  @IsOptional()
  @IsBoolean()
  visibleToAllClasses?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleToClasses?: string[];

  @IsOptional()
  @IsDateString()
  @IsAfterToday({ message: 'La date du quiz doit etre strictement superieure a aujourd\'hui.' })
  dueDate?: Date;

  @IsOptional()
  @IsDateString()
  @IsAfterToday({ message: 'La date du quiz doit etre strictement superieure a aujourd\'hui.' })
  dueDateTime?: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  quizDurationMinutes?: number;

  @ValidateIf(o => o.type === 'quiz' || o.quizMode !== undefined)
  @IsNotEmpty({ message: 'Le type de quiz est obligatoire.' })
  @IsString()
  quizMode?: string;

  @ValidateIf(o => o.type === 'quiz' || o.quizDifficulty !== undefined)
  @IsNotEmpty({ message: 'Le niveau de difficulte est obligatoire.' })
  @IsString()
  quizDifficulty?: string;

  @IsOptional()
  @IsString()
  quizDisplayMode?: string;

  @ValidateIf(o => o.type === 'quiz' || o.quizSourceChapter !== undefined)
  @IsNotEmpty({ message: 'Le chapitre source est obligatoire.' })
  @IsString()
  quizSourceChapter?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quizAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  quizPassingScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quizQuestionCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  quizQuestions?: QuizQuestionDto[];
}
