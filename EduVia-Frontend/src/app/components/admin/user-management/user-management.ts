import { ChangeDetectorRef, Component, OnDestroy, OnInit, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../../services/auth.service';

type UserRole = 'teacher' | 'student';
type UserAccountStatus = 'active' | 'pending' | 'blocked';
const DEFAULT_CLASSES = ['1A1', '1A2', '1A3', '1A4', '1A5'];

interface User {
  id: number | string;
  name: string;
  email: string;
  role: UserRole;
  className?: string | null;
  assignedClasses?: string[];
  teachingSubjects?: string[];
  teachingAssignments?: TeachingAssignment[];
  isVerified: boolean;
  accountStatus: UserAccountStatus;
  createdAt: Date;
  isActive: boolean;
  isBlocked?: boolean;
  passwordChanged?: boolean;
  lastActivity?: string;
  lastActivityAt?: Date | null;
  firstLoginAt?: Date | null;
  passwordChangedAt?: Date | null;
}

interface TeachingAssignment {
  subject: string;
  classes: string[];
}

interface UserForm {
  name: string;
  email: string;
  role: UserRole | '';
  className: string;
  assignedClasses: string[];
  teachingSubjectsText: string;
  teachingSubjects: string[];
  teachingAssignments: TeachingAssignment[];
}

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    FormsModule,
    HttpClientModule,
  ],
  templateUrl: './user-management.html',
  styleUrls: ['./user-management.css'],
})
export class UserManagement implements OnInit, OnDestroy {
  rawSearchQuery = '';
  usersUpdated = output<void>();
  selectedRole: 'all' | UserRole = 'all';
  users: User[] = [];
  studentClasses: string[] = [];
  loading = false;

  showAddUserModal = false;
  showEditUserModal = false;
  showDeleteModal = false;
  showSuccessModal = false;
  showErrorModal = false;

  isCreatingUser = false;
  isFilterMenuOpen = false;
  isAddRoleMenuOpen = false;
  isEditRoleMenuOpen = false;
  isNewClassesMenuOpen = false;
  isEditClassesMenuOpen = false;
  isNewStudentClassMenuOpen = false;
  isEditStudentClassMenuOpen = false;

  newUser: UserForm = this.getEmptyForm();
  editingUserId: number | string | null = null;
  editUser: UserForm = this.getEmptyForm();
  pendingDeleteUser: User | null = null;
  successMessage = '';
  errorMessage = '';
  private activityTickTimer: ReturnType<typeof setInterval> | null = null;
  private nowTs = Date.now();

  constructor(
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadUsers();
    this.loadStudentClasses();
    this.activityTickTimer = setInterval(() => {
      this.nowTs = Date.now();
    }, 60_000);
  }

  ngOnDestroy() {
    if (this.activityTickTimer) {
      clearInterval(this.activityTickTimer);
      this.activityTickTimer = null;
    }
  }

