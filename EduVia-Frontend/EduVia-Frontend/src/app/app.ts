import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RoleSelection } from './components/role-selection/role-selection';
import { StudentDashboard } from './components/student-dashboard/student-dashboard';
import { TeacherDashboard } from './components/teacher-dashboard/teacher-dashboard';
import { AdminDashboard } from './components/admin-dashboard/admin-dashboard';

type UserRole = 'student' | 'teacher' | 'admin' | null;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RoleSelection, StudentDashboard, TeacherDashboard, AdminDashboard],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('EduVia-Frontend');
  userRole = signal<UserRole>(null);

  onRoleSelected(role: UserRole) {
    this.userRole.set(role);
  }

  onLogout() {
    this.userRole.set(null);
  }
}
