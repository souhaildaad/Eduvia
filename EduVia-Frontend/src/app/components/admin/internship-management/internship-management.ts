import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { timeout } from 'rxjs';

type Internship = {
  _id?: string;
  title: string;
  company: string;
  city: string;
  domain: string;
  duration: string;
  level: string;
  email: string;
  phone: string;
  website: string;
  deadline: string;
  description: string;
  skills: string[];
  address: string;
  latitude?: number | null;
  longitude?: number | null;
};

@Component({
  selector: 'app-internship-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './internship-management.html',
  styleUrls: ['./internship-management.css'],
})
export class InternshipManagement implements OnInit {
  private readonly localStorageKey = 'eduvia-admin-internships-local';
  internships: Internship[] = [];
  selectedSection: 'new' | 'list' = 'list';
  loading = false;
  error = '';
  saving = false;
  editingInternship: Internship | null = null;
  internshipToDelete: Internship | null = null;
  showSuccess = false;
  successMessage = '';
  showSaveError = false;
  saveErrorMessage = '';
  minDeadline = this.getTodayInputDate();
  form = this.emptyForm();
  currentPage = 1;
  readonly pageSize = 5;
  private successTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadInternships();
  }

  loadInternships() {
    this.loading = true;
    localStorage.removeItem(this.localStorageKey);
    this.http.get<Internship[]>('/api/internships').pipe(timeout(8000)).subscribe({
      next: internships => {
        this.internships = internships || [];
        this.currentPage = 1;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.internships = [];
        this.error = 'Impossible de charger les stages depuis la base de donnees.';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  selectSection(section: 'new' | 'list') {
    this.selectedSection = section;
    this.closeEdit();
    this.ensureCurrentPageInRange();
    if (section === 'new') {
      this.form = this.emptyForm();
    }
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.internships.length / this.pageSize));
  }

  get paginatedInternships() {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.internships.slice(start, start + this.pageSize);
  }

  get pageNumbers() {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  get paginationStart() {
    return this.internships.length === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get paginationEnd() {
    return Math.min(this.currentPage * this.pageSize, this.internships.length);
  }

  goToPage(page: number) {
    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
  }

  previousPage() {
    this.goToPage(this.currentPage - 1);
  }

  nextPage() {
    this.goToPage(this.currentPage + 1);
  }

  showForm() {
    this.selectedSection = 'new';
    this.form = this.emptyForm();
  }

  cancel() {
    this.selectedSection = 'list';
    this.editingInternship = null;
    this.form = this.emptyForm();
  }

  save(form?: NgForm) {
    this.error = '';
    this.hideSaveMessages();
    if (form?.invalid) {
      Object.values(form.controls).forEach(control => control.markAsTouched());
      this.error = 'Veuillez corriger les champs du formulaire avant d enregistrer.';
      return;
    }

    if (this.form.deadline < this.minDeadline) {
      this.error = "La date limite ne doit pas etre inferieure a la date d'aujourd'hui.";
      return;
    }

    this.saving = true;
    const payload = {
      ...this.form,
      level: this.form.level || this.editingInternship?.level || 'L2',
      skills: this.form.skillsText
        .split(/\n|,/)
        .map(skill => skill.trim())
        .filter(Boolean),
    };

    if (this.editingInternship) {
      this.updateInternship(payload);
      return;
    }

    this.cancel();
    this.saving = false;
    this.showSuccessMessage('Enregistrement reussi.');

    this.http.post<Internship>('/api/internships', payload).pipe(timeout(8000)).subscribe({
      next: internship => {
        this.internships = this.mergeInternships([internship], this.internships);
        this.currentPage = 1;
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.showSaveErrorMessage("Enregistrement impossible dans la base de donnees.");
      },
    });
  }

  editInternship(internship: Internship) {
    this.error = '';
    this.selectedSection = 'list';
    this.editingInternship = internship;
    this.form = this.internshipToForm(internship);
  }

  closeEdit() {
    this.editingInternship = null;
  }

  askDeleteInternship(internship: Internship) {
    this.error = '';
    this.internshipToDelete = internship;
  }

  closeDeleteConfirm() {
    this.internshipToDelete = null;
  }

  confirmDeleteInternship() {
    const internship = this.internshipToDelete;

    if (!internship?._id) {
      this.closeDeleteConfirm();
      return;
    }

    this.deleteInternship(internship);
  }

  private deleteInternship(internship: Internship) {
    if (!internship._id) {
      return;
    }

    this.http.delete(`/api/internships/${internship._id}`).subscribe({
      next: () => {
        this.internships = this.internships.filter(item => item._id !== internship._id);
        this.ensureCurrentPageInRange();
        this.closeDeleteConfirm();
        this.showSuccessMessage('Suppression reussie dans la base de donnees.');
      },
      error: () => {
        this.closeDeleteConfirm();
        this.error = 'Suppression impossible dans la base de donnees.';
      },
    });
  }

  private emptyForm() {
    return {
      title: '',
      company: '',
      city: '',
      domain: '',
      duration: '',
      level: 'L2',
      email: '',
      phone: '',
      website: '',
      deadline: '',
      description: '',
      skillsText: '',
      address: '',
    };
  }

  private getTodayInputDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private internshipToForm(internship: Internship) {
    return {
      title: internship.title || '',
      company: internship.company || '',
      city: internship.city || '',
      domain: internship.domain || '',
      duration: internship.duration || '',
      level: internship.level || 'L2',
      email: internship.email || '',
      phone: internship.phone || '',
      website: internship.website || '',
      deadline: internship.deadline || '',
      description: internship.description || '',
      skillsText: (internship.skills || []).join('\n'),
      address: internship.address || '',
    };
  }

  private updateInternship(payload: ReturnType<InternshipManagement['emptyForm']> & { skills: string[] }) {
    const editingId = this.editingInternship?._id;

    if (!editingId) {
      this.saving = false;
      this.error = 'Modification impossible.';
      return;
    }

    const optimisticInternship = { ...payload, _id: editingId };
    this.internships = this.internships.map(item =>
      item._id === editingId ? optimisticInternship : item,
    );
    this.saving = false;
    this.cancel();
    this.showSuccessMessage('Modification enregistree.');

    this.http.patch<Internship>(`/api/internships/${editingId}`, payload).pipe(timeout(8000)).subscribe({
      next: internship => {
        this.replaceInternship(editingId, internship);
      },
      error: () => {
        this.http.put<Internship>(`/api/internships/${editingId}`, payload).pipe(timeout(8000)).subscribe({
          next: internship => {
            this.replaceInternship(editingId, internship);
          },
          error: () => {
            this.showSaveErrorMessage("Modification impossible dans la base de donnees.");
          },
        });
      },
    });
  }

  private replaceInternship(editingId: string, internship: Internship) {
    this.internships = this.internships.map(item =>
      item._id === editingId ? internship : item,
    );
    this.ensureCurrentPageInRange();
  }

  private ensureCurrentPageInRange() {
    this.currentPage = Math.min(Math.max(this.currentPage, 1), this.totalPages);
  }

  private readLocalInternships(): Internship[] {
    try {
      const raw = localStorage.getItem(this.localStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveLocalInternship(internship: Internship) {
    const next = this.mergeInternships([internship], this.readLocalInternships());
    localStorage.setItem(this.localStorageKey, JSON.stringify(next));
  }

  private updateLocalInternship(internship: Internship) {
    const localInternships = this.readLocalInternships();
    const exists = localInternships.some(item => item._id === internship._id);
    const next = exists
      ? localInternships.map(item => (item._id === internship._id ? internship : item))
      : this.mergeInternships([internship], localInternships);
    localStorage.setItem(this.localStorageKey, JSON.stringify(next));
  }

  private removeLocalInternship(id: string) {
    const next = this.readLocalInternships().filter(item => item._id !== id);
    localStorage.setItem(this.localStorageKey, JSON.stringify(next));
  }

  private showSuccessMessage(message: string) {
    this.showSaveError = false;
    this.successMessage = message;
    this.showSuccess = true;
    clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => {
      this.showSuccess = false;
    }, 2600);
  }

  private showSaveErrorMessage(message: string) {
    this.showSuccess = false;
    this.saveErrorMessage = message;
    this.showSaveError = true;
    clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => {
      this.showSaveError = false;
    }, 3600);
  }

  private hideSaveMessages() {
    this.showSuccess = false;
    this.showSaveError = false;
    clearTimeout(this.successTimer);
  }

  private removeLocalInternshipBySignature(internship: Partial<Internship>) {
    const signature = this.internshipSignature(internship);
    const next = this.readLocalInternships().filter(item => this.internshipSignature(item) !== signature);
    localStorage.setItem(this.localStorageKey, JSON.stringify(next));
  }

  private mergeInternships(primary: Internship[], secondary: Internship[]) {
    const indexes = new Map<string, number>();
    const merged: Internship[] = [];

    [...primary, ...secondary].forEach(item => {
      const key = item._id || this.internshipSignature(item);
      const existingIndex = indexes.get(key);

      if (existingIndex !== undefined) {
        merged[existingIndex] = item;
        return;
      }

      indexes.set(key, merged.length);
      merged.push(item);
    });

    return merged;
  }

  private internshipSignature(internship: Partial<Internship>) {
    return [
      internship.title,
      internship.company,
      internship.city,
      internship.deadline,
    ]
      .map(value => String(value || '').trim().toLowerCase())
      .join('|');
  }
}