  loadUsers() {
    this.loading = true;

    this.authService.getUsers().subscribe({
      next: (response) => {
        Promise.resolve().then(() => {
          this.users = (response?.data || response || [])
            .filter((user: any) => user.role === 'teacher' || user.role === 'student')
            .map((user: any) => {
              const assignedClasses = this.resolveAssignedClasses(user);
              const teachingAssignments = this.resolveTeachingAssignments(user, assignedClasses);
              const normalizedUser = {
                ...user,
                id: user.id || user._id || user.keycloakId,
                name: this.buildDisplayName(user),
                role: user.role as UserRole,
                className: this.resolveStudentClassName(user),
                assignedClasses,
                teachingSubjects: teachingAssignments.map((assignment) => assignment.subject),
                teachingAssignments,
                isVerified: user.emailVerified ?? user.isVerified ?? user.verified ?? false,
                createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
                isActive: user.isActive ?? !user.isBlocked,
                isBlocked: !!user.isBlocked,
                passwordChanged: !!user.passwordChanged,
                firstLoginAt: user.firstLoginAt ? new Date(user.firstLoginAt) : null,
                passwordChangedAt: user.passwordChangedAt
                  ? new Date(user.passwordChangedAt)
                  : user.lastPasswordChange
                    ? new Date(user.lastPasswordChange)
                    : null,
                lastActivityAt: this.resolveLastActivityAt(user),
                lastActivity: user.lastActivity || ''
              };

              return {
                ...normalizedUser,
                accountStatus: this.getAccountStatus(normalizedUser),
              };
            });
          this.loading = false;
          this.usersUpdated.emit();
          this.cdr.detectChanges();
        });
      },
      error: (error) => {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        Promise.resolve().then(() => {
          this.loadMockUsers();
          this.loading = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  get filteredUsers(): User[] {
    const normalizedSearch = this.rawSearchQuery.trim().toLowerCase();

    return this.users.filter((user) => {
      const userName = user.name.toLowerCase();
      const userEmail = user.email.toLowerCase();
      const nameWords = userName.split(/\s+/);

      const matchesSearch =
        normalizedSearch === '' ||
        userName.startsWith(normalizedSearch) ||
        userEmail.startsWith(normalizedSearch) ||
        nameWords.some((word) => word.startsWith(normalizedSearch));
      const matchesRole = this.selectedRole === 'all' || user.role === this.selectedRole;
      return matchesSearch && matchesRole;
    });
  }

  get userCounts() {
    return {
      all: this.users.length,
      teacher: this.users.filter((u) => u.role === 'teacher').length,
      student: this.users.filter((u) => u.role === 'student').length
    };
  }

  get selectedRoleLabel(): string {
    return this.selectedRole === 'all'
      ? 'Tous les roles'
      : this.getRoleLabel(this.selectedRole);
  }

  get addRoleLabel(): string {
    return this.newUser.role ? this.getRoleLabel(this.newUser.role) : 'Selectionner un role';
  }

  get isCreateUserFormValid(): boolean {
    if (!this.newUser.name.trim() || !this.newUser.email.trim() || !this.newUser.role) {
      return false;
    }

    if (this.newUser.role === 'student') {
      return !!this.newUser.className.trim();
    }

    return (
      this.newUser.assignedClasses.length > 0 &&
      this.hasValidTeachingAssignments(this.newUser)
    );
  }

  get editRoleLabel(): string {
    return this.editUser.role ? this.getRoleLabel(this.editUser.role) : 'Selectionner un role';
  }

  get newAssignedClassesLabel(): string {
    return this.getAssignedClassesLabel(this.newUser.assignedClasses);
  }

  get editAssignedClassesLabel(): string {
    return this.getAssignedClassesLabel(this.editUser.assignedClasses);
  }

  get newStudentClassLabel(): string {
    return this.newUser.className || 'Selectionnez une classe';
  }

  get editStudentClassLabel(): string {
    return this.editUser.className || 'Selectionnez une classe';
  }

  get isEditUserFormValid(): boolean {
    if (!this.editUser.name.trim() || !this.editUser.email.trim() || !this.editUser.role) {
      return false;
    }

    if (this.editUser.role === 'student') {
      return !!this.editUser.className.trim();
    }

    return (
      this.editUser.assignedClasses.length > 0 &&
      this.hasValidTeachingAssignments(this.editUser)
    );
  }

  getRoleIcon(role: UserRole): string {
    return role === 'teacher' ? 'person_search' : 'school';
  }

  getRoleLabel(role: UserRole): string {
    return role === 'teacher' ? 'Enseignant' : 'Etudiant';
  }

  getRoleChipClass(role: UserRole): string {
    return role === 'teacher' ? 'chip chip--teacher' : 'chip chip--student';
  }

  getRolePanelClass(role: UserRole): string {
    return role === 'teacher' ? 'avatar avatar--teacher' : 'avatar avatar--student';
  }

  getAccountStatusClass(status: UserAccountStatus): string {
    if (status === 'active') {
      return 'verification-chip verification-chip--verified';
    }

    if (status === 'blocked') {
      return 'verification-chip verification-chip--blocked';
    }

    return 'verification-chip verification-chip--pending';
  }

  getVerificationClass(isVerified: boolean): string {
    return isVerified ? 'verification-chip verification-chip--verified' : 'verification-chip verification-chip--pending';
  }

  getVerificationLabel(isVerified: boolean): string {
    return isVerified ? 'Verifie' : 'Non verifie';
  }

  getAccountStatusLabel(status: UserAccountStatus): string {
    if (status === 'active') {
      return 'Actif';
    }

    if (status === 'blocked') {
      return 'Bloque';
    }

    return 'En attente';
  }

  getLastActivityLabel(user: User): string {
    if (!user.lastActivityAt || Number.isNaN(user.lastActivityAt.getTime())) {
      return 'Aucune activite recente';
    }

    const diffMs = Math.max(0, this.nowTs - user.lastActivityAt.getTime());
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) return 'A l instant';
    if (diffMs < hour) {
      const minutes = Math.floor(diffMs / minute);
      return `Il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
    if (diffMs < day) {
      const hours = Math.floor(diffMs / hour);
      return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`;
    }

    const days = Math.floor(diffMs / day);
    return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
  }

  trackByUserId(_: number, user: User) {
    return user.id;
  }

  onSearchInput(value: string) {
    this.rawSearchQuery = value ?? '';
  }

  toggleFilterMenu() {
    this.isFilterMenuOpen = !this.isFilterMenuOpen;
  }

  selectFilterRole(role: 'all' | UserRole) {
    this.selectedRole = role;
    this.isFilterMenuOpen = false;
  }

  openAddUserDialog() {
    this.newUser = this.getEmptyForm();
    this.isAddRoleMenuOpen = false;
    this.isNewClassesMenuOpen = false;
    this.isNewStudentClassMenuOpen = false;
    this.loadStudentClasses();
    this.showAddUserModal = true;
  }

  closeAddUserDialog() {
    this.showAddUserModal = false;
    this.isCreatingUser = false;
    this.isAddRoleMenuOpen = false;
    this.isNewClassesMenuOpen = false;
    this.isNewStudentClassMenuOpen = false;
  }

  toggleAddRoleMenu() {
    this.isAddRoleMenuOpen = !this.isAddRoleMenuOpen;
  }

  selectAddRole(role: UserRole) {
    this.newUser.role = role;
    if (role === 'student') {
      this.newUser.assignedClasses = [];
      this.newUser.teachingSubjectsText = '';
      this.newUser.teachingSubjects = [];
      this.newUser.teachingAssignments = [];
      this.isNewClassesMenuOpen = false;
      this.loadStudentClasses();
    } else {
      this.newUser.className = '';
      this.isNewStudentClassMenuOpen = false;
      this.loadStudentClasses();
    }
    this.isAddRoleMenuOpen = false;
  }

  createUser() {
    if (!this.isCreateUserFormValid) {
      return;
    }

    this.isCreatingUser = true;

    const normalizedName = this.newUser.name.trim();
    const [firstName, ...lastNameParts] = normalizedName.split(/\s+/);
    const lastName = lastNameParts.join(' ').trim();
    const email = this.newUser.email.trim().toLowerCase();
    const role = this.newUser.role as UserRole;
    const username = email;

    this.authService.createUser({
      name: normalizedName,
      email,
      role,
      username,
      firstName,
      lastName,
      className: role === 'student' ? this.newUser.className.trim() : undefined,
      assignedClasses: role === 'teacher' ? this.newUser.assignedClasses : undefined,
      teachingSubjects: role === 'teacher' ? this.newUser.teachingSubjects : undefined,
      teachingAssignments: role === 'teacher' ? this.newUser.teachingAssignments : undefined,
    }).subscribe({
      next: (response) => {
        this.closeAddUserDialog();
        this.loadUsers();
        const result = response?.data ?? response;
        if (result?.emailSent) {
          this.openSuccessModal('Utilisateur créé. E-mail de confirmation envoyé.');
        } else {
          const reason = result?.emailError ? ` Cause : ${result.emailError}.` : '';
          const credentials = result?.temporaryPassword
            ? ` Transmettez ces identifiants manuellement — Identifiant : ${email} / Mot de passe temporaire : ${result.temporaryPassword}`
            : '';
          this.openSuccessModal(`Utilisateur créé, mais l’e-mail n’a pas été envoyé.${reason}${credentials}`);
        }
      },
      error: (error) => {
        console.error('Erreur lors de la creation:', error);
        this.isCreatingUser = false;
        this.openErrorModal(error?.error?.message || "La creation a echoue cote backend.");
      }
    });
  }

  openEditUserDialog(user: User) {
    this.editingUserId = user.id;
    this.editUser = {
      name: user.name,
      email: user.email,
      role: user.role,
      className: user.className || '',
      assignedClasses: [...(user.assignedClasses || [])],
      teachingSubjects: [...(user.teachingSubjects || [])],
      teachingSubjectsText: (user.teachingSubjects || []).join(', '),
      teachingAssignments: this.resolveTeachingAssignments(user, user.assignedClasses || [])
    };
    this.isEditRoleMenuOpen = false;
    this.isEditClassesMenuOpen = false;
    this.isEditStudentClassMenuOpen = false;
    this.loadStudentClasses();
    this.showEditUserModal = true;
  }

  closeEditUserDialog() {
    this.showEditUserModal = false;
    this.isEditRoleMenuOpen = false;
    this.isEditClassesMenuOpen = false;
    this.isEditStudentClassMenuOpen = false;
    this.editingUserId = null;
  }

  toggleEditRoleMenu() {
    this.isEditRoleMenuOpen = !this.isEditRoleMenuOpen;
  }

  selectEditRole(role: UserRole) {
    this.editUser.role = role;
    if (role === 'student') {
      this.editUser.assignedClasses = [];
      this.editUser.teachingSubjectsText = '';
      this.editUser.teachingSubjects = [];
      this.editUser.teachingAssignments = [];
      this.isEditClassesMenuOpen = false;
      this.loadStudentClasses();
    } else {
      this.editUser.className = '';
      this.isEditStudentClassMenuOpen = false;
      this.loadStudentClasses();
    }
    this.isEditRoleMenuOpen = false;
  }

  saveUserChanges() {
    if (!this.editingUserId || !this.isEditUserFormValid) {
      return;
    }

    const normalizedName = this.editUser.name.trim();
    const [firstName, ...lastNameParts] = normalizedName.split(/\s+/);
    const lastName = lastNameParts.join(' ').trim();
    const email = this.editUser.email.trim().toLowerCase();
    const role = this.editUser.role as UserRole;

    this.authService.updateUser(this.editingUserId, {
      name: normalizedName,
      email,
      role,
      username: email,
      firstName,
      lastName,
      className: role === 'student' ? this.editUser.className.trim() : undefined,
      assignedClasses: role === 'teacher' ? this.editUser.assignedClasses : undefined,
      teachingSubjects: role === 'teacher' ? this.editUser.teachingSubjects : undefined,
      teachingAssignments: role === 'teacher' ? this.editUser.teachingAssignments : undefined,
    }).subscribe({
      next: () => {
        this.closeEditUserDialog();
        this.loadUsers();
        this.openSuccessModal('Utilisateur modifie avec succes dans la base et Keycloak.');
      },
      error: (error) => {
        console.error('Erreur lors de la modification:', error);
        this.openErrorModal(error?.error?.message || 'La modification a echoue cote backend.');
      }
    });
  }

  openDeleteModal(user: User) {
    this.pendingDeleteUser = user;
    this.showDeleteModal = true;
  }

  closeDeleteModal() {
    this.pendingDeleteUser = null;
    this.showDeleteModal = false;
  }

  confirmDeleteUser() {
    if (!this.pendingDeleteUser) {
      return;
    }

    const userId = this.pendingDeleteUser.id;

    this.authService.deleteUser(userId).subscribe({
      next: () => {
        this.closeDeleteModal();
        this.loadUsers();
        this.openSuccessModal('Utilisateur supprime avec succes de la base et de Keycloak.');
      },
      error: (error) => {
        console.error('Erreur lors de la suppression:', error);
        this.openErrorModal(error?.error?.message || 'La suppression a echoue cote backend.');
      }
    });
  }

  resendVerification(user: User) {
    this.authService.resendVerificationEmail(user.id).subscribe({
      next: (response) => {
        const result = response?.data ?? response;
        if (result?.emailVerified) {
          this.openSuccessModal('Cette adresse e-mail est déjà confirmée.');
        } else if (result?.emailSent) {
          this.openSuccessModal('E-mail de confirmation envoyé. Vérifiez aussi les courriers indésirables.');
        } else {
          this.openErrorModal("L’e-mail n’a pas été envoyé. Vérifiez la configuration SMTP Django.");
        }
      },
      error: (error) => this.openErrorModal(error?.error?.message || "Impossible d’envoyer l’e-mail de confirmation.")
    });
  }

  closeSuccessModal() {
    this.showSuccessModal = false;
    this.successMessage = '';
  }

  closeErrorModal() {
    this.showErrorModal = false;
    this.errorMessage = '';
  }

  private openSuccessModal(message: string) {
    this.successMessage = message;
    this.showSuccessModal = true;
  }

  private openErrorModal(message: string) {
    this.errorMessage = message;
    this.showErrorModal = true;
  }

  private getEmptyForm(): UserForm {
    return {
      name: '',
      email: '',
      role: '',
      className: '',
      assignedClasses: [],
      teachingSubjectsText: '',
      teachingSubjects: [],
      teachingAssignments: []
    };
  }

  onAssignedClassesChange(target: 'new' | 'edit', event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedValues = Array.from(select.selectedOptions).map((option) => option.value);

    if (target === 'new') {
      this.newUser.assignedClasses = selectedValues;
      this.syncTeachingAssignmentsWithClasses(this.newUser);
      return;
    }

    this.editUser.assignedClasses = selectedValues;
    this.syncTeachingAssignmentsWithClasses(this.editUser);
  }

  toggleAssignedClassesMenu(target: 'new' | 'edit') {
    if (target === 'new') {
      this.isNewClassesMenuOpen = !this.isNewClassesMenuOpen;
      return;
    }

    this.isEditClassesMenuOpen = !this.isEditClassesMenuOpen;
  }

  closeAssignedClassesMenu(target: 'new' | 'edit') {
    if (target === 'new') {
      this.isNewClassesMenuOpen = false;
      return;
    }

    this.isEditClassesMenuOpen = false;
  }

  toggleAssignedClass(target: 'new' | 'edit', className: string) {
    const currentValues = target === 'new' ? this.newUser.assignedClasses : this.editUser.assignedClasses;

    const nextValues = currentValues.includes(className)
      ? currentValues.filter((value) => value !== className)
      : [...currentValues, className];

    if (target === 'new') {
      this.newUser.assignedClasses = nextValues;
      this.syncTeachingAssignmentsWithClasses(this.newUser);
      return;
    }

    this.editUser.assignedClasses = nextValues;
    this.syncTeachingAssignmentsWithClasses(this.editUser);
  }

  isAssignedClassSelected(target: 'new' | 'edit', className: string): boolean {
    const currentValues = target === 'new' ? this.newUser.assignedClasses : this.editUser.assignedClasses;
    return currentValues.includes(className);
  }

  removeAssignedClass(target: 'new' | 'edit', className: string) {
    if (target === 'new') {
      this.newUser.assignedClasses = this.newUser.assignedClasses.filter((value) => value !== className);
      this.syncTeachingAssignmentsWithClasses(this.newUser);
      return;
    }

    this.editUser.assignedClasses = this.editUser.assignedClasses.filter((value) => value !== className);
    this.syncTeachingAssignmentsWithClasses(this.editUser);
  }

  onTeachingSubjectsInput(target: 'new' | 'edit') {
    const form = target === 'new' ? this.newUser : this.editUser;
    form.teachingSubjects = this.parseTeachingSubjects(form.teachingSubjectsText);
    this.syncTeachingAssignmentsWithSubjects(form);
  }

  removeTeachingSubject(target: 'new' | 'edit', subject: string) {
    const form = target === 'new' ? this.newUser : this.editUser;
    form.teachingSubjects = form.teachingSubjects.filter((value) => value !== subject);
    form.teachingAssignments = form.teachingAssignments.filter(
      (assignment) => assignment.subject !== subject,
    );
    form.teachingSubjectsText = form.teachingSubjects.join(', ');
  }

  setSubjectForAllClasses(form: UserForm, subject: string) {
    this.updateTeachingAssignmentClasses(form, subject, form.assignedClasses);
  }

  toggleSubjectClass(form: UserForm, subject: string, className: string) {
    const assignment = this.findTeachingAssignment(form, subject);
    const currentClasses = assignment?.classes || [];
    const nextClasses = currentClasses.includes(className)
      ? currentClasses.filter((value) => value !== className)
      : [...currentClasses, className];

    this.updateTeachingAssignmentClasses(form, subject, nextClasses);
  }

  isSubjectClassSelected(form: UserForm, subject: string, className: string): boolean {
    return !!this.findTeachingAssignment(form, subject)?.classes.includes(className);
  }

  isSubjectForAllClasses(form: UserForm, subject: string): boolean {
    const assignment = this.findTeachingAssignment(form, subject);
    return (
      !!assignment &&
      form.assignedClasses.length > 0 &&
      assignment.classes.length === form.assignedClasses.length &&
      form.assignedClasses.every((className) => assignment.classes.includes(className))
    );
  }

  toggleStudentClassMenu(target: 'new' | 'edit') {
    if (target === 'new') {
      this.isNewStudentClassMenuOpen = !this.isNewStudentClassMenuOpen;
      return;
    }

    this.isEditStudentClassMenuOpen = !this.isEditStudentClassMenuOpen;
  }

  selectStudentClass(target: 'new' | 'edit', className: string) {
    if (target === 'new') {
      this.newUser.className = className;
      this.isNewStudentClassMenuOpen = false;
      return;
    }

    this.editUser.className = className;
    this.isEditStudentClassMenuOpen = false;
  }

  private getAssignedClassesLabel(assignedClasses: string[]): string {
    if (assignedClasses.length === 0) {
      return 'Selectionnez une ou plusieurs classes';
    }

    if (assignedClasses.length === 1) {
      return assignedClasses[0];
    }

    return `${assignedClasses.length} classes selectionnees`;
  }

  getTeachingAssignmentLabel(user: User, assignment: TeachingAssignment): string {
    const assignedClasses = user.assignedClasses || [];
    const classes = assignment.classes || [];

    if (
      assignedClasses.length > 0 &&
      classes.length === assignedClasses.length &&
      assignedClasses.every((className) => classes.includes(className))
    ) {
      return `${assignment.subject} - toutes les classes`;
    }

    return `${assignment.subject} - ${classes.join(', ')}`;
  }

  private hasValidTeachingAssignments(form: UserForm): boolean {
    return (
      form.teachingAssignments.length > 0 &&
      form.teachingAssignments.every(
        (assignment) =>
          !!assignment.subject.trim() &&
          assignment.classes.length > 0 &&
          assignment.classes.every((className) => form.assignedClasses.includes(className)),
      )
    );
  }

  private findTeachingAssignment(form: UserForm, subject: string): TeachingAssignment | undefined {
    return form.teachingAssignments.find((assignment) => assignment.subject === subject);
  }

  private updateTeachingAssignmentClasses(form: UserForm, subject: string, classes: string[]) {
    const normalizedClasses = classes.filter(
      (className, index, array) =>
        form.assignedClasses.includes(className) && array.indexOf(className) === index,
    );

    form.teachingAssignments = form.teachingAssignments.map((assignment) =>
      assignment.subject === subject
        ? {
            ...assignment,
            classes: normalizedClasses,
          }
        : assignment,
    );
  }

  private syncTeachingAssignmentsWithSubjects(form: UserForm) {
    form.teachingAssignments = form.teachingSubjects.map((subject) => {
      const existingAssignment = this.findTeachingAssignment(form, subject);
      const existingClasses = (existingAssignment?.classes || []).filter((className) =>
        form.assignedClasses.includes(className),
      );

      return {
        subject,
        classes: existingClasses.length > 0 ? existingClasses : [...form.assignedClasses],
      };
    });
  }

  private syncTeachingAssignmentsWithClasses(form: UserForm) {
    form.teachingAssignments = form.teachingAssignments.map((assignment) => {
      const classes = assignment.classes.filter((className) =>
        form.assignedClasses.includes(className),
      );

      return {
        ...assignment,
        classes: classes.length > 0 ? classes : [...form.assignedClasses],
      };
    });
  }

  private loadStudentClasses() {
    this.authService.getStudentClasses().subscribe({
      next: (response) => {
        const apiClasses = (response?.data || response || [])
          .filter((value: unknown) => typeof value === 'string')
          .map((value: string) => value.trim())
          .filter((value: string, index: number, array: string[]) => !!value && array.indexOf(value) === index);
        this.studentClasses = [...new Set([...DEFAULT_CLASSES, ...apiClasses])];
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Erreur lors du chargement des classes:', error);
        this.studentClasses = [...DEFAULT_CLASSES];
        this.cdr.detectChanges();
      }
    });
  }

  private buildDisplayName(user: any): string {
    const fullName = [user.firstName, user.lastName]
      .filter((value: string | undefined) => !!value)
      .join(' ')
      .trim();

    return user.name || fullName || user.username || user.email;
  }

  private resolveStudentClassName(user: any): string {
    if (user?.role === 'teacher') {
      return '';
    }

    const classCandidates = [
      user.className,
      user.studentClass,
      user.class,
      user.classe,
      Array.isArray(user.classes) ? user.classes[0] : undefined,
      Array.isArray(user.assignedClasses) ? user.assignedClasses[0] : undefined,
    ];

    for (const value of classCandidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return '';
  }

  private resolveAssignedClasses(user: any): string[] {
    const candidates = [
      user.assignedClasses,
      user.classes,
      user.classNames,
      user.affectedClasses,
    ];

    for (const value of candidates) {
      if (!Array.isArray(value)) {
        continue;
      }

      const normalizedValues = value
        .filter((item: unknown) => typeof item === 'string')
        .map((item: string) => item.trim())
        .filter((item: string, index: number, array: string[]) => !!item && array.indexOf(item) === index);

      if (normalizedValues.length > 0) {
        return normalizedValues;
      }
    }

    const classNameCandidates = [
      user.className,
      user.teacherClasses,
      user.classLabel,
    ];

    for (const value of classNameCandidates) {
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }

      const normalizedValues = value
        .split(/[;,/|]/)
        .map((item: string) => item.trim())
        .filter((item: string, index: number, array: string[]) => !!item && array.indexOf(item) === index);

      if (normalizedValues.length > 0) {
        return normalizedValues;
      }
    }

    const singleClass = this.resolveStudentClassName(user);
    return singleClass && user.role === 'teacher' ? [singleClass] : [];
  }

  private resolveTeachingSubjects(user: any): string[] {
    const candidates = [
      user.teachingSubjects,
      user.subjects,
      user.matieres,
      user.teacherSubjects,
    ];

    for (const value of candidates) {
      if (Array.isArray(value)) {
        const normalizedValues = value
          .filter((item: unknown) => typeof item === 'string')
          .map((item: string) => item.trim())
          .filter((item: string, index: number, array: string[]) => !!item && array.indexOf(item) === index);

        if (normalizedValues.length > 0) {
          return normalizedValues;
        }
      }

      if (typeof value === 'string' && value.trim()) {
        return this.parseTeachingSubjects(value);
      }
    }

    return [];
  }

  private resolveTeachingAssignments(user: any, assignedClasses: string[]): TeachingAssignment[] {
    const classLookup = new Map(
      assignedClasses.map((className) => [className.toLowerCase(), className]),
    );
    const rawAssignments = Array.isArray(user?.teachingAssignments)
      ? user.teachingAssignments
      : [];
    const normalizedAssignments = rawAssignments
      .map((assignment: any) => {
        const subject = String(assignment?.subject || '').trim();
        const classes = Array.isArray(assignment?.classes)
          ? assignment.classes
              .filter((value: unknown) => typeof value === 'string')
              .map((value: string) => classLookup.get(value.trim().toLowerCase()))
              .filter((value: string | undefined): value is string => !!value)
          : [];

        return {
          subject,
          classes: classes.length > 0 ? [...new Set(classes)] : [...assignedClasses],
        };
      })
      .filter((assignment: TeachingAssignment) => !!assignment.subject && assignment.classes.length > 0);

    if (normalizedAssignments.length > 0) {
      return normalizedAssignments;
    }

    return this.resolveTeachingSubjects(user).map((subject) => ({
      subject,
      classes: [...assignedClasses],
    }));
  }

  private parseTeachingSubjects(value: string): string[] {
    return String(value || '')
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter((item, index, array) => !!item && array.indexOf(item) === index);
  }

  private loadMockUsers() {
    this.users = [
      {
        id: 1,
        name: 'Prof. Jean Dupont',
        email: 'jean.dupont@university.fr',
        role: 'teacher',
        assignedClasses: ['1A1', '1A2'],
        teachingSubjects: ['Algorithmique'],
        teachingAssignments: [{ subject: 'Algorithmique', classes: ['1A1', '1A2'] }],
        isVerified: true,
        accountStatus: 'active',
        createdAt: new Date('2025-09-15'),
        isActive: true,
        lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
      },
      {
        id: 2,
        name: 'Marie Dubois',
        email: 'marie.dubois@student.fr',
        role: 'student',
        className: '1A1',
        isVerified: false,
        accountStatus: 'pending',
        createdAt: new Date('2025-09-20'),
        isActive: true,
        lastActivityAt: new Date(Date.now() - 3 * 60 * 60 * 1000)
      },
      {
        id: 3,
        name: 'Thomas Martin',
        email: 'thomas.martin@student.fr',
        role: 'student',
        className: '1A2',
        isVerified: true,
        accountStatus: 'active',
        createdAt: new Date('2025-09-22'),
        isActive: true,
        lastActivityAt: new Date(Date.now() - 5 * 60 * 60 * 1000)
      },
      {
        id: 4,
        name: 'Prof. Sophie Leroux',
        email: 'sophie.leroux@university.fr',
        role: 'teacher',
        assignedClasses: ['1A3', '1A4'],
        teachingSubjects: ['Bases de donnees'],
        teachingAssignments: [{ subject: 'Bases de donnees', classes: ['1A3'] }],
        isVerified: true,
        accountStatus: 'active',
        createdAt: new Date('2025-09-18'),
        isActive: true,
        lastActivityAt: new Date(Date.now() - 4 * 60 * 60 * 1000)
      },
      {
        id: 5,
        name: 'Lucas Bernard',
        email: 'lucas.bernard@student.fr',
        role: 'student',
        className: '1A5',
        isVerified: false,
        accountStatus: 'blocked',
        createdAt: new Date('2025-09-25'),
        isActive: false,
        lastActivityAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    ];
  }

  private resolveLastActivityAt(user: any): Date | null {
    const candidates = [
      user.lastLogin,
      user.lastActivityAt,
      user.lastPasswordChange,
      user.passwordChangedAt,
      user.updatedAt,
      user.firstLoginAt,
      user.createdAt,
    ];

    for (const value of candidates) {
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  private getAccountStatus(user: any): UserAccountStatus {
    const firstLoginAt = user.firstLoginAt ? new Date(user.firstLoginAt) : null;
    const passwordChangedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt) : null;
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (user.isBlocked === true) {
      return 'blocked';
    }

    if (user.passwordChanged === true) {
      return 'active';
    }

    if (
      passwordChangedAt &&
      !Number.isNaN(passwordChangedAt.getTime()) &&
      (!firstLoginAt || Number.isNaN(firstLoginAt.getTime()) || passwordChangedAt.getTime() >= firstLoginAt.getTime())
    ) {
      return 'active';
    }

    if (
      firstLoginAt &&
      !Number.isNaN(firstLoginAt.getTime()) &&
      Date.now() - firstLoginAt.getTime() > twentyFourHours
    ) {
      return 'blocked';
    }

    return 'pending';
  }
}
