import html
import io
import json
import logging
import os
import re
import time as _time
import unicodedata
import urllib.request
import uuid
import zipfile
import zlib
from urllib.parse import urlencode
from datetime import date, datetime, time, timedelta
from django.core.files.storage import default_storage
from django.contrib.auth import authenticate, get_user_model, login
from django.core import signing
from django.core.mail import send_mail
from django.conf import settings
from django.shortcuts import redirect
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import JsonResponse, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .models import Resource

User = get_user_model()
logger = logging.getLogger(__name__)

_LEGACY_USERS_SYNCED = False
_USER_CACHE = {}  # uid -> (expires_at, user_obj)
_INITIAL_ASSESSMENT_CACHE = {}  # uid -> (expires_at, bool)
_CONTENTS_CACHE = {'expires_at': 0.0, 'records': None}


def _invalidate_caches(collection=None, user_id=None):
    if user_id is not None:
        uid = str(user_id)
        _USER_CACHE.pop(uid, None)
        _INITIAL_ASSESSMENT_CACHE.pop(uid, None)
    else:
        _USER_CACHE.clear()
        _INITIAL_ASSESSMENT_CACHE.clear()
    if collection in (None, 'contents'):
        _CONTENTS_CACHE['expires_at'] = 0.0
        _CONTENTS_CACHE['records'] = None
    if collection in ('student/assessment', 'student/progress'):
        _INITIAL_ASSESSMENT_CACHE.clear()


def _cached_contents_records():
    now = _time.monotonic()
    if _CONTENTS_CACHE['records'] is not None and now < _CONTENTS_CACHE['expires_at']:
        return _CONTENTS_CACHE['records']
    records = list(Resource.objects.filter(collection='contents'))
    _CONTENTS_CACHE['records'] = records
    _CONTENTS_CACHE['expires_at'] = now + 25.0
    return records

FRENCH_MONTHS = (
    '', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
)


def _sync_legacy_mongo_users():
    return


def _body(request):
    try:
        return json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _token(user):
    return signing.dumps({'uid': str(user.pk)}, salt='eduvia-api')


def _refresh_token(user):
    return signing.dumps({'uid': str(user.pk)}, salt='eduvia-refresh')


def _user(request):
    header = request.headers.get('Authorization', '')
    if header.lower().startswith('bearer '):
        try:
            data = signing.loads(header[7:], salt='eduvia-api', max_age=60 * 60 * 24 * 14)
            uid = str(data.get('uid') or '')
            if not uid:
                return None
            now = _time.monotonic()
            cached = _USER_CACHE.get(uid)
            if cached and now < cached[0]:
                return cached[1]
            user_obj = User.objects.filter(pk=uid, is_active=True).first()
            if user_obj:
                _USER_CACHE[uid] = (now + 45.0, user_obj)
            return user_obj
        except (signing.BadSignature, TypeError, ValueError):
            return None
    return request.user if request.user.is_authenticated else None


def _profile(user, check_resources=True):
    role = 'admin' if user.is_superuser else user.user_role
    initial_completed = True
    if role == 'student':
        uid = str(user.pk)
        has_direct_flag = bool(str(user.level or '').strip() or user.first_login_at is not None)
        if has_direct_flag:
            initial_completed = True
        elif check_resources:
            now = _time.monotonic()
            cached_init = _INITIAL_ASSESSMENT_CACHE.get(uid)
            if cached_init and now < cached_init[0]:
                initial_completed = cached_init[1]
            else:
                initial_completed = Resource.objects.filter(
                    collection__in=('student/assessment', 'student/progress'), owner=user
                ).exists()
                _INITIAL_ASSESSMENT_CACHE[uid] = (now + 60.0, initial_completed)
        else:
            initial_completed = False
    face_enabled = bool(str(user.face_hash or '').strip())
    return {'id': str(user.pk), '_id': str(user.pk), 'userId': str(user.pk), 'email': user.email,
            'username': user.username, 'fullName': user.get_full_name() or user.username,
            'firstName': user.first_name, 'lastName': user.last_name,
            'roles': [role], 'role': role, 'className': user.class_name,
            'assignedClasses': user.assigned_classes, 'teachingSubjects': user.teaching_subjects,
            'teachingAssignments': user.teaching_assignments, 'level': user.level, 'avatar': user.avatar,
            'avatarDataUrl': user.avatar,
            'faceIdEnabled': face_enabled,
            'initialAssessmentCompleted': initial_completed,
            'profileData': {
                'level': user.level,
                'avatarDataUrl': user.avatar,
                'initialAssessmentCompleted': initial_completed,
                'faceIdEnabled': face_enabled,
            },
            'emailVerified': user.email_verified, 'isActive': user.is_active,
            'isBlocked': not user.is_active, 'passwordChanged': user.password_changed,
            'keycloakId': user.keycloak_id, 'firstLoginAt': user.first_login_at,
            'lastLogin': user.last_login, 'lastPasswordChange': user.last_password_change,
            'passwordSyncedAt': user.password_synced_at, 'createdAt': user.date_joined,
            'updatedAt': user.legacy_updated_at}


def _get_base_urls(request=None):
    """Determine dynamic backend and frontend URLs for emails and redirects."""
    backend_url = os.environ.get('BACKEND_URL', '').strip().rstrip('/')
    if not backend_url and os.environ.get('RENDER_EXTERNAL_HOSTNAME'):
        backend_url = f"https://{os.environ['RENDER_EXTERNAL_HOSTNAME']}"
    if not backend_url and request:
        backend_url = f"{request.scheme}://{request.get_host()}".rstrip('/')
    if not backend_url:
        backend_url = 'https://eduvia-backend-4iqm.onrender.com'

    frontend_url = os.environ.get('FRONTEND_URL', '').strip().rstrip('/')
    if not frontend_url:
        if request:
            origin = request.headers.get('Origin') or request.headers.get('Referer')
            if origin:
                from urllib.parse import urlparse
                p = urlparse(origin)
                if p.scheme and p.netloc:
                    frontend_url = f"{p.scheme}://{p.netloc}".rstrip('/')
    if not frontend_url:
        frontend_url = os.environ.get('FRONTEND_PUBLIC_URL', '').strip().rstrip('/')
    if not frontend_url:
        frontend_url = settings.FRONTEND_URL.rstrip('/') or 'http://localhost:4200'

    return backend_url, frontend_url


def _verification_url(user, request=None):
    token = signing.dumps({'uid': str(user.pk), 'purpose': 'email-verification'}, salt='eduvia-email-verification')
    backend_url, _ = _get_base_urls(request)
    return f'{backend_url}/auth/verify-email?{urlencode({"token": token})}'


def _build_verification_email_html(user, verification_url, password=None):
    name = html.escape(user.get_full_name() or user.first_name or user.username or 'Étudiant')
    email = html.escape(user.email)
    pwd_block = ''
    if password:
        pwd_block = f"""
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-left: 5px solid #8b1538; border-radius: 6px; margin: 24px 0;">
            <tr>
                <td style="padding: 16px 20px;">
                    <p style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; color: #8b1538; letter-spacing: 0.5px; font-family: Arial, sans-serif;">
                        Vos identifiants de connexion :
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 14px; color: #334155; font-family: Arial, sans-serif;">
                        <strong>E-mail :</strong> <span style="color: #0f172a; font-weight: 600;">{email}</span>
                    </p>
                    <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155; font-family: Arial, sans-serif;">
                        <strong>Mot de passe temporaire :</strong>
                        <span style="display: inline-block; background-color: #ffffff; color: #8b1538; font-weight: 700; font-family: Consolas, Monaco, monospace; font-size: 15px; padding: 4px 10px; border-radius: 4px; border: 1px solid #cbd5e1;">{html.escape(password)}</span>
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #64748b; font-style: italic; font-family: Arial, sans-serif;">
                        Veuillez modifier ce mot de passe temporaire après votre première connexion.
                    </p>
                </td>
            </tr>
        </table>
        """

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmation de votre compte EduVia</title>
</head>
<body style="margin: 0; padding: 0; background-color: #e2e8f0; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#e2e8f0" style="background-color: #e2e8f0; padding: 30px 10px;">
        <tr>
            <td align="center">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);">
                    <tr>
                        <td align="center" bgcolor="#8b1538" style="background-color: #8b1538; padding: 26px 20px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff !important; font-size: 28px; font-weight: 800; letter-spacing: 1px; font-family: Arial, sans-serif;">EduVia</h1>
                            <p style="margin: 6px 0 0 0; color: #ffffff !important; font-size: 14px; font-family: Arial, sans-serif; opacity: 0.95;">Learn smart, Think EduVia</p>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 32px 28px; color: #1e293b; font-size: 15px; line-height: 1.6;">
                            <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 700; font-family: Arial, sans-serif;">Bonjour {name},</h2>
                            <p style="margin: 0 0 16px 0; color: #334155; font-size: 15px; font-family: Arial, sans-serif;">
                                Bienvenue sur <strong>EduVia</strong> ! Votre compte a été créé avec succès par l'administration.
                            </p>
                            <p style="margin: 0 0 24px 0; color: #334155; font-size: 15px; font-family: Arial, sans-serif;">
                                Cliquez sur le bouton ci-dessous pour confirmer votre adresse e-mail et accéder directement à la page de connexion :
                            </p>

                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
                                <tr>
                                    <td align="center">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center" bgcolor="#8b1538" style="border-radius: 6px; background-color: #8b1538;">
                                                    <a href="{verification_url}" target="_blank" style="background-color: #8b1538; border: 12px solid #8b1538; font-family: Arial, sans-serif; font-size: 16px; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; padding: 4px 22px; text-align: center;">
                                                        <span style="color: #ffffff !important; text-decoration: none; font-weight: bold;">Confirmer mon compte</span>
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            {pwd_block}

                            <p style="margin: 24px 0 0 0; font-size: 13px; color: #64748b; text-align: center; font-family: Arial, sans-serif;">
                                Ce bouton de confirmation est valable pendant 24 heures.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" bgcolor="#f8fafc" style="background-color: #f8fafc; padding: 18px 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; font-family: Arial, sans-serif;">
                            <p style="margin: 0;">© 2026 EduVia • Plateforme d'apprentissage et de formation</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""


