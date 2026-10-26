import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface CourseData {
  name: string;
  students: number;
  satisfaction: number;
}

@Component({
  selector: 'app-platform-statistics',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
  ],
  templateUrl: './platform-statistics.html',
  styleUrls: ['./platform-statistics.css'],
})
export class PlatformStatistics {
  selectedPeriod: 'week' | 'month' | 'year' = 'week';
  isPeriodMenuOpen = false;

  engagementData = [
    { name: 'Lun', etudiants: 340 },
    { name: 'Mar', etudiants: 385 },
    { name: 'Mer', etudiants: 410 },
    { name: 'Jeu', etudiants: 395 },
    { name: 'Ven', etudiants: 420 },
    { name: 'Sam', etudiants: 180 },
    { name: 'Dim', etudiants: 120 }
  ];

  coursePopularity: CourseData[] = [
    { name: 'Structures de donnees', students: 145, satisfaction: 4.2 },
    { name: 'Algorithmique', students: 132, satisfaction: 4.5 },
    { name: 'Bases de donnees', students: 168, satisfaction: 4.1 },
    { name: 'Programmation C', students: 198, satisfaction: 4.3 },
    { name: 'Reseaux', students: 87, satisfaction: 4.0 }
  ];

  monthlyGrowth = [
    { month: 'Sep', users: 320 },
    { month: 'Oct', users: 385 },
    { month: 'Nov', users: 412 },
    { month: 'Dec', users: 445 },
    { month: 'Jan', users: 487 }
  ];

  keyMetrics = [
    {
      icon: 'show_chart',
      color: 'text-blue-600',
      value: '78%',
      label: "Taux d'engagement",
      change: '+12%',
    },
    {
      icon: 'trending_up',
      color: 'text-green-600',
      value: '73%',
      label: 'Progression moyenne',
      change: '+8%',
    },
    {
      icon: 'star',
      color: 'text-yellow-500',
      value: '4.3/5',
      label: 'Satisfaction moyenne',
      change: '+0.2',
    },
    {
      icon: 'people',
      color: 'text-purple-600',
      value: '487',
      label: 'Utilisateurs actifs',
      change: '+45',
    }
  ];

  systemHealth = [
    { service: 'Serveurs', status: 'Operationnel' },
    { service: 'Base de donnees', status: 'Operationnel' },
    { service: 'IA Assistant', status: 'Operationnel' },
    { service: 'Stockage', status: 'Operationnel' }
  ];

  get selectedPeriodLabel(): string {
    switch (this.selectedPeriod) {
      case 'month':
        return 'Ce mois';
      case 'year':
        return 'Cette annee';
      default:
        return 'Cette semaine';
    }
  }

  togglePeriodMenu() {
    this.isPeriodMenuOpen = !this.isPeriodMenuOpen;
  }

  selectPeriod(period: 'week' | 'month' | 'year') {
    this.selectedPeriod = period;
    this.isPeriodMenuOpen = false;
  }
}
