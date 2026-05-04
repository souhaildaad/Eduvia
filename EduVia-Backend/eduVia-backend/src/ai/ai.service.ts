import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model } from 'mongoose';
import { AiChatHistory, AiChatHistoryDocument } from './ai-chat-history.schema';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(AiChatHistory.name)
    private readonly chatHistoryModel: Model<AiChatHistoryDocument>,
  ) {}

  async askChatbot(message: string) {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) {
      return this.detectLanguage(cleanMessage) === 'en'
        ? 'Ask me a question so I can help you.'
        : 'Posez-moi une question pour que je puisse vous aider.';
    }

    if (this.isGreeting(cleanMessage)) {
      return this.buildGreetingReply(cleanMessage);
    }

    if (!this.isEducationalQuestion(cleanMessage)) {
      return this.buildOutOfScopeReply(cleanMessage);
    }

    const chatbotUrl =
      this.configService.get<string>('CHATBOT_AI_URL') || 'http://127.0.0.1:8000/chat';
    const languageInstruction = this.buildLanguageInstruction(cleanMessage);
    const guardedMessage = [
      languageInstruction,
      "Tu es un assistant d'apprentissage EduVia.",
      "Reponds uniquement aux questions educatives: cours, exercices, revisions, programmation, mathematiques, sciences, langues, devoirs, examens ou methodes d'apprentissage.",
      "Si la question n'est pas educative, refuse poliment dans la meme langue que la question.",
      `Question de l'etudiant: ${cleanMessage}`,
    ].join('\n');

    try {
      const response = await axios.post(
        chatbotUrl,
        { message: guardedMessage },
        { timeout: 120000 },
      );

      const reply =
        response.data?.response ||
        response.data?.reply ||
        response.data?.answer ||
        response.data?.message ||
        '';

      if (String(reply).trim()) {
        return reply;
      }

      return "L'IA a repondu, mais sans texte exploitable.";
    } catch (error) {
      this.logger.warn(
        `[AI CHAT] erreur pendant l'appel IA ${chatbotUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return [
        "Le chatbot est bien branche sur l'IA, mais la reponse prend trop de temps.",
        'Essayez une question plus precise, par exemple: resume chapitre boucle while.',
        'Verifiez aussi le terminal Python/Ollama si ce message revient souvent.',
      ].join(' ');
    }
  }

  async findChatHistory(user: any) {
    const ownerEmail = this.requireEmail(user);
    const histories = await this.chatHistoryModel
      .find({ ownerEmail })
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean();

    return histories.map((history: any) => ({
      id: String(history._id),
      title: history.title,
      updatedAt: history.updatedAt || history.createdAt,
      messages: history.messages || [],
    }));
  }

  async saveChatHistory(user: any, body: any) {
    const ownerEmail = this.requireEmail(user);
    const messages = Array.isArray(body?.messages)
      ? body.messages
          .filter((message) => message?.sender && message?.text)
          .map((message) => ({
            sender: message.sender === 'assistant' ? 'assistant' : 'student',
            text: String(message.text || '').trim(),
            time: String(message.time || '').trim() || new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          }))
      : [];

    if (!messages.some((message) => message.sender === 'student')) {
      return null;
    }

    const title =
      String(body?.title || '').trim() ||
      messages.find((message) => message.sender === 'student')?.text.slice(0, 52) ||
      'Nouvelle conversation';

    const existingId = String(body?.id || '').trim();
    const payload = {
      ownerEmail,
      ownerUserId: user?.userId || null,
      title,
      messages,
    };

    const saved = existingId
      ? await this.chatHistoryModel.findOneAndUpdate(
          { _id: existingId, ownerEmail },
          { $set: payload },
          { new: true, upsert: false },
        )
      : await this.chatHistoryModel.create(payload);

    if (!saved) {
      return null;
    }

    return {
      id: String(saved._id),
      title: saved.title,
      updatedAt: (saved as any).updatedAt || (saved as any).createdAt,
      messages: saved.messages || [],
    };
  }

  async deleteChatHistory(user: any, historyId: string) {
    const ownerEmail = this.requireEmail(user);
    const id = String(historyId || '').trim();
    if (!id) {
      return { deleted: false };
    }

    const result = await this.chatHistoryModel.deleteOne({ _id: id, ownerEmail });
    return { deleted: result.deletedCount > 0 };
  }

  private buildLanguageInstruction(message: string) {
    const language = this.detectLanguage(message);
    if (language === 'en') {
      return 'Answer in English, the same language as the student question.';
    }
    if (language === 'ar') {
      return 'اجب بالعربية، بنفس لغة سؤال الطالب.';
    }
    return 'Reponds en francais, dans la meme langue que la question de l etudiant.';
  }

  private buildOutOfScopeReply(message: string) {
    const language = this.detectLanguage(message);
    if (language === 'en') {
      return 'I am an educational assistant, so I only answer questions related to learning, courses, exercises, exams, or study methods.';
    }
    if (language === 'ar') {
      return 'أنا مساعد تعليمي، لذلك أجيب فقط عن الأسئلة المتعلقة بالدراسة والدروس والتمارين والامتحانات.';
    }
    return "Je suis un assistant educatif, donc je reponds seulement aux questions liees aux cours, exercices, examens, revisions ou methodes d'apprentissage.";
  }

  private detectLanguage(message: string): 'fr' | 'en' | 'ar' {
    if (/[\u0600-\u06ff]/.test(message)) {
      return 'ar';
    }

    const normalized = message.toLowerCase();
    const englishHints = /\b(what|why|how|when|where|is|are|can|could|should|explain|summary|exercise|loop|function|class|exam|test|homework)\b/;
    const englishGreetingHints = /\b(hello|hi|hey|good morning|good afternoon|good evening)\b/;
    const frenchHints = /\b(quoi|pourquoi|comment|quand|ou|est|sont|peux|explique|resume|exercice|boucle|fonction|classe|examen|devoir|chapitre)\b/;

    if ((englishHints.test(normalized) || englishGreetingHints.test(normalized)) && !frenchHints.test(normalized)) {
      return 'en';
    }

    return 'fr';
  }

  private isEducationalQuestion(message: string) {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const educationalPattern =
      /\b(cours|course|chapitre|chapter|lecon|lesson|exercice|exercise|devoir|homework|examen|exam|test|quiz|revision|revise|resume|summary|explique|explain|apprendre|learn|study|etud|student|prof|teacher|classe|class|ecole|school|universite|university|math|mathematique|algebre|analyse|science|physique|physics|chimie|chemistry|biologie|biology|francais|english|anglais|arabe|histoire|history|geographie|geography|programmation|programming|code|algorithme|algorithm|boucle|loop|while|for|fonction|function|variable|array|tableau|objet|object|java|javascript|typescript|python|html|css|sql|database|base de donnees|reseau|network|cryptographie|openssl)\b/;

    const nonEducationalPattern =
      /\b(pizza|burger|sandwich|food|manger|restaurant|movie|film|music|song|chanson|sport|football|game|jeu video|meteo|weather|politique|politics|dating|amour|blague|joke)\b/;

    if (educationalPattern.test(normalized)) {
      return true;
    }

    return !nonEducationalPattern.test(normalized) && normalized.length > 80;
  }

  private isGreeting(message: string) {
    return /^(hello|hi|hey|good morning|good afternoon|good evening|bonjour|salut|bonsoir|مرحبا|السلام عليكم)[\s!.?]*$/i.test(
      message.trim(),
    );
  }

  private buildGreetingReply(message: string) {
    const language = this.detectLanguage(message);
    if (language === 'en') {
      return 'Hello! I am your educational assistant. Ask me a question about a course, exercise, exam, or study topic.';
    }
    if (language === 'ar') {
      return 'مرحبا! أنا مساعدك التعليمي. اسألني عن درس أو تمرين أو امتحان أو موضوع دراسي.';
    }
    return 'Bonjour ! Je suis votre assistant educatif. Posez-moi une question sur un cours, un exercice, un examen ou une revision.';
  }

  private requireEmail(user: any) {
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) {
      throw new Error('Utilisateur non connecte');
    }
    return email;
  }
}
