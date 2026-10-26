import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

type StudentLevel = 'debutant' | 'intermediaire' | 'avance';

type AssessmentQuestion = {
  subject: string;
  prompt: string;
  options: string[];
  correctIndex: number;
};

type AssessmentResult = {
  level: StudentLevel;
  levelLabel: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  completedAt: string;
};

@Component({
  selector: 'app-ai-assessment',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './ai-assessment.html',
  styleUrl: './ai-assessment.css',
})
export class AiAssessment implements OnDestroy {
  @Input() studentName = 'Student User';
  @Output() completed = new EventEmitter<AssessmentResult>();

  started = false;
  voiceEnabled = false;
  currentIndex = 0;
  selectedIndex: number | null = null;
  result: AssessmentResult | null = null;
  answers: number[] = [];
  private keyPressCount = 0;
  private keyPressTimer: ReturnType<typeof setTimeout> | null = null;
  private autoNextTimer: ReturnType<typeof setTimeout> | null = null;

  readonly questions: AssessmentQuestion[] = [
    { subject: 'Algorithmique', prompt: "Quel est l'objectif principal d'un algorithme ?", options: ['Dessiner une interface', "Decrire une suite d'etapes pour resoudre un probleme", 'Stocker uniquement des images', 'Remplacer la base de donnees'], correctIndex: 1 },
    { subject: 'Reseaux', prompt: 'Quel protocole est principalement utilise pour charger une page web securisee ?', options: ['FTP', 'HTTPS', 'SMTP', 'SSH'], correctIndex: 1 },
    { subject: 'Angular', prompt: 'A quoi sert un composant Angular ?', options: ['Representer une partie de l interface avec sa logique', 'Compiler une base SQL', 'Remplacer le navigateur', 'Heberger un serveur mail'], correctIndex: 0 },
    { subject: 'React', prompt: 'Quel element permet de memoriser un etat local dans un composant React fonctionnel ?', options: ['useState', 'routerLink', 'HttpClient', 'SELECT'], correctIndex: 0 },
    { subject: 'Java', prompt: 'Quel mot cle permet de creer une classe en Java ?', options: ['class', 'def', 'component', 'table'], correctIndex: 0 },
    { subject: 'Python', prompt: 'Quelle structure permet de repeter un bloc tant qu une condition reste vraie ?', options: ['if', 'while', 'import', 'return'], correctIndex: 1 },
    { subject: 'Bases de donnees', prompt: 'Quelle commande SQL sert a lire des donnees ?', options: ['INSERT', 'SELECT', 'DELETE', 'DROP'], correctIndex: 1 },
    { subject: 'Gestion des projet', prompt: 'Quel outil aide a suivre les taches dans une methode agile ?', options: ['Backlog', 'Adresse IP', 'Variable CSS', 'Cle primaire'], correctIndex: 0 },
    { subject: 'Spring Boot', prompt: 'Quel fichier contient souvent la configuration principale Spring Boot ?', options: ['application.properties', 'index.html', 'package-lock.json', 'style.css'], correctIndex: 0 },
    { subject: 'Complexite', prompt: 'Que mesure la complexite temporelle ?', options: ['La couleur du code', 'Le cout en temps selon la taille des entrees', 'Le nombre d images', 'Le nom du fichier'], correctIndex: 1 },
    { subject: 'Graphes', prompt: 'Dans un graphe, que represente une arete ?', options: ['Un lien entre deux sommets', 'Une variable CSS', 'Une table SQL', 'Un mot de passe'], correctIndex: 0 },
    { subject: 'C++', prompt: 'Quel symbole termine generalement une instruction simple en C++ ?', options: [';', ':', '#', '@'], correctIndex: 0 },
    { subject: 'TypeScript', prompt: 'Quel avantage principal apporte TypeScript a JavaScript ?', options: ['Le typage statique', 'La suppression du HTML', 'La creation automatique du serveur', 'Le chiffrement du disque'], correctIndex: 0 },
    { subject: 'API REST', prompt: 'Quelle methode HTTP est souvent utilisee pour creer une ressource ?', options: ['GET', 'POST', 'TRACE', 'CONNECT'], correctIndex: 1 },
    { subject: 'Git', prompt: 'Quelle commande enregistre un instantane des changements ?', options: ['git commit', 'git paint', 'git sleep', 'git table'], correctIndex: 0 },
    { subject: 'Securite', prompt: 'Pourquoi hacher un mot de passe ?', options: ['Pour eviter de le stocker en clair', 'Pour le rendre plus long visuellement', 'Pour changer la couleur du formulaire', 'Pour supprimer la session'], correctIndex: 0 },
    { subject: 'Tests', prompt: 'A quoi sert un test unitaire ?', options: ['Verifier une petite partie du code', 'Remplacer toute documentation', 'Installer le systeme', 'Dessiner une maquette'], correctIndex: 0 },
    { subject: 'Docker', prompt: 'Quel fichier decrit souvent les etapes de construction d une image ?', options: ['Dockerfile', 'README uniquement', 'favicon.ico', 'tsconfig.spec.json'], correctIndex: 0 },
    { subject: 'UML', prompt: 'Quel diagramme montre souvent les classes et leurs relations ?', options: ['Diagramme de classes', 'Diagramme de pixels', 'Diagramme audio', 'Diagramme de couleurs'], correctIndex: 0 },
    { subject: 'Architecture', prompt: 'Quel principe conseille de separer les responsabilites ?', options: ['Separation of concerns', 'Copier tout dans un seul fichier', 'Supprimer les interfaces', 'Ignorer les modules'], correctIndex: 0 },
  ];

  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  get progress() {
    return Math.round((this.currentIndex / this.questions.length) * 100);
  }

