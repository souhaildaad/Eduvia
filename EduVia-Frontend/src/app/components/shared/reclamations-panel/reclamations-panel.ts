import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

export interface ReclamationItem {
  id: string;
  _id?: string;
  subject: string;
  category: string;
  priority: 'Basse' | 'Moyenne' | 'Haute' | 'Urgente';
  message: string;
  status: 'En attente' | 'En cours' | 'Résolue' | 'Rejetée';
  adminResponse?: string;
  respondedAt?: string | null;
  respondedBy?: string;
  authorId?: string;
  authorName?: string;
  authorEmail?: string;
  authorRole?: 'student' | 'teacher' | 'admin';
  authorClass?: string;
  createdAt?: string;
  updatedAt?: string;
}

@Component({
  selector: 'app-reclamations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './reclamations-panel.html',
  styleUrl: './reclamations-panel.css',
})
export class ReclamationsPanelComponent implements OnInit {
  @Input() mode: 'student' | 'teacher' | 'admin' = 'student';

  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);

  reclamations: ReclamationItem[] = [];
  isLoading = false;
  isSubmitting = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' = 'success';

  // Form state for Student / Teacher
  editingId: string | null = null;
  subject = '';
  category = 'Pédagogique / Cours';
  customCategory = '';
  priority: 'Basse' | 'Moyenne' | 'Haute' | 'Urgente' = 'Moyenne';
  message = '';

  categories: string[] = [
    'Pédagogique / Cours',
    'Quiz & Évaluation',
    'Technique / Plateforme',
    'Compte & Accès',
    'Planning / Rappels',
    'Autre',
  ];

  readonly priorities: Array<'Basse' | 'Moyenne' | 'Haute' | 'Urgente'> = [
    'Basse',
    'Moyenne',
    'Haute',
    'Urgente',
  ];

  readonly statuses: Array<'En attente' | 'En cours' | 'Résolue' | 'Rejetée'> = [
    'En attente',
    'En cours',
    'Résolue',
    'Rejetée',
  ];

  // Filters
  statusFilter: string = 'ALL';
  roleFilter: 'ALL' | 'student' | 'teacher' = 'ALL';
  priorityFilter: string = 'ALL';
  searchQuery = '';

  // Admin inline edit drafts
  adminDrafts: Record<string, { status: ReclamationItem['status']; adminResponse: string; saving?: boolean }> = {};

  ngOnInit(): void {
    this.loadReclamations();
  }

  loadReclamations(): void {
    this.isLoading = true;
    this.http.get<any>('/api/reclamations').subscribe({
      next: response => {
        const list = Array.isArray(response?.items)
          ? response.items
          : Array.isArray(response?.data)
            ? response.data
            : Array.isArray(response)
              ? response
              : [];
        this.reclamations = list.map((item: any) => ({
          ...item,
          id: String(item.id || item._id || ''),
          subject: String(item.subject || item.title || ''),
          category: String(item.category || 'Pédagogique / Cours'),
          priority: item.priority || 'Moyenne',
          message: String(item.message || item.description || ''),
          status: item.status || 'En attente',
          adminResponse: String(item.adminResponse || ''),
          authorRole: item.authorRole || 'student',
        }));
        for (const rec of this.reclamations) {
          if (rec.category && !this.categories.includes(rec.category)) {
            const autreIdx = this.categories.indexOf('Autre');
            if (autreIdx >= 0) {
              this.categories.splice(autreIdx, 0, rec.category);
            } else {
              this.categories.push(rec.category);
            }
          }
          if (!this.adminDrafts[rec.id]) {
            this.adminDrafts[rec.id] = {
              status: rec.status,
              adminResponse: rec.adminResponse || '',
            };
          } else {
            this.adminDrafts[rec.id].status = rec.status;
            this.adminDrafts[rec.id].adminResponse = rec.adminResponse || '';
          }
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.showFeedback('Impossible de charger les réclamations pour le moment.', 'error');
        this.cdr.detectChanges();
      },
    });
  }

  get filteredReclamations(): ReclamationItem[] {
    const query = this.searchQuery.trim().toLowerCase();
    return this.reclamations.filter(item => {
      if (this.statusFilter !== 'ALL' && item.status !== this.statusFilter) {
        return false;
      }
      if (this.mode === 'admin' && this.roleFilter !== 'ALL' && item.authorRole !== this.roleFilter) {
        return false;
      }
      if (this.priorityFilter !== 'ALL' && item.priority !== this.priorityFilter) {
        return false;
      }
      if (query) {
        const haystack = [
          item.subject,
          item.message,
          item.category,
          item.authorName,
          item.authorEmail,
          item.authorClass,
          item.adminResponse,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }

  get totalCount(): number {
    return this.reclamations.length;
  }

  get pendingCount(): number {
    return this.reclamations.filter(r => r.status === 'En attente').length;
  }

  get inProgressCount(): number {
    return this.reclamations.filter(r => r.status === 'En cours').length;
  }

  get resolvedCount(): number {
    return this.reclamations.filter(r => r.status === 'Résolue').length;
  }

  get studentsCount(): number {
    return this.reclamations.filter(r => r.authorRole === 'student').length;
  }

  get teachersCount(): number {
    return this.reclamations.filter(r => r.authorRole === 'teacher').length;
  }

  submitReclamation(): void {
    const trimmedSubject = this.subject.trim();
    const trimmedMessage = this.message.trim();
    const trimmedCustomCategory = this.customCategory.trim();
    if (!trimmedSubject || !trimmedMessage) {
      this.showFeedback('Veuillez renseigner le sujet et la description de votre réclamation.', 'error');
      return;
    }
    if (this.category === 'Autre' && !trimmedCustomCategory) {
      this.showFeedback('Veuillez créer / préciser le type de réclamation pour « Autre ».', 'error');
      return;
    }

    const finalCategory = this.category === 'Autre' ? trimmedCustomCategory : this.category;
    if (finalCategory && !this.categories.includes(finalCategory)) {
      const autreIdx = this.categories.indexOf('Autre');
      if (autreIdx >= 0) {
        this.categories.splice(autreIdx, 0, finalCategory);
      } else {
        this.categories.push(finalCategory);
      }
    }

    this.isSubmitting = true;
    const payload = {
      subject: trimmedSubject,
      category: finalCategory,
      priority: this.priority,
      message: trimmedMessage,
    };

    const request$ = this.editingId
      ? this.http.patch<any>(`/api/reclamations/${this.editingId}`, payload)
      : this.http.post<any>('/api/reclamations', payload);

    request$.subscribe({
      next: () => {
        this.isSubmitting = false;
        const wasEdit = !!this.editingId;
        this.resetForm();
        this.showFeedback(
          wasEdit
            ? 'Votre réclamation a été mise à jour avec succès.'
            : "Votre réclamation a été envoyée à l'administration.",
          'success',
        );
        this.loadReclamations();
      },
      error: err => {
        this.isSubmitting = false;
        this.showFeedback(
          err?.error?.message || "Une erreur est survenue lors de l'envoi de la réclamation.",
          'error',
        );
        this.cdr.detectChanges();
      },
    });
  }

  startEdit(item: ReclamationItem): void {
    if (item.status !== 'En attente') {
      return;
    }
    this.editingId = item.id;
    this.subject = item.subject;
    const defaultCats = [
      'Pédagogique / Cours',
      'Quiz & Évaluation',
      'Technique / Plateforme',
      'Compte & Accès',
      'Planning / Rappels',
    ];
    if (defaultCats.includes(item.category)) {
      this.category = item.category;
      this.customCategory = '';
    } else {
      this.category = 'Autre';
      this.customCategory = item.category;
    }
    this.priority = item.priority;
    this.message = item.message;
  }

  resetForm(): void {
    this.editingId = null;
    this.subject = '';
    this.category = 'Pédagogique / Cours';
    this.customCategory = '';
    this.priority = 'Moyenne';
    this.message = '';
  }

  saveAdminDecision(item: ReclamationItem, quickStatus?: ReclamationItem['status']): void {
    const draft = this.adminDrafts[item.id] || {
      status: item.status,
      adminResponse: item.adminResponse || '',
    };
    const nextStatus = quickStatus || draft.status;
    draft.saving = true;
    this.adminDrafts[item.id] = draft;

    this.http
      .patch<any>(`/api/reclamations/${item.id}`, {
        status: nextStatus,
        adminResponse: draft.adminResponse,
      })
      .subscribe({
        next: () => {
          draft.saving = false;
          this.showFeedback(`Réclamation « ${item.subject} » mise à jour (${nextStatus}).`, 'success');
          this.loadReclamations();
        },
        error: err => {
          draft.saving = false;
          this.showFeedback(err?.error?.message || 'Échec de la mise à jour.', 'error');
          this.cdr.detectChanges();
        },
      });
  }

  deleteReclamation(item: ReclamationItem): void {
    this.http.delete<any>(`/api/reclamations/${item.id}`).subscribe({
      next: () => {
        this.reclamations = this.reclamations.filter(r => r.id !== item.id);
        this.showFeedback('Réclamation supprimée.', 'success');
        this.cdr.detectChanges();
      },
      error: () => {
        this.showFeedback('Impossible de supprimer cette réclamation.', 'error');
        this.cdr.detectChanges();
      },
    });
  }

  private showFeedback(msg: string, type: 'success' | 'error'): void {
    this.feedbackMessage = msg;
    this.feedbackType = type;
    setTimeout(() => {
      if (this.feedbackMessage === msg) {
        this.feedbackMessage = '';
        this.cdr.detectChanges();
      }
    }, 4500);
  }
}