def _send_system_email(recipient_email, subject, body_text, html_body=None):
    """Send an email using HTTP API (Resend / Brevo) if configured, or standard Django SMTP as fallback.
    HTTPS APIs (port 443) work on all cloud platforms (including Render Free Tier where outbound SMTP is blocked).
    """
    resend_key = os.environ.get('RESEND_API_KEY', '').strip()
    brevo_key = os.environ.get('BREVO_API_KEY', '').strip()
    from_email = os.environ.get('DEFAULT_FROM_EMAIL', '').strip() or settings.DEFAULT_FROM_EMAIL

    # 1. Try Resend HTTP API (port 443 HTTPS - never blocked by Render)
    if resend_key:
        try:
            resend_payload = {
                'from': from_email if '@' in from_email and not from_email.endswith('@gmail.com') else 'EduVia <onboarding@resend.dev>',
                'to': [recipient_email],
                'subject': subject,
                'text': body_text,
            }
            if html_body:
                resend_payload['html'] = html_body
            req_data = json.dumps(resend_payload).encode('utf-8')
            req = urllib.request.Request(
                'https://api.resend.com/emails',
                data=req_data,
                headers={
                    'Authorization': f'Bearer {resend_key}',
                    'Content-Type': 'application/json',
                    'User-Agent': 'EduVia-Mail/1.0',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                if resp.status in (200, 201):
                    return True, ''
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode('utf-8', errors='ignore')
            try:
                err_json = json.loads(err_body)
                err_msg = err_json.get('message') or err_body
            except Exception:
                err_msg = err_body[:200]
            logger.warning('Resend HTTP error: %s', err_msg)
            # Resend free test mode restricts recipients to the account owner email
            if 'only send testing emails to your own email address' in err_msg:
                return False, f"Resend en mode test envoie uniquement vers votre e-mail de compte ({err_msg}). Pour envoyer à d'autres adresses, utilisez Brevo ou validez un domaine sur resend.com."
            return False, f"Erreur Resend ({exc.code}) : {err_msg}"
        except Exception as exc:
            logger.warning('Resend HTTP email delivery failed: %s', exc)
            return False, f"Erreur Resend : {exc}"

    # 2. Try Brevo (Sendinblue) HTTP API (port 443 HTTPS - never blocked by Render, sends to any address)
    if brevo_key:
        try:
            sender_email = from_email if '@' in from_email else 'noreply@eduvia.app'
            brevo_payload = {
                'sender': {'name': 'EduVia', 'email': sender_email},
                'to': [{'email': recipient_email}],
                'subject': subject,
                'textContent': body_text,
            }
            if html_body:
                brevo_payload['htmlContent'] = html_body
            req_data = json.dumps(brevo_payload).encode('utf-8')
            req = urllib.request.Request(
                'https://api.brevo.com/v3/smtp/email',
                data=req_data,
                headers={
                    'api-key': brevo_key,
                    'Content-Type': 'application/json',
                    'User-Agent': 'EduVia-Mail/1.0',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                if resp.status in (200, 201):
                    return True, ''
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode('utf-8', errors='ignore')
            logger.warning('Brevo HTTP error: %s', err_body)
            return False, f"Erreur Brevo ({exc.code}) : {err_body[:200]}"
        except Exception as exc:
            logger.warning('Brevo HTTP email delivery failed: %s', exc)
            return False, f"Erreur Brevo : {exc}"

    # 3. Standard Django SMTP fallback
    try:
        sent = send_mail(subject, body_text, settings.DEFAULT_FROM_EMAIL, [recipient_email], html_message=html_body, fail_silently=False)
        is_smtp = settings.EMAIL_BACKEND.endswith('smtp.EmailBackend')
        if not is_smtp:
            return False, "Le serveur utilise le mode console (variables SMTP manquantes)."
        return bool(sent), ''
    except OSError as exc:
        # Common on Render Free Tier where ports 25/465/587 are blocked
        logger.warning('SMTP socket error (port blocked by host?): %s', exc)
        return False, f"Port SMTP bloqué par l'hébergeur ({exc}). Utilisez un service HTTP (Resend/Brevo) ou transmettez le mot de passe manuellement."
    except Exception as exc:
        logger.exception('SMTP send_mail failed: %s', exc)
        return False, f'{type(exc).__name__}: {exc}'[:250]


def _send_verification_email(user, password=None, request=None):
    verification_url = _verification_url(user, request=request)
    lines = [f"Bonjour {user.first_name or user.username},", '',
             "Bienvenue sur EduVia ! Veuillez confirmer votre adresse e-mail en cliquant sur le bouton « Confirmer mon compte » présent dans cet e-mail."]
    if password:
        lines.extend(['', f'Identifiant : {user.email}', f'Mot de passe temporaire : {password}',
                      'Veuillez modifier ce mot de passe après votre première connexion.'])
    body_text = '\n'.join(lines)
    html_body = _build_verification_email_html(user, verification_url, password)
    success, error = _send_system_email(user.email, 'Confirmez votre adresse e-mail EduVia', body_text, html_body=html_body)
    return success, error


def _response(data=None, **extra):
    return JsonResponse({'success': True, 'data': data, **extra}, safe=not isinstance(data, list))


_WORD_FIX_PATTERNS = [
    (re.compile(r'\bdeuxime\b', re.I), 'deuxième'),
    (re.compile(r'\btape\b'), 'étape'),
    (re.compile(r'\bTape\b'), 'Étape'),
    (re.compile(r'\btapes\b'), 'étapes'),
    (re.compile(r'\bTapes\b'), 'Étapes'),
    (re.compile(r'\bdmarche\b', re.I), 'démarche'),
    (re.compile(r'\brsolution\b', re.I), 'résolution'),
    (re.compile(r'\brsoudre\b', re.I), 'résoudre'),
    (re.compile(r'\bproblme\b', re.I), 'problème'),
    (re.compile(r'\bproblmes\b', re.I), 'problèmes'),
    (re.compile(r'\bspcification\b', re.I), 'spécification'),
    (re.compile(r'\bspcifier\b', re.I), 'spécifier'),
    (re.compile(r'\bmodlisation\b', re.I), 'modélisation'),
    (re.compile(r'\bexcutable\b', re.I), 'exécutable'),
    (re.compile(r'\bexcution\b', re.I), 'exécution'),
    (re.compile(r'\bexcuter\b', re.I), 'exécuter'),
    (re.compile(r'\bcriture\b', re.I), 'écriture'),
    (re.compile(r'\blment\b', re.I), 'élément'),
    (re.compile(r'\blments\b', re.I), 'éléments'),
    (re.compile(r'\bnonc\b', re.I), 'énoncé'),
    (re.compile(r'\bdonnes\b', re.I), 'données'),
    (re.compile(r'\bpremire\b', re.I), 'première'),
    (re.compile(r'\bcinquime\b', re.I), 'cinquième'),
    (re.compile(r'\baprs\b', re.I), 'après'),
    (re.compile(r'\bdbut\b', re.I), 'début'),
    (re.compile(r'\bsystme\b', re.I), 'système'),
    (re.compile(r'\brseau\b', re.I), 'réseau'),
    (re.compile(r'\brseaux\b', re.I), 'réseaux'),
    (re.compile(r'\bmathmatique\b', re.I), 'mathématique'),
    (re.compile(r'\bmathmatiques\b', re.I), 'mathématiques'),
    (re.compile(r'\bvido\b', re.I), 'vidéo'),
    (re.compile(r'\bvidos\b', re.I), 'vidéos'),
    (re.compile(r'\brsum\b', re.I), 'résumé'),
    (re.compile(r'\brvision\b', re.I), 'révision'),
    (re.compile(r'\brvisions\b', re.I), 'révisions'),
    (re.compile(r'\brgle\b', re.I), 'règle'),
    (re.compile(r'\brgles\b', re.I), 'règles'),
    (re.compile(r'\bdcision\b', re.I), 'décision'),
    (re.compile(r'\bdcisions\b', re.I), 'décisions'),
    (re.compile(r'\bmmoire\b', re.I), 'mémoire'),
    (re.compile(r'\bparamtre\b', re.I), 'paramètre'),
    (re.compile(r'\bparamtres\b', re.I), 'paramètres'),
    (re.compile(r'\bmodle\b', re.I), 'modèle'),
    (re.compile(r'\bmodles\b', re.I), 'modèles'),
    (re.compile(r'\bintrt\b', re.I), 'intérêt'),
    (re.compile(r'\bcontrle\b', re.I), 'contrôle'),
    (re.compile(r'\bdfini\b', re.I), 'défini'),
    (re.compile(r'\bdfinie\b', re.I), 'définie'),
    (re.compile(r'\bdfinir\b', re.I), 'définir'),
    (re.compile(r'\bdclaration\b', re.I), 'déclaration'),
    (re.compile(r'\bpdagogique\b', re.I), 'pédagogique'),
]


def _clean_encoding(data):
    if isinstance(data, str):
        res = data
        res = res.replace('\ufffd', 'é')
        res = res.replace('Ã©', 'é').replace('Ã¨', 'è').replace('Ãª', 'ê')
        res = res.replace('Ã ', 'à').replace('Ã§', 'ç').replace('Ã´', 'ô')
        res = res.replace('Ã¹', 'ù').replace('Ã®', 'î').replace('Ã¯', 'ï')
        res = res.replace('â€™', "'").replace('â€“', '–').replace('â€”', '—')
        for pat, rep in _WORD_FIX_PATTERNS:
            res = pat.sub(rep, res)
        return res
    elif isinstance(data, list):
        return [_clean_encoding(x) for x in data]
    elif isinstance(data, dict):
        return {k: _clean_encoding(v) for k, v in data.items()}
    return data


def _is_test_content(payload):
    if not isinstance(payload, dict):
        return False
    cid = str(payload.get('courseId') or '').strip().casefold()
    title = str(payload.get('title') or '').strip().casefold()
    return cid in ('test', 'cours test') or title in ('test', 'cours test')


def _resource_dict(record):
    cleaned = _clean_encoding(record.payload or {})
    return {**cleaned, '_id': record.public_id, 'id': record.public_id}


def _save_record(collection, data, user=None, public_id=None):
    public_id = str(public_id or data.get('_id') or data.get('id') or uuid.uuid4())
    payload = {k: v for k, v in data.items() if k not in ('_id', 'id')}
    record, _ = Resource.objects.update_or_create(collection=collection, public_id=public_id,
        defaults={'payload': payload, 'owner': user})
    _invalidate_caches(collection=collection, user_id=user.pk if user else None)
    return record


def _ensure_meet_link(record):
    """Give legacy and newly created Meet sessions a stable Jitsi room URL."""
    payload = record.payload
    changed = False
    room_name = str(payload.get('roomName') or '').strip()
    if not room_name:
        slug = unicodedata.normalize('NFKD', str(payload.get('title') or 'session'))
        slug = ''.join(char for char in slug if not unicodedata.combining(char)).lower()
        slug = re.sub(r'[^a-z0-9]+', '-', slug).strip('-') or 'session'
        room_name = f'eduvia-{slug}-{uuid.uuid4().hex[:12]}'
        payload['roomName'] = room_name
        changed = True
    if not str(payload.get('joinUrl') or '').strip():
        payload['joinUrl'] = f'https://meet.jit.si/{room_name}#config.prejoinPageEnabled=false'
        changed = True
    if changed:
        record.save(update_fields=['payload', 'updated_at'])
    return record


def _owned_records(collection, user):
    qs = Resource.objects.filter(collection=collection)
    if user:
        qs = qs.filter(owner=user)
    else:
        qs = qs.none()
    return qs


def _normalized_text(value):
    value = unicodedata.normalize('NFD', str(value or '').strip().casefold())
    return ''.join(char for char in value if unicodedata.category(char) != 'Mn')


def _flashcard_answer(question):
    correct = question.get('correctAnswers') or question.get('correctAnswer') or []
    if not isinstance(correct, list):
        correct = [correct]
    options = question.get('options') or []
    answers = []
    for expected in correct:
        expected_text = str(expected).strip()
        match = next((option for index, option in enumerate(options)
                      if isinstance(option, dict) and expected_text.casefold() in (
                          str(option.get('label', '')).strip().casefold(),
                          str(option.get('id', '')).strip().casefold(),
                          str(index).casefold())), None)
        if match:
            answers.append(str(match.get('text') or match.get('label') or '').strip())
        elif expected_text:
            answers.append(expected_text)
    if not answers:
        fallback = question.get('answer') or question.get('explanation') or ''
        if isinstance(fallback, list):
            answers = [str(value).strip() for value in fallback if str(value).strip()]
        elif str(fallback).strip():
            answers = [str(fallback).strip()]
    return ' / '.join(answers)


def _flashcard_answer_matches(user_answer, expected_answer):
    user = re.sub(r'[^a-z0-9\s]', ' ', _normalized_text(user_answer))
    expected = re.sub(r'[^a-z0-9\s]', ' ', _normalized_text(expected_answer))
    user = ' '.join(user.split())
    expected = ' '.join(expected.split())
    if not user or not expected:
        return False
    if len(expected) < 3:
        return expected in user.split() or expected in user
    if len(user) < 3:
        return False
    if expected in user or user in expected:
        return True
    ignored = {'avec','aux','bonne','ces','cite','comme','dans','definit','des','donc','donne',
               'elle','est','etre','exemple','faire','lie','les','leur','leurs','notion','par',
               'pas','plus','pour','que','qui','reponse','role','son','sont','sur','une','utilise','utiliser'}
    user_words = {word for word in user.split() if len(word) >= 4 and word not in ignored}
    expected_words = [word for word in expected.split() if len(word) >= 4 and word not in ignored]
    shared = sum(word in user_words for word in expected_words)
    return bool(shared and len(user) >= 12 and
                (shared / len(expected_words) >= 0.2 or shared / max(len(user_words), 1) >= 0.2))


def _make_flashcards(student, subject, difficulty, question_count):
    requested_subject = _normalized_text(subject)
    requested_difficulty = _normalized_text(difficulty)
    student_class = _normalized_text(student.class_name)
    cards = []
    seen_questions = set()
    for record in Resource.objects.filter(collection='contents'):
        content = record.payload or {}
        if 'quiz' not in _normalized_text(content.get('type')):
            continue
        course = str(content.get('courseId') or '').strip()
        if requested_subject not in ('', 'all', 'toutes les matieres') and _normalized_text(course) != requested_subject:
            continue
        allowed = content.get('visibleToClasses') or []
        if isinstance(allowed, str):
            allowed = [allowed]
        allowed = {_normalized_text(value) for value in allowed}
        if content.get('visibleToAllClasses') is not True and allowed and (not student_class or student_class not in allowed):
            continue
        source_level = _normalized_text(content.get('quizDifficulty'))
        if requested_difficulty == 'facile' and source_level and not any(value in source_level for value in ('facile','debutant','easy')):
            continue
        if requested_difficulty == 'intermediaire' and source_level and not any(value in source_level for value in ('intermediaire','moyen','medium')):
            continue
        if requested_difficulty == 'difficile' and source_level and not any(value in source_level for value in ('difficile','avance','hard')):
            continue
        questions = content.get('quizQuestions') or []
        if not isinstance(questions, list):
            continue
        for question in questions:
            if not isinstance(question, dict):
                continue
            prompt = str(question.get('prompt') or question.get('question') or '').strip()
            answer = _flashcard_answer(question)
            key = _normalized_text(prompt)
            if not prompt or not answer or key in seen_questions:
                continue
            seen_questions.add(key)
            cards.append({
                'id': str(question.get('id') or uuid.uuid4()),
                'question': prompt,
                'answer': answer,
                'subject': course or subject,
                'difficulty': difficulty,
                'userAnswer': '',
                'revealed': False,
                'correct': False,
            })
    return cards[:question_count]


_COURSE_KB_CACHE = None


def _tokenize_course_text(text):
    norm = re.sub(r'[^a-z0-9\s]', ' ', _normalized_text(text))
    stopwords = {
        'alors', 'ainsi', 'apres', 'aucun', 'aussi', 'autre', 'avant', 'avec', 'avoir',
        'bon', 'bonjour', 'car', 'ceci', 'cela', 'celle', 'celui', 'cependant', 'certain',
        'ces', 'cet', 'cette', 'ceux', 'chaque', 'comme', 'comment', 'concernant', 'contre',
        'dans', 'des', 'deux', 'doit', 'donc', 'donne', 'donner', 'dont', 'duquel', 'elle',
        'elles', 'entre', 'est', 'etait', 'etant', 'ete', 'etre', 'explique', 'expliquer',
        'faire', 'fait', 'fois', 'font', 'hors', 'ici', 'ils', 'jamais', 'leur', 'leurs',
        'lors', 'lui', 'mais', 'meme', 'merci', 'mes', 'moi', 'moins', 'mon', 'nos', 'notre',
        'nous', 'oui', 'par', 'parce', 'parle', 'pas', 'peut', 'peux', 'plus', 'pour',
        'pourquoi', 'propose', 'proposer', 'puis', 'quand', 'que', 'quel', 'quelle',
        'quelles', 'quels', 'qui', 'quoi', 'sans', 'ses', 'soit', 'son', 'sont', 'sous',
        'suis', 'sur', 'tes', 'toi', 'ton', 'tous', 'tout', 'toute', 'toutes', 'tres',
        'une', 'vers', 'voici', 'voir', 'vos', 'votre', 'vous',
    }
    return [w for w in norm.split() if (len(w) >= 2 and w not in stopwords) or w in ('c', 'if', 'ou', 'et')]


def _load_course_knowledge_chunks():
    global _COURSE_KB_CACHE
    if _COURSE_KB_CACHE is not None:
        return _COURSE_KB_CACHE

    chunks = []
    kb_path = os.path.join(settings.BASE_DIR, 'chatbot_train', 'knowledge_base.json')
    if os.path.exists(kb_path):
        try:
            with open(kb_path, 'r', encoding='utf-8-sig') as fh:
                raw_items = json.load(fh)
            for item in (raw_items if isinstance(raw_items, list) else []):
                if not isinstance(item, dict):
                    continue
                source = str(item.get('source') or 'Cours EduVia').strip()
                topic = str(item.get('topic') or '').strip()
                text = str(item.get('text') or '').strip()
                if not text or '\u0000' in text:
                    continue
                chunks.append({
                    'source': source,
                    'topic': topic,
                    'text': text,
                    'tokens': set(_tokenize_course_text(f'{source} {topic} {text}')),
                })
        except Exception:
            logger.exception('Failed to load chatbot_train/knowledge_base.json')

    _COURSE_KB_CACHE = chunks
    return chunks


def _visible_student_contents(user=None):
    student_class = _normalized_text(getattr(user, 'class_name', '') if user else '')
    visible = []
    for record in Resource.objects.filter(collection='contents'):
        content = _resource_dict(record)
        if _is_test_content(content):
            continue
        if content.get('isActive') is False:
            continue
        allowed = content.get('visibleToClasses') or []
        if isinstance(allowed, str):
            allowed = [allowed]
        allowed_set = {_normalized_text(v) for v in allowed if str(v).strip()}
        if content.get('visibleToAllClasses') is True or not allowed_set or not student_class or student_class in allowed_set:
            visible.append(content)
    return visible


def _ask_course_chatbot(message, user=None, course_id='', chapter_id=''):
    clean_message = str(message or '').strip()
    if not clean_message:
        return 'Posez-moi une question sur votre cours pour que je puisse vous aider.'

    norm_msg = _normalized_text(clean_message)
    visible_contents = _visible_student_contents(user)
    course_names = list(dict.fromkeys(
        str(c.get('courseId') or c.get('title') or '').strip()
        for c in visible_contents
        if str(c.get('courseId') or (c.get('title') if str(c.get('type') or '').casefold() == 'course' else '') or '').strip()
    ))
    chapter_names = list(dict.fromkeys(
        str(c.get('title') or c.get('chapterId') or '').strip()
        for c in visible_contents
        if str(c.get('type') or '').casefold() == 'chapter' and str(c.get('title') or c.get('chapterId') or '').strip()
    ))

    # 1. Greetings
    if re.fullmatch(r'(bonjour|salut|bonsoir|coucou|hello|hi|hey|salam|cc|bjr|bsr)[\s!.?]*', norm_msg):
        courses_label = ', '.join(course_names[:4]) if course_names else 'Programmation C & Algorithmique, Idea Pitch (PI-CDIO)'
        chapters_label = f" (chapitres : {', '.join(chapter_names[:5])})" if chapter_names else ''
        return (
            f"Bonjour ! Je suis l'assistant pédagogique IA d'EduVia, spécialisé dans l'explication de vos cours ({courses_label}){chapters_label}.\n\n"
            "Vous pouvez me demander :\n"
            "• « Explique-moi ce chapitre » (ex: étapes de résolution d'un problème, structure d'un programme C, instruction if...else, boucle for)\n"
            "• « Donne-moi un résumé »\n"
            "• « Propose un exercice »\n"
            "• Ou poser directement une question sur une notion du cours (ex: « Comment créer un programme exécutable ? », « C'est quoi main() et printf ? », « Explique if else »)."
        )

    # 2. Out-of-scope check
    non_edu = re.search(
        r'\b(pizza|burger|sandwich|restaurant|film|cinema|chanson|musique|football|meteo|blague)\b',
        norm_msg,
    )
    if non_edu:
        return (
            "Je suis le chatbot pédagogique d'EduVia dédié à vos cours. "
            "Je réponds uniquement aux questions liées aux cours, chapitres, algorithmes, langage C, exercices, quiz et révisions."
        )

    # 3. Try external AI service only if explicitly configured via CHATBOT_AI_URL and reachable quickly
    custom_ai_url = os.environ.get('CHATBOT_AI_URL', '').strip()
    if custom_ai_url:
        try:
            payload = json.dumps({'message': clean_message}, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(custom_ai_url, data=payload, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=3) as response:
                result = json.loads(response.read().decode('utf-8'))
            ext_reply = str(result.get('response') or result.get('reply') or result.get('answer') or result.get('message') or '').strip()
            if ext_reply:
                return ext_reply
        except Exception:
            pass

    # 4. Quick reply / intent: "Explique-moi ce chapitre"
    if any(p in norm_msg for p in ('explique moi ce chapitre', 'explique ce chapitre', 'expliquer ce chapitre', 'explique le cours', 'explique moi le cours')):
        return (
            "📚 Explication des chapitres de votre cours (De l'idée au programme & Programmation C) :\n\n"
            "1️⃣ Chapitre 1 — De l'idée au programme & Structure d'un programme C :\n"
            "• Les 5 étapes de résolution d'un problème :\n"
            "  1. Position du problème (bonne formulation du problème).\n"
            "  2. Spécification et analyse (comprendre l'énoncé, identifier les entrées, sorties, contraintes et formules de calcul).\n"
            "  3. Écriture de l'algorithme (structurer la logique de résolution).\n"
            "  4. Écriture du programme en langage C.\n"
            "  5. Exécution et test du programme.\n"
            "• Création d'un programme exécutable : Fichiers source (*.c) ➔ Compilation (*.o) ➔ Édition des liens (avec libs) ➔ Exécutable.\n"
            "• Structure d'un programme C : inclusion de bibliothèque (#include <stdio.h>), fonction principale void main() { ... }, affichage avec printf(\"...\"), commentaires (/* ... */ ou //), et mots réservés toujours en minuscules.\n\n"
            "2️⃣ Chapitre 2 — Les structures conditionnelles (if ... else & switch) :\n"
            "• if (Condition) { ... } else { ... } : exécute le bloc if si la condition entre parenthèses est vraie (valeur != 0 en C), sinon le bloc else (valeur == 0).\n"
            "• Opérateurs logiques : && (ET logique) et || (OU logique).\n"
            "• Choix de structure : if (1 cas), if-else (2 cas binaires), if imbriqués (conditions complexes), switch (menus et choix fixes).\n\n"
            "3️⃣ Chapitre 3 — Les structures itératives (La boucle for) :\n"
            "• for (Init_compteur; Condition; Incrémentation) { ... } : répète un bloc d'instructions un nombre de fois connu à l'avance grâce à un compteur.\n\n"
            "👉 Sur quelle partie souhaitez-vous approfondir ou faire un exercice (Chapitre 1, if/else, ou boucle for) ?"
        )

    # 5. Quick reply / intent: "Donne-moi un resume"
    if any(p in norm_msg for p in ('donne moi un resume', 'donne un resume', 'fais un resume', 'resumer le cours', 'resume du cours', 'resume chapitre')) or norm_msg == 'resume':
        return (
            "📝 Résumé synthétique du cours (Programmation C & Algorithmique) :\n\n"
            "• Démarche de programmation (5 étapes) :\n"
            "  1. Positionner le problème ➔ 2. Spécifier et analyser (entrées/sorties/formules) ➔ 3. Écrire l'algorithme ➔ 4. Coder en C ➔ 5. Exécuter et tester.\n\n"
            "• Du code source à l'exécutable (3 étapes) :\n"
            "  1. Écriture du code source (*.c) ➔ 2. Compilation en fichier objet (*.o) ➔ 3. Édition des liens (Programme exécutable).\n\n"
            "• Structure minimale d'un programme C :\n"
            "  #include <stdio.h>\n"
            "  void main() {\n"
            "      printf(\"Bienvenue à ESPRIT\");\n"
            "  }\n"
            "  (Sensible à la casse : mots réservés for, while, if, else, return, int, float en minuscules ; commentaires entre /* */ ou //).\n\n"
            "• Structures conditionnelles :\n"
            "  - if (condition) { ... } else { ... } (condition entre parenthèses, combinable avec && et ||).\n"
            "  - En C : 0 = Faux, toute valeur != 0 = Vrai.\n"
            "  - switch : idéal pour les menus à choix multiples fixes.\n\n"
            "• Boucle for :\n"
            "  - for (init; condition; pas) { ... } : utilisée quand le nombre de répétitions est connu à l'avance (ne jamais modifier la variable limite dans le corps de la boucle)."
        )

    # 6. Quick reply / intent: "Propose un exercice"
    if any(p in norm_msg for p in ('propose un exercice', 'donne moi un exercice', 'donne un exercice', 'proposer un exercice', 'exercice', 'qcm')) and not any(k in norm_msg for k in ('corrige', 'solution')):
        return (
            "✍️ Voici 3 exercices progressifs tirés de votre cours (avec corrigé) :\n\n"
            "🔹 Exercice 1 (Chapitre 1 — Étapes & Compilation) :\n"
            "Question : Quel est l'ordre exact des étapes pour créer et exécuter un programme à partir d'un problème ?\n"
            "A) Codage ➔ Analyse ➔ Test ➔ Algorithme\n"
            "B) Position du problème ➔ Spécification & Analyse ➔ Algorithme ➔ Programme C (*.c ➔ compilation *.o ➔ édition des liens) ➔ Exécution & Test\n"
            "✅ Correction : Réponse B. On analyse toujours les entrées/sorties et on écrit l'algorithme avant de coder.\n\n"
            "🔹 Exercice 2 (Chapitre 2 — Condition if ... else en C) :\n"
            "Écrire un programme C qui lit deux entiers a et b et affiche leur maximum.\n"
            "✅ Solution du cours :\n"
            "#include <stdio.h>\n"
            "void main() {\n"
            "    int a, b, max;\n"
            "    printf(\"Donnez a et b : \");\n"
            "    scanf(\"%d %d\", &a, &b);\n"
            "    if (b > a)\n"
            "        max = b;\n"
            "    else\n"
            "        max = a;\n"
            "    printf(\"Le maximum est : %d\", max);\n"
            "}\n\n"
            "🔹 Exercice 3 (Piège classique en C — Que va afficher ce code ?) :\n"
            "int x = 5;\n"
            "if (x > 3)\n"
            "    if (x < 10)\n"
            "        printf(\"A\");\n"
            "else\n"
            "    printf(\"B\");\n"
            "✅ Correction : Il affiche « A » (le else est rattaché au 2ème if, et comme x = 5 vérifie x > 3 et x < 10, printf(\"A\") est exécuté)."
        )

    # 7. Topic-specific explanations from the course slides
    if any(k in norm_msg for k in ('etape', 'resoudre', 'resolution', 'demarches', 'demarche')) and any(k in norm_msg for k in ('probleme', 'programme', 'algorithme', 'etape', '1')):
        return (
            "📌 Les 5 étapes de résolution d'un problème (Cours 1.1) :\n\n"
            "La réalisation d'un programme exécutable nécessite de suivre une démarche précise :\n"
            "1. Étape 1 — Position du problème : bien formuler le problème à résoudre.\n"
            "2. Étape 2 — Spécification et analyse du problème : bien comprendre l'énoncé, identifier les données d'entrée, les résultats (sorties), les contraintes et déterminer les formules de calcul.\n"
            "3. Étape 3 — Écriture de l'algorithme : décrire la suite logique et ordonnée des instructions avant de passer au langage de programmation.\n"
            "4. Étape 4 — Écriture du programme : traduire l'algorithme en langage C (fichiers source *.c).\n"
            "5. Étape 5 — Exécution et test du programme : compiler, exécuter et tester le programme avec différents cas pour détecter d'éventuelles erreurs logiques."
        )

    if any(k in norm_msg for k in ('executable', 'compilateur', 'compilation', 'edition des liens', 'edition de liens', 'fichier objet', 'fichier source')):
        return (
            "⚙️ Comment créer un programme exécutable en langage C (Cours 1.1) :\n\n"
            "Le passage du code écrit par le programmeur au programme exécutable comporte 3 étapes :\n"
            "1) Écriture des fichiers source (*.c) : code écrit en langage C lisible par un humain.\n"
            "2) Compilation : le compilateur vérifie la syntaxe et traduit chaque fichier source (*.c) en fichier objet (*.o) en langage machine.\n"
            "3) Édition des liens (Linker) : combine les fichiers objets (*.o) avec les bibliothèques standard (libs, comme stdio) pour générer le programme exécutable final."
        )

    if any(k in norm_msg for k in ('structure', 'main', 'printf', 'stdio', 'commentaire', 'minuscule', 'majuscule', 'mot reserve')):
        return (
            "💻 Structure d'un programme en langage C (Cours 1.2) :\n\n"
            "Exemple type du cours :\n"
            "#include <stdio.h> /* Bibliothèque d'entrées-sorties standard */\n"
            "void main() /* Fonction principale du programme C */\n"
            "{\n"
            "    printf(\"Bienvenue à ESPRIT\");\n"
            "}\n\n"
            "Points clés à retenir :\n"
            "• #include <stdio.h> : inclut la bibliothèque contenant les fonctions d'affichage (printf) et de lecture (scanf).\n"
            "• main() : est obligatoirement la fonction principale par laquelle commence l'exécution du programme C.\n"
            "• { et } : délimitent le début et la fin du bloc d'instructions.\n"
            "• Commentaires : compris entre /* et */ (multi-lignes) ou après // (une ligne). Ils sont ignorés par le compilateur.\n"
            "• Casse : le langage C distingue les minuscules des majuscules. Tous les mots réservés (for, while, if, else, return, struct...) s'écrivent en minuscules."
        )

    if any(k in norm_msg for k in ('boucle', 'for', 'while', 'iterati', 'compteur')):
        return (
            "🔁 La boucle « for » en langage C (Cours 3.1) :\n\n"
            "• Rôle : exécuter un bloc d'instructions un certain nombre de fois lorsque ce nombre est connu à l'avance, à l'aide d'une variable d'itération appelée Compteur.\n"
            "• Syntaxe :\n"
            "for (Init_compteur; Condition; Inc_ou_Décrémentation_compteur)\n"
            "{\n"
            "    /* Bloc d'instructions */\n"
            "}\n"
            "(Si le bloc contient une seule instruction, les accolades { } sont facultatives).\n\n"
            "• Exemple du cours :\n"
            "#include <stdio.h>\n"
            "void main()\n"
            "{\n"
            "    int a, k = 10;\n"
            "    for (a = 1; a <= k; a++)\n"
            "        printf(\"Bonjour\");\n"
            "}\n\n"
            "⚠️ Attention (piège du cours) : ne modifiez jamais la variable limite (ex: k = k + 10) à l'intérieur du corps de la boucle for, car cela constitue une erreur logique qui modifie la condition d'arrêt !"
        )

    if any(k in norm_msg for k in ('if', 'else', 'condition', 'imbrique', 'switch', '&&', '||')):
        return (
            "🔀 Les structures conditionnelles en C : if ... else, if imbriqués et switch (Cours 2.1 & 2.3) :\n\n"
            "1. Syntaxe de if ... else :\n"
            "if (Condition) {\n"
            "    /* exécuté si la Condition est vraie (toute valeur != 0 en C) */\n"
            "} else {\n"
            "    /* optionnel : exécuté si la Condition est fausse (valeur == 0) */\n"
            "}\n\n"
            "2. Règles importantes :\n"
            "• La condition doit être entre parenthèses : ex. if (moy >= 10).\n"
            "• Opérateurs logiques : ET s'écrit && (les deux conditions doivent être vraies) et OU s'écrit || (au moins une condition vraie).\n"
            "• Piège classique : dans des if imbriqués sans accolades, le « else » se rattache toujours au « if » qui le précède immédiatement. Et attention à ne pas confondre « a == 3 » (comparaison) avec « a = 3 » (affectation, toujours vraie si != 0).\n\n"
            "3. Comparaison (Cours 2.3) :\n"
            "• if : 1 cas (test simple, lisibilité ⭐⭐⭐⭐)\n"
            "• if - else : 2 cas (choix binaire, lisibilité ⭐⭐⭐⭐)\n"
            "• if imbriqués : plusieurs cas (conditions complexes, lisibilité ⭐⭐)\n"
            "• switch : plusieurs cas (menus et choix fixes, lisibilité ⭐⭐⭐⭐⭐)"
        )

    if any(k in norm_msg for k in ('pitch', 'impact', 'poster', 'cdio', 'ccca4', 'cta', 'headline')):
        return (
            "🎯 Guide IDEA PITCH — CCCA4 PI-CDIO (Week 8) :\n\n"
            "• Format : 15 min de présentation persuasive (non technique) + 5 min Q&A + Poster commercial.\n"
            "• Modèle IMPACT pour structurer le pitch :\n"
            "  - I (Ignite curiosity) : capter l'attention dès les premières secondes (question provocante, statistique, scénario).\n"
            "  - M (Make the problem real) : montrer qui souffre du problème et amplifier les conséquences (coût, temps, FOMO).\n"
            "  - P (Present the shift) & A (Amplify the value) : présenter votre solution en insistant sur les résultats/bénéfices utilisateur et non sur la technique.\n"
            "  - C (Chart the future) : projeter la vision et l'impact à long terme.\n"
            "  - T (Trigger action) : conclure par un Call To Action (CTA) fort.\n\n"
            "• Les 7 éléments obligatoires du Poster :\n"
            "  1. Headline (« Achieve [desired result] without [pain/problem] »)\n"
            "  2. The Problem (1-2 lignes quantifiées)\n"
            "  3. The Solution (visuel compréhensible en 10-15s + 1-2 phrases)\n"
            "  4. Three Key Benefits (exactement 3 bénéfices d'une ligne, orientés valeur)\n"
            "  5. Uniqueness (1 phrase sur l'avantage compétitif)\n"
            "  6. Evidence (preuve chiffrée, test pilote, comparaison)\n"
            "  7. Call to Action (CTA) + QR Code + Contact Info."
        )

    # 8. Token similarity search over knowledge_base.json + MongoDB contents
    query_tokens = _tokenize_course_text(clean_message)
    kb_chunks = _load_course_knowledge_chunks()
    scored = []
    for chunk in kb_chunks:
        score = sum(2 if tok in _tokenize_course_text(chunk.get('topic', '')) else 1 for tok in query_tokens if tok in chunk['tokens'])
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: -item[0])

    if scored:
        best_chunks = [item[1] for item in scored[:2]]
        parts_out = [f"📖 D'après votre cours ({best_chunks[0]['source']}) :"]
        for ch in best_chunks:
            parts_out.append(ch['text'])
        parts_out.append("💡 Voulez-vous un exemple supplémentaire ou un exercice d'application sur ce point ?")
        return '\n\n'.join(parts_out)

    # Search dynamic MongoDB contents if question mentions a specific course/chapter/quiz
    matching_contents = []
    for content in visible_contents:
        text_blob = ' '.join(
            str(content.get(k) or '')
            for k in ('courseId', 'chapterId', 'partId', 'title', 'description')
        )
        c_tokens = set(_tokenize_course_text(text_blob))
        overlap = sum(1 for tok in query_tokens if tok in c_tokens)
        if overlap > 0:
            matching_contents.append((overlap, content))
    matching_contents.sort(key=lambda item: -item[0])

    if matching_contents:
        top = [item[1] for item in matching_contents[:3]]
        lines = ["📚 Voici les éléments correspondants dans vos cours EduVia :"]
        for item in top:
            title = str(item.get('title') or item.get('courseId') or 'Contenu').strip()
            course = str(item.get('courseId') or '').strip()
            chapter = str(item.get('chapterId') or '').strip()
            desc = str(item.get('description') or '').strip()
            meta = ' — '.join(p for p in (course, chapter, title) if p)
            lines.append(f"• {meta}" + (f" : {desc}" if desc else ''))
        lines.append("Demandez-moi « Explique-moi ce chapitre », « Donne-moi un résumé » ou « Propose un exercice » pour aller plus loin.")
        return '\n'.join(lines)

    return (
        "Je suis votre assistant de cours EduVia. Voici les thèmes de votre projet sur lesquels je peux vous aider immédiatement :\n"
        "• Chapitre 1 : Les 5 étapes de résolution d'un problème, la création d'un programme exécutable (*.c ➔ *.o ➔ exécutable) et la structure d'un programme C (#include <stdio.h>, main, printf, commentaires).\n"
        "• Chapitre 2 : Les structures conditionnelles (if ... else, opérateurs && et ||, if imbriqués, switch).\n"
        "• Chapitre 3 : Les structures itératives (la boucle for et son compteur).\n"
        "• Guide IDEA PITCH (PI-CDIO) : Le modèle IMPACT et les 7 éléments du poster.\n\n"
        "Cliquez sur « Explique-moi ce chapitre », « Donne-moi un résumé », « Propose un exercice » ou posez votre question sur l'une de ces notions !"
    )


def _planner(request, body, parts, user):
    if not user:
        return JsonResponse({'success': False, 'message': 'Utilisateur non connecté'}, status=401)
    root = 'student/planner/'
    if len(parts) == 2 and request.method == 'GET':
        return _response({'events': [_resource_dict(r) for r in _owned_records(root+'events', user)],
                          'tasks': [_resource_dict(r) for r in _owned_records(root+'tasks', user)]})
    if len(parts) < 3:
        return None
    kind, item_id = parts[2], parts[3] if len(parts) > 3 else ''
    collection = root + kind
    if kind not in ('events', 'tasks'):
        return None
    if request.method == 'POST' and not item_id:
        title, day = str(body.get('title', '')).strip(), str(body.get('date', '')).strip()
        try: date.fromisoformat(day)
        except ValueError: return JsonResponse({'success': False, 'message': 'Date invalide'}, status=400)
        if not title: return JsonResponse({'success': False, 'message': 'Titre obligatoire'}, status=400)
        if kind == 'events':
            payload = {'title': title, 'type': 'test' if body.get('type') == 'test' else 'exam', 'date': day,
                       'time': body.get('time') or '09:00', 'notes': body.get('notes') or '',
                       'reminderEnabled': body.get('reminderEnabled') is True}
        else:
            payload = {'title': title, 'scope': 'week' if body.get('scope') == 'week' else 'day', 'date': day,
                       'notes': body.get('notes') or '', 'completed': body.get('completed') is True}
        rec = _save_record(collection, payload, user)
        return _response(_resource_dict(rec))
    record = _owned_records(collection, user).filter(public_id=item_id).first()
    if record and len(parts) == 5 and parts[4] == 'reminder' and request.method in ('POST', 'DELETE'):
        record.payload['reminderEnabled'] = request.method == 'POST'
        if request.method == 'POST':
            record.payload['reminded'] = False
            record.payload['remindedAt'] = None
        record.save(update_fields=['payload', 'updated_at'])
        return _response(_resource_dict(record))
    if record and len(parts) > 5 and parts[4:6] == ['reminder', 'fire'] and request.method == 'POST':
        record.payload['reminderEnabled'] = False
        record.payload['reminded'] = True
        record.payload['remindedAt'] = timezone.now().isoformat()
        record.save(update_fields=['payload', 'updated_at'])
        return _response(_resource_dict(record))
    if request.method == 'PATCH' and record:
        if len(parts) > 4 and parts[4] == 'reminder':
            record.payload['reminderEnabled'] = True
        elif len(parts) > 4 and parts[4] == 'toggle':
            record.payload['completed'] = body.get('completed') is True
        else:
            record.payload.update(body)
        record.save(update_fields=['payload', 'updated_at'])
        return _response(_resource_dict(record))
    if request.method == 'DELETE' and record:
        record.delete(); return _response({'deleted': True})
    return JsonResponse({'success': False, 'message': 'Ressource introuvable'}, status=404)


def _notifications(request, body, parts, user):
    if not user:
        return JsonResponse({'success': False, 'message': 'Authentification requise'}, status=401)
    qs = _owned_records('notifications', user)
    if request.method == 'GET' and len(parts) == 1:
        return _response([_resource_dict(r) for r in qs.filter(payload__dismissed__in=[False, None])])
    if request.method == 'GET' and len(parts) == 2 and parts[1] == 'read-state':
        emails = {value.strip().lower() for value in request.GET.get('emails', '').split(',') if value.strip()}
        title = request.GET.get('title', '').strip()
        students = [candidate for candidate in User.objects.filter(is_active=True)
                    if candidate.email.strip().lower() in emails]
        matched = Resource.objects.filter(collection='notifications', owner__in=students,
                                          payload__action__reminderTitle=title)
        total = matched.count()
        read = matched.filter(payload__read=True).count()
        return _response({'total': total, 'read': read, 'allRead': total > 0 and read == total})
    if request.method == 'POST' and len(parts) == 1:
        client_id = str(body.get('clientId') or '').strip()
        public_id = f'legacy-{user.pk}-{client_id}' if client_id else None
        payload = {key: value for key, value in body.items() if key not in ('id', '_id', 'clientId')}
        payload.update({'read': body.get('read') is True, 'dismissed': body.get('dismissed') is True,
                        'createdAt': payload.get('createdAt') or timezone.now().isoformat()})
        rec = _save_record('notifications', payload, user, public_id)
        return _response(_resource_dict(rec))
    if request.method == 'POST' and len(parts) == 2 and parts[1] == 'bulk':
        if user.user_role not in ('teacher', 'admin'): return JsonResponse({'success': False}, status=403)
        emails = {str(value).strip().lower() for value in (body.get('emails') or []) if str(value).strip()}
        notification = body.get('notification') if isinstance(body.get('notification'), dict) else {}
        if not emails or not str(notification.get('title') or '').strip() or not str(notification.get('message') or '').strip():
            return JsonResponse({'success': False, 'message': 'Destinataires et contenu obligatoires'}, status=400)
        targets = [candidate for candidate in User.objects.filter(is_active=True, user_role='student')
                   if candidate.email.strip().lower() in emails]
        saved = []
        for target in targets:
            rec = _save_record('notifications', {
                **notification,
                'read': False,
                'dismissed': False,
                'createdAt': timezone.now().isoformat(),
            }, target)
            saved.append(_resource_dict(rec))
        return _response({'created': len(saved), 'notifications': saved})
    if request.method == 'DELETE' and len(parts) == 1:
        qs.delete(); return _response({'deleted': True})
    if len(parts) > 1:
        rec = qs.filter(public_id=parts[1]).first()
        if rec and request.method == 'DELETE': rec.delete(); return _response({'deleted': True})
        if rec and request.method == 'PATCH' and len(parts) > 2 and parts[2] == 'read':
            rec.payload['read'] = True; rec.save(update_fields=['payload', 'updated_at']); return _response(_resource_dict(rec))
    return None


def _parse_iso_datetime(raw_value):
    text = str(raw_value or '').strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
        if timezone.is_aware(dt):
            dt = timezone.localtime(dt)
        return dt
    except ValueError:
        try:
            d = date.fromisoformat(text[:10])
            return datetime.combine(d, time(9, 0))
        except ValueError:
            return None


def _format_exam_date_time(due_dates):
    parsed = [dt for dt in (_parse_iso_datetime(v) for v in (due_dates or [])) if dt is not None]
    if not parsed:
        return 'Date non definie', 'Heure non definie'
    parsed.sort()
    now = datetime.now()
    future = [dt for dt in parsed if dt.date() >= now.date()]
    chosen = future[0] if future else parsed[0]
    date_label = f'{chosen.day:02d} {FRENCH_MONTHS[chosen.month]} {chosen.year}'
    time_label = f'{chosen.hour:02d}:{chosen.minute:02d}'
    return date_label, time_label


def _teacher_subject_keys(teacher):
    subject_keys = set()
    subjects = teacher.teaching_subjects or []
    if isinstance(subjects, str):
        subjects = [subjects]
    for subj in subjects:
        norm = _normalized_text(subj)
        if norm:
            subject_keys.add(norm)
    assignments = teacher.teaching_assignments or []
    if isinstance(assignments, dict):
        assignments = [assignments]
    for assignment in assignments:
        if isinstance(assignment, dict):
            norm = _normalized_text(assignment.get('subject'))
            if norm:
                subject_keys.add(norm)
    return subject_keys


def _teacher_course_members(teacher, requested_class='', include_progress=True):
    assigned_values = teacher.assigned_classes or []
    if isinstance(assigned_values, str):
        assigned_values = [assigned_values]
    assigned_classes = {str(value).strip() for value in assigned_values if str(value).strip()}
    if str(teacher.class_name or '').strip():
        assigned_classes.add(str(teacher.class_name).strip())
    assignments = teacher.teaching_assignments or []
    if isinstance(assignments, dict):
        assignments = [assignments]
    for assignment in assignments:
        if isinstance(assignment, dict):
            for key in ('className', 'class', 'class_name'):
                value = str(assignment.get(key) or '').strip()
                if value:
                    assigned_classes.add(value)
            classes_val = assignment.get('classes') or []
            if isinstance(classes_val, str):
                classes_val = [classes_val]
            for value in classes_val:
                if str(value or '').strip():
                    assigned_classes.add(str(value).strip())

    subject_keys = _teacher_subject_keys(teacher)
    content_records = list(Resource.objects.filter(collection='contents'))
    all_contents = [_resource_dict(record) for record in content_records]
    teacher_contents = [
        content for record, content in zip(content_records, all_contents)
        if record.owner_id == teacher.pk
        or str(content.get('teacherEmail') or '').strip().casefold() == teacher.email.casefold()
        or _normalized_text(content.get('courseId')) in subject_keys
        or (str(content.get('type') or '').strip().casefold() == 'course' and _normalized_text(content.get('title')) in subject_keys)
    ]
    scope_contents = teacher_contents or all_contents
    chapter_aliases = {}
    for content in scope_contents:
        if str(content.get('type') or '').strip().casefold() == 'chapter':
            ch_title = str(content.get('title') or content.get('chapterId') or '').strip()
            if ch_title:
                for alias_val in (content.get('_id'), content.get('id'), content.get('chapterId'), content.get('title')):
                    norm_alias = _normalized_text(alias_val)
                    if norm_alias:
                        chapter_aliases[norm_alias] = ch_title
    class_names = set(assigned_classes)
    shares_with_all = False
    for content in scope_contents:
        classes = content.get('visibleToClasses') or []
        if isinstance(classes, str):
            classes = [classes]
        class_names.update(str(value).strip() for value in classes if str(value).strip())
        class_name = str(content.get('className') or '').strip()
        if class_name:
            class_names.add(class_name)
        shares_with_all = shares_with_all or content.get('visibleToAllClasses') is True

    all_active_students = list(User.objects.filter(user_role='student', is_active=True))
    if shares_with_all or not class_names:
        class_names.update(
            s.class_name.strip() for s in all_active_students if str(s.class_name or '').strip()
        )

    class_by_key = {name.casefold(): name for name in class_names}
    normalized_request = str(requested_class or '').strip().casefold()
    if normalized_request and normalized_request != 'all':
        selected = class_by_key.get(normalized_request)
        if not selected:
            return {'classes': sorted(class_names, key=str.casefold), 'selectedClass': '', 'totalStudents': 0, 'students': []}
        selected_classes = {selected.casefold()}
    else:
        selected_classes = set(class_by_key)

    students = [
        student for student in all_active_students
        if student.class_name.strip().casefold() in selected_classes
    ]
    if not students and (not normalized_request or normalized_request == 'all'):
        students = all_active_students

    if not include_progress:
        return {
            'classes': sorted(class_names, key=str.casefold),
            'selectedClass': class_by_key.get(normalized_request, '') if (normalized_request and normalized_request != 'all') else 'all',
            'totalStudents': len(students),
            'students': [],
        }

    all_progress_by_owner = {}
    if students:
        for rec in Resource.objects.filter(collection='student/progress', owner__in=students):
            all_progress_by_owner.setdefault(rec.owner_id, []).append(rec)

    result_students = []
    for student in students:
        student_class_key = student.class_name.strip().casefold()
        student_contents = [
            content for content in scope_contents
            if content.get('visibleToAllClasses') is True
            or not (content.get('visibleToClasses') or content.get('className'))
            or (student_class_key and student_class_key in {
                str(value).strip().casefold()
                for value in ([content.get('visibleToClasses')] if isinstance(content.get('visibleToClasses'), str)
                              else content.get('visibleToClasses') or [])
            })
            or (student_class_key and str(content.get('className') or '').strip().casefold() == student_class_key)
        ]
        if not student_contents:
            student_contents = list(scope_contents)
        trackable = [
            content for content in student_contents
            if str(content.get('type') or '').strip().casefold() not in ('course', 'chapter', 'part')
        ]
        progress = all_progress_by_owner.get(student.pk, [])
        progress_by_id = {
            str(record.payload.get('contentId') or '').strip(): record
            for record in progress if str(record.payload.get('contentId') or '').strip()
        }
        trackable_by_id = {
            str(content.get('_id') or content.get('id') or '').strip(): content
            for content in trackable
        }
        completed_ids = {
            content_id for content_id, record in progress_by_id.items()
            if content_id in trackable_by_id
            and str(record.payload.get('status') or '').casefold() in ('completed', 'passed')
        }
        quizzes = [content for content in trackable if 'quiz' in str(content.get('type') or '').casefold()]
        quiz_scores = []
        for content_id in completed_ids:
            content = trackable_by_id[content_id]
            if 'quiz' not in str(content.get('type') or '').casefold():
                continue
            score = progress_by_id[content_id].payload.get('score')
            try:
                quiz_scores.append(max(0, min(100, round(float(score)))))
            except (TypeError, ValueError):
                pass
        course_groups = {}
        for content in trackable:
            course_name = str(content.get('courseId') or '').strip()
            if course_name:
                course_groups.setdefault(course_name, set()).add(str(content.get('_id') or content.get('id') or '').strip())
        completed_courses = sum(bool(ids) and ids.issubset(completed_ids) for ids in course_groups.values())
        pending_scopes = []
        for content_id, item_content in trackable_by_id.items():
            if content_id in completed_ids:
                continue
            raw_ch = str(item_content.get('chapterId') or '').strip()
            ch_label = chapter_aliases.get(_normalized_text(raw_ch)) or raw_ch or str(item_content.get('title') or '').strip()
            if ch_label and ch_label not in pending_scopes:
                pending_scopes.append(ch_label)
        last_activity = max((record.updated_at for record in progress), default=None)
        total = len(trackable)
        global_progress = round(len(completed_ids) * 100 / total) if total else 0
        result_students.append({
            'id': str(student.pk),
            'fullName': student.get_full_name() or student.username,
            'email': student.email,
            'className': student.class_name,
            'avatarDataUrl': student.avatar or '',
            'lastActivityAt': last_activity.isoformat() if last_activity else None,
            'globalProgress': global_progress,
            'levelProgress': global_progress,
            'quizProgressDetails': {
                'attemptedQuizzes': len(quiz_scores),
                'totalQuizzes': len(quizzes),
                'averageAttemptScore': round(sum(quiz_scores) / len(quiz_scores)) if quiz_scores else 0,
            },
            'pendingContentScopes': pending_scopes[:8],
            'learningProgress': [
                {
                    'contentId': content_id,
                    'contentType': trackable_by_id[content_id].get('type') or '',
                    'status': record.payload.get('status') or '',
                    'score': record.payload.get('score'),
                    'completedAt': record.updated_at.isoformat(),
                    'updatedAt': record.updated_at.isoformat(),
                }
                for content_id, record in progress_by_id.items()
                if content_id in trackable_by_id
            ],
            'progressDetails': {
                'completedMaterials': len(completed_ids),
                'totalMaterials': total,
                'completedCourses': completed_courses,
                'totalCourses': len(course_groups),
                'completedUnits': len(completed_ids),
                'totalUnits': total,
            },
        })
    result_students.sort(key=lambda student: str(student['fullName']).casefold())
    return {
        'classes': sorted(class_names, key=str.casefold),
        'selectedClass': class_by_key.get(normalized_request, '') if (normalized_request and normalized_request != 'all') else 'all',
        'totalStudents': len(result_students),
        'students': result_students,
    }


def _teacher_exam_reminders(teacher, requested_class=''):
    members = _teacher_course_members(teacher, requested_class)
    students = members.get('students') or []

    subject_keys = _teacher_subject_keys(teacher)
    content_records = list(Resource.objects.filter(collection='contents'))
    all_contents = [_resource_dict(record) for record in content_records]
    teacher_contents = [
        content for record, content in zip(content_records, all_contents)
        if record.owner_id == teacher.pk
        or str(content.get('teacherEmail') or '').strip().casefold() == teacher.email.casefold()
        or _normalized_text(content.get('courseId')) in subject_keys
        or (str(content.get('type') or '').strip().casefold() == 'course' and _normalized_text(content.get('title')) in subject_keys)
    ]
    scope_contents = [
        content for content in (teacher_contents or all_contents)
        if content.get('isActive') is not False
    ]

    course_map = {}
    course_aliases = {}

    def register_course(course_name, visible_classes=None):
        clean_name = str(course_name or '').strip()
        key = _normalized_text(clean_name)
        if not clean_name or not key:
            return ''
        if key not in course_map:
            course_map[key] = {
                'id': clean_name,
                'course': clean_name,
                'chapters': [],
                'due_dates': [],
                'visible_to_all_classes': False,
                'visible_to_classes': set(),
                'chapter_aliases': {},
                'materials': [],
            }
        if visible_classes:
            for cls in visible_classes:
                if str(cls or '').strip():
                    course_map[key]['visible_to_classes'].add(str(cls).strip())
        course_aliases[key] = key
        return key

    assignments = teacher.teaching_assignments or []
    if isinstance(assignments, dict):
        assignments = [assignments]
    for assignment in assignments:
        if isinstance(assignment, dict):
            subj = str(assignment.get('subject') or '').strip()
            cls_list = assignment.get('classes') or []
            if isinstance(cls_list, str):
                cls_list = [cls_list]
            if subj:
                register_course(subj, cls_list)

    subjects = teacher.teaching_subjects or []
    if isinstance(subjects, str):
        subjects = [subjects]
    for subj in subjects:
        if str(subj or '').strip():
            register_course(subj, members.get('classes') or [])

    for content in scope_contents:
        if str(content.get('type') or '').strip().casefold() == 'course':
            c_name = str(content.get('courseId') or content.get('title') or '').strip()
            c_key = register_course(c_name)
            if c_key:
                for alias_val in (content.get('_id'), content.get('id'), content.get('courseId'), content.get('title')):
                    norm_alias = _normalized_text(alias_val)
                    if norm_alias:
                        course_aliases[norm_alias] = c_key

    def resolve_course_key(content):
        for candidate in (content.get('courseId'), content.get('title'), content.get('_id')):
            norm = _normalized_text(candidate)
            if norm and norm in course_aliases:
                return course_aliases[norm]
        c_name = str(content.get('courseId') or '').strip()
        if c_name:
            return register_course(c_name)
        return ''

    for content in scope_contents:
        if str(content.get('type') or '').strip().casefold() != 'chapter':
            continue
        c_key = resolve_course_key(content)
        if not c_key or c_key not in course_map:
            continue
        current = course_map[c_key]
        chapter_name = str(content.get('title') or content.get('chapterId') or '').strip()
        if chapter_name and chapter_name not in current['chapters']:
            current['chapters'].append(chapter_name)
        for alias_val in (content.get('_id'), content.get('id'), content.get('chapterId'), content.get('title')):
            norm_alias = _normalized_text(alias_val)
            if norm_alias and chapter_name:
                current['chapter_aliases'][norm_alias] = chapter_name

    for content in scope_contents:
        c_key = resolve_course_key(content)
        if not c_key or c_key not in course_map:
            continue
        current = course_map[c_key]
        ctype = str(content.get('type') or '').strip().casefold()
        ch_ref = str(content.get('chapterId') or '').strip()
        ch_name = (
            current['chapter_aliases'].get(_normalized_text(ch_ref))
            or (str(content.get('title') or ch_ref).strip() if ctype == 'chapter' else ch_ref)
        )
        if ch_name and ch_name not in current['chapters']:
            current['chapters'].append(ch_name)

        due_candidate = str(content.get('dueDateTime') or content.get('dueDate') or '').strip()
        if due_candidate:
            current['due_dates'].append(due_candidate)

        if content.get('visibleToAllClasses') is True:
            current['visible_to_all_classes'] = True

        vis_classes = content.get('visibleToClasses') or []
        if isinstance(vis_classes, str):
            vis_classes = [vis_classes]
        for cls in vis_classes:
            if str(cls or '').strip():
                current['visible_to_classes'].add(str(cls).strip())
        if str(content.get('className') or '').strip():
            current['visible_to_classes'].add(str(content.get('className')).strip())

        is_trackable = False
        if ctype in ('document', 'video'):
            is_trackable = True
        elif 'quiz' in ctype:
            questions = content.get('quizQuestions')
            is_trackable = not isinstance(questions, list) or len(questions) > 0
        if is_trackable:
            current['materials'].append(content)

    exams = []
    for course in course_map.values():
        if course['visible_to_all_classes'] or not course['visible_to_classes']:
            target_students = list(students)
        else:
            allowed_cls = {c.casefold() for c in course['visible_to_classes']}
            target_students = [
                s for s in students
                if str(s.get('className') or '').strip().casefold() in allowed_cls
            ]
            if not target_students:
                target_students = list(students)

        students_at_risk = []
        for student in target_students:
            s_class = str(student.get('className') or '').strip().casefold()
            visible_materials = []
            for mat in course['materials']:
                mat_classes = mat.get('visibleToClasses') or []
                if isinstance(mat_classes, str):
                    mat_classes = [mat_classes]
                mat_allowed = {str(v).strip().casefold() for v in mat_classes if str(v).strip()}
                mat_cls = str(mat.get('className') or '').strip().casefold()
                if (
                    mat.get('visibleToAllClasses') is True
                    or (not mat_allowed and not mat_cls)
                    or (s_class and (s_class in mat_allowed or s_class == mat_cls))
                ):
                    visible_materials.append(mat)
            if not visible_materials and course['materials']:
                visible_materials = list(course['materials'])

            completed_ids = {
                str(entry.get('contentId') or '').strip()
                for entry in (student.get('learningProgress') or [])
                if str(entry.get('status') or '').strip().casefold() in ('completed', 'passed')
            }

            chapter_map = {}
            for mat in visible_materials:
                raw_ch = str(mat.get('chapterId') or '').strip()
                ch_label = (
                    course['chapter_aliases'].get(_normalized_text(raw_ch))
                    or raw_ch
                    or str(mat.get('title') or 'Chapitre 1').strip()
                )
                chapter_map.setdefault(ch_label, []).append(mat)

            missing_chapters = [
                ch_label for ch_label, mats in chapter_map.items()
                if not all(str(m.get('_id') or m.get('id') or '').strip() in completed_ids for m in mats)
            ]
            total_materials = len(visible_materials)
            completed_materials = sum(
                1 for m in visible_materials
                if str(m.get('_id') or m.get('id') or '').strip() in completed_ids
            )
            progress = round(completed_materials * 100 / total_materials) if total_materials > 0 else 100

            if missing_chapters:
                students_at_risk.append({
                    'id': str(student.get('id') or ''),
                    'name': str(student.get('fullName') or student.get('email') or 'Etudiant'),
                    'email': str(student.get('email') or '').strip(),
                    'progress': progress,
                    'completedContents': completed_materials,
                    'totalContents': total_materials,
                    'missingChapters': missing_chapters,
                })

        chapters = sorted(course['chapters'], key=str.casefold)
        date_label, time_label = _format_exam_date_time(course['due_dates'])
        exams.append({
            'id': course['id'],
            'course': course['course'],
            'date': date_label,
            'time': time_label,
            'location': 'A definir',
            'chapters': chapters,
            'studentsCount': len(target_students),
            'studentEmails': [
                str(s.get('email') or '').strip()
                for s in target_students
                if str(s.get('email') or '').strip()
            ],
            'remindersSent': 0,
            'studentsAtRisk': students_at_risk,
        })

    exams.sort(key=lambda item: str(item['course']).casefold())
    student_objs = User.objects.filter(user_role='student', is_active=True)
    reminders = Resource.objects.filter(
        collection='notifications',
        owner__in=student_objs,
        payload__action__kind='exam_reminder',
    )
    return {
        'classes': members.get('classes') or [],
        'selectedClass': members.get('selectedClass') or 'all',
        'exams': exams,
        'students': members.get('students') or [],
        'reminders': [_resource_dict(item) for item in reminders],
    }


def _extract_pdf_text_fallback(raw_bytes):
    """Extract text from PDF bytes using pypdf when installed, with a pure-Python zlib stream fallback."""
    try:
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(io.BytesIO(raw_bytes))
        pages_text = []
        for page in reader.pages:
            page_txt = page.extract_text() or ''
            if page_txt.strip():
                pages_text.append(page_txt.strip())
        if pages_text:
            return '\n'.join(pages_text)
    except Exception:
        pass

    chunks = []
    for match in re.finditer(rb'stream[\r\n]+(.*?)[\r\n]+endstream', raw_bytes, re.S):
        stream_data = match.group(1)
        for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
            try:
                decompressed = zlib.decompress(stream_data, wbits)
                text_stream = decompressed.decode('latin-1', errors='ignore')
                parts = []
                for token in re.findall(r'\((?:\\.|[^\\()])*\)|\[(?:\\.|[^\[\]])*\]', text_stream):
                    for lit in re.findall(r'\((?:\\.|[^\\()])*\)', token):
                        inner = lit[1:-1]
                        inner = (
                            inner.replace(r'\n', '\n')
                            .replace(r'\r', ' ')
                            .replace(r'\t', ' ')
                            .replace(r'\(', '(')
                            .replace(r'\)', ')')
                            .replace(r'\\', '\\')
                        )
                        if inner.strip():
                            parts.append(inner)
                if parts:
                    chunks.append(' '.join(parts))
                break
            except Exception:
                continue
    if chunks:
        return '\n'.join(chunks)[:25000]
    return ''


def _extract_uploaded_file_text(upload):
    if not upload:
        return ''
    try:
        upload.seek(0)
        raw_bytes = upload.read()
        upload.seek(0)
    except Exception:
        return ''
    if not raw_bytes:
        return ''
    ext = os.path.splitext(getattr(upload, 'name', '') or '')[1].lower()
    if ext == '.docx' or raw_bytes[:2] == b'PK':
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                if 'word/document.xml' in archive.namelist():
                    xml_data = archive.read('word/document.xml').decode('utf-8', errors='ignore')
                    xml_data = re.sub(r'</w:p>', '\n', xml_data)
                    xml_data = re.sub(r'<w:br[^>]*/?>', '\n', xml_data)
                    xml_data = re.sub(r'<w:tab[^>]*/?>', ' ', xml_data)
                    text = re.sub(r'<[^>]+>', '', xml_data)
                    text = html.unescape(text)
                    lines = [re.sub(r'[ \t]+', ' ', ln).strip() for ln in text.splitlines()]
                    cleaned_docx = '\n'.join(ln for ln in lines if ln)
                    if cleaned_docx:
                        return cleaned_docx
        except Exception:
            pass
    if ext == '.pdf' or raw_bytes[:4] == b'%PDF':
        pdf_text = _extract_pdf_text_fallback(raw_bytes)
        if pdf_text.strip():
            return pdf_text.strip()
    if ext in ('.txt', '.md', '.csv', '.json'):
        for enc in ('utf-8', 'utf-8-sig', 'cp1252', 'latin-1'):
            try:
                return raw_bytes.decode(enc)
            except Exception:
                continue
    # Fallback text extraction for DOC / binary files
    decoded = raw_bytes.decode('utf-8', errors='ignore')
    fragments = re.findall(r'[A-Za-zÀ-ÿ0-9 ,;:.?!\'\"()\-+/=\n]{8,}', decoded)
    cleaned = '\n'.join(frag.strip() for frag in fragments if len(frag.strip()) >= 8)
    return cleaned[:20000]


_CURATED_QUIZ_BANK = [
    {
        'topics': {'etape', 'probleme', 'algorithme', 'analyse', 'specification', 'chapitre 1', '1.1', 'idee', 'programme', 'c'},
        'prompt': "Quelle est la deuxième étape de la démarche de résolution d'un problème en programmation (après la position du problème) ?",
        'options': [
            {'label': 'A', 'text': "Spécification et analyse du problème (identifier entrées, sorties, contraintes et formules)"},
            {'label': 'B', 'text': "Édition des liens avec les bibliothèques standard"},
            {'label': 'C', 'text': "Exécution directe du fichier binaire sur le processeur"},
            {'label': 'D', 'text': "Suppression des commentaires dans le code source"},
        ],
        'correctAnswers': ['A'],
        'explanation': "La 2e étape consiste à bien comprendre l'énoncé, identifier les données d'entrée, les résultats attendus, les contraintes et les formules de calcul avant d'écrire l'algorithme.",
    },
    {
        'topics': {'executable', 'compilation', 'compilateur', 'edition', 'liens', 'objet', 'source', 'chapitre 1', '1.1', 'c'},
        'prompt': "Quel est l'ordre exact des étapes permettant de transformer un fichier source en langage C (*.c) en un programme exécutable ?",
        'options': [
            {'label': 'A', 'text': "Fichier source (*.c) ➔ Compilation en fichier objet (*.o) ➔ Édition des liens (avec les bibliothèques) ➔ Exécutable"},
            {'label': 'B', 'text': "Fichier objet (*.o) ➔ Fichier source (*.c) ➔ Interprétation HTML"},
            {'label': 'C', 'text': "Édition des liens ➔ Écriture de l'algorithme ➔ Fichier source (*.c)"},
            {'label': 'D', 'text': "Exécution ➔ Compilation ➔ Spécification du problème"},
        ],
        'correctAnswers': ['A'],
        'explanation': "Le compilateur traduit d'abord les fichiers source (*.c) en fichiers objets (*.o), puis l'éditeur de liens les assemble avec les bibliothèques (libs) pour créer l'exécutable.",
    },
    {
        'topics': {'structure', 'main', 'stdio', 'printf', 'scanf', 'chapitre 1', '1.2', 'c', 'programme'},
        'prompt': "Dans un programme en langage C, quel est le rôle de la directive #include <stdio.h> et de la fonction main() ?",
        'options': [
            {'label': 'A', 'text': "#include <stdio.h> importe la bibliothèque d'entrées/sorties (printf, scanf) et main() est le point d'entrée obligatoire du programme"},
            {'label': 'B', 'text': "#include <stdio.h> déclare une boucle infinie et main() affiche automatiquement du texte"},
            {'label': 'C', 'text': "main() est facultative en langage C si on utilise printf()"},
            {'label': 'D', 'text': "#include <stdio.h> sert uniquement à écrire des commentaires sur plusieurs lignes"},
        ],
        'correctAnswers': ['A'],
        'explanation': "Tout programme C commence son exécution par la fonction principale main(), et <stdio.h> fournit les fonctions standard d'affichage (printf) et de lecture (scanf).",
    },
    {
        'topics': {'commentaire', 'casse', 'minuscule', 'majuscule', 'mot', 'reserve', 'chapitre 1', '1.2', 'c'},
        'prompt': "Laquelle de ces affirmations concernant la syntaxe du langage C est vraie ?",
        'options': [
            {'label': 'A', 'text': "Le langage C distingue les majuscules des minuscules et tous les mots réservés (if, else, for, while, return) s'écrivent en minuscules"},
            {'label': 'B', 'text': "Les mots réservés IF, FOR et WHILE doivent obligatoirement être écrits en majuscules"},
            {'label': 'C', 'text': "Les commentaires entre /* et */ sont exécutés par le processeur"},
            {'label': 'D', 'text': "Les accolades { et } sont interdites dans la fonction main()"},
        ],
        'correctAnswers': ['A'],
        'explanation': "Le langage C est sensible à la casse : tous ses mots réservés s'écrivent en minuscules, et les commentaires (/* ... */ ou //) sont ignorés à la compilation.",
    },
    {
        'topics': {'condition', 'if', 'else', 'conditionnelle', 'chapitre 2', '2.1', '2.3', 'c', 'vrai', 'faux'},
        'prompt': "En langage C, comment une expression conditionnelle dans une instruction if (Condition) est-elle évaluée ?",
        'options': [
            {'label': 'A', 'text': "La valeur 0 correspond à Faux, et toute valeur différente de 0 correspond à Vrai"},
            {'label': 'B', 'text': "La valeur 0 correspond à Vrai, et toute valeur positive correspond à Faux"},
            {'label': 'C', 'text': "Les parenthèses autour de la condition sont interdites après le mot-clé if"},
            {'label': 'D', 'text': "Le bloc else est exécuté même lorsque la condition du if est vraie"},
        ],
        'correctAnswers': ['A'],
        'explanation': "En C, toute expression numérique valant 0 est évaluée comme fausse, tandis que toute valeur non nulle (!= 0) est évaluée comme vraie.",
    },
    {
        'topics': {'operateur', 'logique', 'condition', 'if', 'else', 'imbrique', 'switch', 'chapitre 2', '2.1', '2.3', 'c'},
        'prompt': "Quels sont les opérateurs logiques ET / OU en langage C, et quelle structure est la plus lisible pour gérer un menu à choix fixes ?",
        'options': [
            {'label': 'A', 'text': "&& pour le ET logique, || pour le OU logique, et la structure switch pour les menus à choix fixes"},
            {'label': 'B', 'text': "AND pour le ET logique, OR pour le OU logique, et la boucle for pour les menus"},
            {'label': 'C', 'text': "= pour la comparaison d'égalité et == pour l'affectation d'une valeur"},
            {'label': 'D', 'text': "& pour le OU logique et | pour le ET logique"},
        ],
        'correctAnswers': ['A'],
        'explanation': "En C, && représente le ET logique, || le OU logique, == la comparaison d'égalité, et switch offre la meilleure lisibilité pour des choix multiples fixes.",
    },
    {
        'topics': {'boucle', 'for', 'iterative', 'iteration', 'compteur', 'chapitre 3', '3.1', 'c'},
        'prompt': "Quand utilise-t-on la boucle « for (Init; Condition; Pas) » en langage C et quelle règle faut-il respecter ?",
        'options': [
            {'label': 'A', 'text': "Lorsque le nombre d'itérations est connu à l'avance, en évitant de modifier la variable limite dans le corps de la boucle"},
            {'label': 'B', 'text': "Uniquement lorsque le nombre de répétitions est inconnu et dépend d'une saisie clavier aléatoire"},
            {'label': 'C', 'text': "En modifiant systématiquement la borne limite à chaque tour dans le corps de la boucle"},
            {'label': 'D', 'text': "Pour déclarer une bibliothèque standard au début du fichier"},
        ],
        'correctAnswers': ['A'],
        'explanation': "La boucle for utilise un compteur d'itération quand le nombre de répétitions est connu à l'avance. Modifier la borne limite dans le corps de la boucle provoque des erreurs logiques.",
    },
    {
        'topics': {'pitch', 'impact', 'poster', 'cdio', 'ccca4', 'cta', 'headline', 'idea'},
        'prompt': "Dans le guide IDEA PITCH (PI-CDIO), que signifient les lettres du modèle IMPACT pour structurer une présentation persuasive ?",
        'options': [
            {'label': 'A', 'text': "Ignite curiosity, Make the problem real, Present the shift, Amplify the value, Chart the future, Trigger action"},
            {'label': 'B', 'text': "Initialize code, Manage memory, Print output, Allocate pointers, Compile files, Test binary"},
            {'label': 'C', 'text': "Introduce team, Mention budget, Provide code, Ask questions, Close slides, Thank jury"},
            {'label': 'D', 'text': "Identify bugs, Measure speed, Patch kernel, Archive logs, Check network, Terminate process"},
        ],
        'correctAnswers': ['A'],
        'explanation': "Le modèle IMPACT guide le storytelling persuasif du pitch : capter l'attention (Ignite), ancrer le problème (Make real), présenter la solution et sa valeur (Present & Amplify), projeter l'avenir (Chart) et appeler à l'action (Trigger action).",
    },
    {
        'topics': {'pitch', 'poster', 'cdio', 'ccca4', 'cta', 'headline', 'benefits'},
        'prompt': "Quels sont les 7 éléments indispensables d'un poster IDEA PITCH réussi selon le guide CCCA4 ?",
        'options': [
            {'label': 'A', 'text': "Headline, The Problem, The Solution, Three Key Benefits, Uniqueness, Evidence, Call to Action (CTA + QR Code)"},
            {'label': 'B', 'text': "Code source complet, Schéma UML, Base de données SQL, Bibliographie, CV, Annexe financière, Licence"},
            {'label': 'C', 'text': "Uniquement un titre et un long texte technique de 1000 mots sans visuel"},
            {'label': 'D', 'text': "Table des matières, Introduction théorique, 15 fonctionnalités techniques, Conclusion"},
        ],
        'correctAnswers': ['A'],
        'explanation': "Le poster commercial doit être compris en quelques secondes grâce à ces 7 blocs orientés valeur utilisateur et preuves chiffrées.",
    },
]


def _normalize_ai_generated_questions(raw_list, count=5):
    if not isinstance(raw_list, list):
        return []
    labels = ['A', 'B', 'C', 'D']
    normalized = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        prompt = str(item.get('prompt') or item.get('question') or '').strip()
        raw_opts = item.get('options') or item.get('choices') or []
        if not prompt or not isinstance(raw_opts, list) or len(raw_opts) < 2:
            continue
        opts = []
        for idx, opt in enumerate(raw_opts[:4]):
            lbl = labels[idx]
            if isinstance(opt, dict):
                txt = str(opt.get('text') or opt.get('label') or '').strip()
            else:
                txt = re.sub(r'^[A-Da-d][\)\.\:\-]\s*', '', str(opt or '').strip())
            if txt:
                opts.append({'label': lbl, 'text': txt})
        if len(opts) < 2:
            continue
        while len(opts) < 4:
            lbl = labels[len(opts)]
            opts.append({'label': lbl, 'text': f'Option {lbl}'})
        raw_corr = item.get('correctAnswers') or item.get('correctAnswer') or item.get('answer') or ['A']
        if isinstance(raw_corr, str):
            raw_corr = re.findall(r'[A-Da-d]', raw_corr) or [raw_corr]
        correct = [str(c).strip().upper()[:1] for c in raw_corr if str(c).strip().upper()[:1] in labels]
        if not correct:
            correct = ['A']
        explanation = str(item.get('explanation') or f"La bonne réponse est {', '.join(correct)}.").strip()
        normalized.append({
            'id': f'q-{len(normalized) + 1}',
            'prompt': prompt,
            'type': 'multiple' if len(correct) > 1 else 'single',
            'options': opts,
            'correctAnswers': correct,
            'explanation': explanation,
        })
        if len(normalized) >= count:
            break
    return normalized


def _generate_quiz_questions_via_huggingface(title='', description='', difficulty='medium',
                                             question_count=5, source_chapter='', course_id='',
                                             source_text=''):
    """Generate multiple-choice quiz questions using Hugging Face Inference API (with OpenAI-compatible fallback)."""
    hf_token = (
        os.environ.get('HUGGINGFACE_API_KEY')
        or os.environ.get('HF_TOKEN')
        or os.environ.get('HUGGING_FACE_HUB_TOKEN')
        or ''
    ).strip()
    hf_model = (
        os.environ.get('HUGGINGFACE_MODEL')
        or 'Qwen/Qwen2.5-72B-Instruct'
    ).strip()

    topic = str(source_chapter or title or course_id or 'Cours').strip()
    excerpt = str(source_text or description or '').strip()[:6500]
    if not excerpt and not topic:
        return []

    system_prompt = (
        "Tu es un professeur expert qui conçoit des QCM pédagogiques en français. "
        "Réponds UNIQUEMENT avec un tableau JSON valide contenant les questions, sans aucun texte autour."
    )
    user_prompt = (
        f"Génère exactement {question_count} questions QCM (niveau : {difficulty}) en français "
        f"sur le sujet « {topic} »"
        + (f" ({description})" if description else "")
        + ".\n"
        + (f"Contenu source du chapitre :\n\"\"\"\n{excerpt}\n\"\"\"\n" if excerpt else "")
        + "Format JSON strict attendu :\n"
        '[{"prompt":"Question ?","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},'
        '{"label":"C","text":"..."},{"label":"D","text":"..."}],"correctAnswers":["A"],'
        '"explanation":"Explication courte et claire."}]'
    )

    endpoints = []
    if hf_token:
        endpoints.extend([
            (
                'https://router.huggingface.co/v1/chat/completions',
                {'Authorization': f'Bearer {hf_token}', 'Content-Type': 'application/json'},
                {'model': hf_model, 'messages': [{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': user_prompt}], 'temperature': 0.3, 'max_tokens': 2600},
            ),
            (
                f'https://api-inference.huggingface.co/models/{hf_model}/v1/chat/completions',
                {'Authorization': f'Bearer {hf_token}', 'Content-Type': 'application/json'},
                {'model': hf_model, 'messages': [{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': user_prompt}], 'temperature': 0.3, 'max_tokens': 2600},
            ),
        ])
    # Zero-key OpenAI-compatible inference fallback so automatic generation works out-of-the-box
    endpoints.append((
        'https://text.pollinations.ai/openai',
        {'Content-Type': 'application/json'},
        {'model': 'openai', 'messages': [{'role': 'system', 'content': system_prompt}, {'role': 'user', 'content': user_prompt}], 'temperature': 0.3},
    ))

    for url, headers, payload in endpoints:
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers={**headers, 'User-Agent': 'EduVia-QuizGenerator/1.0'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=14) as resp:
                raw_resp = resp.read().decode('utf-8', errors='ignore')
            data = json.loads(raw_resp)
            content = ''
            if isinstance(data, dict) and data.get('choices'):
                content = str(data['choices'][0].get('message', {}).get('content') or '')
            elif isinstance(data, list) and data and isinstance(data[0], dict):
                content = str(data[0].get('generated_text') or '')
            if not content:
                continue
            json_match = re.search(r'\[.*\]', content, re.S)
            if json_match:
                parsed_list = json.loads(json_match.group(0))
                questions = _normalize_ai_generated_questions(parsed_list, count=question_count)
                if len(questions) >= min(2, question_count):
                    return questions
        except Exception:
            continue
    return []


def _generate_quiz_questions(title='', description='', difficulty='medium', question_count=5,
                             source_chapter='', course_id='', chapter_id='', source_text=''):
    try:
        count = max(1, min(int(question_count or 5), 20))
    except (TypeError, ValueError):
        count = 5

    # 1. If the uploaded file itself already contains structured QCM questions, return them first
    if source_text and re.search(r'(?:^|\n)\s*[A-Da-d][\)\.\:\-]\s+\S+', source_text):
        direct_parsed = _parse_quiz_questions_from_text(
            source_text,
            fallback_title=title,
            fallback_course=course_id,
            count=count,
            allow_fallback=False,
        )
        if len(direct_parsed) >= min(3, count):
            return direct_parsed[:count]

    # 2. Try Hugging Face Inference API (and OpenAI-compatible LLM endpoint)
    ai_questions = _generate_quiz_questions_via_huggingface(
        title=title,
        description=description,
        difficulty=difficulty,
        question_count=count,
        source_chapter=source_chapter or chapter_id,
        course_id=course_id,
        source_text=source_text,
    )
    if len(ai_questions) >= count:
        return ai_questions[:count]

    context_blob = ' '.join(filter(None, [title, description, source_chapter, course_id, chapter_id, source_text]))
    query_tokens = set(_tokenize_course_text(context_blob))

    scored_bank = []
    for idx, item in enumerate(_CURATED_QUIZ_BANK):
        overlap = len(query_tokens & item['topics'])
        scored_bank.append((overlap, -idx, item))
    scored_bank.sort(key=lambda entry: (entry[0], entry[1]), reverse=True)

    selected = list(ai_questions)
    used_prompts = {_normalized_text(q['prompt']) for q in selected}

    # 3. Extract key statements from the uploaded chapter text to build contextual QCM questions
    clean_lines = [
        line.strip(' •-*0123456789.)\t')
        for line in re.split(r'[\n.;]+', f'{source_text}\n{description}')
        if 35 <= len(line.strip()) <= 220 and not re.search(r'(http|www\.|@)', line)
    ]
    topic_label = str(source_chapter or chapter_id or title or course_id or 'ce chapitre').strip()
    labels = ['A', 'B', 'C', 'D']
    generic_distractors = [
        "Cette notion n'est jamais utilisée lors de la phase d'analyse ou d'implémentation.",
        "Le cours indique que cette étape est facultative et ignorée lors de l'exécution.",
        "Cette règle s'applique uniquement aux commentaires et non à la logique du sujet.",
    ]
    for idx, line in enumerate(clean_lines):
        if len(selected) >= count:
            break
        norm_line = _normalized_text(line)
        if norm_line in used_prompts:
            continue
        used_prompts.add(norm_line)
        correct_pos = idx % 4
        correct_lbl = labels[correct_pos]
        option_texts = list(generic_distractors)
        option_texts.insert(correct_pos, line)
        selected.append({
            'id': f'q-{len(selected) + 1}',
            'prompt': f"D'après le chapitre « {topic_label} », quelle affirmation est exacte (Question {len(selected) + 1}) ?",
            'type': 'single',
            'options': [{'label': labels[i], 'text': option_texts[i]} for i in range(4)],
            'correctAnswers': [correct_lbl],
            'explanation': f"D'après le support de cours ({topic_label}) : {line}",
        })

    for _, _, item in scored_bank:
        if len(selected) >= count:
            break
        norm_p = _normalized_text(item['prompt'])
        if norm_p in used_prompts:
            continue
        used_prompts.add(norm_p)
        selected.append({
            'id': f'q-{len(selected) + 1}',
            'prompt': item['prompt'],
            'type': 'single',
            'options': [dict(opt) for opt in item['options']],
            'correctAnswers': list(item['correctAnswers']),
            'explanation': item['explanation'],
        })

    # If count is still higher than selected, synthesize additional questions from KB chunks
    kb_chunks = _load_course_knowledge_chunks()
    for chunk in kb_chunks:
        if len(selected) >= count:
            break
        snippet = str(chunk.get('text') or '').strip().split('\n')[0][:180].strip()
        if len(snippet) < 25:
            continue
        prompt = f"D'après la section « {chunk.get('topic') or chunk.get('source') or topic_label} », quel énoncé est exact ?"
        if _normalized_text(prompt) in used_prompts:
            continue
        used_prompts.add(_normalized_text(prompt))
        selected.append({
            'id': f'q-{len(selected) + 1}',
            'prompt': prompt,
            'type': 'single',
            'options': [
                {'label': 'A', 'text': snippet},
                {'label': 'B', 'text': "L'exécution se fait sans aucune étape d'analyse ni de compilation."},
                {'label': 'C', 'text': "Les instructions sont exécutées dans un ordre aléatoire."},
                {'label': 'D', 'text': "Aucune vérification syntaxique ou logique n'est requise."},
            ],
            'correctAnswers': ['A'],
            'explanation': f"Extrait du cours ({chunk.get('source')}) : {snippet}",
        })

    return selected[:count]


def _parse_quiz_questions_from_text(raw_text, fallback_title='', fallback_course='', count=5, allow_fallback=True):
    text = str(raw_text or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    parsed_questions = []
    if text:
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        current_q = None
        in_answer_key = False
        current_answer_key_idx = None

        section_key_pattern = re.compile(
            r'^(?:partie\s*2\b.*|corrig[eé]\s+et\s+explications.*|corrig[eé]s?\b.*|r[eé]ponses?\s+et\s+explications.*)$',
            re.I,
        )
        ignore_header_pattern = re.compile(
            r'^(?:partie\s*1\b.*|les\s+bonnes\s+r[eé]ponses\s+sont.*|nom\s*\:.*|\d+\s+questions?\s+[àa]\s+choix\s+multiples.*|quiz\s*[\–\-\:].*)$',
            re.I,
        )
        numbered_answer_pattern = re.compile(
            r'^(?:question\s*|q\s*)?(\d+)[\)\.\-\:]\s*(?:bonne\s+r[eé]ponse|r[eé]ponse\s+correcte|r[eé]ponse|correct|answer|solution)\s*[\:\-]?\s*([A-Da-d])\b(?:\s*[\.\)\-\:]\s*(.*))?$',
            re.I,
        )
        option_pattern = re.compile(r'^([*✓✔]?\s*)([A-Da-d])[\)\.\:\-]\s*(.+)$')
        answer_pattern = re.compile(
            r'^(?:bonne\s+r[eé]ponse|r[eé]ponse\s+correcte|r[eé]ponse|correct|answer|solution)\s*[\:\-]?\s*([A-Da-d](?:\s*[,\s]\s*[A-Da-d])*)\b(?:\s*[\.\)\-\:]\s*(.*))?$',
            re.I,
        )
        explanation_pattern = re.compile(r'^(?:explication|justification|correction|note)\s*[\:\-]\s*(.+)$', re.I)
        question_start_pattern = re.compile(r'^(?:question\s*\d+|q\s*\d+|\d+[\)\.\-])\s*[\:\-]?\s*(.+)$', re.I)

        def _flush_question(q_obj):
            if not q_obj or not q_obj.get('prompt') or len(q_obj.get('options') or []) < 2:
                return
            labels = ['A', 'B', 'C', 'D']
            normalized_opts = []
            for idx, opt in enumerate(q_obj['options'][:4]):
                lbl = labels[idx]
                normalized_opts.append({'label': lbl, 'text': opt['text']})
            while len(normalized_opts) < 4:
                lbl = labels[len(normalized_opts)]
                normalized_opts.append({'label': lbl, 'text': f'Option {lbl}'})
            correct = [c.upper() for c in q_obj.get('correctAnswers', []) if c.upper() in labels]
            if not correct:
                correct = ['A']
            parsed_questions.append({
                'id': f'q-{len(parsed_questions) + 1}',
                'prompt': q_obj['prompt'],
                'type': 'multiple' if len(correct) > 1 else 'single',
                'options': normalized_opts,
                'correctAnswers': correct,
                'explanation': q_obj.get('explanation') or f"La bonne réponse est {', '.join(correct)}.",
                '_has_custom_explanation': bool(q_obj.get('explanation')),
            })

        for line in lines:
            if section_key_pattern.match(line):
                _flush_question(current_q)
                current_q = None
                in_answer_key = True
                current_answer_key_idx = None
                continue

            if ignore_header_pattern.match(line):
                continue

            num_ans_match = numbered_answer_pattern.match(line)
            if num_ans_match:
                _flush_question(current_q)
                current_q = None
                in_answer_key = True
                q_num = int(num_ans_match.group(1)) - 1
                ans_letter = num_ans_match.group(2).upper()
                if 0 <= q_num < len(parsed_questions):
                    parsed_questions[q_num]['correctAnswers'] = [ans_letter]
                    parsed_questions[q_num]['type'] = 'single'
                    if not parsed_questions[q_num].get('_has_custom_explanation'):
                        parsed_questions[q_num]['explanation'] = f"La bonne réponse est {ans_letter}."
                    current_answer_key_idx = q_num
                continue

            if in_answer_key:
                exp_match = explanation_pattern.match(line)
                exp_text = exp_match.group(1).strip() if exp_match else line
                if current_answer_key_idx is not None and 0 <= current_answer_key_idx < len(parsed_questions):
                    target_q = parsed_questions[current_answer_key_idx]
                    if not target_q.get('_has_custom_explanation'):
                        target_q['explanation'] = exp_text
                        target_q['_has_custom_explanation'] = True
                    else:
                        target_q['explanation'] = f"{target_q['explanation']} {exp_text}".strip()
                continue

            ans_match = answer_pattern.match(line)
            if ans_match and current_q:
                found = re.findall(r'[A-Da-d]', ans_match.group(1))
                current_q['correctAnswers'] = [c.upper() for c in found]
                continue

            exp_match = explanation_pattern.match(line)
            if exp_match and current_q:
                current_q['explanation'] = exp_match.group(1).strip()
                continue

            opt_match = option_pattern.match(line)
            if opt_match:
                if not current_q:
                    current_q = {'prompt': f'Question {len(parsed_questions) + 1}', 'options': [], 'correctAnswers': [], 'explanation': ''}
                starred = bool(opt_match.group(1).strip())
                lbl = opt_match.group(2).upper()
                opt_text = opt_match.group(3).strip()
                if opt_text.endswith('*') or opt_text.endswith('✓') or opt_text.endswith('✔'):
                    starred = True
                    opt_text = opt_text[:-1].strip()
                current_q['options'].append({'label': lbl, 'text': opt_text})
                if starred and lbl not in current_q['correctAnswers']:
                    current_q['correctAnswers'].append(lbl)
                continue

            q_match = question_start_pattern.match(line)
            if q_match or (line.endswith('?') and (not current_q or current_q.get('options'))):
                _flush_question(current_q)
                prompt_text = q_match.group(1).strip() if q_match else line
                current_q = {'prompt': prompt_text, 'options': [], 'correctAnswers': [], 'explanation': ''}
            elif current_q and not current_q['options']:
                current_q['prompt'] = f"{current_q['prompt']} {line}".strip()
            elif current_q and current_q['options']:
                current_q['options'][-1]['text'] = f"{current_q['options'][-1]['text']} {line}".strip()

        _flush_question(current_q)
        for q_item in parsed_questions:
            q_item.pop('_has_custom_explanation', None)

    if parsed_questions or not allow_fallback:
        return parsed_questions
    return _generate_quiz_questions(
        title=fallback_title,
        course_id=fallback_course,
        source_text=text,
        question_count=count,
    )


def _reclamations(request, body, parts, user):
    if not user:
        return JsonResponse({'success': False, 'message': 'Authentification requise'}, status=401)
    is_admin = bool(user.is_superuser or user.user_role == 'admin')
    qs = Resource.objects.filter(collection='reclamations')

    if len(parts) == 2 and request.method == 'GET':
        records = list(qs)
        if not is_admin:
            user_email = str(user.email or '').strip().casefold()
            records = [
                r for r in records
                if r.owner_id == user.pk or str((r.payload or {}).get('authorEmail') or '').strip().casefold() == user_email
            ]
        items = []
        for r in records:
            item = _resource_dict(r)
            item['createdAt'] = item.get('createdAt') or r.created_at.isoformat()
            item['updatedAt'] = item.get('updatedAt') or r.updated_at.isoformat()
            items.append(item)
        items.sort(key=lambda x: str(x.get('createdAt') or ''), reverse=True)
        stats = {
            'total': len(items),
            'pending': sum(1 for i in items if str(i.get('status') or 'En attente') == 'En attente'),
            'inProgress': sum(1 for i in items if str(i.get('status') or '') == 'En cours'),
            'resolved': sum(1 for i in items if str(i.get('status') or '') == 'Résolue'),
            'rejected': sum(1 for i in items if str(i.get('status') or '') == 'Rejetée'),
            'studentsCount': sum(1 for i in items if str(i.get('authorRole') or 'student') == 'student'),
            'teachersCount': sum(1 for i in items if str(i.get('authorRole') or '') == 'teacher'),
        }
        return _response(items, items=items, stats=stats)

    if len(parts) == 2 and request.method == 'POST':
        subject = str(body.get('subject') or body.get('title') or '').strip()
        message = str(body.get('message') or body.get('description') or '').strip()
        category = str(body.get('category') or 'Pédagogique / Cours').strip()
        priority = str(body.get('priority') or 'Moyenne').strip()
        if not subject or not message:
            return JsonResponse({'success': False, 'message': 'Le sujet et la description de la réclamation sont obligatoires.'}, status=400)
        role = 'teacher' if user.user_role == 'teacher' else ('admin' if is_admin else 'student')
        now_iso = timezone.now().isoformat()
        payload = {
            'subject': subject,
            'category': category,
            'priority': priority if priority in ('Basse', 'Moyenne', 'Haute', 'Urgente') else 'Moyenne',
            'message': message,
            'status': 'En attente',
            'adminResponse': '',
            'respondedAt': None,
            'respondedBy': '',
            'authorId': str(user.pk),
            'authorName': user.get_full_name() or user.username,
            'authorEmail': user.email,
            'authorRole': role,
            'authorClass': user.class_name or (', '.join(user.assigned_classes[:2]) if isinstance(user.assigned_classes, list) and user.assigned_classes else ''),
            'createdAt': now_iso,
            'updatedAt': now_iso,
        }
        rec = _save_record('reclamations', payload, user)
        # Notify admins
        for admin_user in User.objects.filter(Q(is_superuser=True) | Q(user_role='admin'), is_active=True):
            _save_record('notifications', {
                'title': f"Nouvelle réclamation ({'Enseignant' if role == 'teacher' else 'Étudiant'})",
                'message': f"{payload['authorName']} a soumis une réclamation : « {subject} ».",
                'type': 'warning',
                'read': False,
                'dismissed': False,
                'createdAt': now_iso,
            }, admin_user)
        return _response(_resource_dict(rec))

    if len(parts) == 3:
        rec = qs.filter(public_id=parts[2]).first()
        if not rec:
            return JsonResponse({'success': False, 'message': 'Réclamation introuvable'}, status=404)
        is_owner = bool(rec.owner_id == user.pk or str((rec.payload or {}).get('authorEmail') or '').strip().casefold() == str(user.email or '').strip().casefold())
        if not is_admin and not is_owner:
            return JsonResponse({'success': False, 'message': 'Accès refusé'}, status=403)

        if request.method in ('PATCH', 'PUT'):
            now_iso = timezone.now().isoformat()
            if is_admin:
                new_status = str(body.get('status') or rec.payload.get('status') or 'En attente').strip()
                if new_status in ('En attente', 'En cours', 'Résolue', 'Rejetée'):
                    rec.payload['status'] = new_status
                if 'adminResponse' in body:
                    rec.payload['adminResponse'] = str(body.get('adminResponse') or '').strip()
                    rec.payload['respondedAt'] = now_iso
                    rec.payload['respondedBy'] = user.get_full_name() or user.username or user.email
                for key in ('priority', 'category', 'subject', 'message'):
                    if key in body and str(body.get(key) or '').strip():
                        rec.payload[key] = str(body.get(key)).strip()
                rec.payload['updatedAt'] = now_iso
                rec.save(update_fields=['payload', 'updated_at'])
                # Notify author of admin update
                target_author = rec.owner or User.objects.filter(email__iexact=str(rec.payload.get('authorEmail') or '')).first()
                if target_author:
                    _save_record('notifications', {
                        'title': f"Mise à jour de votre réclamation : {rec.payload.get('status')}",
                        'message': f"Sujet : « {rec.payload.get('subject')} »" + (f" — Réponse de l'administration : {rec.payload.get('adminResponse')}" if rec.payload.get('adminResponse') else ''),
                        'type': 'success' if rec.payload.get('status') == 'Résolue' else 'info',
                        'read': False,
                        'dismissed': False,
                        'createdAt': now_iso,
                    }, target_author)
                return _response(_resource_dict(rec))
            else:
                if str(rec.payload.get('status') or 'En attente') != 'En attente':
                    return JsonResponse({'success': False, 'message': 'Cette réclamation est déjà en cours de traitement par l’administration.'}, status=400)
                for key in ('subject', 'category', 'priority', 'message'):
                    if key in body and str(body.get(key) or '').strip():
                        rec.payload[key] = str(body.get(key)).strip()
                rec.payload['updatedAt'] = now_iso
                rec.save(update_fields=['payload', 'updated_at'])
                return _response(_resource_dict(rec))

        if request.method == 'DELETE':
            rec.delete()
            return _response({'deleted': True})

    return None


def _domain_api(request, body, parts, user):
    if parts[:2] == ['api', 'reclamations'] or parts[:1] == ['reclamations']:
        norm_parts = parts if parts[:1] == ['api'] else ['api', *parts]
        result = _reclamations(request, body, norm_parts, user)
        if result is not None:
            return result
    if parts[:2] == ['api','student'] and not user:
        return JsonResponse({'success':False,'message':'Authentification requise'}, status=401)
    if parts[:2] == ['api', 'student'] and len(parts) > 2 and parts[2] == 'planner':
        result = _planner(request, body, parts[1:], user)
        if result is not None: return result
    if parts[:1] == ['notifications']:
        result = _notifications(request, body, parts, user)
        if result is not None: return result

    if parts[:2] == ['api','clubs']:
        if not user: return JsonResponse({'success':False,'message':'Authentification requise'}, status=401)
        if user.user_role != 'student': return JsonResponse({'success':False,'message':'Acces reserve aux etudiants'}, status=403)
        clubs = [
            {'id':'esprit-dev','name':'Esprit-Dev','category':'Programmation / Algorithmique','description':'Programmation, algorithmique et compétitions étudiantes.','activities':['Formations en programmation','Concours internes','Préparation aux compétitions'],'email':'','recommendationRate':0.95,'matchedCourses':['Programmation'],'matchedKeywords':['code','algorithmique'],'recommendationReason':'Correspond aux cours de programmation.'},
            {'id':'futura','name':'Esprit FUTURA','category':'Entrepreneuriat / Culture','description':'Activités culturelles et projets entrepreneuriaux.','activities':['Événements culturels','Activités entrepreneuriales'],'email':'esprit-club-futura@esprit.tn','recommendationRate':0.85,'matchedCourses':[],'matchedKeywords':['entrepreneuriat'],'recommendationReason':'Découvre des projets et activités culturels.'},
            {'id':'aero','name':'ESPRIT Club AERO','category':'Aéronautique','description':'Échange de connaissances et projets aéronautiques.','activities':['Aéronautique générale','Aéromodélisme','Systèmes avioniques'],'email':'esprit-club-aero@esprit.tn','recommendationRate':0.8,'matchedCourses':['Systèmes embarqués'],'matchedKeywords':['électronique'],'recommendationReason':'Une expérience pratique en ingénierie.'},
            {'id':'fusion','name':'ESPRIT Club FUSION','category':'Robotique / Mécanique / Électronique','description':'Conception mécanique, électronique et robotique.','activities':['Conception mécanique','Électronique','Robotique'],'email':'esprit-club-fusion@esprit.tn','recommendationRate':0.9,'matchedCourses':['Électronique'],'matchedKeywords':['robotique'],'recommendationReason':'Mets en pratique tes connaissances techniques.'},
            {'id':'cisco','name':'ESPRIT CISCO','category':'Réseaux / Certifications','description':'Formations réseau et préparation aux certifications.','activities':['Coaching certification','Forums','NetRiders'],'email':'esprit-club-cisco@esprit.tn','recommendationRate':0.78,'matchedCourses':['Réseaux'],'matchedKeywords':['réseau'],'recommendationReason':'Approfondis les réseaux et certifications.'},
        ]
        try:
            limit = max(1, min(int(request.GET.get('limit', 6)), len(clubs)))
        except (TypeError, ValueError):
            limit = min(6, len(clubs))

        student_class = str(user.class_name or '').strip().casefold()
        visible_contents = []
        for record in Resource.objects.filter(collection='contents'):
            content = _resource_dict(record)
            if _is_test_content(content):
                continue
            allowed_classes = content.get('visibleToClasses') or []
            if isinstance(allowed_classes, str):
                allowed_classes = [allowed_classes]
            allowed_classes = {str(value).strip().casefold() for value in allowed_classes if str(value).strip()}
            if content.get('visibleToAllClasses') is True or not allowed_classes or (student_class and student_class in allowed_classes):
                visible_contents.append(content)

        progress_records = list(_owned_records('student/progress', user))
        completed_ids = {
            str(record.payload.get('contentId') or '').strip()
            for record in progress_records
            if str(record.payload.get('status') or '').casefold() in ('completed', 'passed')
        }
        courses = {}
        for content in visible_contents:
            course_name = str(content.get('courseId') or '').strip()
            if not course_name or str(content.get('type') or '').casefold() in ('course', 'chapter', 'part'):
                continue
            course = courses.setdefault(course_name, {'title': course_name, 'total': 0, 'studiedCount': 0})
            course['total'] += 1
            if str(content.get('_id') or content.get('id') or '').strip() in completed_ids:
                course['studiedCount'] += 1
        studied_courses = [
            {**course, 'score': round(course['studiedCount'] * 100 / course['total']) if course['total'] else 0}
            for course in courses.values() if course['studiedCount'] > 0
        ]
        studied_courses.sort(key=lambda course: (-course['studiedCount'], -course['score'], course['title'].casefold()))
        course_terms = [_normalized_text(course['title']) for course in studied_courses]
        course_terms.extend(
            _normalized_text(content.get('title')) for content in visible_contents if content.get('courseId')
        )
        course_terms = [term for term in course_terms if term]
        for club in clubs:
            references = club.get('matchedCourses') or []
            keywords = club.get('matchedKeywords') or []
            matched_courses = [
                course['title'] for course in studied_courses
                if any(
                    _normalized_text(reference) in _normalized_text(course['title'])
                    or _normalized_text(course['title']) in _normalized_text(reference)
                    for reference in references if _normalized_text(reference)
                )
            ]
            matched_keywords = [
                keyword for keyword in keywords
                if any(_normalized_text(keyword) in term for term in course_terms)
            ]
            progress_score = max(
                (course['score'] for course in studied_courses if course['title'] in matched_courses), default=0
            )
            compatibility = min(99, 40 + len(matched_courses) * 30 + len(matched_keywords) * 12 + round(progress_score * 0.15))
            if not studied_courses:
                compatibility = 45 + min(15, len(club.get('activities') or []) * 3)
            if matched_courses:
                reason = f"Recommandé selon ton cours étudié : {', '.join(matched_courses[:2])}."
            elif matched_keywords:
                reason = f"Les thèmes de ton parcours correspondent à : {', '.join(matched_keywords[:3])}."
            elif studied_courses:
                reason = 'Découvre ce club pour élargir tes activités au-delà de tes cours actuels.'
            else:
                reason = 'Suggestion pour découvrir les activités étudiantes disponibles.'
            club.update({
                'recommendationRate': compatibility,
                'matchedCourses': matched_courses or references,
                'matchedKeywords': matched_keywords or keywords,
                'recommendationReason': reason,
            })
        clubs.sort(key=lambda club: (-club['recommendationRate'], club['name'].casefold()))
        payload = {
            'source': 'student-progress' if studied_courses else 'global-studied-courses',
            'studiedCourses': studied_courses,
            'recommendations': clubs[:limit],
            'clubs': clubs,
        }
        return JsonResponse(payload)

    if parts[:1] == ['ai']:
        if parts[1:2] == ['chat'] and len(parts) == 2 and request.method == 'POST':
            message = str(body.get('message', '')).strip()
            reply = _ask_course_chatbot(
                message,
                user=user,
                course_id=str(body.get('courseId') or ''),
                chapter_id=str(body.get('chapterId') or ''),
            )
            return JsonResponse({'reply': reply})
        if parts[1:3] == ['chat','history']:
            if not user: return JsonResponse({'success':False}, status=401)
            histories = _owned_records('ai/chat/history', user)
            if len(parts) == 3 and request.method == 'GET':
                return _response([
                    {**_resource_dict(r), 'updatedAt': r.updated_at.isoformat()}
                    for r in histories.order_by('-updated_at')[:30]
                ])
            if len(parts) == 3 and request.method == 'POST':
                rec = _save_record('ai/chat/history', body, user, body.get('id'))
                return _response({**_resource_dict(rec), 'updatedAt': rec.updated_at.isoformat()})
            if len(parts) == 4 and request.method == 'DELETE':
                rec = histories.filter(public_id=parts[3]).first()
                if rec: rec.delete()
                return _response({'deleted': bool(rec)})

    if parts[:2] == ['api','meet'] and len(parts) > 2:
        if not user: return JsonResponse({'success':False,'message':'Authentification requise'}, status=401)
        section = parts[2]
        collection = 'meet/' + ('replays' if section == 'replays' else 'sessions')
        records = Resource.objects.filter(collection=collection)
        if len(parts) == 3 and request.method == 'GET':
            sessions = [_resource_dict(_ensure_meet_link(r)) if section == 'sessions' else _resource_dict(r)
                        for r in records]
            return JsonResponse(sessions, safe=False)
        if len(parts) == 3 and section == 'sessions' and request.method == 'POST':
            payload = {**body, 'hostEmail': user.email if user else body.get('hostEmail'),
                       'status': body.get('status') or 'live', 'participants': 0}
            session = _ensure_meet_link(_save_record(collection, payload, user))
            audience = session.payload.get('audience')
            if audience == 'teacher':
                recipients = User.objects.filter(is_active=True, user_role='student')
                title = 'Nouvelle session avec un professeur'
            elif audience == 'student' and user.user_role == 'student' and user.class_name:
                recipients = User.objects.filter(is_active=True, user_role='student', class_name=user.class_name).exclude(pk=user.pk)
                title = 'Nouvelle session etudiante'
            else:
                recipients = User.objects.none()
                title = ''
            for recipient in recipients:
                _save_record('notifications', {
                    'title': title,
                    'message': f"{session.payload.get('hostName') or user.get_full_name() or user.username} vous invite a rejoindre : {session.payload.get('title') or 'Session EduVia'}",
                    'type': 'info',
                    'action': {'kind': 'meet_session', 'requestId': session.public_id,
                               'hostEmail': user.email, 'hostName': session.payload.get('hostName') or user.username,
                               'audience': audience},
                    'read': False,
                    'dismissed': False,
                    'createdAt': timezone.now().isoformat(),
                }, recipient)
            return JsonResponse(_resource_dict(session))
        if len(parts) == 3 and section == 'replays' and request.method == 'POST':
            if not user or user.user_role not in ('teacher','admin'): return JsonResponse({'success':False}, status=403)
            return JsonResponse(_resource_dict(_save_record(collection, body, user)))
        if len(parts) == 5 and section == 'sessions' and request.method == 'PATCH':
            rec = records.filter(public_id=parts[3]).first()
            if rec:
                action = parts[4]
                _ensure_meet_link(rec)
                rec.payload['status'] = 'ended' if action == 'end' else rec.payload.get('status', 'live')
                if action == 'join': rec.payload['participants'] = int(rec.payload.get('participants', 0)) + 1
                rec.save(update_fields=['payload','updated_at'])
                return JsonResponse(_resource_dict(rec))

    # Internships retain their own collection and CRUD behavior.
    if parts[:2] == ['api', 'internships']:
        qs = Resource.objects.filter(collection='internships')
        if len(parts) == 2 and request.method == 'GET':
            return JsonResponse([_resource_dict(r) for r in qs], safe=False)
        if len(parts) == 2 and request.method == 'POST':
            if not user or user.user_role != 'admin': return JsonResponse({'detail':'Permission denied'}, status=403)
            invalid = _validate_internship(body)
            if invalid: return JsonResponse({'message':invalid}, status=400)
            return JsonResponse(_resource_dict(_save_record('internships', body, user)))
        if len(parts) == 3:
            rec = qs.filter(public_id=parts[2]).first()
            if request.method in ('PATCH','PUT') and rec:
                if not user or user.user_role != 'admin': return JsonResponse({'detail':'Permission denied'}, status=403)
                invalid = _validate_internship({**rec.payload, **body})
                if invalid: return JsonResponse({'message':invalid}, status=400)
                rec.payload.update(body); rec.save(update_fields=['payload','updated_at']); return JsonResponse(_resource_dict(rec))
            if request.method == 'DELETE' and rec:
                if not user or user.user_role != 'admin': return JsonResponse({'detail':'Permission denied'}, status=403)
                rec.delete(); return _response({'deleted': True})
            if request.method == 'GET' and rec: return JsonResponse(_resource_dict(rec))

    # Content records support filters plus the existing teacher CRUD routes.
    if parts[:2] == ['api', 'contents']:
        qs = Resource.objects.filter(collection='contents')
        if len(parts) == 4 and parts[3] == 'file' and request.method == 'POST':
            record = qs.filter(public_id=parts[2]).first()
            upload = request.FILES.get('file')
            if not record or not upload: return JsonResponse({'success':False,'message':'Contenu ou fichier introuvable'}, status=400)
            extension = os.path.splitext(upload.name)[1].lower()
            if extension not in ('.pdf','.doc','.docx','.mp4','.mov','.avi','.webm','.mkv'):
                return JsonResponse({'success':False,'message':'Format de fichier non autorisé'}, status=400)
            is_quiz_record = 'quiz' in str(record.payload.get('type') or '').casefold()
            is_existing_quiz = str(record.payload.get('quizMode') or '').casefold() == 'existing'
            extracted_text = ''
            if is_quiz_record and (is_existing_quiz or not (record.payload.get('quizQuestions') or [])):
                extracted_text = _extract_uploaded_file_text(upload)
            safe_name = re.sub(r'[^a-zA-Z0-9_.-]', '-', os.path.basename(upload.name))
            stored = default_storage.save(f'{uuid.uuid4().hex}-{safe_name}', upload)
            updates = {'fileUrl':'/uploads/'+stored, 'fileName':upload.name}
            if is_quiz_record and extracted_text:
                strict_parsed = _parse_quiz_questions_from_text(
                    extracted_text,
                    fallback_title=str(record.payload.get('title') or upload.name),
                    fallback_course=str(record.payload.get('courseId') or ''),
                    count=int(record.payload.get('questionCount') or record.payload.get('quizQuestionCount') or 10),
                    allow_fallback=not bool(record.payload.get('quizQuestions')),
                )
                if strict_parsed:
                    updates['quizQuestions'] = strict_parsed
                    updates['quizQuestionCount'] = len(strict_parsed)
            record.payload.update(updates)
            record.save(update_fields=['payload','updated_at'])
            _invalidate_caches(collection='contents')
            return _response({'message':'File uploaded and linked to content','content':_resource_dict(record),'fileUrl':'/uploads/'+stored})
        if len(parts) == 2 and request.method == 'GET':
            has_filters = any(request.GET.get(k) for k in ('teacherEmail', 'className', 'courseId', 'type'))
            if not has_filters:
                return JsonResponse([_resource_dict(r) for r in _cached_contents_records() if not _is_test_content(r.payload or {})], safe=False)
            for key in ('teacherEmail', 'className', 'courseId', 'type'):
                value = request.GET.get(key)
                if value and key == 'teacherEmail' and user and user.user_role in ('teacher', 'admin') and user.email.casefold() == value.strip().casefold():
                    qs = qs.filter(Q(payload__teacherEmail__iexact=value) | Q(owner=user))
                elif value and key == 'teacherEmail':
                    qs = qs.filter(payload__teacherEmail__iexact=value)
                elif value:
                    qs = qs.filter(**{f'payload__{key}': value})
            return JsonResponse([_resource_dict(r) for r in qs if not _is_test_content(r.payload or {})], safe=False)
        if len(parts) == 2 and request.method == 'POST':
            return JsonResponse(_resource_dict(_save_record('contents', body, user)))
        if len(parts) == 4 and parts[2] == 'course' and request.method == 'DELETE':
            course = qs.filter(payload__courseId=parts[3])
            teacher_email = request.GET.get('teacherEmail')
            if teacher_email: course = course.filter(payload__teacherEmail__iexact=teacher_email)
            deleted, _ = course.delete()
            _invalidate_caches(collection='contents')
            return _response({'deleted':deleted})
        if len(parts) == 3 and parts[2] in ('dashboard-stats','overview','tree') and request.method == 'GET':
            contents = [_resource_dict(r) for r in _cached_contents_records()]
            total_students = 0
            assigned_classes = []
            teacher_email = request.GET.get('teacherEmail', '').strip()
            target_teacher = user if (user and user.user_role in ('teacher', 'admin')) else (
                User.objects.filter(email__iexact=teacher_email).first() if teacher_email else None
            )
            if target_teacher:
                members = _teacher_course_members(target_teacher, request.GET.get('className', ''), include_progress=False)
                total_students = members.get('totalStudents', 0)
                assigned_classes = members.get('classes', [])
            return JsonResponse({
                'total': len(contents),
                'count': len(contents),
                'totalStudents': total_students,
                'assignedClasses': assigned_classes,
                'courses': contents,
                'items': contents,
                'data': contents,
            })
        if len(parts) == 3 and parts[2] == 'generate-quiz' and request.method == 'POST':
            chapter_file = request.FILES.get('chapterFile') or request.FILES.get('file')
            source_text = _extract_uploaded_file_text(chapter_file)
            title = str(request.POST.get('title') or body.get('title') or '').strip()
            description = str(request.POST.get('description') or body.get('description') or '').strip()
            difficulty = str(request.POST.get('difficulty') or body.get('difficulty') or 'medium').strip()
            q_count = request.POST.get('questionCount') or body.get('questionCount') or 5
            source_chapter = str(request.POST.get('sourceChapter') or body.get('sourceChapter') or '').strip()
            course_id = str(request.POST.get('courseId') or body.get('courseId') or '').strip()
            chapter_id = str(request.POST.get('chapterId') or body.get('chapterId') or '').strip()
            questions = _generate_quiz_questions(
                title=title,
                description=description,
                difficulty=difficulty,
                question_count=q_count,
                source_chapter=source_chapter,
                course_id=course_id,
                chapter_id=chapter_id,
                source_text=source_text,
            )
            return JsonResponse({'success': True, 'questions': questions, 'data': {'questions': questions}})
        if len(parts) == 3 and parts[2] == 'parse-quiz' and request.method == 'POST':
            quiz_file = request.FILES.get('quizFile') or request.FILES.get('file')
            source_text = _extract_uploaded_file_text(quiz_file)
            fallback_name = os.path.splitext(getattr(quiz_file, 'name', '') or 'Quiz')[0]
            questions = _parse_quiz_questions_from_text(
                source_text,
                fallback_title=fallback_name,
                fallback_course=str(request.POST.get('courseId') or body.get('courseId') or ''),
                count=int(request.POST.get('questionCount') or body.get('questionCount') or 5),
            )
            return JsonResponse({'success': True, 'questions': questions, 'data': {'questions': questions}})
        if len(parts) == 3 and parts[2] == 'generate-flashcards' and request.method == 'POST':
            questions = _generate_quiz_questions(
                title=str(body.get('title') or body.get('subject') or 'Cours'),
                question_count=body.get('questionCount') or 6,
            )
            cards = [
                {
                    'id': q['id'],
                    'question': q['prompt'],
                    'answer': q['options'][0]['text'] if q.get('options') else q.get('explanation', ''),
                    'explanation': q.get('explanation', ''),
                }
                for q in questions
            ]
            return JsonResponse({'success': True, 'flashcards': cards, 'cards': cards})
        if len(parts) == 3:
            rec = qs.filter(public_id=parts[2]).first()
            if request.method in ('PATCH','PUT') and rec:
                rec.payload.update(body); rec.save(update_fields=['payload','updated_at'])
                _invalidate_caches(collection='contents')
                return JsonResponse(_resource_dict(rec))
            if request.method == 'DELETE' and rec:
                rec.delete()
                _invalidate_caches(collection='contents')
                return _response({'deleted': True})
            if request.method == 'GET' and rec: return JsonResponse(_resource_dict(rec))

    # Student learning records are persisted per user; derived endpoints use that data.
    if parts[:2] == ['api','student'] and user:
        _sync_legacy_mongo_users()
        sub = parts[2] if len(parts) > 2 else ''
        collection = 'student/' + sub
        if sub == 'dashboard' and request.method == 'GET':
            if user.user_role != 'student':
                return JsonResponse({'success': False, 'message': 'Acces reserve aux etudiants'}, status=403)

            student_class = str(user.class_name or '').strip().casefold()
            visible_contents = []
            for record in _cached_contents_records():
                content = _resource_dict(record)
                allowed_classes = content.get('visibleToClasses') or []
                if isinstance(allowed_classes, str):
                    allowed_classes = [allowed_classes]
                allowed_classes = {str(value).strip().casefold() for value in allowed_classes if str(value).strip()}
                if content.get('visibleToAllClasses') is True or not allowed_classes or (student_class and student_class in allowed_classes):
                    visible_contents.append(content)

            trackable_contents = [
                content for content in visible_contents
                if str(content.get('type') or '').strip().lower() not in ('course', 'chapter', 'part')
            ]
            progress_records = [
                {**_resource_dict(record), 'updatedAt': record.updated_at.isoformat()}
                for record in _owned_records('student/progress', user)
            ]
            completed_progress = [
                record for record in progress_records
                if str(record.get('status') or '').strip().lower() in ('completed', 'passed')
                and str(record.get('contentId') or '').strip()
            ]
            trackable_ids = {
                str(content.get('_id') or content.get('id') or '').strip()
                for content in trackable_contents
            }
            completed_content_ids = list(dict.fromkeys(
                str(record.get('contentId')).strip() for record in completed_progress
                if str(record.get('contentId')).strip() in trackable_ids
            ))
            total_materials = len(trackable_contents)
            progress_summary = {
                'completedContentIds': completed_content_ids,
                'globalProgress': round(len(completed_content_ids) * 100 / total_materials) if total_materials else 0,
                'totals': {
                    'completedMaterials': len(completed_content_ids),
                    'totalMaterials': total_materials,
                },
            }
            contents_by_id = {
                str(content.get('_id') or content.get('id') or '').strip(): content
                for content in visible_contents
            }
            quiz_attempts = []
            for record in progress_records:
                score = record.get('score')
                content_id = str(record.get('contentId') or '').strip()
                quiz = contents_by_id.get(content_id)
                try:
                    numeric_score = max(0, min(100, round(float(score))))
                except (TypeError, ValueError):
                    continue
                if not quiz or 'quiz' not in str(quiz.get('type') or '').casefold():
                    continue
                quiz_attempts.append({**record, 'quiz': quiz, 'numericScore': numeric_score})
            quiz_attempts.sort(key=lambda attempt: attempt.get('updatedAt') or '')
            recommendation_analysis = None
            if quiz_attempts:
                latest_attempt = quiz_attempts[-1]
                lowest_attempt = min(quiz_attempts, key=lambda attempt: attempt['numericScore'])
                focus_quiz = lowest_attempt['quiz']
                focus_course = str(focus_quiz.get('courseId') or '').strip().casefold()
                focus_chapter = str(focus_quiz.get('chapterId') or '').strip().casefold()
                related_contents = [
                    content for content in trackable_contents
                    if str(content.get('type') or '').casefold() in ('document', 'video')
                    and str(content.get('_id') or content.get('id') or '') != str(focus_quiz.get('_id') or '')
                    and (
                        (focus_chapter and str(content.get('chapterId') or '').strip().casefold() == focus_chapter)
                        or (focus_course and str(content.get('courseId') or '').strip().casefold() == focus_course)
                    )
                ]
                keywords = focus_quiz.get('focusKeywords') or focus_quiz.get('focusLabels') or []
                if isinstance(keywords, str):
                    keywords = [keywords]
                if not keywords:
                    keywords = [str(focus_quiz.get('title') or 'Notions du quiz')]
                score = lowest_attempt['numericScore']
                question_count = max(1, len(focus_quiz.get('quizQuestions') or []))
                weak_acquis = []
                if score < 70:
                    weak_acquis.append({
                        'key': str(focus_quiz.get('_id') or focus_quiz.get('id') or 'quiz'),
                        'label': str(focus_quiz.get('title') or 'Notions du quiz'),
                        'severity': 100 - score,
                        'severityLabel': 'Prioritaire' if score < 50 else 'A renforcer',
                        'incorrectQuestions': round((100 - score) * question_count / 100),
                        'totalQuestions': question_count,
                        'successRate': score,
                        'keywords': [str(value) for value in keywords[:6]],
                        'courseId': focus_quiz.get('courseId') or '',
                        'chapterId': focus_quiz.get('chapterId') or '',
                        'reason': f'Dernier resultat sur ce quiz : {score} %. Revoyez les ressources associees puis retentez le quiz.',
                    })
                recommended_contents = [
                    {
                        **content,
                        'focusLabels': [str(value) for value in keywords[:6]],
                        'focusKeywords': [str(value) for value in keywords[:6]],
                        'recommendationScore': max(1, 100 - score),
                        'recommendationReason': f'Ressource du cours {content.get("courseId") or focus_quiz.get("courseId") or "liee"}, recommandee apres le quiz « {focus_quiz.get("title") or "termine"} » ({score} %).',
                    }
                    for content in related_contents[:8]
                ]
                recommendation_analysis = {
                    'weakAcquis': weak_acquis,
                    'recommendedContents': recommended_contents,
                    'summary': {
                        'attemptsAnalyzed': len(quiz_attempts),
                        'averageScore': round(sum(item['numericScore'] for item in quiz_attempts) / len(quiz_attempts)),
                        'lastScore': latest_attempt['numericScore'],
                        'lastQuizTitle': latest_attempt['quiz'].get('title') or 'Quiz termine',
                        'lastSubmittedAt': latest_attempt.get('updatedAt') or '',
                        'weakAcquisCount': len(weak_acquis),
                        'recommendationCount': len(recommended_contents),
                        'updatedAt': latest_attempt.get('updatedAt') or '',
                    },
                }
            classmates_count = User.objects.filter(
                user_role='student', class_name__iexact=str(user.class_name or '')
            ).count() if user.class_name else 1
            return JsonResponse({
                'level': request.GET.get('level') or user.level,
                'contents': visible_contents,
                'recommendations': recommendation_analysis['recommendedContents'] if recommendation_analysis else [],
                'recommendationAnalysis': recommendation_analysis,
                'progress': progress_summary,
                'stats': {
                    'totalCourses': len({str(item.get('courseId') or '').strip().casefold() for item in visible_contents if item.get('courseId')}),
                    'totalDocuments': sum(str(item.get('type') or '').strip().lower() == 'document' for item in visible_contents),
                    'totalVideos': sum('video' in str(item.get('type') or '').strip().lower() for item in visible_contents),
                    'totalQuizzes': sum('quiz' in str(item.get('type') or '').strip().lower() for item in visible_contents),
                    'totalItems': len(trackable_contents),
                    'classmatesCount': classmates_count,
                },
            })
        if sub == 'level' and request.method == 'POST':
            user.level = str(body.get('level') or user.level or 'debutant').strip()
            if not user.first_login_at:
                user.first_login_at = timezone.now()
            user.save(update_fields=['level', 'first_login_at'])
            _save_record(
                'student/assessment',
                {
                    'level': user.level,
                    'score': body.get('score'),
                    'completedAt': timezone.now().isoformat(),
                },
                user,
                public_id=f'assessment-{user.pk}',
            )
            return _response({'level': user.level, 'initialAssessmentCompleted': True, 'user': _profile(user)})
        if sub == 'assistant' and len(parts) > 3 and parts[3] == 'ask' and request.method == 'POST':
            question = str(body.get('question') or body.get('message') or '').strip()
            answer = _ask_course_chatbot(
                question,
                user=user,
                course_id=str(body.get('courseId') or ''),
                chapter_id=str(body.get('chapterId') or ''),
            )
            return JsonResponse({'answer': answer, 'reply': answer})
        if sub == 'portfolio' and len(parts) > 3 and request.method == 'POST':
            action = parts[3]
            if action == 'course-summary':
                course_id = str(body.get('courseId') or 'Programmation C').strip()
                lvl = str(body.get('level') or user.level or 'intermediaire').strip()
                visible = _visible_student_contents(user)
                course_items = [
                    c for c in visible
                    if _normalized_text(c.get('courseId') or c.get('title')) == _normalized_text(course_id)
                ] or visible
                teacher_name = next((str(c.get('teacherName') or '').strip() for c in course_items if str(c.get('teacherName') or '').strip()), 'Enseignant EduVia')
                res_count = sum(str(c.get('type') or '').casefold() in ('document', 'video') for c in course_items)
                quiz_count = sum('quiz' in str(c.get('type') or '').casefold() for c in course_items)
                return JsonResponse({
                    'courseId': course_id,
                    'courseTitle': course_id,
                    'level': lvl,
                    'resourceCount': res_count,
                    'quizCount': quiz_count,
                    'teacherName': teacher_name,
                    'overview': (
                        f"Ce cours ({course_id}) couvre la démarche complète de résolution d'un problème, "
                        "l'écriture d'algorithmes, la création d'un exécutable en langage C (*.c -> *.o -> exécutable), "
                        "la structure d'un programme C (main, printf, scanf), les structures conditionnelles (if/else, switch) et la boucle for."
                    ),
                    'notions': [
                        {
                            'notion': "Étapes de résolution d'un problème",
                            'explanation': 'Positionner le problème, spécifier/analyser, écrire l’algorithme, coder en C, puis exécuter et tester.',
                            'importance': 'Indispensable pour structurer la logique avant de coder.',
                            'example': 'Déterminer les entrées, sorties et formules avant d’écrire void main().',
                        },
                        {
                            'notion': 'Structure d’un programme C & Compilation',
                            'explanation': 'Fichier source (*.c) compilé en objet (*.o) puis lié aux bibliothèques (#include <stdio.h>, fonction main()).',
                            'importance': 'Base de tout programme exécutable en langage C.',
                            'example': '#include <stdio.h>\nvoid main() { printf("Bienvenue à ESPRIT"); }',
                        },
                        {
                            'notion': 'Structures conditionnelles (if / else / switch)',
                            'explanation': 'Exécuter un bloc selon une condition logique entre parenthèses (&&, ||).',
                            'importance': 'Permet au programme de prendre des décisions.',
                            'example': 'if (moy >= 10) printf("Réussi"); else printf("Échec");',
                        },
                        {
                            'notion': 'Boucle itérative for',
                            'explanation': 'Répéter un bloc d’instructions un nombre de fois connu à l’avance grâce à un compteur.',
                            'importance': 'Automatise les traitements répétitifs sans dupliquer le code.',
                            'example': 'for (a = 1; a <= 10; a++) printf("Bonjour");',
                        },
                    ],
                    'details': [
                        {
                            'title': '1. De l’idée au programme exécutable',
                            'explanation': 'Un programme passe par 5 étapes méthodologiques et 3 étapes techniques (source .c, compilation .o, édition de liens).',
                            'bullets': [
                                'Position du problème et analyse des entrées/sorties.',
                                'Écriture de l’algorithme puis traduction en langage C.',
                                'Compilation et test pour corriger les erreurs de syntaxe et de logique.',
                            ],
                        },
                        {
                            'title': '2. Conditions et boucles en C',
                            'explanation': 'Les structures de contrôle dirigent le flux d’exécution du programme.',
                            'bullets': [
                                'En C, 0 vaut Faux et toute valeur différente de 0 vaut Vrai.',
                                'Utiliser && (ET) et || (OU) pour combiner des conditions.',
                                'Utiliser for(init; condition; incrément) quand le nombre d’itérations est connu.',
                            ],
                        },
                    ],
                    'nextActions': [
                        'Relire les fiches de cours 1.1, 1.2, 2.1, 2.3 et 3.1.',
                        'Tester les exemples de programmes C (calcul du maximum, boucle for).',
                        'Valider les quiz du chapitre pour vérifier vos acquis.',
                    ],
                    'revisionPlan': [
                        {'step': 1, 'text': 'Réviser les 5 étapes de résolution d’un problème et la structure de main().'},
                        {'step': 2, 'text': 'S’entraîner sur les conditions if / else imbriquées et les opérateurs && et ||.'},
                        {'step': 3, 'text': 'Maîtriser la syntaxe de la boucle for et refaire les QCM du cours.'},
                    ],
                    'glossary': [
                        'Algorithme : Suite finie et ordonnée d’étapes permettant de résoudre un problème.',
                        'Compilateur : Outil qui traduit le code source (*.c) en langage machine (*.o).',
                        'main() : Fonction principale obligatoire par laquelle démarre un programme C.',
                        'Compteur : Variable d’itération contrôlant le nombre de répétitions d’une boucle for.',
                    ],
                })
            if action == 'remediation-quiz':
                acquis = str(body.get('acquis') or 'Programmation C').strip()
                course_id = str(body.get('courseId') or 'Programmation C').strip()
                chapter_id = str(body.get('chapterId') or 'Chapitre 1').strip()
                return JsonResponse({
                    'id': f'remediation-{uuid.uuid4().hex[:8]}',
                    'title': f'Renforcer {acquis}',
                    'type': 'quiz',
                    'courseId': course_id,
                    'chapterId': chapter_id,
                    'quizDurationMinutes': 10,
                    'quizPassingScore': 70,
                    'description': f'Quiz ciblé sur le cours ({acquis}) pour consolider vos acquis.',
                    'quizQuestions': [
                        {
                            'id': 'q1',
                            'prompt': "Quelle est la première étape à réaliser avant d'écrire un programme en langage C ?",
                            'options': [
                                'Compiler le programme',
                                "Écrire l'algorithme",
                                'Positionner le problème à résoudre',
                                'Tester le code sur un ordinateur',
                            ],
                            'correctAnswers': [2],
                            'explanation': 'La première étape est toujours la position du problème (bonne formulation).',
                        },
                        {
                            'id': 'q2',
                            'prompt': 'Quel est le rôle du compilateur en langage C ?',
                            'options': [
                                'Exécuter directement le code',
                                'Traduire le code source (*.c) en langage machine (*.o)',
                                'Corriger les erreurs automatiquement',
                                "Écrire l'algorithme",
                            ],
                            'correctAnswers': [1],
                            'explanation': 'Le compilateur traduit les fichiers source en fichiers objets en langage machine.',
                        },
                        {
                            'id': 'q3',
                            'prompt': 'Quelle est la fonction principale obligatoire de tout programme en langage C ?',
                            'options': ['start()', 'program()', 'main()', 'init()'],
                            'correctAnswers': [2],
                            'explanation': 'En langage C, la fonction particulière main() est toujours la fonction principale.',
                        },
                        {
                            'id': 'q4',
                            'prompt': 'Que va afficher : int x = 5; if (x > 3) if (x < 10) printf("A"); else printf("B"); ?',
                            'options': ['A', 'B', 'Rien', 'Erreur'],
                            'correctAnswers': [0],
                            'explanation': 'x vaut 5, donc x > 3 et x < 10 sont vraies : le programme affiche A.',
                        },
                        {
                            'id': 'q5',
                            'prompt': 'Quand utilise-t-on principalement la boucle « for » en langage C ?',
                            'options': [
                                "Quand le nombre de répétitions est connu à l'avance",
                                'Uniquement pour afficher du texte sans répéter',
                                'Pour remplacer la bibliothèque stdio.h',
                                'Pour déclarer une bibliothèque',
                            ],
                            'correctAnswers': [0],
                            'explanation': "La boucle for permet d'exécuter un bloc d'instructions un nombre de fois connu à l'avance grâce à un compteur.",
                        },
                    ],
                })
        if sub == 'progress' and request.method == 'POST':
            content_id = str(body.get('contentId') or '').strip()
            public_id = f'progress-{user.pk}-{content_id}' if content_id else None
            rec = _save_record('student/progress', body, user, public_id)
            return JsonResponse(_resource_dict(rec))
        if sub == 'quizzes' and request.method == 'GET':
            student_class = str(user.class_name or '').strip().casefold()
            quizzes = []
            for record in Resource.objects.filter(collection='contents'):
                quiz = _resource_dict(record)
                quiz_type = str(quiz.get('type') or '').strip().casefold()
                if 'quiz' not in quiz_type and not isinstance(quiz.get('quizQuestions'), list):
                    continue
                visible_classes = quiz.get('visibleToClasses') or []
                if isinstance(visible_classes, str):
                    visible_classes = [visible_classes]
                allowed = {str(v).strip().casefold() for v in visible_classes if str(v).strip()}
                if quiz.get('visibleToAllClasses') is True or not allowed or (student_class and student_class in allowed):
                    quizzes.append(quiz)
            return JsonResponse(quizzes, safe=False)
        if sub == 'leaderboard' and request.method == 'GET':
            classmates_qs = User.objects.filter(user_role='student', is_active=True)
            if user.class_name:
                classmates_qs = classmates_qs.filter(class_name__iexact=user.class_name)
            classmates = list(classmates_qs)
            content_by_id = {
                str(record.public_id): _resource_dict(record)
                for record in Resource.objects.filter(collection='contents')
            }
            progress_by_owner = {}
            if classmates:
                for rec in Resource.objects.filter(collection='student/progress', owner__in=classmates):
                    progress_by_owner.setdefault(rec.owner_id, []).append(rec)
            students = []
            for student in classmates:
                scores = []
                completed_content_ids = set()
                for record in progress_by_owner.get(student.pk, []):
                    cid = str(record.payload.get('contentId') or '').strip()
                    status_val = str(record.payload.get('status') or '').strip().casefold()
                    if status_val in ('completed', 'passed') and cid:
                        completed_content_ids.add(cid)
                    if record.payload.get('score') is not None:
                        try:
                            scores.append(max(0, min(100, round(float(record.payload.get('score'))))))
                        except (TypeError, ValueError):
                            pass
                avg_score = round(sum(scores) / len(scores)) if scores else 0
                points = len(completed_content_ids) * 25 + sum(scores)
                lvl_key = str(student.level or 'intermediaire').strip().lower()
                if lvl_key not in ('debutant', 'intermediaire', 'avance'):
                    lvl_key = 'intermediaire'
                lvl_label = {'debutant': 'Débutant', 'intermediaire': 'Intermédiaire', 'avance': 'Avancé'}[lvl_key]
                courses_done = len({
                    str(content_by_id[cid].get('courseId') or '').strip()
                    for cid in completed_content_ids
                    if cid in content_by_id and str(content_by_id[cid].get('courseId') or '').strip()
                })
                students.append({
                    'id': str(student.pk),
                    'rank': 0,
                    'name': student.get_full_name() or student.username,
                    'avatarDataUrl': student.avatar or '',
                    'levelKey': lvl_key,
                    'level': lvl_label,
                    'className': student.class_name or '',
                    'points': points,
                    'courses': courses_done,
                    'average': avg_score,
                    'isCurrentStudent': student.pk == user.pk,
                })
            students.sort(key=lambda item: (-item['points'], -item['average'], item['name'].casefold()))
            for idx, item in enumerate(students, start=1):
                item['rank'] = idx
            current_entry = next((item for item in students if item.get('isCurrentStudent')), None)
            today = date.today()
            monday = today - timedelta(days=today.weekday())
            sunday = monday + timedelta(days=6)
            return JsonResponse({
                'className': user.class_name or '',
                'week': {
                    'startsAt': monday.isoformat(),
                    'endsAt': sunday.isoformat(),
                    'label': f'Semaine du {monday.strftime("%d/%m")} au {sunday.strftime("%d/%m")}',
                },
                'topStudents': students[:3],
                'students': students,
                'currentStudent': current_entry,
            })
        if sub == 'flashcards':
            action = parts[3] if len(parts) > 3 else ''
            if action == 'start' and request.method == 'POST':
                subject = str(body.get('subject') or 'Toutes les matieres').strip()
                difficulty = str(body.get('difficulty') or 'intermediaire').strip()
                try:
                    question_count = max(1, min(int(body.get('questionCount') or 10), 20))
                except (TypeError, ValueError):
                    question_count = 10
                cards = _make_flashcards(user, subject, difficulty, question_count)
                session_rec = _save_record('student/flashcards', {
                    'subject': subject,
                    'difficulty': difficulty,
                    'cards': cards,
                    'durationSeconds': 180,
                    'score': 0,
                }, user)
                return JsonResponse(_resource_dict(session_rec))
            if len(parts) > 4 and parts[4] == 'submit' and request.method == 'POST':
                session_rec = _owned_records('student/flashcards', user).filter(public_id=parts[3]).first()
                if not session_rec:
                    return JsonResponse({'success': False, 'message': 'Session introuvable'}, status=404)
                cards = session_rec.payload.get('cards') or []
                answers_by_id = {
                    str(item.get('cardId') or ''): item
                    for item in (body.get('answers') or [])
                    if isinstance(item, dict)
                }
                correct_count = 0
                for card in cards:
                    submitted = answers_by_id.get(str(card.get('id') or ''), {})
                    user_ans = str(submitted.get('userAnswer') or card.get('userAnswer') or '').strip()
                    card['userAnswer'] = user_ans
                    card['revealed'] = bool(submitted.get('revealed') or user_ans)
                    card['correct'] = _flashcard_answer_matches(user_ans, card.get('answer') or '')
                    if card['correct']:
                        correct_count += 1
                score = round(correct_count * 100 / len(cards)) if cards else 0
                session_rec.payload.update({'cards': cards, 'score': score, 'completed': True})
                session_rec.save(update_fields=['payload', 'updated_at'])
                return JsonResponse(_resource_dict(session_rec))
        if sub == 'forum' and len(parts) > 3 and parts[3] == 'requests':
            req_qs = Resource.objects.filter(collection='student/forum/requests')
            if len(parts) == 4 and request.method == 'GET':
                requests_list = []
                for r in req_qs:
                    p = r.payload or {}
                    is_mine = r.owner_id == user.pk or str(p.get('authorEmail') or '').casefold() == user.email.casefold()
                    requests_list.append({
                        **p,
                        'id': r.public_id,
                        '_id': r.public_id,
                        'canDelete': is_mine,
                        'isMine': is_mine,
                    })
                open_q = sum(1 for item in requests_list if item.get('status') != 'En discussion')
                return JsonResponse({
                    'requests': requests_list,
                    'stats': {
                        'openQuestions': open_q,
                        'repliesToday': sum(int(item.get('replies') or 0) for item in requests_list),
                        'resolutionRate': round((len(requests_list) - open_q) * 100 / len(requests_list)) if requests_list else 100,
                    },
                })
            if len(parts) == 4 and request.method == 'POST':
                subject = str(body.get('subject') or body.get('title') or 'Question').strip()
                msg_text = str(body.get('message') or '').strip()
                now = timezone.now().strftime('%H:%M')
                rec = _save_record('student/forum/requests', {
                    'author': user.get_full_name() or user.username,
                    'authorEmail': user.email,
                    'authorAvatarDataUrl': user.avatar or '',
                    'level': user.class_name or user.level or 'Etudiant',
                    'authorLevel': user.class_name or user.level or 'Etudiant',
                    'title': subject,
                    'subject': subject,
                    'message': msg_text,
                    'time': now,
                    'replies': 0,
                    'status': 'En attente',
                }, user)
                req_dict = {**_resource_dict(rec), 'canDelete': True, 'isMine': True}
                return JsonResponse({'request': req_dict}, status=201)
            if len(parts) == 5 and request.method == 'DELETE':
                rec = req_qs.filter(public_id=parts[4]).first()
                if rec:
                    rec.delete()
                return JsonResponse({'success': True})
            if len(parts) >= 6 and parts[5] == 'chat':
                rec = req_qs.filter(public_id=parts[4]).first()
                if not rec:
                    return JsonResponse({'success': False, 'message': 'Demande introuvable'}, status=404)
                chat, _ = Resource.objects.get_or_create(
                    collection='student/forum/chats',
                    public_id=rec.public_id,
                    defaults={'owner': rec.owner, 'payload': {'messages': []}},
                )
                if len(parts) == 6 and request.method == 'GET':
                    return JsonResponse({'request': _resource_dict(rec), 'messages': chat.payload.get('messages', [])})
                if len(parts) == 7 and parts[6] == 'messages' and request.method == 'POST':
                    now = timezone.now().strftime('%H:%M')
                    message = {
                        'id': str(uuid.uuid4()),
                        'senderType': 'author' if rec.owner_id == user.pk else 'helper',
                        'senderName': user.get_full_name() or user.username,
                        'senderEmail': user.email,
                        'senderLevel': user.class_name or user.level or 'Etudiant',
                        'text': str(body.get('message') or '').strip(),
                        'attachments': body.get('attachments') if isinstance(body.get('attachments'), list) else [],
                        'transcript': str(body.get('transcript') or ''),
                        'time': now,
                    }
                    if not message['text'] and not message['attachments']:
                        return JsonResponse({'success': False, 'message': 'Message vide'}, status=400)
                    messages = chat.payload.get('messages', [])
                    messages.append(message)
                    chat.payload['messages'] = messages
                    chat.save(update_fields=['payload', 'updated_at'])
                    if rec.owner_id != user.pk:
                        rec.payload['replies'] = int(rec.payload.get('replies') or 0) + 1
                        rec.payload['lastResponderName'] = user.get_full_name() or user.username
                        rec.payload['status'] = 'En discussion'
                        rec.save(update_fields=['payload', 'updated_at'])
                    return JsonResponse({'request': _resource_dict(rec), 'message': message, 'messages': messages}, status=201)
    return None


def _validate_internship(payload):
    required = ('title','company','city','domain','duration','email','phone','deadline','description')
    if any(not str(payload.get(key,'')).strip() for key in required): return 'Tous les champs obligatoires doivent être remplis.'
    if len(str(payload.get('description','')).strip()) < 20: return 'La description doit contenir au moins 20 caractères.'
    skills = payload.get('skills') or []
    if isinstance(skills, str): skills = [value.strip() for value in re.split(r'[,\n]', skills) if value.strip()]
    if not skills: return 'Ajoutez au moins une compétence.'
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', str(payload.get('email','')).strip()): return 'Adresse email invalide.'
    if payload.get('website') and not re.match(r'^https?://.+', str(payload['website']), re.I): return 'Site web invalide.'
    return None


@csrf_exempt
@require_http_methods(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])
def api(request, path=''):
    """Compatibility API for existing Angular routes, with persisted JSON resources."""
    if request.method == 'OPTIONS':
        return HttpResponse(status=204)
    body = _body(request)
    parts = [p for p in path.strip('/').split('/') if p]

    if parts[:1] == ['auth']:
        action = parts[1] if len(parts) > 1 else ''
        if action == 'verify-email' and request.method == 'GET':
            _, frontend = _get_base_urls(request)
            try:
                data = signing.loads(request.GET.get('token', ''), salt='eduvia-email-verification', max_age=60 * 60 * 24)
                if data.get('purpose') != 'email-verification': raise signing.BadSignature('Invalid purpose')
                target = User.objects.get(pk=data['uid'])
                if not target.email_verified:
                    target.email_verified = True
                    target.is_active = True
                    target.save(update_fields=['email_verified', 'is_active'])
                role = getattr(target, 'user_role', 'student') or 'student'
                query = urlencode({'verified': '1', 'role': role, 'email': target.email})
                return redirect(f'{frontend}/?{query}')
            except Exception:
                return redirect(f'{frontend}/?{urlencode({"verified": "0", "message": "Lien de confirmation invalide ou expiré"})}')
        if action == 'login' and request.method == 'POST':
            login_id = (body.get('email') or '').strip().lower()
            user = User.objects.filter(email__iexact=login_id).first() or User.objects.filter(username__iexact=login_id).first()
            if not user or not user.check_password(body.get('password', '')) or not user.is_active:
                return JsonResponse({'success': False, 'message': 'Email ou mot de passe invalide'}, status=401)
            token = _token(user)
            profile = _profile(user)
            return _response({'access_token': token, 'refresh_token': _refresh_token(user), 'user': profile, 'role': profile['role']})
        if action == 'refresh' and request.method == 'POST':
            refresh = str(body.get('refresh_token') or '')
            try:
                data = signing.loads(refresh, salt='eduvia-refresh', max_age=60 * 60 * 24 * 30)
            except signing.BadSignature:
                # Tokens issued before separate refresh tokens were introduced used the access-token salt.
                try:
                    data = signing.loads(refresh, salt='eduvia-api', max_age=60 * 60 * 24 * 14)
                except signing.BadSignature:
                    return JsonResponse({'success': False, 'message': 'Session expirée, veuillez vous reconnecter.'}, status=401)
            user = User.objects.filter(pk=data.get('uid'), is_active=True).first()
            if not user:
                return JsonResponse({'success': False, 'message': 'Session expirée, veuillez vous reconnecter.'}, status=401)
            return _response({'access_token': _token(user), 'refresh_token': _refresh_token(user)})
        if action == 'logout':
            return _response({'success': True})
        if action == 'verify':
            user = _user(request)
            return _response({'user': _profile(user)}) if user else JsonResponse({'success': False}, status=401)
        if action == 'profile':
            user = _user(request)
            if not user: return JsonResponse({'success': False}, status=401)
            if request.method in ('PATCH', 'PUT'):
                user.first_name = body.get('firstName', user.first_name)
                user.last_name = body.get('lastName', user.last_name)
                user.email = body.get('email', user.email)
                user.avatar = body.get('avatarDataUrl', user.avatar)
                if 'className' in body: user.class_name = body['className']
                if 'level' in body: user.level = body['level']
                if 'fullName' in body and not body.get('firstName'):
                    names = str(body['fullName']).strip().split(' ', 1)
                    user.first_name = names[0]
                    user.last_name = names[1] if len(names) > 1 else ''
                user.save()
            return _response(_profile(user))
        if action == 'password-status':
            user = _user(request)
            return _response({'needsPasswordChange': bool(user and user.user_role in ('teacher','student') and not user.password_changed), 'blocked': False})
        if action == 'reset-password' and len(parts) > 2 and parts[2] == 'validate' and request.method == 'GET':
            try:
                data = signing.loads(request.GET.get('token',''), salt='eduvia-reset', max_age=3600)
                if data.get('purpose') != 'password-reset': raise signing.BadSignature('Invalid purpose')
                target = User.objects.get(pk=data['uid'])
                role = 'admin' if target.is_superuser else target.user_role
                if role not in ('student', 'teacher'):
                    raise signing.BadSignature('Unsupported reset role')
                return _response({
                    'valid': True,
                    'role': role,
                    'email': target.email,
                    'name': target.get_full_name() or target.username,
                })
            except Exception:
                return _response({'valid': False})
        if action == 'validate-current-password' and request.method == 'POST':
            user = _user(request)
            return _response({'valid': bool(user and user.check_password(body.get('currentPassword', '')))})
        if action == 'change-password' and request.method == 'POST':
            user = _user(request)
            if not user: return JsonResponse({'success':False}, status=401)
            if not user.check_password(body.get('currentPassword', '')): return JsonResponse({'success':False,'message':'Current password is incorrect'}, status=400)
            new_password = body.get('newPassword', '')
            if new_password != body.get('confirmPassword', ''): return JsonResponse({'success':False,'message':'Password confirmation does not match'}, status=400)
            try: validate_password(new_password, user)
            except Exception as error: return JsonResponse({'success':False,'message':'; '.join(error.messages)}, status=400)
            user.set_password(new_password); user.password_changed = True; user.save(update_fields=['password','password_changed'])
            return _response({'message':'Password changed'})
        if action == 'reset-password' and request.method == 'POST':
            try:
                data = signing.loads(body.get('token',''), salt='eduvia-reset', max_age=3600)
                if data.get('purpose') != 'password-reset': raise signing.BadSignature('Invalid purpose')
                target = User.objects.get(pk=data['uid'])
            except (signing.BadSignature, User.DoesNotExist, KeyError, TypeError, ValueError, ValidationError):
                return JsonResponse({'success':False,'message':'Le lien de reinitialisation est invalide ou expire.'}, status=400)

            new_password = body.get('newPassword', '')
            if new_password != body.get('confirmPassword', ''):
                return JsonResponse({'success':False,'message':'La confirmation du mot de passe ne correspond pas.'}, status=400)
            try:
                validate_password(new_password, target)
            except ValidationError as error:
                return JsonResponse({
                    'success':False,
                    'message':'Choisissez un mot de passe différent et respectant les règles de sécurité : ' + '; '.join(error.messages),
                }, status=400)

            target.set_password(new_password)
            target.password_changed = True
            target.save(update_fields=['password','password_changed'])
            return _response({'message':'Password reset'})
        if action == 'forgot-password' and request.method == 'POST':
            target = User.objects.filter(email__iexact=body.get('email','').strip()).first()
            email_sent = False
            error_msg = ''
            if target:
                token = signing.dumps({'uid': str(target.pk), 'purpose':'password-reset'}, salt='eduvia-reset')
                reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?{urlencode({'token': token})}"
                message = (
                    f"Bonjour {target.first_name or target.username},\n\n"
                    "Pour choisir un nouveau mot de passe EduVia, ouvrez ce lien (valable une heure) :\n"
                    f"{reset_url}\n\nSi vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail."
                )
                email_sent, error_msg = _send_system_email(target.email, 'Réinitialisation du mot de passe EduVia', message)
                if not email_sent:
                    return JsonResponse({
                        'success': False,
                        'message': error_msg or "Le serveur e-mail n'a pas accepté l'envoi. Vérifiez les paramètres dans .env.",
                    }, status=503)
            return _response({
                'message': "Si cette adresse correspond à un compte, un lien a été envoyé. Vérifiez aussi les courriers indésirables.",
                'emailSent': email_sent,
            })
        if action in ('forgot-password', 'reset-password', 'change-password', 'validate-current-password'):
            return _response({'message': 'Demande traitée'})
        sub_action = '/'.join(parts[1:3])
        if action == 'face-id/config' or sub_action == 'face-id/config':
            return _response({'hashLength': 256, 'matchThreshold': 82, 'duplicateThreshold': 40, 'ambiguityMargin': 6})
        if (action == 'face-id/enroll' or sub_action == 'face-id/enroll') and request.method in ('POST', 'DELETE'):
            user = _user(request)
            if not user:
                return JsonResponse({'success': False, 'message': 'Authentification requise'}, status=401)
            if request.method == 'DELETE':
                user.face_hash = ''
                user.save(update_fields=['face_hash'])
                _invalidate_caches(user_id=user.pk)
                return _response({'enrolled': False, 'faceIdEnabled': False, 'user': _profile(user)})
            face_hash = str(body.get('faceHash', '')).strip()
            if not re.fullmatch(r'[01]{64,512}', face_hash):
                return JsonResponse({'success': False, 'message': 'Empreinte faciale invalide. Veuillez réessayer face à la caméra.'}, status=400)
            # Enforce unique Face ID per user
            duplicate_threshold = round(len(face_hash) * 0.22)
            for other in User.objects.exclude(pk=user.pk).exclude(face_hash=''):
                other_hash = str(other.face_hash or '').strip()
                if len(other_hash) != len(face_hash):
                    continue
                distance = sum(1 for a, b in zip(other_hash, face_hash) if a != b)
                if distance <= duplicate_threshold:
                    return JsonResponse({
                        'success': False,
                        'message': "Ce visage est déjà associé à un autre compte utilisateur. Chaque utilisateur doit avoir un Face ID unique.",
                    }, status=409)
            user.face_hash = face_hash
            user.save(update_fields=['face_hash'])
            _invalidate_caches(user_id=user.pk)
            return _response({'enrolled': True, 'faceIdEnabled': True, 'user': _profile(user), 'message': 'Face ID unique enregistré avec succès.'})
        if (action == 'face-id/login' or sub_action == 'face-id/login') and request.method == 'POST':
            face_hash = str(body.get('faceHash', '')).strip()
            if not re.fullmatch(r'[01]{64,512}', face_hash):
                return JsonResponse({'success': False, 'message': 'Empreinte faciale invalide.'}, status=400)
            requested_role = str(body.get('role') or '').strip().lower()
            candidates = User.objects.filter(is_active=True).exclude(face_hash='')
            if requested_role in ('student', 'teacher'):
                candidates = candidates.filter(user_role=requested_role)
            scored_candidates = []
            for candidate in candidates:
                stored_hash = str(candidate.face_hash or '').strip()
                if len(stored_hash) != len(face_hash):
                    continue
                distance = sum(1 for a, b in zip(stored_hash, face_hash) if a != b)
                scored_candidates.append((distance, candidate))
            scored_candidates.sort(key=lambda item: item[0])
            best_distance, best_user = scored_candidates[0] if scored_candidates else (10**9, None)
            max_allowed = round(len(face_hash) * 0.32)
            if not best_user or best_distance > max_allowed:
                return JsonResponse({
                    'success': False,
                    'message': "Visage non reconnu ou aucun Face ID configuré pour ce profil. Activez d'abord Face ID dans Paramètres.",
                }, status=401)
            token = _token(best_user)
            profile = _profile(best_user)
            return _response({'access_token': token, 'refresh_token': _refresh_token(best_user), 'user': profile, 'role': profile['role']})
        if action in ('teacher-course-members', 'teacher-exam-reminders'):
            user = _user(request)
            if not user or user.user_role not in ('teacher','admin'): return JsonResponse({'success':False}, status=403)
            class_name = request.GET.get('className')
            if action == 'teacher-course-members':
                return _response(_teacher_course_members(user, class_name))
            return _response(_teacher_exam_reminders(user, class_name))
        if action == 'student-classes':
            _sync_legacy_mongo_users()
            return _response(list(User.objects.exclude(class_name='').values_list('class_name', flat=True).distinct()))
        if action in ('users', 'admin/create-user') or sub_action == 'admin/create-user':
            user = _user(request)
            if not user or not user.is_superuser: return JsonResponse({'success':False,'message':'Permission denied'}, status=403)
            if len(parts) == 4 and parts[3] == 'resend-verification' and request.method == 'POST':
                target = User.objects.filter(pk=parts[2]).first()
                if not target: return JsonResponse({'success':False,'message':'Utilisateur introuvable'}, status=404)
                if target.email_verified: return _response({'emailSent':False,'emailVerified':True})
                sent, error_msg = _send_verification_email(target, request=request)
                if target.email_verified: return _response({'emailSent':False,'emailVerified':True})
                if not sent:
                    return JsonResponse({'success':False,'message': error_msg or "E-mail non envoyé. Vérifiez la configuration SMTP Django."}, status=503)
                return _response({'emailSent': True, 'emailVerified':False})
            if request.method == 'GET':
                if len(parts) > 2:
                    target = User.objects.filter(pk=parts[2]).first()
                    return _response(_profile(target)) if target else JsonResponse({'success':False}, status=404)
                return _response([_profile(u, check_resources=False) for u in User.objects.all()])
            if request.method == 'POST':
                email = (body.get('email') or '').lower()
                if not email: return JsonResponse({'success': False, 'message': 'Email obligatoire'}, status=400)
                username = body.get('username') or email
                password = body.get('password') or uuid.uuid4().hex
                now_ts = timezone.now()
                existing_user = User.objects.filter(email__iexact=email).first()
                if existing_user:
                    existing_user.first_name = body.get('firstName', existing_user.first_name)
                    existing_user.last_name = body.get('lastName', existing_user.last_name)
                    existing_user.user_role = body.get('role', existing_user.user_role)
                    existing_user.class_name = body.get('className', existing_user.class_name)
                    existing_user.assigned_classes = body.get('assignedClasses', existing_user.assigned_classes)
                    existing_user.teaching_subjects = body.get('teachingSubjects', existing_user.teaching_subjects)
                    existing_user.teaching_assignments = body.get('teachingAssignments', existing_user.teaching_assignments)
                    existing_user.set_password(password)
                    existing_user.is_active = True
                    existing_user.date_joined = now_ts
                    existing_user.last_login = now_ts
                    existing_user.save()
                    new_user = existing_user
                else:
                    new_user = User.objects.create_user(username=username, email=email, password=password,
                        first_name=body.get('firstName', ''), last_name=body.get('lastName', ''),
                        user_role=body.get('role', 'student'), class_name=body.get('className', ''),
                        assigned_classes=body.get('assignedClasses', []), teaching_subjects=body.get('teachingSubjects', []),
                        teaching_assignments=body.get('teachingAssignments', []))
                    new_user.date_joined = now_ts
                    new_user.last_login = now_ts
                    new_user.save(update_fields=['date_joined', 'last_login'])
                generated_password = not body.get('password')
                sent, email_error = _send_verification_email(new_user, password if generated_password else None, request=request)
                payload = {**_profile(new_user), 'emailSent': bool(sent)}
                if not sent:
                    payload['emailError'] = email_error
                    if generated_password:
                        # Let the admin hand over the credentials manually when the e-mail could not be delivered.
                        payload['temporaryPassword'] = password
                return _response(payload)
            if len(parts) > 2:
                target = User.objects.filter(pk=parts[2]).first()
                if target and request.method in ('PATCH', 'PUT'):
                    new_email = body.get('email', target.email)
                    if new_email.lower() != target.email.lower(): target.email_verified = False
                    target.email = new_email; target.first_name = body.get('firstName', target.first_name)
                    target.last_name = body.get('lastName', target.last_name); target.user_role = body.get('role', target.user_role)
                    target.class_name = body.get('className', target.class_name)
                    target.assigned_classes = body.get('assignedClasses', target.assigned_classes)
                    target.teaching_subjects = body.get('teachingSubjects', target.teaching_subjects)
                    target.teaching_assignments = body.get('teachingAssignments', target.teaching_assignments)
                    target.save(); return _response(_profile(target))
                if target and request.method == 'DELETE': target.delete(); return _response({'deleted': True})

    user = _user(request)
    specialized = _domain_api(request, body, parts, user)
    if specialized is not None:
        return specialized

    # Each feature route stores its records in a namespaced JSON collection.
    tail = parts[1:] if parts[:1] == ['api'] else parts
    if not tail: return _response({'service': 'EduVia Django API', 'status': 'ok'})
    identifier = None
    collection = '/'.join(tail)
    # Treat a trailing path segment as an ID only when that record exists.
    if len(tail) > 1:
        candidate = '/'.join(tail[:-1])
        if Resource.objects.filter(collection=candidate, public_id=tail[-1]).exists():
            collection, identifier = candidate, tail[-1]
    if collection in ('student/dashboard', 'student/leaderboard', 'contents/dashboard-stats', 'notifications/read-state'):
        return _response({'items': [], 'stats': {}, 'total': 0})
    if collection == 'clubs/recommendations': return _response({'clubs': [], 'recommendations': []})

    qs = Resource.objects.filter(collection=collection)
    if identifier:
        qs = qs.filter(public_id=identifier)
    if request.method == 'GET':
        rows = list(qs)
        if identifier and rows:
            return _response({**rows[0].payload, '_id': rows[0].public_id, 'id': rows[0].public_id})
        return JsonResponse({'success': True, 'data': [{**r.payload, '_id': r.public_id, 'id': r.public_id} for r in rows], 'items': [{**r.payload, '_id': r.public_id} for r in rows]})
    if request.method == 'POST':
        public_id = str(body.get('_id') or body.get('id') or uuid.uuid4())
        payload = {k: v for k, v in body.items() if k not in ('_id', 'id')}
        record, _ = Resource.objects.update_or_create(collection=collection, public_id=public_id, defaults={'payload': payload, 'owner': user})
        return _response({**record.payload, '_id': record.public_id, 'id': record.public_id})
    if request.method in ('PATCH', 'PUT') and identifier:
        record = qs.first()
        if not record: return JsonResponse({'success': False, 'message': 'Ressource introuvable'}, status=404)
        record.payload.update(body); record.save(update_fields=['payload', 'updated_at'])
        return _response({**record.payload, '_id': record.public_id, 'id': record.public_id})
    if request.method == 'DELETE' and identifier:
        deleted, _ = qs.delete()
        return _response({'success': bool(deleted)})
    return JsonResponse({'success': False, 'message': 'Méthode non prise en charge'}, status=405)


@csrf_exempt
@require_http_methods(['POST'])
def register(request):
    body = _body(request)
    email = (body.get('email') or '').strip().lower()
    if not email or not body.get('password'):
        return JsonResponse({'success': False, 'message': 'Email et mot de passe obligatoires'}, status=400)
    username = body.get('username') or email
    if User.objects.filter(username=username).exists() or User.objects.filter(email=email).exists():
        return JsonResponse({'success': False, 'message': 'Compte déjà existant'}, status=409)
    now_ts = timezone.now()
    user = User.objects.create_user(username=username, email=email, password=body['password'], user_role='student')
    user.date_joined = now_ts
    user.last_login = now_ts
    user.save(update_fields=['date_joined', 'last_login'])
    try:
        _send_verification_email(user, request=request)
    except Exception:
        pass
    token = _token(user)
    return _response({'access_token': token, 'refresh_token': token, 'user': _profile(user)})
