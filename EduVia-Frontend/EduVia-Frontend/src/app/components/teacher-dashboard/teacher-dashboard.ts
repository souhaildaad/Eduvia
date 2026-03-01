import { Component, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { ContentManagement } from '../teacher/content-management/content-management';
import { ExamReminders } from '../teacher/exam-reminders/exam-reminders';
import { StudentTracking } from '../teacher/student-tracking/student-tracking';

@Component({
  selector: 'app-teacher-dashboard',
  imports: [
    CommonModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    ContentManagement,
    ExamReminders,
    StudentTracking,
  ],
  templateUrl: './teacher-dashboard.html',
  styleUrl: './teacher-dashboard.css',
})
export class TeacherDashboard {
  logout = output();

  onLogout() {
    this.logout.emit();
  }
}