  ngOnDestroy() {
    this.clearTimers();
    this.stopVoice();
  }

  start() {
    this.started = true;
    this.result = null;
    this.currentIndex = 0;
    this.selectedIndex = null;
    this.answers = [];
    this.speakCurrentQuestion();
  }

  toggleVoice() {
    this.voiceEnabled = !this.voiceEnabled;
    if (this.voiceEnabled) {
      this.speakCurrentQuestion();
      return;
    }
    this.stopVoice();
  }

  selectAnswer(index: number) {
    if (this.result) {
      return;
    }
    this.selectedIndex = index;
  }

  next() {
    if (this.selectedIndex === null) {
      return;
    }
    this.answers[this.currentIndex] = this.selectedIndex;
    if (this.currentIndex >= this.questions.length - 1) {
      this.finish();
      return;
    }
    this.currentIndex += 1;
    this.selectedIndex = this.answers[this.currentIndex] ?? null;
    this.speakCurrentQuestion();
  }

  previous() {
    if (this.currentIndex === 0) {
      return;
    }
    this.currentIndex -= 1;
    this.selectedIndex =
      this.answers[this.currentIndex] !== undefined ? this.answers[this.currentIndex] : null;
    this.speakCurrentQuestion();
  }

  continueToDashboard() {
    if (this.result) {
      this.completed.emit(this.result);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (!this.started || !this.voiceEnabled || this.result) {
      return;
    }
    if (['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    this.keyPressCount = Math.min(4, this.keyPressCount + 1);
    if (this.keyPressTimer) {
      clearTimeout(this.keyPressTimer);
    }
    this.keyPressTimer = setTimeout(() => {
      const answerIndex = Math.max(0, Math.min(3, this.keyPressCount - 1));
      this.keyPressCount = 0;
      this.selectAnswer(answerIndex);
      this.autoNextTimer = setTimeout(() => this.next(), 650);
    }, 520);
  }

  private finish() {
    const correctSubjects: string[] = [];
    const wrongSubjects: string[] = [];
    this.questions.forEach((question, index) => {
      if (this.answers[index] === question.correctIndex) {
        correctSubjects.push(question.subject);
      } else {
        wrongSubjects.push(question.subject);
      }
    });

    const correctCount = correctSubjects.length;
    const score = Math.round((correctCount / this.questions.length) * 100);
    const level: StudentLevel = score >= 75 ? 'avance' : score >= 45 ? 'intermediaire' : 'debutant';
    const levelLabel = level === 'avance' ? 'Avance' : level === 'intermediaire' ? 'Intermediaire' : 'Debutant';
    const weaknesses = [...new Set(wrongSubjects)].slice(0, 6);
    const strengths = [...new Set(correctSubjects)].slice(0, 6);

    this.result = {
      level,
      levelLabel,
      score,
      correctCount,
      totalQuestions: this.questions.length,
      strengths,
      weaknesses,
      recommendation: weaknesses.length
        ? `EduVia recommande un parcours progressif, en priorite sur ${weaknesses.slice(0, 3).join(', ')}.`
        : 'EduVia recommande de consolider vos acquis avec des quiz avances.',
      completedAt: new Date().toISOString(),
    };
    this.speakResult();
  }

  private speakCurrentQuestion() {
    if (!this.voiceEnabled || !this.started || this.result) {
      return;
    }
    const question = this.currentQuestion;
    const text = [
      `Question ${this.currentIndex + 1} sur ${this.questions.length}.`,
      `Matiere: ${question.subject}.`,
      question.prompt,
      ...question.options.map((option, index) => `Reponse ${index + 1}: ${option}.`),
    ].join(' ');
    this.speak(text);
  }

  private speakResult() {
    if (!this.voiceEnabled || !this.result) {
      return;
    }
    this.speak([
      `Resultat final. Niveau ${this.result.levelLabel}.`,
      `Score ${this.result.correctCount} sur ${this.result.totalQuestions}, soit ${this.result.score} pourcent.`,
      `Forces detectees: ${this.result.strengths.join(', ') || 'a consolider'}.`,
      `Points a renforcer: ${this.result.weaknesses.join(', ') || 'aucun point critique'}.`,
      this.result.recommendation,
      'Vous pouvez maintenant continuer vers votre dashboard.',
    ].join(' '));
  }

  private speak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  private stopVoice() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  private clearTimers() {
    if (this.keyPressTimer) {
      clearTimeout(this.keyPressTimer);
    }
    if (this.autoNextTimer) {
      clearTimeout(this.autoNextTimer);
    }
  }
}
