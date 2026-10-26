import base64
from datetime import date, datetime, time, timezone
from decimal import Decimal

from bson import ObjectId
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from pymongo import MongoClient

from api.models import Resource, User


COLLECTION_MAP = {
    'contents': 'contents',
    'internships': 'internships',
    'meet_sessions': 'meet/sessions',
    'notifications': 'notifications',
    'planner_events': 'student/planner/events',
    'planner_tasks': 'student/planner/tasks',
    'ai_chat_histories': 'ai/chat/history',
    'forumrequests': 'student/forum/requests',
    'quizattempts': 'student/quizzes',
    'studentquizattempts': 'student/quizzes',
    'studentquizresults': 'student/progress',
    'flashcard_sessions': 'student/flashcards',
    'studentevaluations': 'student/evaluations',
    'recommendedquizzes': 'student/recommended-quizzes',
}

DJANGO_COLLECTIONS = {
    'api_resource', 'api_user', 'api_user_groups', 'api_user_user_permissions',
    'auth_group', 'auth_group_permissions', 'auth_permission', 'django_admin_log',
    'django_content_type', 'django_migrations', 'django_session',
}


def json_safe(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace('+00:00', 'Z')
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items() if key != '__v'}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, bytes):
        return base64.b64encode(value).decode('ascii')
    if isinstance(value, Decimal):
        return str(value)
    if value.__class__.__name__ == 'Decimal128':
        return str(value)
    return value


