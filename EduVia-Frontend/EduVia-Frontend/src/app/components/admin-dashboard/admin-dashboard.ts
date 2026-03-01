import { Component, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { PlatformStatistics } from '../admin/platform-statistics/platform-statistics';
import { UserManagement } from '../admin/user-management/user-management';

@Component({
  selector: 'app-admin-dashboard',
  imports: [
    CommonModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    PlatformStatistics,
    UserManagement,
  ],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard {
  logout = output();

  onLogout() {
    this.logout.emit();
  }
}
