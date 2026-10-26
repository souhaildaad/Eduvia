import { ChangeDetectorRef, Component, OnInit, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UserManagement } from '../user-management/user-management';
import { InternshipManagement } from '../internship-management/internship-management';
import { AuthService } from '../../../services/auth.service';

type AdminTab = 'overview' | 'users' | 'internships';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    UserManagement,
    InternshipManagement,
  ],
  templateUrl: './admin-dashboard.html',
  styleUrls: ['./admin-dashboard.css'],
})
export class AdminDashboard implements OnInit {
  logout = output();
  selectedTab: AdminTab = 'overview';
  isLoadingOverview = false;

  adminData = {
    name: 'Administrateur Systeme',
    stats: {
      totalUsers: 0,
      students: 0,
      teachers: 0,
      activeToday: 0,
      createdThisWeek: 0,
      createdToday: 0
    }
  };

  tabs: Array<{ id: AdminTab; label: string; icon: string }> = [
    { id: 'overview', label: "Vue d'ensemble", icon: 'bar_chart' },
    { id: 'users', label: 'Utilisateurs', icon: 'group' },
    { id: 'internships', label: 'Stages', icon: 'work' },
  ];

  constructor(
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    const role = localStorage.getItem('role');
    if (role === 'admin') {
      this.loadOverview();
    }
  }

  get overviewCards() {
    return [
      { icon: 'group', value: `${this.adminData.stats.totalUsers}`, label: 'Utilisateurs totaux', colorClass: 'blue' },
      { icon: 'school', value: `${this.adminData.stats.students}`, label: 'Etudiants', colorClass: 'green' },
      { icon: 'groups_2', value: `${this.adminData.stats.teachers}`, label: 'Enseignants', colorClass: 'violet' },
      { icon: 'diversity_3', value: `${this.adminData.stats.activeToday}`, label: "Actifs aujourd'hui", colorClass: 'plum' },
      { icon: 'calendar_month', value: `${this.adminData.stats.createdToday}`, label: "Crees aujourd'hui", colorClass: 'multi' },
      { icon: 'event_available', value: `${this.adminData.stats.createdThisWeek}`, label: 'Crees cette semaine', colorClass: 'gold' },
    ];
  }

  get recentActivities() {
    return [
      {
        description: `${this.adminData.stats.students} etudiants enregistres`,
        time: 'Synchronise avec MongoDB',
        change: `${this.adminData.stats.students}`,
        colorClass: 'positive'
      },
      {
        description: `${this.adminData.stats.teachers} enseignants enregistres`,
        time: 'Synchronise avec MongoDB',
        change: `${this.adminData.stats.teachers}`,
        colorClass: 'info'
      },
      {
        description: `${this.adminData.stats.createdToday} nouveaux utilisateurs aujourd'hui`,
        time: "Mise a jour en temps reel",
        change: `+${this.adminData.stats.createdToday}`,
        colorClass: 'accent'
      }
    ];
  }

  selectTab(tab: AdminTab) {
    this.selectedTab = tab;

    if (tab === 'overview') {
      this.loadOverview();
    }
  }

  onLogout() {
    this.logout.emit();
  }

  onUsersUpdated() {
    this.loadOverview();
  }

  private loadOverview() {
    this.isLoadingOverview = true;

    this.authService.getUsers().subscribe({
      next: (response) => {
        const users = response?.data || response || [];
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfToday);
        startOfWeek.setDate(startOfToday.getDate() - 6);

        const isSameOrAfter = (dateValue: any, minDate: Date) => {
          if (!dateValue) {
            return false;
          }

          const date = new Date(dateValue);
          return !Number.isNaN(date.getTime()) && date >= minDate;
        };

        this.adminData.stats = {
          totalUsers: users.length,
          students: users.filter((user: any) => user.role === 'student').length,
          teachers: users.filter((user: any) => user.role === 'teacher').length,
          activeToday: users.filter((user: any) => isSameOrAfter(user.lastLogin || user.firstLoginAt, startOfToday)).length,
          createdThisWeek: users.filter((user: any) => isSameOrAfter(user.createdAt, startOfWeek)).length,
          createdToday: users.filter((user: any) => isSameOrAfter(user.createdAt, startOfToday)).length
        };
        this.isLoadingOverview = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Erreur lors du chargement du dashboard admin:', error);
        this.isLoadingOverview = false;
        this.cdr.detectChanges();
      }
    });
  }
}