def utc_aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class Command(BaseCommand):
    help = 'Importe les utilisateurs et documents de l’ancien backend depuis la même base MongoDB.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Affiche les volumes sans rien écrire.')

    def handle(self, *args, **options):
        database = settings.DATABASES['default']
        uri = database.get('HOST')
        name = database.get('NAME')
        if not uri or not name:
            raise CommandError('MONGODB_URI et MONGODB_NAME doivent être configurés.')

        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        try:
            source = client[name]
            client.admin.command('ping')
            names = set(source.list_collection_names())
            if 'users' not in names:
                raise CommandError(f"La collection 'users' n'existe pas dans la base {name!r}.")

            users = list(source['users'].find())
            legacy_names = sorted(names - DJANGO_COLLECTIONS - {'users'})
            total = sum(source[collection].count_documents({}) for collection in legacy_names)
            self.stdout.write(f"Base MongoDB : {name}; utilisateurs : {len(users)}; documents fonctionnels : {total}.")
            if options['dry_run']:
                for collection in legacy_names:
                    count = source[collection].count_documents({})
                    self.stdout.write(f"  {collection} -> {COLLECTION_MAP.get(collection, 'legacy/' + collection)} : {count}")
                return

            # A first import may have written BSON datetimes inside JSONField payloads.
            # Normalize them in MongoDB directly before Django reads those documents.
            for existing in source['api_resource'].find({}, {'payload': 1}):
                normalized = json_safe(existing.get('payload') or {})
                if normalized != existing.get('payload'):
                    source['api_resource'].update_one(
                        {'_id': existing['_id']}, {'$set': {'payload': normalized}}
                    )

            users_by_legacy_id = {}
            users_by_email = {}
            for legacy in users:
                email = str(legacy.get('email') or '').strip().lower()
                if not email:
                    self.stderr.write(f"Utilisateur MongoDB {legacy.get('_id')} ignoré : e-mail absent.")
                    continue
                legacy_id = str(legacy['_id'])
                keycloak_id = str(legacy.get('keycloakId') or '')
                role = str(legacy.get('role') or 'student').strip().lower()
                if role not in ('admin', 'teacher', 'student'):
                    role = 'student'

                profile_data = legacy.get('profileData') if isinstance(legacy.get('profileData'), dict) else {}
                class_name = str(legacy.get('className') or profile_data.get('className') or '').strip()
                assigned_classes = legacy.get('assignedClasses') if isinstance(legacy.get('assignedClasses'), list) else []
                teaching_subjects = legacy.get('teachingSubjects') if isinstance(legacy.get('teachingSubjects'), list) else []
                teaching_assignments = legacy.get('teachingAssignments') if isinstance(legacy.get('teachingAssignments'), list) else []
                level_val = str(legacy.get('level') or profile_data.get('level') or 'intermediaire').strip()
                avatar_val = str(legacy.get('avatarDataUrl') or profile_data.get('avatarDataUrl') or '').strip()

                target = User.objects.filter(pk=legacy['_id']).first()
                if target is None:
                    target = User.objects.filter(email__iexact=email).first()
                if target is None:
                    target = User(
                        pk=legacy['_id'], username=email, email=email,
                        first_name=str(legacy.get('firstName') or ''),
                        last_name=str(legacy.get('lastName') or ''),
                        user_role=role,
                        class_name=class_name,
                        assigned_classes=json_safe(assigned_classes),
                        teaching_subjects=json_safe(teaching_subjects),
                        teaching_assignments=json_safe(teaching_assignments),
                        level=level_val or 'intermediaire',
                        avatar=avatar_val,
                        is_superuser=(role == 'admin'), is_staff=(role == 'admin'),
                        is_active=not bool(legacy.get('isBlocked')),
                        email_verified=bool(legacy.get('emailVerified')),
                        password_changed=bool(legacy.get('passwordChanged')),
                        keycloak_id=str(legacy.get('keycloakId') or ''),
                        first_login_at=utc_aware(legacy.get('firstLoginAt')),
                        last_login=utc_aware(legacy.get('lastLogin')),
                        last_password_change=utc_aware(legacy.get('lastPasswordChange')),
                        password_synced_at=utc_aware(legacy.get('passwordSyncedAt')),
                        date_joined=utc_aware(legacy.get('createdAt')) or User.date_joined.field.default(),
                        legacy_updated_at=utc_aware(legacy.get('updatedAt')),
                    )
                    # Legacy passwords were managed by the former identity provider and
                    # their hashes are not Django-compatible. Never copy them as plaintext.
                    target.set_unusable_password()
                    target.save(force_insert=True)
                else:
                    target.email = email
                    target.first_name = str(legacy.get('firstName') or target.first_name)
                    target.last_name = str(legacy.get('lastName') or target.last_name)
                    target.user_role = role
                    if class_name:
                        target.class_name = class_name
                    if assigned_classes:
                        target.assigned_classes = json_safe(assigned_classes)
                    if teaching_subjects:
                        target.teaching_subjects = json_safe(teaching_subjects)
                    if teaching_assignments:
                        target.teaching_assignments = json_safe(teaching_assignments)
                    if level_val:
                        target.level = level_val
                    if avatar_val:
                        target.avatar = avatar_val
                    target.is_superuser = role == 'admin'
                    target.is_staff = role == 'admin'
                    target.is_active = not bool(legacy.get('isBlocked'))
                    target.email_verified = bool(legacy.get('emailVerified'))
                    target.password_changed = bool(legacy.get('passwordChanged'))
                    target.keycloak_id = str(legacy.get('keycloakId') or '')
                    target.first_login_at = utc_aware(legacy.get('firstLoginAt'))
                    target.last_login = utc_aware(legacy.get('lastLogin'))
                    target.last_password_change = utc_aware(legacy.get('lastPasswordChange'))
                    target.password_synced_at = utc_aware(legacy.get('passwordSyncedAt'))
                    if legacy.get('createdAt'):
                        target.date_joined = utc_aware(legacy['createdAt'])
                    target.legacy_updated_at = utc_aware(legacy.get('updatedAt'))
                    target.save()

                learning_progress = legacy.get('learningProgress')
                if isinstance(learning_progress, list):
                    for prog in learning_progress:
                        if not isinstance(prog, dict):
                            continue
                        cid = str(prog.get('contentId') or '').strip()
                        if not cid:
                            continue
                        Resource.objects.update_or_create(
                            collection='student/progress',
                            public_id=f'progress-{target.pk}-{cid}',
                            defaults={'owner': target, 'payload': json_safe(prog)},
                        )

                users_by_legacy_id[legacy_id] = target
                if keycloak_id:
                    users_by_legacy_id[keycloak_id] = target
                users_by_email[email] = target

            imported = 0
            for collection in legacy_names:
                target_collection = COLLECTION_MAP.get(collection, f'legacy/{collection}')
                for document in source[collection].find():
                    owner = self._resolve_owner(document, users_by_legacy_id, users_by_email)
                    payload = {key: json_safe(value) for key, value in document.items()
                               if key not in ('_id', '__v')}
                    Resource.objects.update_or_create(
                        collection=target_collection,
                        public_id=str(document['_id']),
                        defaults={'payload': payload, 'owner': owner},
                    )
                    imported += 1

            self.stdout.write(self.style.SUCCESS(
                f"Import terminé : {len(users_by_email)} compte(s) associés et {imported} document(s) importé(s). "
                'Les collections MongoDB originales ont été conservées.'
            ))
        finally:
            client.close()

    @staticmethod
    def _resolve_owner(document, users_by_legacy_id, users_by_email):
        for key in ('ownerUserId', 'studentUserId', 'authorUserId', 'recipientUserId', 'userId', 'studentKey'):
            value = document.get(key)
            if value is not None and str(value) in users_by_legacy_id:
                return users_by_legacy_id[str(value)]
        for key in ('ownerEmail', 'studentEmail', 'authorEmail', 'recipientEmail', 'teacherEmail',
                    'hostEmail', 'studentKey', 'userId', 'email'):
            value = document.get(key)
            if value and str(value).lower() in users_by_email:
                return users_by_email[str(value).lower()]
        return None
