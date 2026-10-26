import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';

type ClubRecommendation = {
  id: string;
  name: string;
  category: string;
  description: string;
  activities: string[];
  email: string;
  recommendationRate: number;
  matchedCourses: string[];
  matchedKeywords: string[];
  recommendationReason: string;
};

type StudiedCourse = {
  title: string;
  score: number;
  studiedCount: number;
};

type ClubsPayload = {
  source: 'student-progress' | 'global-studied-courses';
  studiedCourses: StudiedCourse[];
  recommendations: ClubRecommendation[];
  clubs: ClubRecommendation[];
};

@Component({
  selector: 'app-club-suggestions',
  imports: [CommonModule, HttpClientModule],
  templateUrl: './club-suggestions.html',
  styleUrl: './club-suggestions.css',
})
export class ClubSuggestions implements OnInit {
  recommendations: ClubRecommendation[] = [];
  allClubs: ClubRecommendation[] = [];
  studiedCourses: StudiedCourse[] = [];
  selectedCategory = 'Tous';
  categories: string[] = ['Tous'];
  isLoading = true;
  errorMessage = '';
  sourceLabel = '';

  constructor(
    private readonly http: HttpClient,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadClubRecommendations();
  }

  get filteredClubs(): ClubRecommendation[] {
    if (this.selectedCategory === 'Tous') {
      return this.allClubs;
    }

    return this.allClubs.filter(club => club.category === this.selectedCategory);
  }

  loadClubRecommendations(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<ClubsPayload>('/api/clubs/recommendations?limit=6').subscribe({
      next: payload => {
        this.recommendations = payload.recommendations || [];
        this.allClubs = payload.clubs || [];
        this.studiedCourses = payload.studiedCourses || [];
        this.categories = [
          'Tous',
          ...Array.from(new Set(this.allClubs.map(club => club.category))).sort((a, b) =>
            a.localeCompare(b, 'fr'),
          ),
        ];
        this.sourceLabel =
          payload.source === 'student-progress'
            ? 'Base sur tes cours termines et les themes de ton parcours'
            : 'Suggestions pour decouvrir les clubs disponibles';
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMessage = 'Impossible de charger les recommandations de clubs.';
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
  }
}
