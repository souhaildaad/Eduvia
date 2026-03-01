import { Component, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatBadgeModule } from '@angular/material/badge';
import { AiAssessment } from '../student/ai-assessment/ai-assessment';
import { CourseQuiz } from '../student/course-quiz/course-quiz';
import { RecommendationSystem } from '../student/recommendation-system/recommendation-system';
import { RatingSystem } from '../student/rating-system/rating-system';
import { Chatbot } from '../student/chatbot/chatbot';
import { ClubSuggestions } from '../student/club-suggestions/club-suggestions';
import { StudentForum } from '../student/student-forum/student-forum';

@Component({
  selector: 'app-student-dashboard',
  imports: [
    CommonModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressBarModule,
    MatBadgeModule,
    AiAssessment,
    CourseQuiz,
    RecommendationSystem,
    RatingSystem,
    Chatbot,
    ClubSuggestions,
    StudentForum,
  ],
  templateUrl: './student-dashboard.html',
  styleUrl: './student-dashboard.css',
})
export class StudentDashboard {
  logout = output();

  studentData = {
    name: 'Marie Dubois',
    level: 'Licence 2 Informatique',
    overallProgress: 75,
    currentCourses: [
      { id: 1, name: 'Structures de données', progress: 60, status: 'en cours' },
      { id: 2, name: 'Algorithmique avancée', progress: 85, status: 'en cours' },
      { id: 3, name: 'Bases de données', progress: 45, status: 'à risque' }
    ],
    notifications: [
      { id: 1, text: 'Courage ! Tu as bien progressé en algorithmique.', type: 'motivation' },
      { id: 2, text: 'Examen de BD dans 5 jours - Révise les chapitres 3 et 4', type: 'exam' }
    ]
  };

  showChatbot = false;

  onLogout() {
    this.logout.emit();
  }

  toggleChatbot() {
    this.showChatbot = !this.showChatbot;
  }
}
